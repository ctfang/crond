package crond

import (
	"strings"
	"testing"
)

func TestProjectSlugValidationAndUniqueness(t *testing.T) {
	_, c, base := loginProject(t)
	if c.cookie.Path != "/" {
		t.Fatal("session must cover project service paths", c.cookie)
	}
	for _, slug := range []string{"", "UPPER", "123", "-bad", "bad-", "bad--slug", "with/slash", "a?query", "中文", "api", "admin", "src", "assets", "public", strings.Repeat("a", 64)} {
		c.call("POST", "/api/projects", Object{"name": "invalid", "slug": slug}, 400)
	}
	created := c.call("POST", "/api/projects", Object{"name": "Readable project", "slug": "my-project"}, 200).(map[string]interface{})
	if created["slug"] != "my-project" {
		t.Fatal(created)
	}
	c.call("POST", "/api/projects", Object{"name": "Duplicate", "slug": "my-project"}, 409)
	c.call("PATCH", base, Object{"slug": "my-project"}, 409)
	c.call("PATCH", base, Object{"slug": "api"}, 400)
	updated := c.call("PATCH", base, Object{"slug": "updated-project"}, 200).(map[string]interface{})
	if updated["slug"] != "updated-project" {
		t.Fatal(updated)
	}
	c.call("PATCH", base, Object{"name": "Renamed"}, 200)
	// A slug can be saved unchanged, and is unique independently of the display name.
	c.call("PATCH", base, Object{"slug": "updated-project"}, 200)
	c.call("POST", "/api/projects", Object{"name": "Readable project", "slug": "different-project"}, 200)
}
