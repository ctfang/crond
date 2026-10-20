package crond

import (
	"context"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/robfig/cron/v3"
	"gorm.io/gorm"
)

type Service struct {
	db               *gorm.DB
	filesRoot        string
	fileOwners       sync.Map
	frameworkFS      fs.FS
	fileMu           sync.Mutex
	temporaryFiles   bool
	scheduler        *cron.Cron
	scheduleMu       sync.Mutex
	scheduledJobs    map[string]scheduledJob
	mutationMu       sync.Mutex
	running          sync.Map
	workRoot         string
	apiURL           string
	qqClient         *http.Client
	composerJobs     sync.Map
	terminalSessions sync.Map
	dependencyMu     sync.RWMutex
	composerContext  context.Context
	composerCancel   context.CancelFunc
	composerWG       sync.WaitGroup
}

func New(dbPath string) (*Service, error) {
	db, err := openDB(dbPath)
	if err != nil {
		return nil, err
	}
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return nil, err
	}
	root := os.Getenv("CROND_WORK_DIR")
	if root == "" {
		root = "./data/workspaces"
	}
	s := &Service{db: db, scheduler: cron.New(cron.WithLocation(location)), workRoot: root, apiURL: "http://127.0.0.1:8080/api"}
	s.filesRoot = os.Getenv("CROND_FILES_DIR")
	if s.filesRoot == "" {
		s.filesRoot = filepath.Join(filepath.Dir(dbPath), "projects")
	}
	if dbPath == ":memory:" && os.Getenv("CROND_FILES_DIR") == "" {
		s.filesRoot, err = os.MkdirTemp("", "crond-files-")
		if err != nil {
			s.Close()
			return nil, err
		}
		s.temporaryFiles = true
	}
	s.composerContext, s.composerCancel = context.WithCancel(context.Background())
	if err := s.loadDefaultFramework(); err != nil {
		s.Close()
		return nil, err
	}
	var projects []Document
	if err := s.db.Where("kind = ?", "projects").Find(&projects).Error; err != nil {
		s.Close()
		return nil, err
	}
	for _, project := range projects {
		s.fileOwners.Store(project.ID, str(decode(project), "ownerId"))
	}
	if err := s.migrateProjectFiles(); err != nil {
		s.Close()
		return nil, err
	}
	if err := s.migrateSharedDependencies(); err != nil {
		s.Close()
		return nil, err
	}
	if err := s.ensureDefaultFrameworks(); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}
func (s *Service) SetAPIURL(url string) { s.apiURL = url }

func (s *Service) Start() error {
	if err := s.reschedule(); err != nil {
		return err
	}
	s.scheduler.Start()
	return nil
}
func (s *Service) Close() {
	<-s.scheduler.Stop().Done()
	if s.composerCancel != nil {
		s.composerCancel()
	}
	s.composerWG.Wait()
	if s.temporaryFiles {
		_ = os.RemoveAll(s.filesRoot)
	}
	db, _ := s.db.DB()
	if db != nil {
		_ = db.Close()
	}
}

