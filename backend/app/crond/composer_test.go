package crond

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func waitComposer(t *testing.T, c *client, base string, expected string) Object {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		result := c.call("GET", base+"/composer", nil, 200).(map[string]interface{})
		if str(result, "status") != "running" {
			if str(result, "status") != expected {
				t.Fatal(result)
			}
			return result
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("Composer did not finish")
	return nil
}

func TestComposerLocalPackageInstallationAndExecution(t *testing.T) {
	if _, err := composerPHARPath(); err != nil {
		t.Skip("Composer not available")
	}
	s, c, base := loginProject(t)
	project := strings.TrimPrefix(base, "/api/projects/")
	files, _ := s.list(project, "files", "")
	var manifest Object
	for _, file := range files {
		if filePath(file) == "composer.json" {
			manifest = file
		}
	}
	config := Object{
		"name":         "crond/test",
		"require":      Object{"fixture/greeting": "1.0.0"},
		"repositories": []interface{}{Object{"type": "path", "url": "packages/greeting", "options": Object{"symlink": false}}, Object{"packagist.org": false}},
		"autoload":     Object{"psr-4": Object{"App\\": "src/"}},
	}
	encoded, _ := json.Marshal(config)
	c.call("PATCH", base+"/files/"+str(manifest, "id"), Object{"content": string(encoded)}, 200)
	c.call("POST", base+"/files", Object{"path": "packages/greeting/composer.json", "type": "file", "content": `{"name":"fixture/greeting","version":"1.0.0","autoload":{"psr-4":{"Fixture\\":"src/"}}}`}, 200)
	c.call("POST", base+"/files", Object{"path": "packages/greeting/src/Greeting.php", "type": "file", "content": "<?php namespace Fixture; class Greeting { public static function hello() { return 'composer-package-loaded'; } }"}, 200)
	c.call("POST", base+"/files", Object{"path": "src/Example.php", "type": "file", "content": "<?php namespace App; class Example { public static function value() { return 'project-class-loaded'; } }"}, 200)
	c.call("POST", base+"/composer/install", Object{"operation": "install"}, 202)
	status := waitComposer(t, c, base, "success")
	if status["installed"] != true || status["outdated"] != false {
		t.Fatal(status)
	}
	run := c.call("POST", base+"/execute", Object{"type": "php", "content": "<?php echo Fixture\\Greeting::hello().':'.App\\Example::value();"}, 200).(map[string]interface{})
	if run["status"] != "success" || !strings.Contains(str(run, "output"), "composer-package-loaded:project-class-loaded") {
		t.Fatal(run)
	}
	// Vendor persists beyond an individual execution directory and is reusable.
	c.call("POST", base+"/execute", Object{"type": "php", "content": "<?php echo Fixture\\Greeting::hello();"}, 200)
	c.call("POST", base+"/services", Object{"name": "Composer service", "method": "POST", "route": "/composer", "content": "<?php function handle(Request $r) { return ['value'=>Fixture\\Greeting::hello()]; }"}, 200)
	response := c.call("POST", base+"/invoke/composer", nil, 200).(map[string]interface{})
	if response["value"] != "composer-package-loaded" {
		t.Fatal(response)
	}
	// An invalid new declaration never replaces the successful vendor snapshot.
	c.call("PATCH", base+"/files/"+str(manifest, "id"), Object{"content": string(encoded) + " "}, 200)
	status = c.call("GET", base+"/composer", nil, 200).(map[string]interface{})
	if status["outdated"] != true {
		t.Fatal("modified manifest not detected")
	}
	run = c.call("POST", base+"/execute", Object{"type": "php", "content": "<?php echo 'blocked';"}, 200).(map[string]interface{})
	if run["status"] != "error" {
		t.Fatal("stale vendor used", run)
	}
	c.call("PATCH", base+"/files/"+str(manifest, "id"), Object{"content": string(encoded)}, 200)
	c.call("POST", base+"/composer/install", Object{"operation": "update"}, 202)
	waitComposer(t, c, base, "success")
	bad := Object{"name": "crond/test", "require": Object{"fixture/greeting": "2.0.0"}, "repositories": config["repositories"], "autoload": config["autoload"]}
	broken, _ := json.Marshal(bad)
	c.call("PATCH", base+"/files/"+str(manifest, "id"), Object{"content": string(broken)}, 200)
	c.call("POST", base+"/composer/install", Object{"operation": "update"}, 202)
	waitComposer(t, c, base, "error")
	c.call("PATCH", base+"/files/"+str(manifest, "id"), Object{"content": string(encoded)}, 200)
	run = c.call("POST", base+"/execute", Object{"type": "php", "content": "<?php echo Fixture\\Greeting::hello();"}, 200).(map[string]interface{})
	if run["status"] != "success" {
		t.Fatal("failed install removed working dependencies", run)
	}
	// Saved vendor remains available after restarting the backend.
	// Locate setup's temporary on-disk database.
	var databasePaths []struct{ File string }
	s.db.Raw("PRAGMA database_list").Scan(&databasePaths)
	if len(databasePaths) == 0 {
		t.Fatal("missing database path")
	}
	s.Close()
	second, err := New(databasePaths[0].File)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	second.workRoot = t.TempDir()
	result := second.execute(context.Background(), project, Object{"type": "php", "content": "<?php echo Fixture\\Greeting::hello();"})
	if result.Status != "success" || !strings.Contains(result.Output, "composer-package-loaded") {
		t.Fatal("dependencies lost after restart", result)
	}
}

func TestComposerValidationAndFailurePreservesBuild(t *testing.T) {
	s, c, base := loginProject(t)
	project := strings.TrimPrefix(base, "/api/projects/")
	files, _ := s.list(project, "files", "")
	var manifest Object
	for _, file := range files {
		if filePath(file) == "composer.json" {
			manifest = file
		}
	}
	c.call("PATCH", base+"/files/"+str(manifest, "id"), Object{"content": `{"config":{"vendor-dir":"elsewhere"}}`}, 403)
	if _, _, err := s.composerManifest(project); err != nil {
		t.Fatal("rejected write changed manifest", err)
	}
	c.call("PATCH", base+"/files/"+str(manifest, "id"), Object{"content": "invalid json"}, 403)
	if _, _, err := s.composerManifest(project); err != nil {
		t.Fatal("rejected invalid write changed manifest", err)
	}
}
