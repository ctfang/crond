package crond

import (
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"gorm.io/gorm"
)

// The default framework is loaded from ordinary files, independently of the binary.
func (s *Service) loadDefaultFramework() error {
	root := os.Getenv("CROND_FRAMEWORK_DIR")
	if root == "" {
		root = "./data/framework"
	}
	directory, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	s.frameworkFS = os.DirFS(directory)
	for _, name := range []string{"bootstrap.php", "README.md", "composer.json", "framework/bootstrap.php", "src/Database.php"} {
		info, err := fs.Stat(s.frameworkFS, name)
		if err != nil {
			return fmt.Errorf("默认框架目录 %s 缺少 %s: %w", directory, name, err)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("默认框架文件 %s 不是普通文件", name)
		}
	}
	return nil
}

func frameworkFileID(name string) string {
	return fmt.Sprintf("framework-%x", sha256.Sum256([]byte(name)))
}

// Framework IDs and contents are identical for every user and project.
func (s *Service) defaultFrameworkFiles() ([]Object, error) {
	files := []Object{}
	err := fs.WalkDir(s.frameworkFS, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if name == "." {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("默认框架不支持符号链接: %s", name)
		}
		parent := "root"
		if dir := path.Dir(name); dir != "." {
			parent = frameworkFileID(dir)
		}
		file := Object{"id": frameworkFileID(name), "projectId": "", "path": name, "name": path.Base(name), "parentId": parent, "type": "folder", "updatedAt": 0}
		if !entry.IsDir() {
			content, err := fs.ReadFile(s.frameworkFS, name)
			if err != nil {
				return err
			}
			file["type"], file["content"] = "file", string(content)
		}
		files = append(files, file)
		return nil
	})
	return files, err
}

// Protect framework paths, their ancestors, and descendants of framework files.
func (s *Service) frameworkPathProtected(name string) bool {
	files, err := s.defaultFrameworkFiles()
	if err != nil {
		return true
	}
	name = strings.ToLower(path.Clean(name))
	for _, file := range files {
		reserved := strings.ToLower(filePath(file))
		if name == reserved || strings.HasPrefix(reserved, name+"/") ||
			str(file, "type") == "file" && strings.HasPrefix(name, reserved+"/") {
			return true
		}
	}
	return false
}

// Project metadata refers to the shared framework; no per-user copy is installed.
func (s *Service) installStarter(tx *gorm.DB, project Object) (Object, error) {
	projectID := str(project, "id")
	s.fileOwners.Store(projectID, str(project, "ownerId"))
	old, _ := project["framework"].(map[string]interface{})
	entry := str(project, "entryFileId")
	if entry == "" || entry == str(old, "entryFileId") {
		project["entryFileId"] = frameworkFileID("bootstrap.php")
	}
	project["framework"] = Object{"name": "Script Framework", "version": "1.2.0", "entryFileId": frameworkFileID("bootstrap.php")}
	return persist(tx, "", "projects", "", project, projectID)
}

// Existing projects use the shared default framework when the backend starts.
func (s *Service) ensureDefaultFrameworks() error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var projects []Document
		if err := tx.Where("kind = ?", "projects").Find(&projects).Error; err != nil {
			return err
		}
		for _, doc := range projects {
			if _, err := s.installStarter(tx, decode(doc)); err != nil {
				return err
			}
		}
		return nil
	})
}
