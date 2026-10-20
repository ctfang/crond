package engine

import (
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"

	"github.com/php-any/origami/data"
	"github.com/php-any/origami/parser"
	"github.com/php-any/origami/runtime"
	"github.com/php-any/origami/std"
	origamihttp "github.com/php-any/origami/std/net/http"
	"github.com/php-any/origami/std/php"
	"github.com/php-any/origami/std/system"
)

const CLIWorkerFlag = "--origami-cli"

// RunCLI runs in a separate Go process so CLI globals, stdin and VM state remain isolated.
func RunCLI(args []string) (code int) {
	code = 1
	defer func() {
		if recovered := recover(); recovered != nil {
			fmt.Fprintln(os.Stderr, "Origami CLI:", recovered)
			code = 1
		}
	}()
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "用法: php [-r code | -f file | file] [arguments]")
		return 1
	}
	script, inline := "", ""
	parameters := []string{}
	switch args[0] {
	case "-v", "--version":
		fmt.Println("Origami PHP CLI (Go runtime; PHP-compatible syntax)")
		return 0
	case "-r":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "php -r 缺少代码")
			return 1
		}
		inline = args[1]
		script = "Command line code"
		parameters = args[2:]
	case "-f":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "php -f 缺少文件")
			return 1
		}
		script = args[1]
		parameters = args[2:]
	default:
		if strings.HasPrefix(args[0], "-") {
			fmt.Fprintln(os.Stderr, "Origami CLI 不支持选项:", args[0])
			return 1
		}
		script = args[0]
		parameters = args[1:]
	}
	if len(parameters) > 0 && parameters[0] == "--" {
		parameters = parameters[1:]
	}
	// Origami builds $argv/$argc/$_SERVER from os.Args on first access.
	os.Args = append([]string{os.Args[0], script}, parameters...)
	p := parser.NewParser()
	vm := runtime.NewVM(p).(*runtime.VM)
	std.Load(vm)
	php.Load(vm)
	origamihttp.Load(vm)
	loadScriptHTTP(vm)
	system.Load(vm)
	vm.RegisterFunction("sys_get_temp_dir", func() string { return os.TempDir() })
	vm.RegisterFunction("php_uname", func(mode string) string { return goruntime.GOOS })
	if binary := os.Getenv("CROND_PHP_BINARY"); binary != "" {
		vm.SetConstant("PHP_BINARY", data.NewStringValue(binary))
	}
	phar := inline == "" && IsPhar(script)
	if phar {
		extracted, err := ExtractPhar(script)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Origami PHAR:", err)
			return 1
		}
		defer os.RemoveAll(extracted)
		entry := filepath.Join(extracted, "bin", "composer")
		if _, err = os.Stat(entry); err != nil {
			fmt.Fprintln(os.Stderr, "Origami PHAR: 当前仅支持含 bin/composer 入口的 Composer PHAR")
			return 1
		}
		// Xdebug is a native-PHP debugger and cannot be active in the Go VM.
		compat := `<?php namespace Composer\XdebugHandler; class XdebugHandler { public function __construct($prefix) {} public function check() {} public static function isXdebugActive() { return false; } }`
		if _, control := vm.EvalCode(compat, vm.CreateContext(nil), nil); control != nil {
			return report(control)
		}
		_, control := vm.LoadAndRun(entry)
		if control != nil {
			if exit, ok := control.(data.ExitControl); ok {
				if exit.GetCode() != 0 {
					fmt.Fprintln(os.Stderr, "Composer (Origami) 执行失败，未回退到系统 PHP；可加 -vvv 查看详细错误。")
				}
				return exit.GetCode()
			}
			fmt.Fprintln(os.Stderr, "Composer PHAR 已由 Origami 加载，但运行遇到 PHP 兼容性错误；不会回退到系统 PHP。")
			return report(control)
		}
	} else {
		if bootstrap := os.Getenv("CROND_BOOTSTRAP"); bootstrap != "" {
			if _, control := vm.LoadAndRun(bootstrap); control != nil {
				return report(control)
			}
		}
		if inline != "" {
			file, err := os.CreateTemp("", "crond-inline-*.php")
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				return 1
			}
			name := file.Name()
			defer os.Remove(name)
			_, err = file.WriteString("<?php\n" + inline)
			file.Close()
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				return 1
			}
			if _, control := vm.LoadAndRun(name); control != nil {
				return report(control)
			}
		} else {
			if _, control := vm.LoadAndRun(script); control != nil {
				return report(control)
			}
		}
	}
	vm.RunShutdownCallbacks()
	return 0
}