func (s *Service) Register(router gin.IRouter) {
	router.Use(func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && origin != "http://"+c.Request.Host && origin != "https://"+c.Request.Host {
			fail(c, 403, "请求来源不受信任")
			return
		}
		c.Next()
	})
	router.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, Object{"status": "ok", "service": "crond", "timezone": "Asia/Shanghai"})
	})
	router.POST("/api/auth/test", s.testLogin)
	router.POST("/api/auth/google", s.googleLogin)
	router.POST("/api/auth/qq", s.qqLogin)
	router.GET("/api/auth/qq/callback", s.qqCallback)
	api := router.Group("/api", s.authenticate)
	api.GET("/auth/me", s.me)
	api.POST("/auth/logout", s.logout)
	api.POST("/cron/preview", s.previewCron)
	api.GET("/framework", func(c *gin.Context) {
		files, err := s.defaultFrameworkFiles()
		result(c, files, err)
	})
	api.GET("/projects", s.projects)
	api.POST("/projects", s.createProject)
	api.PATCH("/projects/:projectId", s.projectAccess("owner"), s.updateProject)
	api.DELETE("/projects/:projectId", s.projectAccess("owner"), s.deleteProject)
	api.GET("/projects/:projectId/composer", s.projectAccess("viewer"), s.composerStatus)
	api.POST("/projects/:projectId/composer/install", s.projectAccess("owner"), s.installComposer)
	api.GET("/projects/:projectId/terminal/ws", s.projectAccess("owner"), s.openTerminal)
	api.POST("/projects/:projectId/terminal/sync/:sessionId", s.projectAccess("editor"), s.syncTerminalSession)
	api.POST("/projects/:projectId/terminal/command/:sessionId", s.projectAccess("editor"), s.sessionTerminalCommand)
	api.GET("/projects/:projectId/terminal", s.projectAccess("viewer"), s.composerStatus)
	api.POST("/projects/:projectId/terminal", s.projectAccess("owner"), s.terminalCommand)
	api.GET("/projects/:projectId/logs", s.projectAccess("viewer"), func(c *gin.Context) { s.respondList(c, "logs", "") })
	api.POST("/projects/:projectId/execute", s.projectAccess("editor"), s.executePreview)
	for _, kind := range []string{"jobs", "members", "files", "services", "collections"} {
		kind := kind
		base := "/projects/:projectId/" + kind
		permission := "editor"
		if kind == "members" || kind == "files" {
			permission = "owner"
		}
		api.GET(base, s.projectAccess("viewer"), func(c *gin.Context) { s.respondList(c, kind, "") })
		api.POST(base, s.projectAccess(permission), func(c *gin.Context) { s.upsert(c, kind, "") })
		api.PATCH(base+"/:id", s.projectAccess(permission), func(c *gin.Context) { s.upsert(c, kind, "") })
		api.DELETE(base+"/:id", s.projectAccess(permission), func(c *gin.Context) { s.remove(c, kind, "") })
	}
	api.GET("/projects/:projectId/jobs/:id/logs", s.projectAccess("viewer"), func(c *gin.Context) {
		if _, err := s.find(c.Param("projectId"), "jobs", c.Param("id")); err != nil {
			fail(c, 404, "任务不存在")
			return
		}
		s.respondList(c, "logs", c.Param("id"))
	})
	api.POST("/projects/:projectId/jobs/:id/run", s.projectAccess("editor"), s.runJob)
	records := "/projects/:projectId/collections/:id/records"
	api.GET(records, s.projectAccess("viewer"), s.collectionExists, func(c *gin.Context) { s.respondList(c, "records", c.Param("id")) })
	api.POST(records, s.projectAccess("editor"), s.collectionExists, func(c *gin.Context) { s.upsert(c, "records", c.Param("id")) })
	api.PATCH(records+"/:recordId", s.projectAccess("editor"), s.collectionExists, func(c *gin.Context) { s.upsert(c, "records", c.Param("id")) })
	api.DELETE(records+"/:recordId", s.projectAccess("editor"), s.collectionExists, func(c *gin.Context) { s.remove(c, "records", c.Param("id")) })
	api.Any("/projects/:projectId/invoke/*route", s.projectAccess("editor"), s.invokeService)
	if engine, ok := router.(*gin.Engine); ok {
		engine.NoRoute(s.authenticate, s.directService)
	}
}
func fail(c *gin.Context, code int, message string) {
	c.AbortWithStatusJSON(code, Object{"error": message})
}
func body(c *gin.Context) (Object, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var data Object
	if err := c.ShouldBindJSON(&data); err != nil || data == nil {
		fail(c, 400, "无效的 JSON 请求")
		return nil, false
	}
	return data, true
}
func result(c *gin.Context, data interface{}, err error) {
	if err != nil {
		log.Printf("API error: %v", err)
		fail(c, 500, "后台操作失败")
		return
	}
	c.JSON(200, data)
}
func userID(c *gin.Context) string { return c.GetString("userID") }
func (s *Service) authenticate(c *gin.Context) {
	token, err := c.Cookie("crond_session")
	if bearer := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "); bearer != "" && bearer != c.GetHeader("Authorization") {
		token = bearer
		err = nil
	}
	if err != nil {
		fail(c, 401, "请先登录")
		return
	}
	var session Session
	if s.db.First(&session, "token = ? AND expires_at > ?", token, time.Now()).Error != nil {
		fail(c, 401, "登录已过期，请重新登录")
		return
	}
	if session.ScopedProjectID != "" && c.Param("projectId") != session.ScopedProjectID {
		fail(c, 403, "执行凭据只能访问当前项目")
		return
	}
	// Requests with an explicit foreign origin may not use our session cookie.
	origin := c.GetHeader("Origin")
	if origin != "" && origin != "http://"+c.Request.Host && origin != "https://"+c.Request.Host {
		fail(c, 403, "请求来源不受信任")
		return
	}
	c.Set("userID", session.UserID)
	c.Set("worker", session.ScopedProjectID != "")
	c.Next()
}
func (s *Service) projectAccess(required string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role := s.role(c.Param("projectId"), userID(c))
		if c.GetBool("worker") {
			role = "editor"
		}
		allowed := role == "owner" || role == "editor" && required != "owner" || role == "viewer" && required == "viewer"
		if !allowed {
			fail(c, 403, "没有访问此项目的权限")
			return
		}
		c.Next()
	}
}
func (s *Service) collectionExists(c *gin.Context) {
	if _, err := s.find(c.Param("projectId"), "collections", c.Param("id")); err != nil {
		fail(c, 404, "集合不存在")
		return
	}
	c.Next()
}
func (s *Service) respondList(c *gin.Context, kind, parent string) {
	data, err := s.list(c.Param("projectId"), kind, parent)
	result(c, data, err)
}
func (s *Service) projects(c *gin.Context) {
	all, err := s.list("", "projects", "")
	if err != nil {
		result(c, nil, err)
		return
	}
	visible := []Object{}
	for _, project := range all {
		if s.role(str(project, "id"), userID(c)) != "" {
			visible = append(visible, project)
		}
	}
	c.JSON(200, visible)
}
func (s *Service) createProject(c *gin.Context) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	data, ok := body(c)
	if !ok {
		return
	}
	name := strings.TrimSpace(str(data, "name"))
	if name == "" {
		fail(c, 400, "项目名称不能为空")
		return
	}
	slug := strings.TrimSpace(str(data, "slug"))
	if !s.validateProjectSlug(c, slug, "") {
		return
	}
	var project Object
	err := s.db.Transaction(func(tx *gorm.DB) error {
		created, err := persist(tx, "", "projects", "", Object{"name": name, "slug": slug, "type": "crond", "ownerId": userID(c), "createdAt": millis()}, "")
		if err != nil {
			return err
		}
		project, err = s.installStarter(tx, created)
		return err
	})
	result(c, project, err)
}
func (s *Service) updateProject(c *gin.Context) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	data, ok := body(c)
	if !ok {
		return
	}
	doc, err := s.find("", "projects", c.Param("projectId"))
	if err != nil {
		fail(c, 404, "项目不存在")
		return
	}
	old := decode(doc)
	if _, exists := data["slug"]; exists {
		slug := strings.TrimSpace(str(data, "slug"))
		if !s.validateProjectSlug(c, slug, doc.ID) {
			return
		}
		old["slug"] = slug
	}
	if entry, exists := data["entryFileId"]; exists {
		id, valid := entry.(string)
		if !valid {
			fail(c, 400, "入口文件 ID 必须为字符串")
			return
		}
		if id != "" {
			file, err := s.find(c.Param("projectId"), "files", id)
			if err != nil || str(decode(file), "type") != "file" {
				fail(c, 400, "入口必须是当前项目的文件")
				return
			}
		}
	}
	for _, key := range []string{"name", "phpBootstrap", "entryFileId"} {
		if v, exists := data[key]; exists {
			old[key] = v
		}
	}
	if strings.TrimSpace(str(old, "name")) == "" {
		fail(c, 400, "项目名称不能为空")
		return
	}
	updated, err := s.save("", "projects", "", old, doc.ID)
	result(c, updated, err)
}
func (s *Service) deleteProject(c *gin.Context) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	id := c.Param("projectId")
	s.dependencyMu.Lock()
	defer s.dependencyMu.Unlock()
	var build ComposerBuild
	s.db.Where("project_id = ?", s.dependencyKey(id)).Find(&build)
	owner := s.fileOwner(id)
	shared := false
	projects, listErr := s.list("", "projects", "")
	if listErr != nil {
		result(c, nil, listErr)
		return
	}
	for _, project := range projects {
		if str(project, "id") != id && str(project, "ownerId") == owner {
			shared = true
		}
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if !shared {
			if err := tx.Where("project_id = ?", s.dependencyKey(id)).Delete(&ComposerBuild{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("project_id = ?", id).Delete(&Document{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND kind = ?", id, "projects").Delete(&Document{}).Error
	})
	if err == nil {
		if !shared && build.Directory != "" {
			_ = os.RemoveAll(build.Directory)
		}
		directory, pathErr := s.projectFilesPath(id)
		if !shared && pathErr == nil {
			s.fileMu.Lock()
			err = os.RemoveAll(filepath.Dir(directory))
			s.fileMu.Unlock()
		}
		s.fileOwners.Delete(id)
		s.composerJobs.Delete(id)
		if err == nil {
			err = s.reschedule()
		}
	}
	result(c, Object{"ok": true}, err)
}
func (s *Service) upsert(c *gin.Context, kind, parent string) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	data, ok := body(c)
	if !ok {
		return
	}
	id := c.Param("id")
	if kind == "records" {
		id = c.Param("recordId")
	}
	project := c.Param("projectId")
	old := Object{}
	if c.Request.Method == "PATCH" {
		doc, err := s.find(project, kind, id)
		if err != nil || parent != "" && doc.ParentID != parent {
			fail(c, 404, "资源不存在")
			return
		}
		old = decode(doc)
	} else {
		id = ""
		old["createdAt"] = millis()
	}
	delete(data, "id")
	delete(data, "projectId")
	delete(data, "ownerId")
	delete(data, "createdAt")
	data = merge(old, data)
	if kind == "jobs" {
		if err := validateJob(data); err != nil {
			fail(c, 400, err.Error())
			return
		}
	}
	if kind == "files" {
		s.upsertFile(c, data, id, old)
		return
	}
	if kind == "services" {
		method := serviceMethod(data)
		if raw, exists := data["method"]; exists {
			if _, ok := raw.(string); !ok || strings.TrimSpace(str(data, "method")) == "" {
				fail(c, 400, "请求方法不能为空")
				return
			}
		}
		switch method {
		case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS":
		default:
			fail(c, 400, "不支持的服务请求方法")
			return
		}
		data["method"] = method
		if str(data, "status") == "" {
			data["status"] = "active"
		}
		if str(data, "status") != "active" && str(data, "status") != "inactive" {
			fail(c, 400, "无效的服务状态")
			return
		}
		if strings.TrimSpace(str(data, "name")) == "" || strings.TrimSpace(str(data, "content")) == "" {
			fail(c, 400, "服务名称和代码不能为空")
			return
		}
		route, routeErr := normalizeServicePath(str(data, "route"))
		if routeErr != nil {
			fail(c, 400, routeErr.Error())
			return
		}
		data["route"] = route
		services, err := s.list(project, "services", "")
		if err != nil {
			result(c, nil, err)
			return
		}
		for _, service := range services {
			existingRoute, _ := normalizeServicePath(str(service, "route"))
			if existingRoute == route && serviceMethod(service) == method && str(service, "id") != id {
				fail(c, 409, "相同请求方法和路径的服务已存在")
				return
			}
		}
	}
	if kind == "members" || kind == "files" {
		role := str(data, "role")
		if role != "editor" && role != "viewer" {
			fail(c, 400, "成员角色必须为 editor 或 viewer")
			return
		}
		var account Account
		if s.db.First(&account, "email = ?", str(data, "userEmail")).Error != nil {
			fail(c, 404, "用户必须先登录一次")
			return
		}
		data["userId"] = account.ID
		if s.role(project, account.ID) == "owner" {
			fail(c, 400, "不能修改项目拥有者的角色")
			return
		}
		members, err := s.list(project, "members", "")
		if err != nil {
			result(c, nil, err)
			return
		}
		for _, m := range members {
			if str(m, "userId") == account.ID {
				id = str(m, "id")
			}
		}
	}
	if kind == "records" {
		record, ok := data["data"].(map[string]interface{})
		if !ok {
			fail(c, 400, "记录 data 必须是 JSON 对象")
			return
		}
		if id == "" {
			id = newID()
		}
		if _, exists := record["key"]; !exists {
			if previous, ok := old["data"].(map[string]interface{}); ok && str(previous, "key") != "" {
				record["key"] = str(previous, "key")
			} else {
				record["key"] = id
			}
		}
		key := strings.TrimSpace(str(record, "key"))
		if key == "" {
			fail(c, 400, "记录 key 必须为非空字符串")
			return
		}
		record["key"] = key
		records, err := s.list(project, "records", parent)
		if err != nil {
			result(c, nil, err)
			return
		}
		for _, existing := range records {
			payload, _ := existing["data"].(map[string]interface{})
			if str(existing, "id") != id && str(payload, "key") == key {
				fail(c, 409, "记录 key 已存在")
				return
			}
		}
		data["collectionId"] = parent
		data["updatedAt"] = millis()
	}
	if kind == "collections" {
		name := strings.ToLower(strings.TrimSpace(str(data, "name")))
		if !collectionNamePattern.MatchString(name) {
			fail(c, 400, "集合名称必须由小写字母、数字和下划线组成")
			return
		}
		data["name"] = name
		collections, err := s.list(project, kind, "")
		if err != nil {
			result(c, nil, err)
			return
		}
		for _, collection := range collections {
			if str(collection, "id") != id && str(collection, "name") == name {
				fail(c, 409, "集合名称已存在")
				return
			}
		}
	}
	saved, err := s.save(project, kind, parent, data, id)
	if err == nil && kind == "jobs" {
		err = s.reschedule()
	}
	result(c, saved, err)
}
func (s *Service) remove(c *gin.Context, kind, parent string) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	id := c.Param("id")
	if kind == "records" {
		id = c.Param("recordId")
	}
	project := c.Param("projectId")
	doc, err := s.find(project, kind, id)
	if err != nil || parent != "" && doc.ParentID != parent {
		fail(c, 404, "资源不存在")
		return
	}
	if kind == "files" && s.frameworkPathProtected(filePath(decode(doc))) {
		fail(c, 403, "默认框架仅供查看，请由服务器管理员维护")
		return
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if kind == "files" {
			return s.removeFile(tx, project, doc)
		}
		if kind == "jobs" || kind == "collections" {
			if err := tx.Where("project_id = ? AND parent_id = ?", project, id).Delete(&Document{}).Error; err != nil {
				return err
			}
		}
		return tx.Delete(&doc).Error
	})
	if err == nil && kind == "jobs" {
		err = s.reschedule()
	}
	result(c, Object{"ok": true}, err)
}

var collectionNamePattern = regexp.MustCompile(`^[a-z0-9_]+$`)

func validateJob(data Object) error {
	if strings.TrimSpace(str(data, "name")) == "" {
		return errors.New("任务名称不能为空")
	}
	switch str(data, "type") {
	case "shell", "php", "http":
	default:
		return errors.New("不支持的任务类型")
	}
	if str(data, "status") == "" {
		data["status"] = "active"
	}
	if str(data, "status") != "active" && str(data, "status") != "inactive" {
		return errors.New("无效的任务状态")
	}
	if str(data, "cronExp") == "" {
		data["cronExp"] = defaultJobCron
	}
	_, err := parseJobSchedule(str(data, "cronExp"))
	return err
}
