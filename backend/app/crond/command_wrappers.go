package crond

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"

	"github.com/go-home-admin/go-admin/app/engine"
)

// Every script entry point shares these PHP wrappers and the same framework entry.
func (s *Service) scriptRuntime(project, directory string) (string, []string, error) {
	doc, err := s.find("", "projects", project)
	if err != nil {
		return "", nil, errors.New("项目不存在")
	}
	bootstrap := filepath.Join(directory, "bootstrap.php")
	if _, err := os.Stat(bootstrap); err != nil {
		return "", nil, errors.New("默认框架入口不存在，请重启后台以补齐框架")
	}
	data := decode(doc)
	metadata, _ := data["framework"].(map[string]interface{})
	if custom := str(data, "entryFileId"); custom != "" && custom != str(metadata, "entryFileId") {
		file, err := s.find(project, "files", custom)
		if err != nil {
			return "", nil, errors.New("框架扩展入口文件不存在")
		}
		content := "<?php require_once " + strconv.Quote(bootstrap) + "; require_once " + strconv.Quote(filepath.Join(directory, filePath(decode(file)))) + ";"
		bootstrap = filepath.Join(directory, ".crond-bootstrap.php")
		if err := os.WriteFile(bootstrap, []byte(content), 0600); err != nil {
			return "", nil, err
		}
	}
	phar, _ := composerPHARPath()
	wrappers, err := s.commandWrappers(directory, phar)
	if err != nil {
		return "", nil, err
	}
	environment := []string{
		"PATH=" + wrappers + string(os.PathListSeparator) + os.Getenv("PATH"),
		"TZ=Asia/Shanghai", "CROND_PROJECT_ID=" + project,
		"CROND_BOOTSTRAP=" + bootstrap, "CROND_PHP_BINARY=" + filepath.Join(wrappers, "php"),
	}
	return bootstrap, environment, nil
}

func (s *Service) commandWrappers(directory, phar string) (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	bin := filepath.Join(directory, ".crond-bin")
	if err = os.MkdirAll(bin, 0700); err != nil {
		return "", err
	}
	scripts := map[string]string{
		"php":        "exec " + shellQuote(executable) + " " + engine.CLIWorkerFlag + " \"$@\"\n",
		"composer":   "exec " + shellQuote(executable) + " " + engine.CLIWorkerFlag + " " + shellQuote(phar) + " \"$@\"\n",
		"crond-json": "exec " + shellQuote(executable) + " " + engine.JSONWorkerFlag + " \"$@\"\n",
	}
	for name, script := range scripts {
		if err = os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/bash\n"+script), 0700); err != nil {
			return "", err
		}
	}
	return bin, nil
}
