package crond

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDefaultFrameworkAndMigration(t *testing.T) {
	s, c, base := loginProject(t)
	projectID := strings.TrimPrefix(base, "/api/projects/")
	files, _ := s.list(projectID, "files", "")
	paths := map[string]Object{}
	for _, file := range files {
		paths[filePath(file)] = file
	}
	for _, name := range []string{"README.md", "bootstrap.php", "composer.json", "framework/README.md", "framework/settings.php", "framework/Http.php", "framework/examples/http.php"} {
		if paths[name] == nil {
			t.Fatalf("default project missing %s", name)
		}
	}
	if paths["crond"] != nil {
		t.Fatal("default framework still uses the scheduler directory")
	}
	c.call("PATCH", base+"/files/"+str(paths["framework/settings.php"], "id"), Object{"content": "changed"}, 403)
	c.call("DELETE", base+"/files/"+str(paths["README.md"], "id"), nil, 403)
	c.call("POST", base+"/files", Object{"path": "bootstrap.php", "type": "file", "content": "changed"}, 403)
	c.call("PATCH", base+"/files/"+str(paths["framework"], "id"), Object{"path": "renamed"}, 403)
	c.call("DELETE", base+"/files/"+str(paths["framework"], "id"), nil, 403)
	if err := s.ensureDefaultFrameworks(); err != nil {
		t.Fatal(err)
	}
	config, _ := s.find(projectID, "files", str(paths["framework/settings.php"], "id"))
	if str(decode(config), "content") != str(paths["framework/settings.php"], "content") {
		t.Fatal("framework changed")
	}
	project := c.call("POST", "/api/projects", Object{"name": "Default framework", "slug": "default-framework"}, 200).(map[string]interface{})
	if project["framework"] == nil || str(project, "entryFileId") == "" {
		t.Fatal(project)
	}
	framework := project["framework"].(map[string]interface{})
	if framework["name"] != "Script Framework" || framework["version"] != "1.2.0" {
		t.Fatal(framework)
	}
}

func TestStarterPHPAndOrigamiExecution(t *testing.T) {
	s, c, base := loginProject(t)
	projectID := strings.TrimPrefix(base, "/api/projects/")
	target := httptest.NewServer(c.router)
	defer target.Close()
	s.SetAPIURL(target.URL + "/api")
	collection := c.call("POST", base+"/collections", Object{"name": "task_runs"}, 200).(map[string]interface{})
	task, err := fs.ReadFile(s.frameworkFS, "framework/examples/task.php")
	if err != nil {
		t.Fatal(err)
	}
	run := c.call("POST", base+"/execute", Object{"type": "php", "content": string(task)}, 200).(map[string]interface{})
	if run["status"] != "success" || !strings.Contains(str(run, "output"), "Task completed") {
		t.Fatal(run)
	}
	job := c.call("POST", base+"/jobs", Object{"name": "Starter task", "type": "php", "status": "inactive", "content": "<?php Task::run('write', function () { Database::collection('task_runs')->insert(['value'=>Config::get('app.name')]); });"}, 200).(map[string]interface{})
	c.call("POST", base+"/jobs/"+str(job, "id")+"/run", nil, 200)
	records := c.call("GET", base+"/collections/"+str(collection, "id")+"/records", nil, 200).([]interface{})
	if len(records) != 1 {
		t.Fatal("framework task did not persist data", records)
	}
	failed := c.call("POST", base+"/execute", Object{"type": "php", "content": "<?php Task::run('failed',function () { throw new RuntimeException('intentional failure'); });"}, 200).(map[string]interface{})
	if failed["status"] != "error" || !strings.Contains(str(failed, "output"), "Task failed") {
		t.Fatal("failure swallowed", failed)
	}
	// Both PHP tasks and services must run without a native PHP installation.
	t.Setenv("PATH", "/nonexistent")
	service, err := fs.ReadFile(s.frameworkFS, "framework/examples/service.php")
	if err != nil {
		t.Fatal(err)
	}
	saved := c.call("POST", base+"/services", Object{"name": "Starter service", "method": "POST", "route": "/starter", "content": string(service)}, 200).(map[string]interface{})
	response := c.call("POST", base+"/invoke/starter", Object{"message": "framework working"}, 200).(map[string]interface{})
	if response["app"] != "Script App" || response["message"] != "framework working" {
		t.Fatal(response)
	}
	logs, _ := s.list(projectID, "logs", str(saved, "id"))
	if len(logs) != 1 || !strings.Contains(str(logs[0], "output"), "Service invoked") {
		t.Fatal("service diagnostics not persisted", logs)
	}
	c.call("POST", base+"/services", Object{"name": "Starter storage", "method": "POST", "route": "/starter/storage", "content": "<?php function handle(Request $r) { Database::collection('task_runs')->insert(['value'=>'origami']); return ['records'=>Database::collection('task_runs')->find(), 'fallback'=>Config::get('missing',false)]; }"}, 200)
	storage := c.call("POST", base+"/invoke/starter/storage", nil, 200).(map[string]interface{})
	if storage["fallback"] != false || len(storage["records"].([]interface{})) < 1 {
		t.Fatal(storage)
	}
	c.call("POST", base+"/services", Object{"name": "Starter task wrapper", "method": "POST", "route": "/starter/task", "content": "<?php function handle(Request $r) { return Task::run('wrapped', function () { return ['ok'=>true, 'project'=>Config::env('CROND_PROJECT_ID')]; }); }"}, 200)
	wrapped := c.call("POST", base+"/invoke/starter/task", nil, 200).(map[string]interface{})
	if wrapped["ok"] != true || wrapped["project"] != projectID {
		t.Fatal(wrapped)
	}
}

