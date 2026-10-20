package http

import (
	"context"
	"github.com/gin-gonic/gin"
	"github.com/go-home-admin/go-admin/app/crond"
	"github.com/go-home-admin/go-admin/routes"
	"github.com/go-home-admin/home/bootstrap/constraint"
	"github.com/go-home-admin/home/bootstrap/providers"
	"github.com/go-home-admin/home/bootstrap/servers"
	"log"
	"net/http"
	"os"
	"time"
)

// Kernel @Bean
type Kernel struct {
	*servers.Http            `inject:""`
	*providers.RouteProvider `inject:""`
	service                  *crond.Service
	server                   *http.Server
}

func (k *Kernel) Init() {
	// 加载所有路由
	k.LoadRoute(routes.GetAllProvider())
	// 全局中间件
	k.Middleware = []gin.HandlerFunc{}

	// 分组中间件
	k.MiddlewareGroup = map[string][]gin.HandlerFunc{
		"admin": {
			Cors(),
		},
		"api": {},
	}

	// 如果需要, 为每个路由分组设置中间件组+前缀等
	k.Group("admin").Prefix("/admin").Middleware("admin")
	k.Group("api").Middleware("api")
}

func (k *Kernel) Boot() {
	database := os.Getenv("CROND_DB_PATH")
	if database == "" {
		database = "./data/crond.db"
	}
	service, err := crond.New(database)
	if err != nil {
		log.Fatal(err)
	}
	k.service = service
	service.SetAPIURL("http://127.0.0.1:" + k.Port + "/api")
	service.Register(k.Engine)
	if err = service.Start(); err != nil {
		log.Fatal(err)
	}
}

// Run overrides the framework's all-interface listener for local script execution.
func (k *Kernel) Run() {
	k.server = &http.Server{Addr: "127.0.0.1:" + k.Port, Handler: k.Engine, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("Crond backend listening on http://%s", k.server.Addr)
	if err := k.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func (k *Kernel) Exit() {
	if k.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
		defer cancel()
		_ = k.server.Shutdown(ctx)
	}
	if k.service != nil {
		k.service.Close()
	}
}

// GetServer 提供统一命名规范的独立服务
func GetServer() constraint.KernelServer {
	return NewKernel()
}
