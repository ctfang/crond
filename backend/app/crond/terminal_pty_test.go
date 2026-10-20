package crond

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type terminalReader struct {
	pending string
	conn    *websocket.Conn
}

func (r *terminalReader) until(t *testing.T, expected string) string {
	t.Helper()
	r.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	for {
		if index := strings.Index(r.pending, expected); index >= 0 {
			end := index + len(expected)
			output := r.pending[:end]
			r.pending = r.pending[end:]
			return output
		}
		_, data, err := r.conn.ReadMessage()
		if err != nil {
			t.Fatalf("waiting for %q: %v; output=%q", expected, err, r.pending)
		}
		r.pending += string(data)
	}
}

func TestInteractiveTerminalPTYAndFilePersistence(t *testing.T) {
	s, c, base := loginProject(t)
	native := t.TempDir()
	marker := filepath.Join(native, "native-php-called")
	if err := os.WriteFile(filepath.Join(native, "php"), []byte("#!/bin/sh\nprintf native > "+shellQuote(marker)+"\nexit 77\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", native+string(os.PathListSeparator)+os.Getenv("PATH"))
	entry := c.call("POST", base+"/files", Object{"path": "pty-entry.php", "type": "file", "content": "<?php define('CROND_PTY_ENTRY', 'custom');"}, 200).(map[string]interface{})
	c.call("PATCH", base, Object{"entryFileId": str(entry, "id")}, 200)
	server := httptest.NewServer(c.router)
	defer server.Close()
	s.SetAPIURL(server.URL + "/api")
	header := http.Header{"Cookie": {c.cookie.String()}, "Origin": {server.URL}}
	conn, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+base+"/terminal/ws", header)
	if err != nil {
		t.Fatal(response, err)
	}
	defer conn.Close()
	reader := &terminalReader{conn: conn}
	reader.until(t, "\x1b[0m")
	send := func(command string) {
		t.Helper()
		if err := conn.WriteMessage(websocket.TextMessage, []byte(command)); err != nil {
			t.Fatal(err)
		}
	}
	send("test -t 0 && printf '\\n%s\\n' 'TTY-OK'\r")
	reader.until(t, "\r\nTTY-OK\r\n")
	reader.until(t, "\x1b[0m")
	send("php -r 'echo Config::get(\"app.name\"), \":\", CROND_PTY_ENTRY, PHP_EOL;'\r")
	reader.until(t, "\r\nScript App:custom\r\n")
	reader.until(t, "\x1b[0m")
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("interactive terminal invoked native PHP")
	}
	conn.WriteMessage(websocket.BinaryMessage, []byte(`{"cols":132,"rows":38}`))
	send("stty size\r")
	output := reader.until(t, "\r\n38 132\r\n")
	reader.until(t, "\x1b[0m")
	if !strings.Contains(output, "38 132") {
		t.Fatal("PTY resize failed", output)
	}
	send("cd src\r")
	reader.until(t, "\x1b[0m")
	send("printf 'persistent-pty-source' > terminal-check.txt\r")
	reader.until(t, "\x1b[0m")
	found := false
	deadlineSync := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadlineSync) {
		files, err := s.list(strings.TrimPrefix(base, "/api/projects/"), "files", "")
		if err != nil {
			t.Fatal(err)
		}
		for _, file := range files {
			if filePath(file) == "src/terminal-check.txt" && str(file, "content") == "persistent-pty-source" {
				found = true
			}
		}
		if found {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !found {
		t.Fatal("persistent cwd or source synchronization failed", reader.pending)
	}
	send("read -r answer; printf '\\nANSWER:%s\\n' \"$answer\"\r")
	send("interactive-input\r")
	reader.until(t, "\r\nANSWER:interactive-input\r\n")
	reader.until(t, "\x1b[0m")
	send("sleep 30\r")
	reader.until(t, "sleep 30")
	// Wait for Bash to transfer the foreground process group to sleep.
	time.Sleep(100 * time.Millisecond)
	send("\x03")
	reader.until(t, "\x1b[0m")
	// Ctrl+C also cancels managed commands, including Composer's background process.
	c.call("POST", base+"/terminal", Object{"command": "sleep 30"}, 202)
	cancelReady := false
	for deadline := time.Now().Add(time.Second); time.Now().Before(deadline); {
		raw, _ := s.composerJobs.Load(strings.TrimPrefix(base, "/api/projects/"))
		task := raw.(*composerTask)
		task.mu.Lock()
		cancelReady = task.cancel != nil
		task.mu.Unlock()
		if cancelReady {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !cancelReady {
		t.Fatal("managed command never became cancellable")
	}
	send("\x03")
	waitComposer(t, c, base, "error")
	// A foreign origin must never upgrade an authenticated owner's shell.
	foreign := http.Header{"Cookie": {c.cookie.String()}, "Origin": {"https://foreign.invalid"}}
	_, rejected, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+base+"/terminal/ws", foreign)
	if err == nil || rejected.StatusCode != 403 {
		t.Fatal("foreign origin accepted", rejected, err)
	}
	conn.Close()
	key := "terminal:" + s.fileOwner(strings.TrimPrefix(base, "/api/projects/"))
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, running := s.running.Load(key); !running {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("disconnected terminal did not release its process/session")
}

func TestPTYComposerBridgeLoadsPersistentDependencies(t *testing.T) {
	if _, err := composerPHARPath(); err != nil {
		t.Skip("Composer unavailable")
	}
	s, c, base := loginProject(t)
	project := strings.TrimPrefix(base, "/api/projects/")
	files, _ := s.list(project, "files", "")
	for _, file := range files {
		if filePath(file) == "composer.json" {
			c.call("PATCH", base+"/files/"+str(file, "id"), Object{"content": `{"name":"crond/pty-test","require":{},"repositories":[{"type":"path","url":"packages/demo","options":{"symlink":false}},{"packagist.org":false}]}`}, 200)
		}
	}
	c.call("POST", base+"/files", Object{"path": "packages/demo/composer.json", "type": "file", "content": `{"name":"fixture/demo","version":"1.0.0","autoload":{"psr-4":{"Demo\\":"src/"}}}`}, 200)
	c.call("POST", base+"/files", Object{"path": "packages/demo/src/Value.php", "type": "file", "content": "<?php namespace Demo; class Value { public static function message() { return 'PTY-COMPOSER-LOADED'; } }"}, 200)
	server := httptest.NewServer(c.router)
	defer server.Close()
	s.SetAPIURL(server.URL + "/api")
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+base+"/terminal/ws", http.Header{"Cookie": {c.cookie.String()}, "Origin": {server.URL}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	reader := &terminalReader{conn: conn}
	reader.until(t, "\x1b[0m")
	conn.WriteMessage(websocket.TextMessage, []byte("composer require fixture/demo:1.0.0\r"))
	reader.until(t, "Generating autoload files")
	reader.until(t, "\x1b[0m")
	conn.WriteMessage(websocket.TextMessage, []byte("composer install\r"))
	reader.until(t, "Generating autoload files")
	reader.until(t, "\x1b[0m")
	conn.WriteMessage(websocket.TextMessage, []byte("php -r 'echo Demo\\Value::message(), PHP_EOL;'\r"))
	reader.until(t, "\r\nPTY-COMPOSER-LOADED\r\n")
	reader.until(t, "\x1b[0m")
	manifest, _, err := s.composerManifest(project)
	if err != nil || !strings.Contains(manifest, "fixture/demo") {
		t.Fatal("PTY Composer did not persist manifest", manifest, err)
	}
}
