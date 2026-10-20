package crond

import (
	"errors"
	"github.com/gin-gonic/gin"
	"net/url"
	"path"
	"strings"
)

func normalizeServicePath(route string) (string, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(route))
	if err != nil || parsed.Host != "" || parsed.RawQuery != "" || parsed.Fragment != "" || !strings.HasPrefix(route, "/") || strings.Contains(route, "..") || strings.Contains(route, "#") {
		return "", errors.New("服务路径须以 / 开头，不能包含查询参数、片段或 ..")
	}
	return path.Clean(parsed.Path), nil
}

// Direct service paths retain authentication, project permissions and isolation.
func (s *Service) directService(c *gin.Context) {
	projects, err := s.list("", "projects", "")
	if err != nil {
		result(c, nil, err)
		return
	}
	segments := strings.SplitN(strings.TrimPrefix(c.Request.URL.Path, "/"), "/", 2)
	slug := segments[0]
	route := "/"
	if len(segments) == 2 {
		route += segments[1]
	}
	for _, project := range projects {
		if str(project, "slug") != slug {
			continue
		}
		id := str(project, "id")
		role := s.role(id, userID(c))
		if role != "owner" && role != "editor" {
			break
		}
		c.Params = append(c.Params, gin.Param{Key: "projectId", Value: id}, gin.Param{Key: "route", Value: route})
		s.invokeService(c)
		return
	}
	fail(c, 404, "项目不存在或没有调用权限")
}

// Services default to GET when no method is specified.
func serviceMethod(service Object) string {
	method := strings.ToUpper(strings.TrimSpace(str(service, "method")))
	if method == "" {
		return "GET"
	}
	return method
}
