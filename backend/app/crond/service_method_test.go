package crond

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServiceMethodDefinitionAndRouting(t *testing.T) {
	s, c, base := loginProject(t)
	project, _ := s.find("", "projects", strings.TrimPrefix(base, "/api/projects/"))
	direct := "/" + str(decode(project), "slug") + "/resource"
	source := "<?php function handle(Request $r) { return ['method'=>$r->method,'value'=>$r->input('value')]; }"
	get := c.call("POST", base+"/services", Object{"name": "read", "route": "/resource", "content": source}, 200).(map[string]interface{})
	if get["method"] != "GET" {
		t.Fatal(get)
	}
	post := c.call("POST", base+"/services", Object{"name": "write", "route": "/resource", "method": "post", "content": source}, 200).(map[string]interface{})
	if post["method"] != "POST" {
		t.Fatal(post)
	}
	c.call("POST", base+"/services", Object{"name": "duplicate", "route": "/resource/", "method": "GET", "content": source}, 409)
	c.call("PATCH", base+"/services/"+str(post, "id"), Object{"method": "GET"}, 409)
	for _, method := range []interface{}{"", "TRACE", "ANY", 123, nil} {
		c.call("POST", base+"/services", Object{"name": "invalid", "route": "/invalid", "method": method, "content": source}, 400)
	}
	for _, target := range []string{direct, base + "/invoke/resource"} {
		result := c.call("GET", target+"?value=query", nil, 200).(map[string]interface{})
		if result["method"] != "GET" || result["value"] != "query" {
			t.Fatal(result)
		}
		result = c.call("POST", target, Object{"value": "json"}, 200).(map[string]interface{})
		if result["method"] != "POST" || result["value"] != "json" {
			t.Fatal(result)
		}
		request := httptest.NewRequest("DELETE", target, nil)
		request.AddCookie(c.cookie)
		response := httptest.NewRecorder()
		c.router.ServeHTTP(response, request)
		if response.Code != 405 || response.Header().Get("Allow") != "GET, POST" {
			t.Fatal(response.Code, response.Header(), response.Body.String())
		}
	}
	for _, method := range []string{"PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"} {
		c.call("POST", base+"/services", Object{"name": method, "route": "/resource", "method": method, "content": source}, 200)
		request := httptest.NewRequest(method, direct, nil)
		request.AddCookie(c.cookie)
		response := httptest.NewRecorder()
		c.router.ServeHTTP(response, request)
		if response.Code != 200 {
			t.Fatalf("%s: %d %s", method, response.Code, response.Body.String())
		}
	}
	c.call("PATCH", base+"/services/"+str(get, "id"), Object{"status": "inactive"}, 200)
	c.call("GET", direct, nil, 405)
	c.call("GET", direct+"/missing", nil, 404)
}
