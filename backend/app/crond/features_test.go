package crond

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func loginProject(t *testing.T) (*Service, *client, string) {
	t.Helper()
	s, c := setup(t)
	c.call("POST", "/api/auth/test", nil, 200)
	project := c.call("GET", "/api/projects", nil, 200).([]interface{})[0].(map[string]interface{})
	return s, c, "/api/projects/" + str(project, "id")
}

func TestFileTreeLifecycle(t *testing.T) {
	s, c, base := loginProject(t)
	project := strings.TrimPrefix(base, "/api/projects/")
	folder := c.call("POST", base+"/files", Object{"path": "assets", "type": "folder", "parentId": "root"}, 200).(map[string]interface{})
	nested := c.call("POST", base+"/files", Object{"path": "assets/deep", "type": "folder", "parentId": str(folder, "id")}, 200).(map[string]interface{})
	file := c.call("POST", base+"/files", Object{"path": "assets/deep/boot.php", "type": "file", "parentId": str(nested, "id"), "content": "<?php echo 'boot:';"}, 200).(map[string]interface{})
	c.call("POST", base+"/files", Object{"path": "assets/deep/boot.php", "type": "file"}, 409)
	c.call("POST", base+"/files", Object{"path": "bad.php", "type": "file", "parentId": "missing"}, 400)
	c.call("POST", base+"/files", Object{"path": "assets/deep/boot.php/child", "type": "file"}, 409)
	c.call("PATCH", base, Object{"entryFileId": str(folder, "id")}, 400)
	c.call("PATCH", base, Object{"entryFileId": "missing"}, 400)
	c.call("PATCH", base, Object{"entryFileId": str(file, "id")}, 200)
	c.call("PATCH", base+"/files/"+str(folder, "id"), Object{"path": "lib"}, 200)
	doc, err := s.find(project, "files", str(file, "id"))
	if err != nil || str(decode(doc), "path") != "lib/deep/boot.php" {
		t.Fatal("child path did not follow rename", err, decode(doc))
	}
	c.call("PATCH", base+"/files/"+str(folder, "id"), Object{"path": "lib/deep/child"}, 400)
	c.call("POST", base+"/files", Object{"path": "occupied/deep/boot.php", "type": "file"}, 200)
	c.call("PATCH", base+"/files/"+str(folder, "id"), Object{"path": "occupied"}, 409)
	doc, _ = s.find(project, "files", str(file, "id"))
	if str(decode(doc), "path") != "lib/deep/boot.php" {
		t.Fatal("failed rename partially wrote descendants")
	}
	c.call("DELETE", base+"/files/"+str(folder, "id"), nil, 200)
	if _, err := s.find(project, "files", str(file, "id")); err == nil {
		t.Fatal("descendant survived folder deletion")
	}
	projectDoc, _ := s.find("", "projects", project)
	if str(decode(projectDoc), "entryFileId") != "" {
		t.Fatal("deleted entry reference survived")
	}
	// Deleting a single entry file also clears the reference.
	standalone := c.call("POST", base+"/files", Object{"path": "single.php", "type": "file"}, 200).(map[string]interface{})
	c.call("PATCH", base, Object{"entryFileId": str(standalone, "id")}, 200)
	c.call("DELETE", base+"/files/"+str(standalone, "id"), nil, 200)
	projectDoc, _ = s.find("", "projects", project)
	if str(decode(projectDoc), "entryFileId") != "" {
		t.Fatal("single entry reference survived")
	}
}

func TestPersistentCollectionsAndRecordKeys(t *testing.T) {
	s, c, base := loginProject(t)
	col := c.call("POST", base+"/collections", Object{"name": "mock_users"}, 200).(map[string]interface{})
	c.call("POST", base+"/collections", Object{"name": "mock_users"}, 409)
	c.call("POST", base+"/collections", Object{"name": " MOCK_USERS "}, 409)
	c.call("POST", base+"/collections", Object{"name": "bad/name"}, 400)
	records := base + "/collections/" + str(col, "id") + "/records"
	record := c.call("POST", records, Object{"data": Object{"value": 1}}, 200).(map[string]interface{})
	key := str(record["data"].(map[string]interface{}), "key")
	if key == "" {
		t.Fatal("missing generated key")
	}
	custom := c.call("POST", records, Object{"data": Object{"key": "custom", "value": 1}}, 200).(map[string]interface{})
	updated := c.call("PATCH", records+"/"+str(custom, "id"), Object{"data": Object{"value": 2}}, 200).(map[string]interface{})
	if str(updated["data"].(map[string]interface{}), "key") != "custom" {
		t.Fatal("update changed key")
	}
	c.call("POST", records, Object{"data": Object{"key": "custom"}}, 409)
	c.call("PATCH", records+"/"+str(record, "id"), Object{"data": Object{"key": "custom"}}, 409)
	c.call("POST", records, Object{"data": Object{"key": " "}}, 400)
	c.call("POST", records, Object{"data": Object{"key": 1}}, 400)
	other := c.call("POST", base+"/collections", Object{"name": "other"}, 200).(map[string]interface{})
	c.call("POST", base+"/collections/"+str(other, "id")+"/records", Object{"data": Object{"key": "custom"}}, 200)
	doc, err := s.find(strings.TrimPrefix(base, "/api/projects/"), "records", str(record, "id"))
	if err != nil || str(decode(doc)["data"].(map[string]interface{}), "key") != key {
		t.Fatal("record not persisted")
	}
}

