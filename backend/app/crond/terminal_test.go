package crond

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestProjectTerminalPersistencePHPAndCredentials(t *testing.T) {
	s, c, base := loginProject(t)
	c.call("POST", base+"/terminal", Object{"command": "mkdir -p src/Tools && printf 'persistent-source' > src/Tools/check.txt && cat src/Tools/check.txt"}, 202)
	status := waitComposer(t, c, base, "success")
	if !strings.Contains(str(status, "output"), "persistent-source") {
		t.Fatal(status)
	}
	project := strings.TrimPrefix(base, "/api/projects/")
	files, _ := s.list(project, "files", "")
	found := false
	for _, file := range files {
		if filePath(file) == "src/Tools/check.txt" {
			found = str(file, "content") == "persistent-source" && str(file, "parentId") != "root"
		}
	}
	if !found {
		t.Fatal("terminal files did not persist with their parent folder")
	}
	c.call("POST", base+"/terminal", Object{"command": "cat src/Tools/check.txt"}, 202)
	waitComposer(t, c, base, "success")
	c.call("POST", base+"/terminal", Object{"command": "php -r 'echo Config::get(\"app.name\");'"}, 202)
	status = waitComposer(t, c, base, "success")
	if !strings.Contains(str(status, "output"), "Script App") {
		t.Fatal("PHP CLI entry did not load", status)
	}
	c.call("POST", base+"/terminal", Object{"command": "php framework/examples/task.php"}, 202)
	waitComposer(t, c, base, "success")
	c.call("POST", base+"/terminal", Object{"command": "printf '%s' \"$CROND_API_TOKEN\""}, 202)
	status = waitComposer(t, c, base, "success")
	if !strings.Contains(str(status, "output"), "[REDACTED]") {
		t.Fatal("live terminal leaked execution credentials", status)
	}
	c.call("POST", base+"/terminal", Object{"command": "printf changed > src/Tools/check.txt; exit 7"}, 202)
	waitComposer(t, c, base, "error")
	files, _ = s.list(project, "files", "")
	for _, file := range files {
		if filePath(file) == "src/Tools/check.txt" && str(file, "content") != "changed" {
			t.Fatal("failed command lost completed file edits")
		}
	}
	c.call("POST", base+"/terminal", Object{"command": "rm src/Tools/check.txt"}, 202)
	waitComposer(t, c, base, "success")
	files, _ = s.list(project, "files", "")
	for _, file := range files {
		if filePath(file) == "src/Tools/check.txt" {
			t.Fatal("file removal was not synced")
		}
	}
	account := Account{ID: "terminal-viewer", Email: "viewer@terminal.local", Name: "Viewer"}
	s.db.Create(&account)
	c.call("POST", base+"/members", Object{"userEmail": account.Email, "role": "viewer"}, 200)
	session := Session{Token: newID(), UserID: account.ID, ExpiresAt: time.Now().Add(time.Hour)}
	s.db.Create(&session)
	viewer := &client{t: t, router: c.router, cookie: &http.Cookie{Name: "crond_session", Value: session.Token}}
	viewer.call("GET", base+"/terminal", nil, 200)
	viewer.call("POST", base+"/terminal", Object{"command": "echo forbidden"}, 403)
}

