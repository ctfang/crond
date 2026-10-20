package engine

import (
	"fmt"
	"os"

	"github.com/php-any/origami/data"
	"github.com/php-any/origami/parser"
	"github.com/php-any/origami/runtime"
	"github.com/php-any/origami/std"
	origamihttp "github.com/php-any/origami/std/net/http"
	"github.com/php-any/origami/std/php"
	"github.com/php-any/origami/std/system"
)

const WorkerFlag = "--origami-worker"

// RunWorker executes one service in a fresh Origami VM. The parent owns timeout,
// output limits, credentials and workspace cleanup; no request state is shared.
func RunWorker(args []string) (code int) {
	code = 1
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(os.Stderr, "Origami runtime error: %v\n", r)
			code = 1
		}
	}()
	if len(args) < 1 || len(args) > 2 {
		fmt.Fprintln(os.Stderr, "Origami worker requires script and optional bootstrap paths")
		return 1
	}
	p := parser.NewParser()
	vm := runtime.NewVM(p).(*runtime.VM)
	std.Load(vm)
	php.Load(vm)
	origamihttp.Load(vm)
	loadScriptHTTP(vm)
	system.Load(vm)
	if binary := os.Getenv("CROND_PHP_BINARY"); binary != "" {
		vm.SetConstant("PHP_BINARY", data.NewStringValue(binary))
	}
	if len(args) == 2 && args[1] != "" {
		if _, control := vm.LoadAndRun(args[1]); control != nil {
			return report(control)
		}
	}
	_, control := vm.LoadAndRun(args[0])
	if control != nil {
		return report(control)
	}
	vm.RunShutdownCallbacks()
	return 0
}
func report(control data.Control) int {
	if exit, ok := control.(data.ExitControl); ok {
		return exit.GetCode()
	}
	if message, ok := control.(data.AsString); ok {
		fmt.Fprintln(os.Stderr, "Origami:", message.AsString())
	} else {
		fmt.Fprintf(os.Stderr, "Origami: %v\n", control)
	}
	return 1
}