func TestJobAndServiceStatus(t *testing.T) {
	s, c, base := loginProject(t)
	job := c.call("POST", base+"/jobs", Object{"name": "toggle", "type": "shell", "status": "inactive", "content": "echo ok"}, 200).(map[string]interface{})
	c.call("PATCH", base+"/jobs/"+str(job, "id"), Object{"status": "active"}, 200)
	if len(s.scheduler.Entries()) != 1 {
		t.Fatal("enabled task not scheduled")
	}
	c.call("PATCH", base+"/jobs/"+str(job, "id"), Object{"status": "inactive"}, 200)
	if len(s.scheduler.Entries()) != 0 {
		t.Fatal("disabled task still scheduled")
	}
	service := c.call("POST", base+"/services", Object{"name": "toggle", "method": "POST", "route": "/toggle", "content": "<?php function handle(Request $r) { return ['ok'=>true]; }"}, 200).(map[string]interface{})
	c.call("PATCH", base+"/services/"+str(service, "id"), Object{"status": "invalid"}, 400)
	c.call("PATCH", base+"/services/"+str(service, "id"), Object{"status": "inactive"}, 200)
	c.call("POST", base+"/invoke/toggle", nil, 404)
	c.call("PATCH", base+"/services/"+str(service, "id"), Object{"status": "active"}, 200)
	c.call("POST", base+"/invoke/toggle", nil, 200)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestQQOAuthFlow(t *testing.T) {
	t.Setenv("QQ_APP_ID", "123")
	t.Setenv("QQ_APP_KEY", "secret")
	t.Setenv("QQ_REDIRECT_URL", "http://localhost:3000/api/auth/qq/callback")
	s, c := setup(t)
	calls := 0
	s.qqClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		payload := ""
		switch r.URL.Path {
		case "/oauth2.0/token":
			if r.URL.Query().Get("client_secret") != "secret" || r.URL.Query().Get("code") != "code" {
				t.Fatal("bad token exchange")
			}
			payload = `{"access_token":"access"}`
		case "/oauth2.0/me":
			payload = `callback( {"client_id":"123","openid":"user"} );`
		case "/user/get_user_info":
			payload = `{"ret":0,"nickname":"QQ tester"}`
		default:
			t.Fatal(r.URL.Path)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(payload)), Header: make(http.Header)}, nil
	})}
	start := func() (string, *http.Cookie) {
		req := httptest.NewRequest("POST", "/api/auth/qq", nil)
		res := httptest.NewRecorder()
		c.router.ServeHTTP(res, req)
		if res.Code != 200 {
			t.Fatal(res.Body.String())
		}
		cookies := res.Result().Cookies()
		if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteLaxMode {
			t.Fatal("bad state cookie")
		}
		return cookies[0].Value, cookies[0]
	}
	callback := func(state string, cookie *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/auth/qq/callback?code=code&state="+url.QueryEscape(state), nil)
		req.AddCookie(cookie)
		res := httptest.NewRecorder()
		c.router.ServeHTTP(res, req)
		return res
	}
	state, cookie := start()
	bad := callback("wrong", cookie)
	if !strings.Contains(bad.Header().Get("Location"), "authError=") || calls != 0 {
		t.Fatal("invalid state was accepted")
	}
	success := callback(state, cookie)
	if success.Code != 303 || success.Header().Get("Location") != "/" || calls != 3 {
		t.Fatal(success.Body.String(), calls)
	}
	for _, session := range success.Result().Cookies() {
		if session.Name == "crond_session" {
			c.cookie = session
		}
	}
	me := c.call("GET", "/api/auth/me", nil, 200).(map[string]interface{})
	if me["username"] != "QQ tester" {
		t.Fatal(me)
	}
	replay := callback(state, cookie)
	if !strings.Contains(replay.Header().Get("Location"), "authError=") || calls != 3 {
		t.Fatal("state replay accepted")
	}
	expired, expiredCookie := start()
	s.db.Model(&OAuthState{}).Where("state = ?", expired).Update("expires_at", time.Now().Add(-time.Minute))
	callback(expired, expiredCookie)
	if calls != 3 {
		t.Fatal("expired state accepted")
	}
	t.Setenv("QQ_APP_KEY", "")
	c.call("POST", "/api/auth/qq", nil, 503)
}