func TestDefaultFrameworkDirectoryAndTemplateChanges(t *testing.T) {
	original := os.Getenv("CROND_FRAMEWORK_DIR")
	template := filepath.Join(t.TempDir(), "framework")
	if err := copyDependencyTree(original, template, original); err != nil {
		t.Fatal(err)
	}
	settings := filepath.Join(template, "framework", "settings.php")
	customized := "<?php return ['app'=>['name'=>'Disk template']];"
	if err := os.WriteFile(settings, []byte(customized), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CROND_FRAMEWORK_DIR", template)
	s, _, base := loginProject(t)
	project := strings.TrimPrefix(base, "/api/projects/")
	files, err := s.list(project, "files", "")
	if err != nil {
		t.Fatal(err)
	}
	var config Object
	for _, file := range files {
		if filePath(file) == "framework/settings.php" {
			config = file
		}
	}
	if config == nil || str(config, "content") != customized {
		t.Fatal("initializer did not read configured disk template", config)
	}
	if err := os.WriteFile(settings, []byte("<?php return ['app'=>['name'=>'Updated template']];"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.ensureDefaultFrameworks(); err != nil {
		t.Fatal(err)
	}
	doc, err := s.find(project, "files", str(config, "id"))
	if err != nil || !strings.Contains(str(decode(doc), "content"), "Updated template") {
		t.Fatal("shared framework did not receive template update", doc, err)
	}
	if _, err := os.Stat(filepath.Join(template, "src", "Database.php")); err != nil {
		t.Fatal("Database helper missing from template", err)
	}
}

func TestMissingDefaultFrameworkDirectory(t *testing.T) {
	t.Setenv("CROND_FRAMEWORK_DIR", filepath.Join(t.TempDir(), "missing-framework"))
	s, err := New(filepath.Join(t.TempDir(), "db.sqlite"))
	if err == nil {
		s.Close()
		t.Fatal("missing template directory was silently accepted")
	}
	if !strings.Contains(err.Error(), "默认框架目录") {
		t.Fatal(err)
	}
}

func TestFrameworkIsSharedAcrossUsersAndExecution(t *testing.T) {
	original := os.Getenv("CROND_FRAMEWORK_DIR")
	template := filepath.Join(t.TempDir(), "framework")
	if err := copyDependencyTree(original, template, original); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CROND_FRAMEWORK_DIR", template)
	s, c, base := loginProject(t)
	first := strings.TrimPrefix(base, "/api/projects/")
	account := Account{ID: "framework-other-owner", Email: "framework@example.local", Name: "Other"}
	if err := s.db.Create(&account).Error; err != nil {
		t.Fatal(err)
	}
	session := Session{Token: newID(), UserID: account.ID, ExpiresAt: time.Now().Add(time.Hour)}
	if err := s.db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	other := &client{t: t, router: c.router, cookie: &http.Cookie{Name: "crond_session", Value: session.Token}}
	project := other.call("POST", "/api/projects", Object{"name": "Other framework", "slug": "other-framework"}, 200).(map[string]interface{})
	if !reflect.DeepEqual(c.call("GET", "/api/framework", nil, 200), other.call("GET", "/api/framework", nil, 200)) {
		t.Fatal("users received different documentation")
	}
	// A previous user's edited copy is preserved on disk but cannot override the default.
	directory, _ := s.projectFilesPath(first)
	if err := os.MkdirAll(filepath.Join(directory, "framework"), 0700); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(directory, "framework", "settings.php")
	if err := os.WriteFile(legacy, []byte("legacy user settings"), 0600); err != nil {
		t.Fatal(err)
	}
	updated := "<?php return ['app'=>['name'=>'Shared update']];"
	if err := os.WriteFile(filepath.Join(template, "framework", "settings.php"), []byte(updated), 0600); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{first, str(project, "id")} {
		files, err := s.readProjectFiles(id)
		if err != nil {
			t.Fatal(err)
		}
		for _, file := range files {
			if filePath(file) == "framework/settings.php" && str(file, "content") != updated {
				t.Fatal("stale framework", file)
			}
		}
		workspace, err := s.workspaceFiles(id)
		if err != nil {
			t.Fatal(err)
		}
		content, err := os.ReadFile(filepath.Join(workspace, "framework", "settings.php"))
		os.RemoveAll(workspace)
		if err != nil || string(content) != updated {
			t.Fatal("execution did not use shared default", string(content), err)
		}
	}
	if content, _ := os.ReadFile(legacy); string(content) != "legacy user settings" {
		t.Fatal("legacy source was overwritten")
	}
	other.call("PATCH", "/api/projects/"+str(project, "id")+"/files/"+frameworkFileID("framework/settings.php"), Object{"content": "changed"}, 403)
	if err := s.syncTerminalFiles(first, directory, nil); err == nil {
		t.Fatal("terminal allowed changing default framework")
	}
}
