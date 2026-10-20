package crond

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/go-home-admin/go-admin/app/engine"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == engine.WorkerFlag {
		os.Exit(engine.RunWorker(os.Args[2:]))
		return
	}
	if len(os.Args) > 1 && os.Args[1] == engine.CLIWorkerFlag {
		os.Exit(engine.RunCLI(os.Args[2:]))
		return
	}
	if len(os.Args) > 1 && os.Args[1] == engine.JSONWorkerFlag {
		os.Exit(engine.RunJSON(os.Args[2:]))
		return
	}
	frameworkPath, err := filepath.Abs("../../data/framework")
	if err != nil {
		panic(err)
	}
	if err := os.Setenv("CROND_FRAMEWORK_DIR", frameworkPath); err != nil {
		panic(err)
	}
	os.Exit(m.Run())
}

type client struct {
	t      *testing.T
	router http.Handler
	cookie *http.Cookie
}

func (cl *client) call(method, path string, data interface{}, status int) interface{} {
	cl.t.Helper()
	payload, _ := json.Marshal(data)
	request := httptest.NewRequest(method, path, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	if cl.cookie != nil {
		request.AddCookie(cl.cookie)
	}
	response := httptest.NewRecorder()
	cl.router.ServeHTTP(response, request)
	if response.Code != status {
		cl.t.Fatalf("%s %s: got %d want %d: %s", method, path, response.Code, status, response.Body.String())
	}
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == "crond_session" {
			cl.cookie = cookie
		}
	}
	var result interface{}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		cl.t.Fatal(err)
	}
	return result
}
func setup(t *testing.T) (*Service, *client) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	s, err := New(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	s.workRoot = t.TempDir()
	router := gin.New()
	router.Use(gin.Recovery())
	s.Register(router)
	t.Cleanup(s.Close)
	return s, &client{t: t, router: router}
}
func TestBackendSessionCRUDExecutionAndPermissions(t *testing.T) {
	s, c := setup(t)
	c.call("GET", "/api/projects", nil, 401)
	c.call("POST", "/api/auth/test", nil, 200)
	if c.cookie == nil || !c.cookie.HttpOnly {
		t.Fatal("missing HttpOnly session cookie")
	}
	me := c.call("GET", "/api/auth/me", nil, 200).(map[string]interface{})
	if me["username"] != "测试账号" {
		t.Fatal(me)
	}
	projects := c.call("GET", "/api/projects", nil, 200).([]interface{})
	if len(projects) != 1 {
		t.Fatal(projects)
	}
	project := c.call("POST", "/api/projects", Object{"name": "Integration", "slug": "integration"}, 200).(map[string]interface{})
	projectID := str(project, "id")
	base := "/api/projects/" + projectID
	c.call("POST", base+"/jobs", Object{"name": "Bad cron", "type": "shell", "cronExp": "invalid"}, 400)
	job := c.call("POST", base+"/jobs", Object{"name": "Echo", "type": "shell", "status": "inactive", "content": "printf 'backend-real-output'"}, 200).(map[string]interface{})
	id := str(job, "id")
	c.call("PATCH", base+"/jobs/"+id, Object{"name": "Echo updated"}, 200)
	run := c.call("POST", base+"/jobs/"+id+"/run", nil, 200).(map[string]interface{})
	if run["status"] != "success" || run["output"] != "backend-real-output" {
		t.Fatal(run)
	}
	logs := c.call("GET", base+"/jobs/"+id+"/logs", nil, 200).([]interface{})
	if len(logs) != 1 {
		t.Fatal(logs)
	}
	failed := c.call("POST", base+"/execute", Object{"type": "shell", "content": "echo failing; exit 7"}, 200).(map[string]interface{})
	if failed["status"] != "error" {
		t.Fatal(failed)
	}
	c.call("POST", base+"/files", Object{"name": "../../escape.php", "path": "../../escape.php", "type": "file"}, 400)
	c.call("POST", base+"/files", Object{"name": "bootstrap.php", "path": "src/bootstrap.php", "type": "file", "content": "<?php echo 'bootstrap:';"}, 200)
	collection := c.call("POST", base+"/collections", Object{"name": "users", "displayName": "Users"}, 200).(map[string]interface{})
	records := base + "/collections/" + str(collection, "id") + "/records"
	record := c.call("POST", records, Object{"data": Object{"name": "Alice"}}, 200).(map[string]interface{})
	c.call("PATCH", records+"/"+str(record, "id"), Object{"data": Object{"name": "Bob"}}, 200)
	if got := c.call("GET", records, nil, 200).([]interface{})[0].(map[string]interface{})["data"].(map[string]interface{})["name"]; got != "Bob" {
		t.Fatal(got)
	}
	// A foreign collection must not let a record be moved to another scope.
	other := c.call("POST", base+"/collections", Object{"name": "other"}, 200).(map[string]interface{})
	c.call("PATCH", base+"/collections/"+str(other, "id")+"/records/"+str(record, "id"), Object{"data": Object{}}, 404)
	stranger := Account{ID: "stranger", Email: "stranger@example.com", Name: "Stranger"}
	if err := s.db.Create(&stranger).Error; err != nil {
		t.Fatal(err)
	}
	session := Session{Token: newID(), UserID: stranger.ID, ExpiresAt: time.Now().Add(time.Hour)}
	if err := s.db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	foreign := &client{t: t, router: c.router, cookie: &http.Cookie{Name: "crond_session", Value: session.Token}}
	foreign.call("GET", base+"/jobs", nil, 403)
	c.call("POST", base+"/members", Object{"userEmail": stranger.Email, "role": "viewer"}, 200)
	foreign.call("GET", base+"/jobs", nil, 200)
	foreign.call("POST", base+"/jobs", Object{"name": "No access", "type": "shell"}, 403)
	foreign.call("GET", base+"/composer", nil, 200)
	foreign.call("POST", base+"/composer/install", nil, 403)
	// Explicit origin checks defend cookie-authenticated mutations.
	request := httptest.NewRequest("DELETE", base, nil)
	request.AddCookie(c.cookie)
	request.Header.Set("Origin", "https://untrusted.example")
	response := httptest.NewRecorder()
	c.router.ServeHTTP(response, request)
	if response.Code != 403 {
		t.Fatal(response.Code)
	}
	oldCookie := *c.cookie
	c.call("POST", "/api/auth/logout", nil, 200)
	c.cookie = &oldCookie
	c.call("GET", "/api/auth/me", nil, 401)
	c.call("POST", "/api/auth/test", nil, 200)
	c.call("DELETE", base, nil, 200)
	if jobs, _ := s.list(projectID, "jobs", ""); len(jobs) != 0 {
		t.Fatal("jobs not deleted")
	}
	if records, _ := s.list(projectID, "records", ""); len(records) != 0 {
		t.Fatal("records not deleted")
	}
}
func TestPersistenceAcrossRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "persistent.db")
	first, err := New(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	account, err := first.seedTest()
	if err != nil {
		t.Fatal(err)
	}
	projects, _ := first.list("", "projects", "")
	projectID := str(projects[0], "id")
	_, err = first.save(projectID, "collections", "", Object{"name": "persistent"}, "")
	if err != nil {
		t.Fatal(err)
	}
	first.Close()
	second, err := New(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	again, err := second.seedTest()
	if err != nil || again.ID != account.ID {
		t.Fatal(err, again)
	}
	projects, _ = second.list("", "projects", "")
	if len(projects) != 1 {
		t.Fatal("seed duplicated projects")
	}
	collections, _ := second.list(projectID, "collections", "")
	if len(collections) != 1 {
		t.Fatal("data lost after restart")
	}
}
func TestHTTPExecutionAndPHPBootstrap(t *testing.T) {
	s, c := setup(t)
	c.call("POST", "/api/auth/test", nil, 200)
	project := c.call("GET", "/api/projects", nil, 200).([]interface{})[0].(map[string]interface{})
	base := "/api/projects/" + str(project, "id")
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("X-Test") != "sent" || r.Method != "POST" {
			w.WriteHeader(400)
		}
		_, _ = w.Write([]byte(`{"real":true}`))
	}))
	defer target.Close()
	config, _ := json.Marshal(HTTPConfig{URL: target.URL, Method: "POST", Headers: map[string]string{"X-Test": "sent"}, Body: `{"hello":"world"}`})
	run := c.call("POST", base+"/execute", Object{"type": "http", "content": string(config)}, 200).(map[string]interface{})
	if run["status"] != "success" || run["http"].(map[string]interface{})["data"].(map[string]interface{})["real"] != true {
		t.Fatal(run)
	}
	file := c.call("POST", base+"/files", Object{"name": "bootstrap.php", "path": "custom-bootstrap.php", "type": "file", "content": "<?php echo 'bootstrap:';"}, 200).(map[string]interface{})
	c.call("PATCH", base, Object{"entryFileId": str(file, "id")}, 200)
	run = c.call("POST", base+"/execute", Object{"type": "php", "content": "<?php echo 'php-real-output';"}, 200).(map[string]interface{})
	if run["status"] != "success" || !strings.Contains(run["output"].(string), "bootstrap:php-real-output") {
		t.Fatal(run)
	}
	_ = s
}
func TestSchedulerAndCancellation(t *testing.T) {
	s, _ := setup(t)
	account, err := s.seedTest()
	if err != nil {
		t.Fatal(err)
	}
	_ = account
	projects, _ := s.list("", "projects", "")
	projectID := str(projects[0], "id")
	job, err := s.save(projectID, "jobs", "", Object{"name": "Scheduled", "type": "shell", "status": "active", "cronExp": "@every 1s", "content": "echo scheduled-real-output"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Start(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		logs, _ := s.list(projectID, "logs", str(job, "id"))
		if len(logs) > 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	logs, _ := s.list(projectID, "logs", str(job, "id"))
	if len(logs) == 0 || !strings.Contains(str(logs[0], "output"), "scheduled-real-output") {
		t.Fatal("scheduled task never executed", logs)
	}
	job["status"] = "inactive"
	_, err = s.save(projectID, "jobs", "", job, str(job, "id"))
	if err != nil {
		t.Fatal(err)
	}
	if err = s.reschedule(); err != nil {
		t.Fatal(err)
	}
	if len(s.scheduler.Entries()) != 0 {
		t.Fatal("disabled job still scheduled")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	run := s.execute(ctx, projectID, Object{"type": "shell", "content": "sleep 10"})
	if run.Status != "error" || run.Duration > 3000 {
		t.Fatal("timeout failed", run)
	}
}

func TestServiceHandlerAndProjectDatabaseHelper(t *testing.T) {
	s, c := setup(t)
	target := httptest.NewServer(c.router)
	defer target.Close()
	s.SetAPIURL(target.URL + "/api")
	c.call("POST", "/api/auth/test", nil, 200)
	project := c.call("GET", "/api/projects", nil, 200).([]interface{})[0].(map[string]interface{})
	projectID := str(project, "id")
	base := "/api/projects/" + projectID
	c.call("POST", base+"/collections", Object{"name": "system_configs"}, 200)
	run := c.call("POST", base+"/execute", Object{"type": "php", "content": "<?php require_once 'src/Database.php'; Database::collection('system_configs')->insert(['value'=>'sdk-real-write']); echo json_encode(Database::collection('system_configs')->find());"}, 200).(map[string]interface{})
	if run["status"] != "success" || !strings.Contains(run["output"].(string), "sdk-real-write") {
		t.Fatal(run)
	}
	c.call("POST", base+"/services", Object{"name": "Hello handler", "method": "POST", "route": "/api/hello", "content": "<?php function handle(Request $request) { return ['method'=>$request->method,'message'=>$request->input('message','default')]; }"}, 200)
	result := c.call("POST", base+"/invoke/api/hello", Object{"message": "real-request"}, 200).(map[string]interface{})
	if result["message"] != "real-request" || result["method"] != "POST" {
		t.Fatal(result)
	}
	var workers int64
	s.db.Model(&Session{}).Where("scoped_project_id <> ?", "").Count(&workers)
	if workers != 0 {
		t.Fatal("worker tokens were not revoked")
	}
	// A worker's token must not become owner access, even though scheduled work uses the owner's identity.
	session := Session{Token: newID(), UserID: "test-user", ScopedProjectID: projectID, ExpiresAt: time.Now().Add(time.Minute)}
	if err := s.db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("DELETE", base, nil)
	request.Header.Set("Authorization", "Bearer "+session.Token)
	response := httptest.NewRecorder()
	c.router.ServeHTTP(response, request)
	if response.Code != 403 {
		t.Fatal("worker could delete project", response.Code)
	}
	request = httptest.NewRequest("GET", "/api/projects", nil)
	request.Header.Set("Authorization", "Bearer "+session.Token)
	response = httptest.NewRecorder()
	c.router.ServeHTTP(response, request)
	if response.Code != 403 {
		t.Fatal("worker could list other projects", response.Code)
	}
}

func TestOrigamiServicesWithoutSystemPHP(t *testing.T) {
	s, c := setup(t)
	target := httptest.NewServer(c.router)
	defer target.Close()
	s.SetAPIURL(target.URL + "/api")
	c.call("POST", "/api/auth/test", nil, 200)
	project := c.call("GET", "/api/projects", nil, 200).([]interface{})[0].(map[string]interface{})
	projectID := str(project, "id")
	base := "/api/projects/" + projectID
	// System PHP is unavailable: all service requests must use the embedded Go VM.
	t.Setenv("PATH", "/nonexistent")
	c.call("POST", base+"/collections", Object{"name": "origami_records"}, 200)
	c.call("POST", base+"/services", Object{"name": "Origami SDK", "method": "POST", "route": "/origami/sdk", "content": "<?php require_once 'src/Database.php'; function handle(Request $request) { Database::collection('origami_records')->insert(['message'=>$request->input('message')]); return ['records'=>Database::collection('origami_records')->find()]; }"}, 200)
	response := c.call("POST", base+"/invoke/origami/sdk", Object{"message": "go-vm-storage"}, 200).(map[string]interface{})
	if got := response["records"].([]interface{})[0].(map[string]interface{})["message"]; got != "go-vm-storage" {
		t.Fatal(response)
	}
	c.call("POST", base+"/services", Object{"name": "Isolation", "method": "POST", "route": "/origami/isolation", "content": "<?php function handle(Request $request) { static $count = 0; $count++; return ['count'=>$count,'message'=>$request->input('message')]; }"}, 200)
	// Concurrent requests get separate static state and request parameters.
	errors := make(chan string, 8)
	for i := 0; i < 8; i++ {
		go func(i int) {
			payload, _ := json.Marshal(Object{"message": i})
			request := httptest.NewRequest("POST", base+"/invoke/origami/isolation", bytes.NewReader(payload))
			request.AddCookie(c.cookie)
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			c.router.ServeHTTP(recorder, request)
			var result Object
			err := json.Unmarshal(recorder.Body.Bytes(), &result)
			if err != nil || recorder.Code != 200 || result["count"] != float64(1) || result["message"] != float64(i) || recorder.Header().Get("X-Crond-Engine") != "origami" {
				errors <- recorder.Body.String()
				return
			}
			errors <- ""
		}(i)
	}
	for i := 0; i < 8; i++ {
		if failure := <-errors; failure != "" {
			t.Fatal(failure)
		}
	}
	c.call("POST", base+"/services", Object{"name": "Bad source", "method": "POST", "route": "/origami/error", "content": "<?php function handle(Request $request) { totally_missing_function(); }"}, 200)
	c.call("POST", base+"/invoke/origami/error", nil, 500)
	// Fatal script failures must not kill or invalidate the parent backend.
	c.call("GET", "/api/health", nil, 200)
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	run := s.execute(ctx, projectID, Object{"type": "origami", "content": "<?php while (true) {}"})
	if run.Status != "error" || run.Duration > 3000 {
		t.Fatal("Origami worker timeout failed", run)
	}
}