func TestTerminalComposerRequireRemoveAndManifestSync(t *testing.T) {
	if _, err := composerPHARPath(); err != nil {
		t.Skip("Composer unavailable")
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
	config := Object{"name": "crond/terminal-test", "require": Object{}, "repositories": []interface{}{Object{"type": "path", "url": "packages/demo", "options": Object{"symlink": false}}, Object{"packagist.org": false}}}
	encoded, _ := json.Marshal(config)
	c.call("PATCH", base+"/files/"+str(manifest, "id"), Object{"content": string(encoded)}, 200)
	c.call("POST", base+"/files", Object{"path": "packages/demo/composer.json", "type": "file", "content": `{"name":"fixture/demo","version":"1.0.0","autoload":{"psr-4":{"Demo\\":"src/"}}}`}, 200)
	c.call("POST", base+"/files", Object{"path": "packages/demo/src/Value.php", "type": "file", "content": "<?php namespace Demo; class Value { public static function message() { return 'new-package-from-terminal'; } }"}, 200)
	c.call("POST", base+"/terminal", Object{"command": "composer require fixture/demo:1.0.0"}, 202)
	waitComposer(t, c, base, "success")
	manifestDoc, _ := s.find(project, "files", str(manifest, "id"))
	if !strings.Contains(str(decode(manifestDoc), "content"), "fixture/demo") {
		t.Fatal("require did not save composer.json")
	}
	c.call("POST", base+"/terminal", Object{"command": "php -r 'echo Demo\\Value::message();'"}, 202)
	status := waitComposer(t, c, base, "success")
	if !strings.Contains(str(status, "output"), "new-package-from-terminal") {
		t.Fatal(status)
	}
	second := c.call("POST", "/api/projects", Object{"name": "Another project sharing dependencies", "slug": "another-project-sharing-dependencies"}, 200).(map[string]interface{})
	secondID := str(second, "id")
	secondBase := "/api/projects/" + secondID
	c.call("POST", secondBase+"/terminal", Object{"command": "php -r 'echo Demo\\Value::message();'"}, 202)
	sharedStatus := waitComposer(t, c, secondBase, "success")
	if !strings.Contains(str(sharedStatus, "output"), "new-package-from-terminal") {
		t.Fatal("dependency snapshot was not shared", sharedStatus)
	}
	c.call("POST", base+"/terminal", Object{"command": "composer show fixture/demo"}, 202)
	waitComposer(t, c, base, "success")
	c.call("POST", base+"/terminal", Object{"command": "composer remove fixture/demo"}, 202)
	waitComposer(t, c, base, "success")
	manifestDoc, _ = s.find(project, "files", str(manifest, "id"))
	var data Object
	json.Unmarshal([]byte(str(decode(manifestDoc), "content")), &data)
	required, _ := data["require"].(map[string]interface{})
	if _, exists := required["fixture/demo"]; exists {
		t.Fatal("remove did not save composer.json")
	}
	c.call("POST", base+"/terminal", Object{"command": "composer install --working-dir=/tmp"}, 400)
}

func TestDirectServiceRoutingAndIsolation(t *testing.T) {
	s, c, base := loginProject(t)
	projectID := strings.TrimPrefix(base, "/api/projects/")
	project, _ := s.find("", "projects", projectID)
	prefix := "/" + str(decode(project), "slug")
	service := Object{"name": "direct", "route": "/direct/", "content": "<?php function handle(Request $r) { return ['method'=>$r->method,'message'=>$r->input('message','direct works')]; }"}
	saved := c.call("POST", base+"/services", service, 200).(map[string]interface{})
	response := c.call("GET", prefix+"/direct?message=ok", nil, 200).(map[string]interface{})
	if response["message"] != "ok" || response["method"] != "GET" {
		t.Fatal(response)
	}
	c.call("GET", prefix+"/direct/", nil, 200)
	postService := merge(service, Object{"method": "POST"})
	c.call("POST", base+"/services", postService, 200)
	response = c.call("POST", prefix+"/direct", Object{"message": "posted"}, 200).(map[string]interface{})
	if response["message"] != "posted" || response["method"] != "POST" {
		t.Fatal(response)
	}
	anonymous := &client{t: t, router: c.router}
	anonymous.call("GET", prefix+"/direct", nil, 401)
	account := Account{ID: "service-stranger", Email: "stranger@route.local", Name: "Stranger"}
	s.db.Create(&account)
	session := Session{Token: newID(), UserID: account.ID, ExpiresAt: time.Now().Add(time.Hour)}
	s.db.Create(&session)
	stranger := &client{t: t, router: c.router, cookie: &http.Cookie{Name: "crond_session", Value: session.Token}}
	stranger.call("GET", prefix+"/direct", nil, 404)
	other := c.call("POST", "/api/projects", Object{"name": "Another project", "slug": "another-project"}, 200).(map[string]interface{})
	c.call("POST", "/api/projects/"+str(other, "id")+"/services", service, 200)
	c.call("GET", "/another-project/direct", nil, 200)
	c.call("GET", prefix+"/direct", nil, 200)
	c.call("GET", "/unknown-project/direct", nil, 404)
	c.call("GET", "/api/direct", nil, 404)
	c.call("POST", base+"/services", Object{"name": "root", "route": "/", "content": "<?php function handle(Request $r) { return ['root'=>true]; }"}, 200)
	c.call("GET", prefix+"/", nil, 200)
	c.call("PATCH", base+"/services/"+str(saved, "id"), Object{"status": "inactive"}, 200)
	c.call("GET", prefix+"/direct", nil, 405)
	c.call("POST", base+"/services", Object{"name": "query route", "route": "/bad?x=1", "content": "<?php"}, 400)
}

func TestTerminalPHPUsesOrigamiAndOtherCommandsUseBash(t *testing.T) {
	s, c, base := loginProject(t)
	_ = s
	directory := t.TempDir()
	marker := filepath.Join(directory, "native-php-called")
	if err := os.WriteFile(filepath.Join(directory, "php"), []byte("#!/bin/bash\nprintf native > "+marker+"\nexit 77\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", directory+string(os.PathListSeparator)+os.Getenv("PATH"))
	c.call("POST", base+"/terminal", Object{"command": "php -v && php -r '$x=7; echo Config::get(\"app.name\"), \":\", $x;' && printf '\\nBASH-OK'"}, 202)
	status := waitComposer(t, c, base, "success")
	output := str(status, "output")
	if !strings.Contains(output, "Origami PHP CLI") || !strings.Contains(output, "Script App:7") || !strings.Contains(output, "BASH-OK") {
		t.Fatal(status)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("terminal used native PHP")
	}
}

func TestOrigamiComposerFailurePreservesDependenciesAndNeverFallsBack(t *testing.T) {
	phar, err := filepath.Abs("../../data/tools/composer.phar")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(phar); os.IsNotExist(err) {
		t.Skip("official Composer PHAR not provided")
	}
	t.Setenv("CROND_COMPOSER_PHAR", phar)
	s, c, base := loginProject(t)
	project := strings.TrimPrefix(base, "/api/projects/")
	manifest, lock, err := s.composerManifest(project)
	if err != nil {
		t.Fatal(err)
	}
	saved := t.TempDir()
	vendor := filepath.Join(saved, "vendor")
	os.MkdirAll(vendor, 0700)
	os.WriteFile(filepath.Join(vendor, "autoload.php"), []byte("<?php // last successful snapshot"), 0600)
	original := ComposerBuild{ProjectID: s.dependencyKey(project), Directory: saved, Fingerprint: manifestFingerprint(manifest, lock), InstalledAt: 123}
	if err := s.db.Save(&original).Error; err != nil {
		t.Fatal(err)
	}
	native := t.TempDir()
	marker := filepath.Join(native, "native-php-called")
	os.WriteFile(filepath.Join(native, "php"), []byte("#!/bin/bash\nprintf native > "+marker+"\nexit 77\n"), 0700)
	t.Setenv("PATH", native+string(os.PathListSeparator)+os.Getenv("PATH"))
	c.call("POST", base+"/terminal", Object{"command": "composer --version"}, 202)
	version := waitComposer(t, c, base, "success")
	if !strings.Contains(str(version, "output"), "Composer version") {
		t.Fatal(version)
	}
	c.call("POST", base+"/terminal", Object{"command": "composer install -vvv"}, 202)
	failed := waitComposer(t, c, base, "error")
	if !strings.Contains(str(failed, "output"), "Origami") {
		t.Fatal("missing runtime failure details", failed)
	}
	var after ComposerBuild
	s.db.Where("project_id = ?", s.dependencyKey(project)).First(&after)
	if after.Directory != saved || after.InstalledAt != 123 {
		t.Fatal("failure replaced working dependency snapshot", after)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("Composer fell back to native PHP")
	}
}
