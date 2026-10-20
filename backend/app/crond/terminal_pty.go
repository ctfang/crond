package crond

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"golang.org/x/sys/unix"
)

type terminalSession struct {
	mu          sync.Mutex
	project     string
	directory   string
	baseline    []Object
	token       string
	installedAt int64
	idle        bool
}

func shellQuote(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'" }

func (s *Service) terminalRC(project, directory, id string) (string, error) {
	script := "PS1='\\[\\033[32m\\]crond:\\W\\$ \\[\\033[0m\\]'\nHISTFILE=/dev/null\n"
	script += `composer() {
 local cliCommand='composer' arg response status offset=0
 for arg in "$@"; do printf -v arg '%q' "$arg"; cliCommand="$cliCommand $arg"; done
 local payload
 payload=$(command crond-json command "$cliCommand") || return
 response=$(command curl -sS --max-time 10 "$CROND_API_URL/terminal/command/SESSION_ID" -H "Authorization: Bearer $CROND_API_TOKEN" -H 'Content-Type: application/json' --data-binary "$payload") || return
 printf '%s' "$response" | command crond-json accepted || return 1
 while :; do
  response=$(command curl -sS --max-time 10 "$CROND_API_URL/terminal" -H "Authorization: Bearer $CROND_API_TOKEN") || return
  printf '%s' "$response" | command crond-json output "$offset"
  offset=$(printf '%s' "$response" | command crond-json length)
  status=$(printf '%s' "$response" | command crond-json status)
  if [ "$status" != running ]; then printf '\n'; [ "$status" = success ]; return; fi
  command sleep 0.2
 done
}
`
	script = strings.ReplaceAll(script, "SESSION_ID", id)
	script += "PROMPT_COMMAND='command curl -fsS --max-time 10 -o /dev/null -X POST \"$CROND_API_URL/terminal/sync/" + id + "\" -H \"Authorization: Bearer $CROND_API_TOKEN\" || printf \"\\n[终端文件同步失败]\\n\"'\n"
	name := filepath.Join(directory, ".crond-terminal-rc")
	return name, os.WriteFile(name, []byte(script), 0600)
}

func (s *Service) authorizedTerminalSession(c *gin.Context) (*terminalSession, bool) {
	raw, ok := s.terminalSessions.Load(c.Param("sessionId"))
	if !ok {
		fail(c, 404, "终端会话已关闭")
		return nil, false
	}
	session := raw.(*terminalSession)
	if session.project != c.Param("projectId") || s.role(session.project, userID(c)) != "owner" {
		fail(c, 403, "终端不属于当前项目拥有者")
		return nil, false
	}
	if c.GetBool("worker") && c.GetHeader("Authorization") != "Bearer "+session.token {
		fail(c, 403, "仅终端会话凭据可调用此接口")
		return nil, false
	}
	return session, true
}
func (s *Service) sessionTerminalCommand(c *gin.Context) {
	if _, ok := s.authorizedTerminalSession(c); !ok {
		return
	}
	s.terminalCommand(c)
}
func (s *Service) syncTerminalSession(c *gin.Context) {
	session, ok := s.authorizedTerminalSession(c)
	if !ok {
		return
	}
	if err := s.refreshTerminal(session); err != nil {
		fail(c, 409, err.Error())
		return
	}
	session.mu.Lock()
	session.idle = true
	session.mu.Unlock()
	c.JSON(200, Object{"ok": true})
}

// Each shell prompt commits completed source edits and loads editor/Composer changes.
func (s *Service) refreshTerminal(session *terminalSession) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	snapshot, err := terminalSourceFiles(session.directory)
	if err != nil {
		return err
	}
	for _, file := range snapshot {
		if str(file, "type") == "file" && strings.Contains(str(file, "content"), session.token) {
			if err := os.WriteFile(filepath.Join(session.directory, filePath(file)), []byte(strings.ReplaceAll(str(file, "content"), session.token, "[REDACTED]")), 0600); err != nil {
				return err
			}
		}
	}
	if err := s.syncTerminalFiles(session.project, session.directory, session.baseline); err != nil {
		return err
	}
	files, err := s.readProjectFiles(session.project)
	if err != nil {
		return err
	}
	current := map[string]Object{}
	for _, file := range files {
		current[filePath(file)] = file
	}
	// Remove only obsolete source paths; vendor and shell configuration stay private.
	sort.Slice(snapshot, func(i, j int) bool { return len(filePath(snapshot[i])) > len(filePath(snapshot[j])) })
	for _, file := range snapshot {
		if current[filePath(file)] == nil {
			if err := os.Remove(filepath.Join(session.directory, filePath(file))); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	for _, file := range files {
		target := filepath.Join(session.directory, filePath(file))
		if str(file, "type") == "folder" {
			err = os.MkdirAll(target, 0700)
		} else {
			err = os.MkdirAll(filepath.Dir(target), 0700)
			if err == nil {
				err = os.WriteFile(target, []byte(str(file, "content")), 0600)
			}
		}
		if err != nil {
			return err
		}
	}
	s.dependencyMu.RLock()
	var build ComposerBuild
	err = s.db.Where("project_id = ?", s.dependencyKey(session.project)).Find(&build).Error
	if err == nil && build.InstalledAt != session.installedAt {
		err = os.RemoveAll(filepath.Join(session.directory, "vendor"))
		if err == nil && build.ProjectID != "" {
			source := filepath.Join(build.Directory, "vendor")
			err = copyDependencyTree(source, filepath.Join(session.directory, "vendor"), source)
		}
		if err == nil {
			session.installedAt = build.InstalledAt
		}
	}
	s.dependencyMu.RUnlock()
	if err != nil {
		return err
	}
	session.baseline = files
	return nil
}

func (s *Service) openTerminal(c *gin.Context) {
	// Background worker credentials cannot create another long-lived shell session.
	token, _ := c.Cookie("crond_session")
	var login Session
	if token == "" || s.db.Where("token = ?", token).First(&login).Error != nil || login.ScopedProjectID != "" {
		fail(c, 403, "请使用已登录浏览器连接终端")
		return
	}
	project := c.Param("projectId")
	busyKey := "terminal:" + s.fileOwner(project)
	if _, busy := s.running.LoadOrStore(busyKey, true); busy {
		fail(c, 409, "同一用户已有终端会话，请先关闭")
		return
	}
	defer s.running.Delete(busyKey)
	directory, err := s.workspaceFiles(project)
	if err != nil {
		result(c, nil, err)
		return
	}
	defer os.RemoveAll(directory)
	if err = s.attachDependencySnapshot(project, directory); err != nil {
		result(c, nil, err)
		return
	}
	baseline, err := terminalSourceFiles(directory)
	if err != nil {
		result(c, nil, err)
		return
	}
	id := newID()
	worker := Session{Token: newID(), UserID: userID(c), ScopedProjectID: project, ExpiresAt: time.Now().Add(30 * time.Minute)}
	if err = s.db.Create(&worker).Error; err != nil {
		result(c, nil, err)
		return
	}
	defer s.db.Where("token = ?", worker.Token).Delete(&Session{})
	session := &terminalSession{project: project, directory: directory, baseline: baseline, token: worker.Token}
	rc, err := s.terminalRC(project, directory, id)
	if err != nil {
		result(c, nil, err)
		return
	}
	upgrader := websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(s.composerContext, 30*time.Minute)
	defer cancel()
	_, environment, err := s.scriptRuntime(project, directory)
	if err != nil {
		_ = conn.WriteMessage(websocket.BinaryMessage, []byte(err.Error()))
		return
	}
	command := exec.Command("bash", "--noprofile", "--rcfile", rc, "-i")
	command.Dir = directory
	command.Env = append(environment, "TERM=xterm-256color", "BASH_SILENCE_DEPRECATION_WARNING=1", "HOME="+directory, "CROND_API_URL="+s.apiURL+"/projects/"+project, "CROND_API_TOKEN="+worker.Token)
	terminal, err := pty.StartWithSize(command, &pty.Winsize{Cols: 80, Rows: 24})
	if err != nil {
		_ = conn.WriteMessage(websocket.BinaryMessage, []byte(err.Error()))
		return
	}
	s.composerWG.Add(1)
	defer s.composerWG.Done()
	s.terminalSessions.Store(id, session)
	defer s.terminalSessions.Delete(id)
	started := time.Now()
	transcript := &cappedOutput{}
	transcript.redact(worker.Token)
	var writeMu sync.Mutex
	send := func(data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		return conn.WriteMessage(websocket.BinaryMessage, data)
	}
	outputDone := make(chan struct{})
	go func() {
		defer close(outputDone)
		defer cancel()
		data := make([]byte, 8192)
		for {
			n, err := terminal.Read(data)
			if n > 0 {
				_, _ = transcript.Write(data[:n])
				if err := send(data[:n]); err != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()
	// Close both streams to release blocked readers on shutdown, timeout or logout.
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				if group, err := unix.IoctlGetInt(int(terminal.Fd()), unix.TIOCGPGRP); err == nil && group > 0 {
					_ = syscall.Kill(-group, syscall.SIGKILL)
				}
				_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
				_ = terminal.Close()
				_ = conn.Close()
				return
			case <-ticker.C:
				var active Session
				if s.db.Where("token = ? AND expires_at > ?", token, time.Now()).First(&active).Error != nil || s.role(project, userID(c)) != "owner" {
					cancel()
					continue
				}
				session.mu.Lock()
				idle := session.idle
				session.mu.Unlock()
				if idle {
					if err := s.refreshTerminal(session); err != nil {
						_ = send([]byte("\r\n[文件同步失败] " + err.Error() + "\r\n"))
					}
				}
			}
		}
	}()
	conn.SetReadLimit(65536)
	for {
		kind, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		if kind == websocket.BinaryMessage {
			var size struct {
				Cols uint16 `json:"cols"`
				Rows uint16 `json:"rows"`
			}
			if json.Unmarshal(data, &size) == nil && size.Cols > 0 && size.Cols <= 500 && size.Rows > 0 && size.Rows <= 200 {
				_ = pty.Setsize(terminal, &pty.Winsize{Cols: size.Cols, Rows: size.Rows})
				continue
			}
		}
		if strings.Contains(string(data), "\x03") {
			s.cancelProjectCommand(project)
		}
		if strings.ContainsAny(string(data), "\r\n\x03") {
			session.mu.Lock()
			session.idle = false
			session.mu.Unlock()
		}
		if _, err := terminal.Write(data); err != nil {
			break
		}
	}
	cancel()
	<-stopped
	_ = command.Wait()
	<-outputDone
	s.terminalSessions.Delete(id)
	// Revoke execution credentials before committing any final edits.
	s.db.Where("token = ?", worker.Token).Delete(&Session{})
	err = s.refreshTerminal(session)
	status := "success"
	if err != nil && !errors.Is(err, io.EOF) {
		status = "error"
		_, _ = transcript.Write([]byte("\n" + err.Error()))
	}
	if _, findErr := s.find("", "projects", project); findErr == nil {
		_, _ = s.save(project, "logs", "", Object{"jobName": "交互终端", "triggerTime": started.UnixMilli(), "duration": time.Since(started).Milliseconds(), "status": status, "output": transcript.String()}, "")
	}
}
