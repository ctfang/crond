package crond

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-home-admin/go-admin/app/engine"
)

const outputLimit = 1 << 20

// cappedOutput continues draining a child process without unbounded memory use.
type cappedOutput struct {
	mu      sync.Mutex
	buf     bytes.Buffer
	secrets []string
}

func (b *cappedOutput) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	remaining := outputLimit - b.buf.Len()
	if remaining > 0 {
		if len(p) > remaining {
			p = p[:remaining]
		}
		_, _ = b.buf.Write(p)
	}
	return n, nil
}
func (b *cappedOutput) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	value := b.buf.String()
	for _, secret := range b.secrets {
		if secret != "" {
			value = strings.ReplaceAll(value, secret, "[REDACTED]")
		}
	}
	return value
}
func (b *cappedOutput) redact(secret string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.secrets = append(b.secrets, secret)
}

type Execution struct {
	Output      string      `json:"output"`
	Status      string      `json:"status"`
	Duration    int64       `json:"duration"`
	HTTP        *HTTPResult `json:"http,omitempty"`
	Diagnostics string      `json:"diagnostics,omitempty"`
}
type HTTPConfig struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}
type HTTPResult struct {
	Status     int               `json:"status"`
	StatusText string            `json:"statusText"`
	Headers    map[string]string `json:"headers"`
	Data       interface{}       `json:"data"`
}

func validateFile(data Object) error {
	name := str(data, "path")
	if name == "" {
		name = str(data, "name")
	}
	cleaned := filepath.Clean(name)
	if cleaned == fileIndexName || strings.HasPrefix(cleaned, fileIndexName+string(filepath.Separator)) {
		return errors.New("该路径用于文件索引，不能作为项目源文件")
	}
	if name == "" || filepath.IsAbs(name) || cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) || strings.Contains(name, "\\") {
		return errors.New("文件路径必须为项目内的相对路径")
	}
	if str(data, "type") != "file" && str(data, "type") != "folder" {
		return errors.New("文件类型必须为 file 或 folder")
	}
	return nil
}
func (s *Service) workspace(project string) (string, error) {
	directory, err := s.workspaceFiles(project)
	if err != nil {
		return "", err
	}
	if err := s.attachDependencies(project, directory); err != nil {
		_ = os.RemoveAll(directory)
		return "", err
	}
	return directory, nil
}
func (s *Service) workspaceFiles(project string) (string, error) {
	root, err := filepath.Abs(filepath.Join(s.workRoot, project))
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	// Per-execution directories prevent stale/deleted files and overlapping writes.
	directory, err := os.MkdirTemp(root, "run-")
	if err != nil {
		return "", err
	}
	files, err := s.list(project, "files", "")
	if err != nil {
		_ = os.RemoveAll(directory)
		return "", err
	}
	for _, file := range files {
		if err = validateFile(file); err != nil {
			_ = os.RemoveAll(directory)
			return "", err
		}
		name := str(file, "path")
		if name == "" {
			name = str(file, "name")
		}
		target := filepath.Join(directory, filepath.Clean(name))
		if str(file, "type") == "folder" {
			err = os.MkdirAll(target, 0700)
		} else {
			err = os.MkdirAll(filepath.Dir(target), 0700)
			if err == nil {
				err = os.WriteFile(target, []byte(str(file, "content")), 0600)
			}
		}
		if err != nil {
			_ = os.RemoveAll(directory)
			return "", err
		}
	}
	helper, err := fs.ReadFile(s.frameworkFS, "src/Database.php")
	if err != nil {
		_ = os.RemoveAll(directory)
		return "", err
	}
	helperPath := filepath.Join(directory, "src", "Database.php")
	if _, err = os.Stat(helperPath); os.IsNotExist(err) {
		if err = os.MkdirAll(filepath.Dir(helperPath), 0700); err == nil {
			err = os.WriteFile(helperPath, helper, 0600)
		}
		if err != nil {
			_ = os.RemoveAll(directory)
			return "", err
		}
	}

	return directory, nil
}
func (s *Service) execute(ctx context.Context, project string, job Object) Execution {
	start := time.Now()
	execution := Execution{Status: "success"}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var err error
	if str(job, "type") == "http" {
		var config HTTPConfig
		content := str(job, "content")
		if json.Unmarshal([]byte(content), &config) != nil {
			config.URL = content
			config.Method = "GET"
		}
		execution.HTTP, err = requestHTTP(ctx, config)
		if execution.HTTP != nil {
			encoded, _ := json.MarshalIndent(execution.HTTP, "", "  ")
			execution.Output = string(encoded)
		}
	} else {
		execution.Output, execution.Diagnostics, err = s.executeScript(ctx, project, job)
	}
	if err != nil {
		execution.Status = "error"
		execution.Output += "\n[ERROR] " + err.Error()
	}
	if ctx.Err() != nil {
		execution.Status = "error"
		execution.Output += "\n[ERROR] 执行超时或请求已取消"
	}
	execution.Duration = time.Since(start).Milliseconds()
	return execution
}

