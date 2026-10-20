package crond

import (
	"regexp"

	"github.com/gin-gonic/gin"
)

var projectSlugPattern = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)

// Call while holding mutationMu so concurrent creates/updates cannot claim the same slug.
func (s *Service) validateProjectSlug(c *gin.Context, slug, excludeID string) bool {
	if len(slug) > 63 || !projectSlugPattern.MatchString(slug) {
		fail(c, 400, "项目标识须为 1–63 个字符，以小写字母开头，仅支持小写字母、数字和单个连字符，不能以连字符结尾")
		return false
	}
	switch slug {
	case "api", "admin", "src", "assets", "node_modules", "public":
		fail(c, 400, "该项目标识为系统保留路径，请使用其他标识")
		return false
	}
	projects, err := s.list("", "projects", "")
	if err != nil {
		result(c, nil, err)
		return false
	}
	for _, project := range projects {
		if str(project, "slug") == slug && str(project, "id") != excludeID {
			fail(c, 409, "项目标识已被使用")
			return false
		}
	}
	return true
}
