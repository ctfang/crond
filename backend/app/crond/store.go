package crond

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// Documents retain the frontend's resource fields while isolating every project.
type Document struct {
	ID        string `gorm:"primaryKey"`
	ProjectID string `gorm:"index"`
	Kind      string `gorm:"index"`
	ParentID  string `gorm:"index"`
	Payload   string
	CreatedAt int64
}
type Session struct {
	Token           string `gorm:"primaryKey"`
	UserID          string
	ScopedProjectID string
	ExpiresAt       time.Time
}
type Account struct {
	ID    string `gorm:"primaryKey"`
	Email string `gorm:"uniqueIndex"`
	Name  string
}
type OAuthState struct {
	State     string `gorm:"primaryKey"`
	ExpiresAt time.Time
}
type Object = map[string]interface{}

func newID() string {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func millis() int64                   { return time.Now().UnixMilli() }
func str(o Object, key string) string { v, _ := o[key].(string); return v }
func decode(d Document) Object        { var o Object; _ = json.Unmarshal([]byte(d.Payload), &o); return o }

func openDB(name string) (*gorm.DB, error) {
	if name != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
			return nil, err
		}
	}
	db, err := gorm.Open(sqlite.Open(name), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1)
	if err = db.Exec("PRAGMA busy_timeout = 5000").Error; err != nil {
		return nil, err
	}
	if err = db.AutoMigrate(&Document{}, &Session{}, &Account{}, &OAuthState{}, &ComposerBuild{}); err != nil {
		return nil, err
	}
	if name != ":memory:" {
		_ = os.Chmod(name, 0600)
	}
	return db, nil
}

func (s *Service) list(project, kind, parent string) ([]Object, error) {
	if kind == "files" {
		return s.readProjectFiles(project)
	}
	var docs []Document
	q := s.db.Where("project_id = ? AND kind = ?", project, kind)
	if parent != "" {
		q = q.Where("parent_id = ?", parent)
	}
	if err := q.Order("created_at desc").Find(&docs).Error; err != nil {
		return nil, err
	}
	result := make([]Object, 0, len(docs))
	for _, d := range docs {
		result = append(result, decode(d))
	}
	return result, nil
}
func (s *Service) find(project, kind, id string) (Document, error) {
	if kind == "files" {
		return s.findProjectFile(project, id)
	}
	var d Document
	err := s.db.Where("id = ? AND project_id = ? AND kind = ?", id, project, kind).First(&d).Error
	return d, err
}
func persist(db *gorm.DB, project, kind, parent string, data Object, id string) (Object, error) {
	if id == "" {
		id = newID()
	}
	data["id"] = id
	if project != "" {
		data["projectId"] = project
	}
	b, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	d := Document{ID: id, ProjectID: project, Kind: kind, ParentID: parent, Payload: string(b), CreatedAt: millis()}
	err = db.Save(&d).Error
	return data, err
}
func (s *Service) save(project, kind, parent string, data Object, id string) (Object, error) {
	if kind == "files" {
		return s.saveProjectFile(project, data, id)
	}
	return persist(s.db, project, kind, parent, data, id)
}
func merge(old, updates Object) Object {
	merged := Object{}
	for key, value := range old {
		merged[key] = value
	}
	for key, value := range updates {
		merged[key] = value
	}
	return merged
}
func (s *Service) role(project, uid string) string {
	d, err := s.find("", "projects", project)
	if err != nil {
		return ""
	}
	if str(decode(d), "ownerId") == uid {
		return "owner"
	}
	members, _ := s.list(project, "members", "")
	for _, m := range members {
		if str(m, "userId") == uid {
			return str(m, "role")
		}
	}
	return ""
}
func (s *Service) seedTest() (Account, error) {
	account := Account{ID: "test-user", Email: "test@crond.local", Name: "测试账号"}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var existing Account
		err := tx.First(&existing, "id = ?", account.ID).Error
		if err == nil {
			account = existing
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err = tx.Create(&account).Error; err != nil {
			return err
		}
		projectID := newID()
		if _, err = persist(tx, "", "projects", "", Object{"name": "测试项目", "slug": "test-" + projectID, "type": "crond", "ownerId": account.ID, "createdAt": millis()}, projectID); err != nil {
			return err
		}
		var projectDoc Document
		if err = tx.Where("id = ?", projectID).First(&projectDoc).Error; err != nil {
			return err
		}
		if _, err = s.installStarter(tx, decode(projectDoc)); err != nil {
			return err
		}
		_, err = persist(tx, projectID, "jobs", "", Object{"name": "示例 Shell 任务", "type": "shell", "status": "inactive", "cronExp": "*/5 * * * *", "content": "#!/bin/bash\necho \"Hello Crond!\"", "createdAt": millis()}, "")
		return err
	})
	return account, err
}
