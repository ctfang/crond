package crond

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestFrameworkHTTPInPHPAndOrigami(t *testing.T) {
	_, c, base := loginProject(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/slow":
			time.Sleep(80 * time.Millisecond)
		case "/redirect":
			w.Header().Set("Location", "/echo")
			w.WriteHeader(302)
			return
		case "/error":
			w.WriteHeader(422)
			fmt.Fprint(w, `{"error":"invalid"}`)
			return
		case "/binary":
			w.Write([]byte{0, 255, 1})
			return
		case "/null":
			fmt.Fprint(w, "null")
			return
		case "/text":
			fmt.Fprint(w, "not json")
			return
		}
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Add("X-Reply", "one")
		w.Header().Add("X-Reply", "two")
		json.NewEncoder(w).Encode(map[string]interface{}{"method": r.Method, "query": r.URL.RawQuery, "body": string(body), "type": r.Header.Get("Content-Type"), "token": r.Header.Get("X-Token"), "authorization": r.Header.Get("Authorization")})
	}))
	defer upstream.Close()
	address, _ := json.Marshal(upstream.URL)
	code := `$url = ` + string(address) + `;
 $get = Http::get($url . '/echo?existing=1#fragment', ['query'=>['q'=>'a b'], 'headers'=>['X-Token'=>'hello']]);
 $post = Http::post($url . '/echo', ['nested'=>['ok'=>true]]);
 $form = Http::request('POST', $url . '/echo', ['form'=>['q'=>'a b']]);
 $put = Http::put($url . '/echo', 'raw');
 $patch = Http::patch($url . '/echo', ['value'=>2]);
 $delete = Http::delete($url . '/echo');
 $error = Http::get($url . '/error');
 $throws = false;
 try { $error->throwIfFailed(); } catch (RuntimeException $e) { $throws = true; }
 $badJSON = false;
 try { Http::get($url . '/text')->json(); } catch (RuntimeException $e) { $badJSON = true; }
 $timedOut = false;
 try { Http::get($url . '/slow', ['timeout'=>0.01]); } catch (RuntimeException $e) { $timedOut = true; }
 $conflict = false;
 try { Http::request('POST', $url, ['json'=>[], 'form'=>[]]); } catch (InvalidArgumentException $e) { $conflict = true; }
 $invalidURL = false;
 try { Http::get('file:///etc/hosts'); } catch (InvalidArgumentException $e) { $invalidURL = true; }
 $badHeader = false;
 try { Http::get($url, ['headers'=>['X-Test'=>"bad\r\nInjected: value"]]); } catch (InvalidArgumentException $e) { $badHeader = true; }
 $result = ['get'=>$get->json(), 'status'=>$get->status(), 'ok'=>$get->successful(), 'header'=>$get->header('X-REPLY'), 'missing'=>$get->header('missing', 'fallback'), 'post'=>$post->json(), 'form'=>$form->json(), 'put'=>$put->json(), 'patch'=>$patch->json(), 'delete'=>$delete->json(), 'errorStatus'=>$error->status(), 'errorOK'=>$error->successful(), 'throws'=>$throws, 'badJSON'=>$badJSON, 'timedOut'=>$timedOut, 'conflict'=>$conflict, 'invalidURL'=>$invalidURL, 'badHeader'=>$badHeader, 'redirect'=>Http::get($url . '/redirect')->status(), 'binary'=>base64_encode(Http::get($url . '/binary')->body()), 'nullJSON'=>Http::get($url . '/null')->json()];`
	check := func(t *testing.T, result Object) {
		t.Helper()
		get := result["get"].(map[string]interface{})
		if get["method"] != "GET" || get["query"] != "existing=1&q=a+b" || get["token"] != "hello" || get["authorization"] != "" {
			t.Fatal(get)
		}
		if result["status"] != float64(200) || result["ok"] != true || result["header"] != "one, two" || result["missing"] != "fallback" {
			t.Fatal(result)
		}
		for _, key := range []string{"throws", "badJSON", "timedOut", "conflict", "invalidURL", "badHeader"} {
			if result[key] != true {
				t.Fatalf("%s: %v", key, result)
			}
		}
		if result["binary"] != "AP8B" || result["nullJSON"] != nil {
			t.Fatal(result)
		}
		if result["errorStatus"] != float64(422) || result["errorOK"] != false || result["redirect"] != float64(302) {
			t.Fatal(result)
		}
		post := result["post"].(map[string]interface{})
		if post["method"] != "POST" || post["body"] != `{"nested":{"ok":true}}` || post["type"] != "application/json" {
			t.Fatal(post)
		}
		form := result["form"].(map[string]interface{})
		if form["body"] != "q=a+b" || form["type"] != "application/x-www-form-urlencoded" {
			t.Fatal(form)
		}
		for _, key := range []string{"put", "patch", "delete"} {
			if result[key].(map[string]interface{})["method"] != strings.ToUpper(key) {
				t.Fatal(result)
			}
		}
		if result["put"].(map[string]interface{})["body"] != "raw" {
			t.Fatal(result)
		}
	}
	t.Run("Origami PHP task", func(t *testing.T) {
		run := c.call("POST", base+"/execute", Object{"type": "php", "content": "<?php " + code + " echo json_encode($result);"}, 200).(map[string]interface{})
		if run["status"] != "success" {
			t.Fatal(run)
		}
		result := Object{}
		if err := json.Unmarshal([]byte(str(run, "output")), &result); err != nil {
			t.Fatal(run, err)
		}
		check(t, result)
	})
	t.Run("Origami service", func(t *testing.T) {
		t.Setenv("PATH", "/nonexistent")
		c.call("POST", base+"/services", Object{"name": "HTTP test", "method": "POST", "route": "/http-test", "content": "<?php function handle(Request $request) { " + code + " return $result; }"}, 200)
		result := c.call("POST", base+"/invoke/http-test", nil, 200).(map[string]interface{})
		check(t, result)
	})
}
