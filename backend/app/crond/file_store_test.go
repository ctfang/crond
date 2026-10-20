package crond

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTextFileStoreMigrationAndDatabaseIndependence(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy.db")
	db, err := openDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	project := "legacy-project"
	_, err = persist(db, "", "projects", "", Object{"name": "Legacy", "ownerId": "owner", "entryFileId": "legacy-entry"}, project)
	if err != nil {
		t.Fatal(err)
	}
	_, err = persist(db, project, "files", "", Object{"path": "custom.php", "name": "custom.php", "type": "file", "parentId": "root", "content": "<?php echo 'legacy preserved';"}, "legacy-entry")
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.Close()
	s, err := New(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	directory, _ := s.projectFilesPath(project)
	source, err := os.ReadFile(filepath.Join(directory, "custom.php"))
	if err != nil || string(source) != "<?php echo 'legacy preserved';" {
		t.Fatal(string(source), err)
	}
	var count int64
	s.db.Model(&Document{}).Where("kind = ?", "files").Count(&count)
	if count != 0 {
		t.Fatal("file rows remain in database", count)
	}
	metadata, err := os.ReadFile(filepath.Join(directory, fileIndexName))
	if err != nil || strings.Contains(string(metadata), "legacy preserved") {
		t.Fatal("metadata contains source content", err)
	}
	if _, err = os.Stat(filepath.Join(filepath.Dir(directory), ".legacy-files-"+project+".json")); err != nil {
		t.Fatal("migration backup missing", err)
	}
	original, err := s.find(project, "files", "legacy-entry")
	if err != nil || str(decode(original), "content") != string(source) {
		t.Fatal(original, err)
	}
	s.Close()
	// File reads and writes continue to work with the database closed.
	if err = os.WriteFile(filepath.Join(directory, "custom.php"), []byte("<?php echo 'disk changed';"), 0600); err != nil {
		t.Fatal(err)
	}
	doc, err := s.find(project, "files", "legacy-entry")
	if err != nil || !strings.Contains(str(decode(doc), "content"), "disk changed") {
		t.Fatal(doc, err)
	}
	if _, err = s.save(project, "files", "", Object{"path": "new.txt", "type": "file", "content": "saved without db"}, "new-file"); err != nil {
		t.Fatal(err)
	}
	second, err := New(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	doc, err = second.find(project, "files", "legacy-entry")
	if err != nil || !strings.Contains(str(decode(doc), "content"), "disk changed") {
		t.Fatal("restart lost changes", doc, err)
	}
	doc, err = second.find(project, "files", "new-file")
	if err != nil || str(decode(doc), "content") != "saved without db" {
		t.Fatal(doc, err)
	}
}

func TestFileTreeRecoveryAndExternalFiles(t *testing.T) {
	s, c, base := loginProject(t)
	project := strings.TrimPrefix(base, "/api/projects/")
	directory, _ := s.projectFilesPath(project)
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "external.php"), []byte("<?php echo 'external';"), 0600); err != nil {
		t.Fatal(err)
	}
	files, err := s.list(project, "files", "")
	if err != nil {
		t.Fatal(err)
	}
	var external Object
	for _, file := range files {
		if filePath(file) == "external.php" {
			external = file
		}
	}
	if external == nil {
		t.Fatal("external file was not discovered")
	}
	c.call("PATCH", base+"/files/"+str(external, "id"), Object{"content": "<?php echo 'edited';"}, 200)
	source, _ := os.ReadFile(filepath.Join(directory, "external.php"))
	if string(source) != "<?php echo 'edited';" {
		t.Fatal(string(source))
	}
	c.call("POST", base+"/files", Object{"path": fileIndexName, "type": "file", "content": "override"}, 400)
	if err := os.Rename(directory, directory+".previous"); err != nil {
		t.Fatal(err)
	}
	doc, err := s.find(project, "files", str(external, "id"))
	if err != nil || str(decode(doc), "content") != string(source) {
		t.Fatal("incomplete directory swap was not recovered", doc, err)
	}
	// Symbolic links must never let a project source read outside its tree.
	outside := filepath.Join(t.TempDir(), "secret.txt")
	os.WriteFile(outside, []byte("outside"), 0600)
	if err := os.Symlink(outside, filepath.Join(directory, "link.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.list(project, "files", ""); err == nil {
		t.Fatal("source symlink was accepted")
	}
}

func TestUserSharedFrameworkAndProjectDeletion(t *testing.T) {
	s, c, base := loginProject(t)
	first := strings.TrimPrefix(base, "/api/projects/")
	second := c.call("POST", "/api/projects", Object{"name": "Shared framework project", "slug": "shared-framework-project"}, 200).(map[string]interface{})
	secondID := str(second, "id")
	firstPath, _ := s.projectFilesPath(first)
	secondPath, _ := s.projectFilesPath(secondID)
	if firstPath != secondPath || filepath.Base(filepath.Dir(firstPath)) != "test-user" {
		t.Fatal(firstPath, secondPath)
	}
	file := c.call("POST", base+"/files", Object{"path": "shared.php", "type": "file", "content": "<?php // Shared source"}, 200).(map[string]interface{})
	doc, err := s.find(secondID, "files", str(file, "id"))
	if err != nil || str(decode(doc), "projectId") != secondID {
		t.Fatal(doc, err)
	}
	c.call("PATCH", "/api/projects/"+secondID, Object{"entryFileId": str(file, "id")}, 200)
	c.call("DELETE", base+"/files/"+str(file, "id"), nil, 200)
	projectDoc, _ := s.find("", "projects", secondID)
	if str(decode(projectDoc), "entryFileId") != "" {
		t.Fatal("shared entry was not cleared")
	}
	c.call("DELETE", base, nil, 200)
	if _, err := s.find(secondID, "files", frameworkFileID("bootstrap.php")); err != nil {
		t.Fatal("deleting one project removed shared framework", err)
	}
	c.call("DELETE", "/api/projects/"+secondID, nil, 200)
	if _, err := os.Stat(firstPath); !os.IsNotExist(err) {
		t.Fatal("last project deletion did not clean files", err)
	}
}

func TestSharedMigrationConflictsKeepOriginalSource(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy.db")
	db, err := openDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"one", "two"} {
		persist(db, "", "projects", "", Object{"name": id, "ownerId": "same-owner", "entryFileId": id + "-file"}, id)
		persist(db, id, "files", "", Object{"path": "custom.php", "type": "file", "content": id}, id+"-file")
	}
	sqlDB, _ := db.DB()
	sqlDB.Close()
	s, err := New(dbPath)
	if err == nil {
		s.Close()
		t.Fatal("conflicting source was silently overwritten")
	}
	source, readErr := os.ReadFile(filepath.Join(filepath.Dir(dbPath), "projects", "same-owner", "files", "custom.php"))
	if readErr != nil || string(source) != "one" {
		t.Fatal(string(source), readErr)
	}
	db, err = openDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { conn, _ := db.DB(); conn.Close() }()
	var legacy Document
	if err := db.Where("id = ?", "two-file").First(&legacy).Error; err != nil || str(decode(legacy), "content") != "two" {
		t.Fatal("conflicting source lost", legacy, err)
	}
}