// PHP tasks and terminal commands use the same Origami CLI; services keep stdout
// separate from diagnostics so framework logs cannot corrupt their HTTP response.
func (s *Service) executeScript(ctx context.Context, project string, job Object) (string, string, error) {
	kind := str(job, "type")
	if kind != "shell" && kind != "php" && kind != "origami" {
		return "", "", errors.New("不支持的任务类型")
	}
	directory, err := s.workspace(project)
	if err != nil {
		return "", "", err
	}
	defer os.RemoveAll(directory)
	bootstrap, environment, err := s.scriptRuntime(project, directory)
	if err != nil {
		return "", "", err
	}
	service := kind == "origami"
	content := str(job, "content")
	if service && job["serviceSource"] != nil {
		source := "handler-" + newID() + ".php"
		if err := os.WriteFile(filepath.Join(directory, source), []byte(str(job, "serviceSource")), 0600); err != nil {
			return "", "", err
		}
		content = "<?php $crondSourceFile = __DIR__ . '/" + source + "';\n" + strings.TrimPrefix(content, "<?php")
	}
	script := "task-" + newID() + ".sh"
	if kind != "shell" {
		script = "task-" + newID() + ".php"
	}
	if err := os.WriteFile(filepath.Join(directory, script), []byte(content), 0600); err != nil {
		return "", "", err
	}
	binary, args := "bash", []string{script}
	if kind != "shell" {
		binary, err = os.Executable()
		if err != nil {
			return "", "", err
		}
		args = []string{engine.CLIWorkerFlag, script}
		if service {
			args = []string{engine.WorkerFlag, script, bootstrap}
		}
	}
	command := exec.CommandContext(ctx, binary, args...)
	command.Dir = directory
	command.Env = environment
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Cancel = func() error {
		if command.Process == nil {
			return os.ErrProcessDone
		}
		return syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	}
	command.WaitDelay = 2 * time.Second
	projectDoc, err := s.find("", "projects", project)
	if err != nil {
		return "", "", errors.New("项目不存在")
	}
	session := Session{Token: newID(), UserID: str(decode(projectDoc), "ownerId"), ScopedProjectID: project, ExpiresAt: time.Now().Add(time.Minute)}
	if err := s.db.Create(&session).Error; err != nil {
		return "", "", err
	}
	defer s.db.Where("token = ?", session.Token).Delete(&Session{})
	command.Env = append(command.Env, "CROND_API_URL="+s.apiURL+"/projects/"+project, "CROND_API_TOKEN="+session.Token)
	output, diagnostics := &cappedOutput{}, &cappedOutput{}
	output.redact(session.Token)
	diagnostics.redact(session.Token)
	command.Stdout, command.Stderr = output, output
	if service {
		command.Stderr = diagnostics
	}
	err = command.Run()
	result := output.String()
	if err != nil && service {
		result += diagnostics.String()
	}
	return result, diagnostics.String(), err
}

