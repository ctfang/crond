package crond

import (
	"path"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func filePath(file Object) string {
	name := str(file, "path")
	if name == "" {
		name = str(file, "name")
	}
	return path.Clean(name)
}

func (s *Service) upsertFile(c *gin.Context, data Object, id string, previous Object) {
	if s.frameworkPathProtected(filePath(data)) || id != "" && s.frameworkPathProtected(filePath(previous)) {
		fail(c, 403, "默认框架仅供查看，请由服务器管理员维护")
		return
	}
	if id != "" && str(previous, "type") != str(data, "type") {
		fail(c, 400, "已有文件或目录不能修改类型")
		return
	}
	if err := validateFile(data); err != nil {
		fail(c, 400, err.Error())
		return
	}
	project := c.Param("projectId")
	files, err := s.list(project, "files", "")
	if err != nil {
		result(c, nil, err)
		return
	}
	newPath := filePath(data)
	oldPath := filePath(previous)
	if id == "" {
		id = newID()
	}
	data["path"], data["name"], data["updatedAt"] = newPath, path.Base(newPath), millis()
	parent := str(data, "parentId")
	if parent != "" && parent != "root" {
		found := false
		for _, file := range files {
			if str(file, "id") == parent && str(file, "type") == "folder" && parent != id {
				found = true
				if path.Dir(newPath) != filePath(file) {
					fail(c, 400, "文件路径与父目录不一致")
					return
				}
			}
		}
		if !found {
			fail(c, 400, "父目录不存在或不是文件夹")
			return
		}
	} else {
		data["parentId"] = "root"
	}
	changes := map[string]Object{id: data}
	if str(previous, "type") == "folder" {
		if strings.HasPrefix(newPath, oldPath+"/") {
			fail(c, 400, "不能将目录移动到自身内部")
			return
		}
		for _, file := range files {
			if strings.HasPrefix(filePath(file), oldPath+"/") {
				if str(data, "type") != "folder" {
					fail(c, 400, "非空目录不能改为文件")
					return
				}
				changed := merge(file, Object{"path": newPath + strings.TrimPrefix(filePath(file), oldPath), "updatedAt": millis()})
				changes[str(file, "id")] = changed
			}
		}
	}
	// Validate the complete resulting tree before writing any part of the rename.
	paths := map[string]string{}
	types := map[string]string{}
	combined := append(files, data)
	for _, file := range combined {
		if changed, ok := changes[str(file, "id")]; ok {
			file = changed
		}
		name := filePath(file)
		if other, exists := paths[name]; exists && other != str(file, "id") {
			fail(c, 409, "文件路径已存在")
			return
		}
		paths[name], types[name] = str(file, "id"), str(file, "type")
	}
	for name := range paths {
		for ancestor := path.Dir(name); ancestor != "."; ancestor = path.Dir(ancestor) {
			if types[ancestor] == "file" {
				fail(c, 409, "父路径已被文件占用")
				return
			}
		}
	}
	err = s.changeProjectFiles(project, changes, nil)
	result(c, data, err)
}

func (s *Service) removeFile(tx *gorm.DB, project string, doc Document) error {
	ids := map[string]bool{doc.ID: true}
	deleted := decode(doc)
	files, err := s.readProjectFiles(project)
	if err != nil {
		return err
	}
	if str(deleted, "type") == "folder" {
		for _, file := range files {
			if strings.HasPrefix(filePath(file), filePath(deleted)+"/") {
				ids[str(file, "id")] = true
			}
		}
	}
	if err = s.changeProjectFiles(project, nil, ids); err != nil {
		return err
	}
	return s.clearDeletedEntries(tx, project, ids)
}

func (s *Service) clearDeletedEntries(tx *gorm.DB, project string, ids map[string]bool) error {
	if len(ids) == 0 {
		return nil
	}
	var projects []Document
	if err := tx.Where("kind = ?", "projects").Find(&projects).Error; err != nil {
		return err
	}
	owner := s.fileOwner(project)
	for _, doc := range projects {
		data := decode(doc)
		if str(data, "ownerId") == owner && ids[str(data, "entryFileId")] {
			data["entryFileId"] = ""
			if _, err := persist(tx, "", "projects", "", data, doc.ID); err != nil {
				return err
			}
		}
	}
	return nil
}
