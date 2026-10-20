package crond

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"gorm.io/gorm"
)

const fileIndexName = ".crond-files.json"

func (s *Service) fileOwner(project string) string {
	owner, _ := s.fileOwners.Load(project)
	value, _ := owner.(string)
	return value
}
func (s *Service) dependencyKey(project string) string { return "owner:" + s.fileOwner(project) }
func (s *Service) projectFilesPath(project string) (string, error) {
	owner := s.fileOwner(project)
	if owner == "" || owner == "." || owner == ".." || strings.ContainsAny(owner, "/\\") {
		return "", fmt.Errorf("invalid framework owner")
	}
	return filepath.Join(s.filesRoot, owner, "files"), nil
}

// Recover an interrupted directory replacement before reading the source tree.
func recoverFileTree(directory string) error {
	if _, err := os.Lstat(directory); os.IsNotExist(err) {
		if _, backupErr := os.Lstat(directory + ".previous"); backupErr == nil {
			return os.Rename(directory+".previous", directory)
		}
	} else if err != nil {
		return err
	}
	return nil
}

func (s *Service) readProjectFiles(project string) ([]Object, error) {
	s.fileMu.Lock()
	defer s.fileMu.Unlock()
	files, err := s.readProjectFilesLocked(project)
	if err != nil {
		return nil, err
	}
	defaults, err := s.defaultFrameworkFiles()
	if err != nil {
		return nil, err
	}
	byPath := map[string]Object{}
	for _, file := range files {
		hidden := false
		name := strings.ToLower(filePath(file))
		for _, reserved := range defaults {
			target := strings.ToLower(filePath(reserved))
			if name == target || str(reserved, "type") == "file" && strings.HasPrefix(name, target+"/") {
				hidden = true
				break
			}
		}
		if !hidden {
			byPath[filePath(file)] = file
		}
	}
	for _, file := range defaults {
		byPath[filePath(file)] = file
	}
	files = []Object{}
	for _, file := range byPath {
		files = append(files, file)
	}
	byPath = map[string]Object{}
	for _, file := range files {
		byPath[filePath(file)] = file
	}
	for _, file := range files {
		file["parentId"] = "root"
		if dir := path.Dir(filePath(file)); dir != "." {
			file["parentId"] = str(byPath[dir], "id")
		}
	}
	sort.Slice(files, func(i, j int) bool { return filePath(files[i]) < filePath(files[j]) })
	return files, nil
}
func (s *Service) readProjectFilesLocked(project string) ([]Object, error) {
	directory, err := s.projectFilesPath(project)
	if err != nil {
		return nil, err
	}
	if err = recoverFileTree(directory); err != nil {
		return nil, err
	}
	index := map[string]Object{}
	if info, statErr := os.Lstat(filepath.Join(directory, fileIndexName)); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("file index cannot be a symlink")
	}
	data, err := os.ReadFile(filepath.Join(directory, fileIndexName))
	if err == nil {
		var entries []Object
		if err = json.Unmarshal(data, &entries); err != nil {
			return nil, fmt.Errorf("invalid file index: %w", err)
		}
		for _, entry := range entries {
			index[filePath(entry)] = entry
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	result := []Object{}
	err = filepath.WalkDir(directory, func(full string, entry fs.DirEntry, walkErr error) error {
		if os.IsNotExist(walkErr) && full == directory {
			return nil
		}
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("source tree contains symlink: %s", full)
		}
		if full == directory {
			return nil
		}
		rel, err := filepath.Rel(directory, full)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(rel)
		if name == fileIndexName {
			return nil
		}
		file := merge(index[name], Object{"path": name, "name": path.Base(name), "projectId": project, "type": "folder"})
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if str(file, "id") == "" {
			file["id"] = fmt.Sprintf("fs-%x", sha256.Sum256([]byte(project+"/"+name)))
		}
		if file["createdAt"] == nil {
			file["createdAt"] = info.ModTime().UnixMilli()
		}
		file["updatedAt"] = info.ModTime().UnixMilli()
		if !entry.IsDir() {
			if info.Size() > 2<<20 {
				return fmt.Errorf("source file exceeds 2 MiB: %s", name)
			}
			content, err := os.ReadFile(full)
			if err != nil {
				return err
			}
			if !utf8.Valid(content) {
				return fmt.Errorf("source file is not UTF-8: %s", name)
			}
			file["type"], file["content"] = "file", string(content)
		}
		result = append(result, file)
		return nil
	})
	if err != nil {
		return nil, err
	}
	byPath := map[string]Object{}
	for _, file := range result {
		byPath[filePath(file)] = file
	}
	for _, file := range result {
		file["parentId"] = "root"
		if dir := path.Dir(filePath(file)); dir != "." {
			file["parentId"] = str(byPath[dir], "id")
		}
	}
	sort.Slice(result, func(i, j int) bool { return filePath(result[i]) < filePath(result[j]) })
	return result, nil
}

