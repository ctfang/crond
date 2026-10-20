package main

import (
	"embed"
	"github.com/go-home-admin/go-admin/app/engine"
	"github.com/go-home-admin/go-admin/app/http"
	"github.com/go-home-admin/go-admin/app/providers"
	"github.com/go-home-admin/home/bootstrap/constraint"
	fp "github.com/go-home-admin/home/bootstrap/providers"
	"os"
)

//go:embed config
var config embed.FS

func init() {
	fp.SetConfigDir(&config)
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == engine.WorkerFlag {
		os.Exit(engine.RunWorker(os.Args[2:]))
		return
	}
	if len(os.Args) > 1 && os.Args[1] == engine.CLIWorkerFlag {
		os.Exit(engine.RunCLI(os.Args[2:]))
		return
	}
	if len(os.Args) > 1 && os.Args[1] == engine.JSONWorkerFlag {
		os.Exit(engine.RunJSON(os.Args[2:]))
		return
	}
	app := providers.NewApp()

	app.Run([]constraint.KernelServer{
		// http服务
		http.GetServer(),
		//election.GetServer(func() {
		//	logrus.Info("选举出一台存活机器启动特殊服务, 例如定时服务")
		//	crontab.GetServer()
		//}),
		// Job消费服务
		// queues.GetServer(),
	})
}
