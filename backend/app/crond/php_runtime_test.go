package crond

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPHPEntryPointsUseOrigamiWithoutSystemPHP(t *testing.T) {
	s, c, base := loginProject(t)
	project := strings.TrimPrefix(base, "/api/projects/")
	// Native PHP and Composer fail visibly if any entry point bypasses Origami.
	native := t.TempDir()
	marker := filepath.Join(native, "native-runtime-called")
	for _, name := range []string{"php", "composer"} {
		trap := "#!/bin/sh\nprintf native > " + shellQuote(marker) + "\nexit 77\n"
		if err := os.WriteFile(filepath.Join(native, name), []byte(trap), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink("/bin/bash", filepath.Join(native, "bash")); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", native)
	phar, err := filepath.Abs("../../data/tools/composer.phar")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(phar); err == nil {
		t.Setenv("CROND_COMPOSER_PHAR", phar)
	}
	entry := c.call("POST", base+"/files", Object{"path": "runtime-entry.php", "type": "file", "content": "<?php define('CROND_RUNTIME_ENTRY', 'custom');"}, 200).(map[string]interface{})
	c.call("PATCH", base, Object{"entryFileId": str(entry, "id")}, 200)
	c.call("POST", base+"/files", Object{"path": "src/RuntimeMessage.php", "type": "file", "content": `<?php namespace App; class RuntimeMessage { public static function value() { return 'autoloaded'; } }`}, 200)
	code := `<?php
namespace App\Jobs;
use Framework\Config;
use App\RuntimeMessage;
echo function_exists('script_http_request') ? 'origami:' : 'native:';
echo Config::get('app.name'), ':', RuntimeMessage::value(), ':', CROND_RUNTIME_ENTRY;
echo strpos(PHP_BINARY, '.crond-bin/php') !== false ? ':wrapped-binary' : ':unwrapped-binary';
`
	want := "origami:Script App:autoloaded:custom:wrapped-binary"
	assertRun := func(run Object) {
		t.Helper()
		if run["status"] != "success" || !strings.Contains(str(run, "output"), want) {
			t.Fatal(run)
		}
	}
	assertRun(c.call("POST", base+"/execute", Object{"type": "php", "content": code}, 200).(map[string]interface{}))
	job := c.call("POST", base+"/jobs", Object{"name": "Origami PHP", "type": "php", "content": code, "status": "inactive", "cronExp": "@every 1s"}, 200).(map[string]interface{})
	id := str(job, "id")
	assertRun(c.call("POST", base+"/jobs/"+id+"/run", nil, 200).(map[string]interface{}))
	c.call("PATCH", base+"/jobs/"+id, Object{"status": "active"}, 200)
	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	for deadline := time.Now().Add(4 * time.Second); ; {
		logs, err := s.list(project, "logs", id)
		if err != nil {
			t.Fatal(err)
		}
		if len(logs) >= 2 {
			assertRun(logs[0])
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Origami PHP task never ran on schedule")
		}
		time.Sleep(20 * time.Millisecond)
	}
	c.call("PATCH", base+"/jobs/"+id, Object{"status": "inactive"}, 200)
	<-s.scheduler.Stop().Done()
	assertRun(c.call("POST", base+"/execute", Object{"type": "shell", "content": "php -r " + shellQuote(strings.TrimPrefix(code, "<?php"))}, 200).(map[string]interface{}))
	c.call("POST", base+"/terminal", Object{"command": "php -r " + shellQuote(strings.TrimPrefix(code, "<?php"))}, 202)
	terminal := waitComposer(t, c, base, "success")
	if !strings.Contains(str(terminal, "output"), want) {
		t.Fatal(terminal)
	}
	if _, err := os.Stat(phar); err == nil {
		composer := c.call("POST", base+"/execute", Object{"type": "shell", "content": "composer --version"}, 200).(map[string]interface{})
		if composer["status"] != "success" || !strings.Contains(str(composer, "output"), "Composer version") {
			t.Fatal(composer)
		}
	}
	c.call("POST", base+"/services", Object{"name": "Origami service", "route": "/runtime", "content": `<?php function handle(Request $r) { return ['app'=>Config::get('app.name'), 'entry'=>CROND_RUNTIME_ENTRY, 'engine'=>function_exists('script_http_request')]; }`}, 200)
	service := c.call("GET", base+"/invoke/runtime", nil, 200).(map[string]interface{})
	if service["app"] != "Script App" || service["entry"] != "custom" || service["engine"] != true {
		t.Fatal(service)
	}
	t.Run("PHP unavailable on PATH", func(t *testing.T) {
		t.Setenv("PATH", "/nonexistent")
		assertRun(c.call("POST", base+"/execute", Object{"type": "php", "content": code}, 200).(map[string]interface{}))
	})
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("an execution entry point invoked native PHP or Composer")
	}
	var workers int64
	s.db.Model(&Session{}).Where("scoped_project_id <> ?", "").Count(&workers)
	if workers != 0 {
		t.Fatal("execution credentials were not revoked")
	}
}

func TestOrigamiPHPTaskLogsErrorsAndCancellation(t *testing.T) {
	s, c, base := loginProject(t)
	project := strings.TrimPrefix(base, "/api/projects/")
	t.Setenv("PATH", "/nonexistent")
	job := c.call("POST", base+"/jobs", Object{"name": "PHP logging", "type": "php", "status": "inactive", "content": `<?php Logger::info('origami-task-log'); echo 'task-stdout';`}, 200).(map[string]interface{})
	id := str(job, "id")
	run := c.call("POST", base+"/jobs/"+id+"/run", nil, 200).(map[string]interface{})
	if run["status"] != "success" || !strings.Contains(str(run, "output"), "origami-task-log") || !strings.Contains(str(run, "output"), "task-stdout") {
		t.Fatal(run)
	}
	logs, err := s.list(project, "logs", id)
	if err != nil || len(logs) != 1 || str(logs[0], "output") != str(run, "output") {
		t.Fatal("PHP stdout/stderr were not persisted", logs, err)
	}
	failed := c.call("POST", base+"/execute", Object{"type": "php", "content": `<?php Task::run('failure', function () { throw new RuntimeException('origami-task-error'); });`}, 200).(map[string]interface{})
	if failed["status"] != "error" || !strings.Contains(str(failed, "output"), "origami-task-error") || !strings.Contains(str(failed, "output"), "Task failed") {
		t.Fatal(failed)
	}
	invalid := c.call("POST", base+"/execute", Object{"type": "php", "content": "<?php $broken = ;"}, 200).(map[string]interface{})
	if invalid["status"] != "error" {
		t.Fatal("invalid PHP unexpectedly succeeded", invalid)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	timedOut := s.execute(ctx, project, Object{"type": "php", "content": "<?php while (true) {}"})
	if timedOut.Status != "error" || timedOut.Duration > 3000 || !strings.Contains(timedOut.Output, "执行超时") {
		t.Fatal("Origami PHP cancellation failed", timedOut)
	}
}
