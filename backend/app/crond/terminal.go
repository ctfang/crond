package crond

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Composer arguments are executed directly; general commands use the project shell.
func commandWords(command string) ([]string, error) {
	words := []string{}
	var word strings.Builder
	quote := rune(0)
	escape := false
	for _, char := range command {
		if escape {
			word.WriteRune(char)
			escape = false
			continue
		}
		if char == '\\' && quote != '\'' {
			escape = true
			continue
		}
		if quote != 0 {
			if char == quote {
				quote = 0
			} else {
				word.WriteRune(char)
			}
			continue
		}
		if char == '\'' || char == '"' {
			quote = char
			continue
		}
		if char == ' ' || char == '\t' || char == '\n' {
			if word.Len() > 0 {
				words = append(words, word.String())
				word.Reset()
			}
			continue
		}
		word.WriteRune(char)
	}
	if quote != 0 || escape {
		return nil, errors.New("命令引号未闭合")
	}
	if word.Len() > 0 {
		words = append(words, word.String())
	}
	return words, nil
}
func composerArguments(command string) ([]string, error) {
	words, err := commandWords(command)
	if err != nil {
		return nil, err
	}
	if len(words) == 0 || words[0] != "composer" {
		return nil, nil
	}
	if len(words) < 2 {
		return nil, errors.New("用法：composer require vendor/package、install、update、remove、show、validate 或 dump-autoload")
	}
	if words[1] == "--version" || words[1] == "-V" {
		return words[1:], nil
	}
	allowed := map[string]bool{"require": true, "remove": true, "install": true, "update": true, "show": true, "validate": true, "dump-autoload": true}
	if !allowed[words[1]] {
		return nil, errors.New("此处支持 Composer require/remove/install/update/show/validate/dump-autoload")
	}
	flags := map[string]bool{"-v": true, "-vv": true, "-vvv": true, "--verbose": true, "--dev": true, "--no-dev": true, "--with-dependencies": true, "--with-all-dependencies": true, "-w": true, "-W": true, "-o": true, "--optimize-autoloader": true, "--prefer-stable": true, "--prefer-lowest": true, "--sort-packages": true, "--strict": true, "--locked": true, "--all": true, "--no-audit": true}
	for _, arg := range words[2:] {
		if strings.HasPrefix(arg, "-") && !flags[arg] {
			return nil, fmt.Errorf("不支持选项 %s；工作目录与自动加载由项目管理", arg)
		}
		if arg == "&&" || arg == "||" || arg == ";" || arg == "|" || arg == ">" || arg == ">>" {
			return nil, errors.New("请单独执行 Composer 命令，完成后再执行下一条命令")
		}
	}
	if (words[1] == "require" || words[1] == "remove") && len(words) < 3 {
		return nil, errors.New("请提供包名，例如 composer require psr/log:^3.0")
	}
	return words[1:], nil
}
func (s *Service) terminalCommand(c *gin.Context) {
	data, ok := body(c)
	if !ok {
		return
	}
	command := strings.TrimSpace(str(data, "command"))
	if command == "" || len(command) > 8192 {
		fail(c, 400, "请输入命令（最多 8192 字符）")
		return
	}
	args, err := composerArguments(command)
	if err != nil {
		fail(c, 400, err.Error())
		return
	}
	binary, manifest, lock := "", "", ""
	if args != nil {
		binary, err = composerPHARPath()
		if err != nil {
			fail(c, 503, "后台未找到 composer.phar")
			return
		}
		manifest, lock, err = s.composerManifest(c.Param("projectId"))
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
	}
	project := c.Param("projectId")
	busyKey := "composer:" + s.fileOwner(project)
	if _, busy := s.running.LoadOrStore(busyKey, true); busy {
		fail(c, 409, "项目命令正在执行，请稍后重试")
		return
	}
	task := &composerTask{status: "running", started: time.Now(), output: &cappedOutput{}, command: command}
	s.composerJobs.Store(project, task)
	s.composerWG.Add(1)
	go func() {
		defer s.composerWG.Done()
		defer s.running.Delete(busyKey)
		_, _ = task.output.Write([]byte("$ " + command + "\n"))
		var err error
		if args != nil {
			err = s.runComposerArguments(binary, args, project, manifest, lock, task.output)
		} else {
			err = s.runProjectCommand(project, command, task.output)
		}
		status := "success"
		if err != nil {
			status = "error"
			_, _ = task.output.Write([]byte("\n[ERROR] " + err.Error()))
		}
		duration := time.Since(task.started).Milliseconds()
		if _, findErr := s.find("", "projects", project); findErr == nil {
			_, _ = s.save(project, "logs", "", Object{"jobName": "终端: " + command, "triggerTime": task.started.UnixMilli(), "duration": duration, "status": status, "output": task.output.String()}, "")
		}
		task.mu.Lock()
		task.status, task.duration = status, duration
		task.mu.Unlock()
	}()
	c.JSON(202, Object{"status": "running", "command": command})
}
func (s *Service) runProjectCommand(project, command string, output *cappedOutput) error {
	ctx, cancel := s.projectCommandContext(project, output)
	defer cancel()
	baseline, err := s.list(project, "files", "")
	if err != nil {
		return err
	}
	directory, err := s.workspaceFiles(project)
	if err != nil {
		return err
	}
	defer os.RemoveAll(directory)
	if err = s.attachDependencySnapshot(project, directory); err != nil {
		return err
	}
	doc, err := s.find("", "projects", project)
	if err != nil {
		return err
	}
	session := Session{Token: newID(), UserID: str(decode(doc), "ownerId"), ScopedProjectID: project, ExpiresAt: time.Now().Add(3 * time.Minute)}
	if err = s.db.Create(&session).Error; err != nil {
		return err
	}
	defer s.db.Where("token = ?", session.Token).Delete(&Session{})
	output.redact(session.Token)
	execCommand := exec.CommandContext(ctx, "bash", "-c", command)
	execCommand.Dir = directory
	_, environment, err := s.scriptRuntime(project, directory)
	if err != nil {
		return err
	}
	execCommand.Env = append(environment, "HOME="+directory, "CROND_API_URL="+s.apiURL+"/projects/"+project, "CROND_API_TOKEN="+session.Token)
	execCommand.Stdout, execCommand.Stderr = output, output
	execCommand.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	execCommand.Cancel = func() error {
		if execCommand.Process == nil {
			return os.ErrProcessDone
		}
		return syscall.Kill(-execCommand.Process.Pid, syscall.SIGKILL)
	}
	execCommand.WaitDelay = 2 * time.Second
	executionErr := execCommand.Run()
	// Revoke before making changed project files visible to other members.
	s.db.Where("token = ?", session.Token).Delete(&Session{})
	if err = s.syncTerminalFiles(project, directory, baseline); err != nil {
		return err
	}
	return executionErr
}
func terminalExcluded(name string) bool {
	root := strings.Split(name, "/")[0]
	return root == "vendor" || root == "node_modules" || root == ".git" || root == ".composer" || strings.HasPrefix(root, ".crond-")
}
func sameProjectFile(a, b Object) bool {
	return str(a, "type") == str(b, "type") && str(a, "content") == str(b, "content") && str(a, "path") == str(b, "path")
}
func terminalSourceFiles(directory string) ([]Object, error) {
	after := map[string]Object{}
	err := filepath.WalkDir(directory, func(full string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(directory, full)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		name := filepath.ToSlash(rel)
		if terminalExcluded(name) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("项目源文件不支持符号链接：%s", name)
		}
		file := Object{"path": name, "name": path.Base(name), "type": "folder"}
		if !entry.IsDir() {
			info, err := entry.Info()
			if err != nil {
				return err
			}
			if info.Size() > 2<<20 {
				return fmt.Errorf("源文件超过 2 MiB：%s", name)
			}
			content, err := os.ReadFile(full)
			if err != nil {
				return err
			}
			if !utf8.Valid(content) {
				return fmt.Errorf("文件编辑器只同步 UTF-8 源文件：%s", name)
			}
			file["type"], file["content"] = "file", string(content)
		}
		after[name] = file
		return nil
	})
	if err != nil {
		return nil, err
	}
	files := []Object{}
	for _, file := range after {
		files = append(files, file)
	}
	return files, nil
}
func (s *Service) syncTerminalFiles(project, directory string, baseline []Object) error {
	before, after := map[string]Object{}, map[string]Object{}
	for _, file := range baseline {
		if !terminalExcluded(filePath(file)) {
			before[filePath(file)] = file
		}
	}
	snapshot, err := terminalSourceFiles(directory)
	if err != nil {
		return err
	}
	for _, file := range snapshot {
		after[filePath(file)] = file
	}
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		var projectDoc Document
		if err := tx.Where("kind = ? AND id = ?", "projects", project).First(&projectDoc).Error; err != nil {
			return err
		}
		files, err := s.readProjectFiles(project)
		if err != nil {
			return err
		}
		current := map[string]Object{}
		for _, file := range files {
			current[filePath(file)] = file
		}
		updates := map[string]Object{}
		deleted := map[string]bool{}
		changed := []string{}
		for name, file := range after {
			if !sameProjectFile(file, before[name]) {
				changed = append(changed, name)
			}
		}
		for name := range before {
			if after[name] == nil {
				changed = append(changed, name)
			}
		}
		sort.Strings(changed)
		for _, name := range changed {
			if s.frameworkPathProtected(name) {
				return fmt.Errorf("默认框架仅供查看: %s", name)
			}
			if !sameProjectFile(current[name], before[name]) {
				return fmt.Errorf("终端执行期间 %s 已被编辑，请重新执行", name)
			}
		}
		for _, name := range changed {
			file := after[name]
			old := current[name]
			if file == nil {
				deleted[str(old, "id")] = true
				delete(current, name)
				continue
			}
			parent := "root"
			if dir := path.Dir(name); dir != "." {
				parent = str(current[dir], "id")
			}
			file["parentId"], file["updatedAt"] = parent, millis()
			file["createdAt"] = old["createdAt"]
			if file["createdAt"] == nil {
				file["createdAt"] = millis()
			}
			id := str(old, "id")
			if id == "" {
				id = newID()
			}
			file["id"], file["projectId"] = id, project
			updates[id] = file
			current[name] = file
		}
		if err := s.clearDeletedEntries(tx, project, deleted); err != nil {
			return err
		}
		return s.changeProjectFiles(project, updates, deleted)
	})
}

func (s *Service) projectCommandContext(project string, output *cappedOutput) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(s.composerContext, 2*time.Minute)
	raw, exists := s.composerJobs.Load(project)
	if !exists {
		return ctx, cancel
	}
	task := raw.(*composerTask)
	task.mu.Lock()
	if task.output == output {
		task.cancel = cancel
	}
	task.mu.Unlock()
	return ctx, func() {
		cancel()
		task.mu.Lock()
		if task.output == output {
			task.cancel = nil
		}
		task.mu.Unlock()
	}
}
func (s *Service) cancelProjectCommand(project string) {
	if raw, exists := s.composerJobs.Load(project); exists {
		task := raw.(*composerTask)
		task.mu.Lock()
		cancel := task.cancel
		task.mu.Unlock()
		if cancel != nil {
			cancel()
		}
	}
}
