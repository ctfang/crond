package crond

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-home-admin/go-admin/app/engine"
)

type ComposerBuild struct {
	ProjectID   string `gorm:"primaryKey"`
	Fingerprint string
	Directory   string
	InstalledAt int64
}
type composerTask struct {
	mu       sync.Mutex
	status   string
	started  time.Time
	duration int64
	output   *cappedOutput
	command  string
	cancel   context.CancelFunc
}

func manifestFingerprint(manifest, lock string) string {
	sum := sha256.Sum256([]byte(manifest + "\x00" + lock))
	return hex.EncodeToString(sum[:])
}
func composerPHARPath() (string, error) {
	phar := os.Getenv("CROND_COMPOSER_PHAR")
	if phar == "" {
		phar = os.Getenv("CROND_COMPOSER_BINARY")
	}
	if phar == "" {
		phar = "./data/tools/composer.phar"
	}
	absolute, err := filepath.Abs(phar)
	if err != nil {
		return "", err
	}
	if !engine.IsPhar(absolute) {
		return "", fmt.Errorf("找不到有效 composer.phar: %s", absolute)
	}
	return absolute, nil
}
func (s *Service) composerManifest(project string) (string, string, error) {
	files, err := s.list(project, "files", "")
	if err != nil {
		return "", "", err
	}
	manifest, lock := "", ""
	for _, file := range files {
		if filePath(file) == "composer.json" {
			manifest = str(file, "content")
		}
		if filePath(file) == "composer.lock" {
			lock = str(file, "content")
		}
	}
	var data map[string]interface{}
	if json.Unmarshal([]byte(manifest), &data) != nil || data == nil {
		return "", "", errors.New("请先保存有效的 composer.json")
	}
	if config, ok := data["config"].(map[string]interface{}); ok {
		if dir, exists := config["vendor-dir"]; exists && dir != "vendor" {
			return "", "", errors.New("vendor-dir 必须为 vendor，以便统一入口加载")
		}
	}
	return manifest, lock, nil
}
func (s *Service) composerStatus(c *gin.Context) {
	project := c.Param("projectId")
	_, binaryErr := composerPHARPath()
	manifest, lock, manifestErr := s.composerManifest(project)
	var build ComposerBuild
	installed := s.db.Where("project_id = ?", s.dependencyKey(project)).Find(&build).Error == nil && build.ProjectID != ""
	data := Object{"available": binaryErr == nil, "installed": installed, "installedAt": build.InstalledAt, "outdated": installed && (manifestErr != nil || build.Fingerprint != manifestFingerprint(manifest, lock)), "status": "idle", "output": ""}
	if binaryErr != nil {
		data["message"] = "后台未找到 composer.phar，请配置 CROND_COMPOSER_PHAR"
	}
	if manifestErr != nil {
		data["message"] = manifestErr.Error()
	}
	if raw, exists := s.composerJobs.Load(project); exists {
		task := raw.(*composerTask)
		task.mu.Lock()
		data["status"], data["duration"], data["command"] = task.status, task.duration, task.command
		task.mu.Unlock()
		data["output"] = task.output.String()
	}
	c.JSON(200, data)
}
func (s *Service) installComposer(c *gin.Context) {
	binary, err := composerPHARPath()
	if err != nil {
		fail(c, 503, "后台未找到 composer.phar，请配置 CROND_COMPOSER_PHAR")
		return
	}
	project := c.Param("projectId")
	manifest, lock, err := s.composerManifest(project)
	if err != nil {
		fail(c, 400, err.Error())
		return
	}
	mode := "install"
	if c.Request.ContentLength > 0 {
		data, ok := body(c)
		if !ok {
			return
		}
		if str(data, "operation") != "" {
			mode = str(data, "operation")
		}
	}
	if mode != "install" && mode != "update" {
		fail(c, 400, "仅支持 install 或 update")
		return
	}
	busyKey := "composer:" + s.fileOwner(project)
	if _, busy := s.running.LoadOrStore(busyKey, true); busy {
		fail(c, 409, "Composer 正在执行，请稍后重试")
		return
	}
	task := &composerTask{status: "running", started: time.Now(), output: &cappedOutput{}}
	s.composerJobs.Store(project, task)
	s.composerWG.Add(1)
	go func() {
		defer s.composerWG.Done()
		defer s.running.Delete(busyKey)
		err := s.runComposer(binary, mode, project, manifest, lock, task.output)
		task.mu.Lock()
		task.status = "success"
		if err != nil {
			task.status = "error"
			_, _ = task.output.Write([]byte("\n[ERROR] " + err.Error()))
		}
		task.duration = time.Since(task.started).Milliseconds()
		status, duration := task.status, task.duration
		task.mu.Unlock()
		if _, findErr := s.find("", "projects", project); findErr == nil {
			_, _ = s.save(project, "logs", "", Object{"jobName": "Composer " + mode, "triggerTime": task.started.UnixMilli(), "duration": duration, "status": status, "output": task.output.String()}, "")
		}
	}()
	c.JSON(http.StatusAccepted, Object{"status": "running"})
}
func (s *Service) runComposer(binary, mode, project, manifest, lock string, output *cappedOutput) error {
	return s.runComposerArguments(binary, []string{mode}, project, manifest, lock, output)
}
func (s *Service) runComposerArguments(binary string, arguments []string, project, manifest, lock string, output *cappedOutput) error {
	mode := arguments[0]
	ctx, cancel := s.projectCommandContext(project, output)
	defer cancel()
	directory, err := s.workspaceFiles(project)
	if err != nil {
		return err
	}
	keep := false
	defer func() {
		if !keep {
			_ = os.RemoveAll(directory)
		}
	}()
	if mode == "update" {
		_ = os.Remove(filepath.Join(directory, "composer.lock"))
	}
	// Existing packages are staged privately; install/require/remove can update them.
	if err := s.attachDependencySnapshot(project, directory); err != nil {
		return err
	}
	args := append(append([]string{}, arguments...), "--no-interaction", "--no-scripts", "--no-plugins", "--no-ansi")
	if mode == "install" || mode == "update" || mode == "require" {
		args = append(args, "--prefer-dist")
	}
	if mode == "install" || mode == "update" || mode == "require" || mode == "remove" {
		args = append(args, "--no-progress")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	wrappers, err := s.commandWrappers(directory, binary)
	if err != nil {
		return err
	}
	args = append([]string{engine.CLIWorkerFlag, binary}, args...)
	command := exec.CommandContext(ctx, executable, args...)
	command.Dir = directory
	command.Env = []string{"PATH=" + wrappers + string(os.PathListSeparator) + os.Getenv("PATH"), "CROND_PHP_BINARY=" + filepath.Join(wrappers, "php"), "COMPOSER_HOME=" + filepath.Join(directory, ".composer"), "COMPOSER_MIRROR_PATH_REPOS=1"}
	command.Stdout, command.Stderr = output, output
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Cancel = func() error {
		if command.Process == nil {
			return os.ErrProcessDone
		}
		return syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	}
	command.WaitDelay = 2 * time.Second
	if err = command.Run(); err != nil {
		return err
	}
	if mode == "show" || mode == "validate" || mode == "--version" || mode == "-V" {
		return nil
	}
	if _, err = os.Stat(filepath.Join(directory, "vendor", "autoload.php")); err != nil {
		return errors.New("Composer 未生成 vendor/autoload.php")
	}
	newLock, _ := os.ReadFile(filepath.Join(directory, "composer.lock"))
	newManifest, err := os.ReadFile(filepath.Join(directory, "composer.json"))
	if err != nil {
		return err
	}
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	currentManifest, currentLock, err := s.composerManifest(project)
	if err != nil || currentManifest != manifest || currentLock != lock {
		return errors.New("安装期间依赖声明已变更，请重新安装")
	}
	if _, err := s.find("", "projects", project); err != nil {
		return errors.New("项目已删除")
	}
	s.dependencyMu.Lock()
	defer s.dependencyMu.Unlock()
	var previous ComposerBuild
	s.db.Where("project_id = ?", s.dependencyKey(project)).Find(&previous)
	files, err := s.readProjectFiles(project)
	if err != nil {
		return err
	}
	changes := map[string]Object{}
	lockID := ""
	for _, file := range files {
		if filePath(file) == "composer.json" && string(newManifest) != manifest {
			changes[str(file, "id")] = merge(file, Object{"content": string(newManifest), "updatedAt": millis()})
		}
		if filePath(file) == "composer.lock" {
			lockID = str(file, "id")
		}
	}
	if len(newLock) > 0 {
		if lockID == "" {
			lockID = newID()
		}
		changes[lockID] = Object{"name": "composer.lock", "path": "composer.lock", "type": "file", "parentId": "root", "content": string(newLock), "createdAt": millis(), "updatedAt": millis()}
	}
	err = s.changeProjectFiles(project, changes, nil)
	if err == nil {
		err = s.db.Save(&ComposerBuild{ProjectID: s.dependencyKey(project), Fingerprint: manifestFingerprint(string(newManifest), string(newLock)), Directory: directory, InstalledAt: millis()}).Error
	}
	if err != nil {
		return err
	}
	keep = true
	if previous.Directory != "" && previous.Directory != directory {
		_ = os.RemoveAll(previous.Directory)
	}
	return nil
}
func (s *Service) attachDependencySnapshot(project, directory string) error {
	s.dependencyMu.RLock()
	defer s.dependencyMu.RUnlock()
	var build ComposerBuild
	if err := s.db.Where("project_id = ?", s.dependencyKey(project)).Find(&build).Error; err != nil {
		return err
	}
	if build.ProjectID == "" {
		return nil
	}
	source := filepath.Join(build.Directory, "vendor")
	return copyDependencyTree(source, filepath.Join(directory, "vendor"), source)
}
func (s *Service) attachDependencies(project, directory string) error {
	s.dependencyMu.RLock()
	defer s.dependencyMu.RUnlock()
	var build ComposerBuild
	lookup := s.db.Where("project_id = ?", s.dependencyKey(project)).Find(&build)
	if lookup.Error != nil {
		return lookup.Error
	}
	if lookup.RowsAffected == 0 {
		return nil
	}
	manifest, lock, err := s.composerManifest(project)
	if err != nil {
		return err
	}
	if build.Fingerprint != manifestFingerprint(manifest, lock) {
		// The default App autoloader needs no vendor snapshot. Old per-user builds
		// must not block the dependency-free shared framework after migration.
		var config struct {
			Require    map[string]interface{} `json:"require"`
			RequireDev map[string]interface{} `json:"require-dev"`
			Autoload   map[string]interface{} `json:"autoload"`
		}
		if json.Unmarshal([]byte(manifest), &config) == nil && len(config.Require) == 0 && len(config.RequireDev) == 0 && len(config.Autoload) == 1 {
			if psr4, ok := config.Autoload["psr-4"].(map[string]interface{}); ok && len(psr4) == 1 && psr4["App\\"] == "src/" {
				return nil
			}
		}
		return errors.New("Composer 依赖声明已变更，请先安装或更新依赖")
	}
	source := filepath.Join(build.Directory, "vendor")
	return copyDependencyTree(source, filepath.Join(directory, "vendor"), source)
}
func copyDependencyTree(source, target, root string) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		resolved, err := filepath.EvalSymlinks(source)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, resolved)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("依赖链接超出 vendor: %s", source)
		}
		return copyDependencyTree(resolved, target, root)
	}
	if info.IsDir() {
		if err := os.MkdirAll(target, 0700); err != nil {
			return err
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := copyDependencyTree(filepath.Join(source, entry.Name()), filepath.Join(target, entry.Name()), root); err != nil {
				return err
			}
		}
		return nil
	}
	if !info.Mode().IsRegular() {
		return errors.New("依赖中包含不支持的文件类型")
	}
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return err
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}
	_, err = io.Copy(output, input)
	closeErr := output.Close()
	if err != nil {
		return err
	}
	return closeErr
}

// Preserve a compatible installed snapshot from the old per-project layout.
func (s *Service) migrateSharedDependencies() error {
	var builds []ComposerBuild
	if err := s.db.Order("installed_at desc").Find(&builds).Error; err != nil {
		return err
	}
	for _, build := range builds {
		if strings.HasPrefix(build.ProjectID, "owner:") || s.fileOwner(build.ProjectID) == "" {
			continue
		}
		key := s.dependencyKey(build.ProjectID)
		var shared ComposerBuild
		if err := s.db.Where("project_id = ?", key).Find(&shared).Error; err != nil {
			return err
		}
		if shared.ProjectID != "" {
			continue
		}
		manifest, lock, err := s.composerManifest(build.ProjectID)
		if err != nil || build.Fingerprint != manifestFingerprint(manifest, lock) {
			continue
		}
		build.ProjectID = key
		if err := s.db.Save(&build).Error; err != nil {
			return err
		}
	}
	return nil
}
