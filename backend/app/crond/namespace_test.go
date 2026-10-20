package crond

import (
	"context"
	"strings"
	"testing"
	"testing/fstest"
)

func TestFrameworkNamespacesAndAutoloadWithoutComposer(t *testing.T) {
	_, c, base := loginProject(t)
	c.call("POST", base+"/files", Object{"path": "src/Domain/Message.php", "type": "file", "content": `<?php namespace App\Domain; class Config { public static function value() { return 'autoloaded'; } } class Message { public static function value() { return Config::value(); } }`}, 200)
	c.call("POST", base+"/services", Object{"name": "Namespaced service", "route": "/namespace", "method": "POST", "content": `<?php
namespace App\Services;
use Framework\Config;
use Framework\Request;
use Framework\Task;
use App\Domain\Message;
function handle(Request $request) {
 return Task::run('namespaced', function () use ($request) {
  return ['app'=>Config::get('app.name'), 'message'=>Message::value(), 'input'=>$request->input('message')];
 });
}`}, 200)
	response := c.call("POST", base+"/invoke/namespace", Object{"message": "namespace works"}, 200).(map[string]interface{})
	if response["app"] != "Script App" || response["message"] != "autoloaded" || response["input"] != "namespace works" {
		t.Fatal(response)
	}

	c.call("POST", base+"/services", Object{"name": "Namespace alias", "route": "/namespace-alias", "content": `<?php
namespace App\Aliased;
 use Framework\Request;
 use Framework\Config as Settings;
 function handle(Request $request) { return ['app'=>Settings::get('app.name')]; }`}, 200)
	bracketed := c.call("GET", base+"/invoke/namespace-alias", nil, 200).(map[string]interface{})
	if bracketed["app"] != "Script App" {
		t.Fatal(bracketed)
	}
	run := c.call("POST", base+"/execute", Object{"type": "php", "content": `<?php
namespace App\Jobs;
use Framework\Config;
use Framework\Task;
use App\Domain\Message;
Task::run('namespaced', function () { echo Config::get('app.name') . ':' . Message::value(); });`}, 200).(map[string]interface{})
	if run["status"] != "success" || !strings.Contains(str(run, "output"), "Script App:autoloaded") {
		t.Fatal(run)
	}
}

func TestStandaloneFrameworkIgnoresStaleVendor(t *testing.T) {
	s, _, base := loginProject(t)
	project := strings.TrimPrefix(base, "/api/projects/")
	build := ComposerBuild{ProjectID: s.dependencyKey(project), Fingerprint: "old-user-framework", Directory: t.TempDir()}
	if err := s.db.Create(&build).Error; err != nil {
		t.Fatal(err)
	}
	run := s.execute(context.Background(), project, Object{"type": "origami", "content": `<?php use Framework\Config; echo Config::get('app.name');`})
	if run.Status != "success" || !strings.Contains(run.Output, "Script App") {
		t.Fatal(run)
	}
	var preserved ComposerBuild
	if err := s.db.First(&preserved, "project_id = ?", build.ProjectID).Error; err != nil || preserved.Directory != build.Directory {
		t.Fatal("legacy dependency snapshot changed", err)
	}
	original := s.frameworkFS
	defer func() { s.frameworkFS = original }()
	s.frameworkFS = fstest.MapFS{"composer.json": &fstest.MapFile{Data: []byte(`{"require":{"fixture/package":"1.0"},"autoload":{"psr-4":{"App\\":"src/"}}}`)}}
	if err := s.attachDependencies(project, t.TempDir()); err == nil || !strings.Contains(err.Error(), "依赖声明已变更") {
		t.Fatal("required packages must still reject stale vendor", err)
	}

}