func requestHTTP(ctx context.Context, config HTTPConfig) (*HTTPResult, error) {
	parsed, err := url.Parse(config.URL)
	if err != nil || parsed.Host == "" || parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, errors.New("URL 必须是有效的 HTTP/HTTPS 地址")
	}
	if config.Method == "" {
		config.Method = "GET"
	}
	request, err := http.NewRequestWithContext(ctx, config.Method, config.URL, strings.NewReader(config.Body))
	if err != nil {
		return nil, err
	}
	for key, value := range config.Headers {
		request.Header.Set(key, value)
	}
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	contents, err := io.ReadAll(io.LimitReader(response.Body, outputLimit+1))
	if err != nil {
		return nil, err
	}
	if len(contents) > outputLimit {
		return nil, errors.New("HTTP 响应超过 1 MiB 限制")
	}
	var data interface{}
	if json.Unmarshal(contents, &data) != nil {
		data = string(contents)
	}
	headers := map[string]string{}
	for key, values := range response.Header {
		headers[key] = strings.Join(values, ", ")
	}
	result := &HTTPResult{Status: response.StatusCode, StatusText: http.StatusText(response.StatusCode), Headers: headers, Data: data}
	if response.StatusCode >= 400 {
		return result, fmt.Errorf("HTTP %d %s", response.StatusCode, result.StatusText)
	}
	return result, nil
}
func (s *Service) executeStored(ctx context.Context, project, id string) (Execution, error) {
	if _, busy := s.running.LoadOrStore(id, true); busy {
		return Execution{}, errors.New("任务正在执行，请稍后重试")
	}
	defer s.running.Delete(id)
	document, err := s.find(project, "jobs", id)
	if err != nil {
		return Execution{}, err
	}
	job := decode(document)
	execution := s.execute(ctx, project, job)
	_, err = s.save(project, "logs", id, Object{"jobId": id, "jobName": str(job, "name"), "triggerTime": millis() - execution.Duration, "duration": execution.Duration, "status": execution.Status, "output": execution.Output}, "")
	return execution, err
}
func (s *Service) runJob(c *gin.Context) {
	if _, err := s.find(c.Param("projectId"), "jobs", c.Param("id")); err != nil {
		fail(c, 404, "任务不存在")
		return
	}
	execution, err := s.executeStored(c.Request.Context(), c.Param("projectId"), c.Param("id"))
	if err != nil {
		fail(c, 409, err.Error())
		return
	}
	c.JSON(200, execution)
}
func (s *Service) executePreview(c *gin.Context) {
	data, ok := body(c)
	if !ok {
		return
	}
	if str(data, "name") == "" {
		data["name"] = "试运行"
	}
	if err := validateJob(data); err != nil {
		fail(c, 400, err.Error())
		return
	}
	c.JSON(200, s.execute(c.Request.Context(), c.Param("projectId"), data))
}
func (s *Service) invokeService(c *gin.Context) {
	services, err := s.list(c.Param("projectId"), "services", "")
	if err != nil {
		result(c, nil, err)
		return
	}
	allowed := []string{}
	for _, service := range services {
		configured, _ := normalizeServicePath(str(service, "route"))
		requested, _ := normalizeServicePath(c.Param("route"))
		if configured != "" && configured == requested && str(service, "status") == "active" {
			method := serviceMethod(service)
			if method != c.Request.Method {
				allowed = append(allowed, method)
				continue
			}
			contents, err := io.ReadAll(io.LimitReader(c.Request.Body, 2<<20))
			if err != nil {
				fail(c, 400, "无法读取请求体")
				return
			}
			input, _ := json.Marshal(Object{"method": c.Request.Method, "query": c.Request.URL.Query(), "headers": c.Request.Header, "body": string(contents)})
			wrapper := "<?php\n" + `
            $crondRequest = new \Request(json_decode(base64_decode('` + base64.StdEncoding.EncodeToString(input) + `'), true));
            // Load user code as its own file so namespace declarations stay first.
            require $crondSourceFile;
            $crondNamespace = '';
            $crondReadingNamespace = false;
            foreach (token_get_all(file_get_contents($crondSourceFile)) as $token) {
                if (is_array($token)) {
                    if ($token[0] === T_NAMESPACE) { $crondReadingNamespace = true; continue; }
                    if ($crondReadingNamespace && $token[0] !== T_WHITESPACE && $token[0] !== T_COMMENT && $token[0] !== T_DOC_COMMENT) $crondNamespace .= $token[1];
                } elseif ($crondReadingNamespace && ($token === ';' || $token === '{')) {
                    break;
                }
            }
            $crondHandler = $crondNamespace === '' ? 'handle' : $crondNamespace . '\\handle';
            if (function_exists($crondHandler)) echo json_encode($crondHandler($crondRequest), JSON_UNESCAPED_UNICODE);
            elseif ($crondNamespace !== '') throw new \RuntimeException('未找到命名空间服务处理器 ' . $crondHandler . '；请使用 namespace Name; 形式声明');
            `
			execution := s.execute(c.Request.Context(), c.Param("projectId"), Object{"type": "origami", "content": wrapper, "serviceSource": str(service, "content")})
			logOutput := execution.Diagnostics
			if execution.Status != "success" {
				logOutput = execution.Output
			}
			_, logErr := s.save(c.Param("projectId"), "logs", str(service, "id"), Object{"jobId": str(service, "id"), "jobName": "服务: " + str(service, "name"), "triggerTime": millis() - execution.Duration, "duration": execution.Duration, "status": execution.Status, "output": logOutput}, "")
			if logErr != nil {
				result(c, nil, logErr)
				return
			}
			if execution.Status != "success" {
				fail(c, 500, execution.Output)
				return
			}
			var response interface{}
			if json.Unmarshal([]byte(execution.Output), &response) == nil {
				c.Header("X-Crond-Engine", "origami")
				c.JSON(200, response)
			} else {
				c.Header("X-Crond-Engine", "origami")
				c.Data(200, "text/plain; charset=utf-8", []byte(execution.Output))
			}
			return
		}
	}
	if len(allowed) > 0 {
		sort.Strings(allowed)
		c.Header("Allow", strings.Join(allowed, ", "))
		fail(c, 405, "该服务不支持当前请求方法")
		return
	}
	fail(c, 404, "无状态服务不存在或未启用")
}