// A complete staged tree keeps directory renames and terminal batches consistent.
// Content lives in ordinary source files; the JSON index only retains stable IDs.
func (s *Service) writeProjectFilesLocked(project string, files []Object) error {
	directory, err := s.projectFilesPath(project)
	if err != nil {
		return err
	}
	if err = recoverFileTree(directory); err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(directory), 0700); err != nil {
		return err
	}
	staged, err := os.MkdirTemp(filepath.Dir(directory), ".files-stage-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staged)
	index := []Object{}
	seen := map[string]bool{}
	for _, file := range files {
		if err = validateFile(file); err != nil {
			return err
		}
		name := filePath(file)
		if name == fileIndexName {
			return fmt.Errorf("reserved file path")
		}
		if seen[strings.ToLower(name)] {
			return fmt.Errorf("duplicate file path: %s", name)
		}
		seen[strings.ToLower(name)] = true
		target := filepath.Join(staged, filepath.FromSlash(name))
		if str(file, "type") == "folder" {
			err = os.MkdirAll(target, 0700)
		} else {
			if !utf8.ValidString(str(file, "content")) || len(str(file, "content")) > 2<<20 {
				return fmt.Errorf("invalid source file: %s", name)
			}
			err = os.MkdirAll(filepath.Dir(target), 0700)
			if err == nil {
				err = os.WriteFile(target, []byte(str(file, "content")), 0600)
			}
		}
		if err != nil {
			return err
		}
		metadata := merge(file, Object{})
		delete(metadata, "content")
		delete(metadata, "projectId")
		index = append(index, metadata)
	}
	data, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(staged, fileIndexName), data, 0600); err != nil {
		return err
	}
	backup := directory + ".previous"
	if err = os.RemoveAll(backup); err != nil {
		return err
	}
	hadTree := false
	if _, err = os.Lstat(directory); err == nil {
		if err = os.Rename(directory, backup); err != nil {
			return err
		}
		hadTree = true
	} else if !os.IsNotExist(err) {
		return err
	}
	if err = os.Rename(staged, directory); err != nil {
		if hadTree {
			_ = os.Rename(backup, directory)
		}
		return err
	}
	_ = os.RemoveAll(backup)
	return nil
}
func (s *Service) changeProjectFiles(project string, changes map[string]Object, deleted map[string]bool) error {
	if len(changes) == 0 && len(deleted) == 0 {
		return nil
	}
	s.fileMu.Lock()
	defer s.fileMu.Unlock()
	files, err := s.readProjectFilesLocked(project)
	if err != nil {
		return err
	}
	entries := map[string]Object{}
	for _, file := range files {
		entries[str(file, "id")] = file
	}
	for id := range deleted {
		delete(entries, id)
	}
	for id, file := range changes {
		file["id"], file["projectId"] = id, project
		entries[id] = file
	}
	files = []Object{}
	for _, file := range entries {
		files = append(files, file)
	}
	sort.Slice(files, func(i, j int) bool { return filePath(files[i]) < filePath(files[j]) })
	return s.writeProjectFilesLocked(project, files)
}
func (s *Service) saveProjectFile(project string, data Object, id string) (Object, error) {
	if id == "" {
		id = newID()
	}
	err := s.changeProjectFiles(project, map[string]Object{id: data}, nil)
	return data, err
}

// Migration is idempotent: conflicting disk content aborts without deleting DB rows.
func (s *Service) migrateProjectFiles() error {
	var docs []Document
	if err := s.db.Where("kind = ?", "files").Find(&docs).Error; err != nil {
		return err
	}
	projects := map[string][]Object{}
	for _, doc := range docs {
		projects[doc.ProjectID] = append(projects[doc.ProjectID], decode(doc))
	}
	ordered := []string{}
	for project := range projects {
		ordered = append(ordered, project)
	}
	sort.Strings(ordered)
	for _, project := range ordered {
		legacy := projects[project]
		disk, err := s.readProjectFiles(project)
		if err != nil {
			return err
		}
		byPath := map[string]Object{}
		for _, file := range disk {
			byPath[filePath(file)] = file
		}
		changes := map[string]Object{}
		deleted := map[string]bool{}
		remapped := map[string]string{}
		for _, file := range legacy {
			if existing := byPath[filePath(file)]; existing != nil {
				if !sameProjectFile(existing, file) {
					return fmt.Errorf("migration conflict: %s/%s", project, filePath(file))
				}
				oldID := str(file, "id")
				file["id"] = str(existing, "id")
				remapped[oldID] = str(existing, "id")
			}
			changes[str(file, "id")] = file
		}
		directory, _ := s.projectFilesPath(project)
		if err := os.MkdirAll(filepath.Dir(directory), 0700); err != nil {
			return err
		}
		backup, err := json.MarshalIndent(legacy, "", "  ")
		if err != nil {
			return err
		}
		backupPath := filepath.Join(filepath.Dir(directory), ".legacy-files-"+project+".json")
		if _, err := os.Stat(backupPath); os.IsNotExist(err) {
			if err := os.WriteFile(backupPath, backup, 0600); err != nil {
				return err
			}
		}
		if err := s.changeProjectFiles(project, changes, deleted); err != nil {
			return err
		}
		if err := s.db.Transaction(func(tx *gorm.DB) error {
			var doc Document
			if err := tx.Where("id = ? AND kind = ?", project, "projects").First(&doc).Error; err != nil {
				return err
			}
			data := decode(doc)
			if entry := remapped[str(data, "entryFileId")]; entry != "" {
				data["entryFileId"] = entry
			}
			if framework, ok := data["framework"].(map[string]interface{}); ok {
				if entry := remapped[str(framework, "entryFileId")]; entry != "" {
					framework["entryFileId"] = entry
				}
			}
			if _, err := persist(tx, "", "projects", "", data, project); err != nil {
				return err
			}
			return tx.Where("kind = ? AND project_id = ?", "files", project).Delete(&Document{}).Error
		}); err != nil {
			return err
		}
	}
	return nil
}
func fileDocument(project string, file Object) Document {
	payload, _ := json.Marshal(file)
	return Document{ID: str(file, "id"), ProjectID: project, Kind: "files", Payload: string(payload)}
}
func (s *Service) findProjectFile(project, id string) (Document, error) {
	files, err := s.readProjectFiles(project)
	if err != nil {
		return Document{}, err
	}
	for _, file := range files {
		if str(file, "id") == id {
			return fileDocument(project, file), nil
		}
	}
	return Document{}, gorm.ErrRecordNotFound
}
