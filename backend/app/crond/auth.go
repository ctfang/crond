package crond

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

func (s *Service) setSession(c *gin.Context, account Account) {
	if s.establishSession(c, account) {
		c.JSON(200, Object{"token": "", "username": account.Name})
	}
}
func (s *Service) establishSession(c *gin.Context, account Account) bool {
	session := Session{Token: newID(), UserID: account.ID, ExpiresAt: time.Now().Add(24 * time.Hour)}
	if err := s.db.Create(&session).Error; err != nil {
		result(c, nil, err)
		return false
	}
	_ = s.db.Where("expires_at < ?", time.Now()).Delete(&Session{}).Error
	http.SetCookie(c.Writer, &http.Cookie{Name: "crond_session", Value: session.Token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: c.Request.TLS != nil, MaxAge: 86400})
	return true
}
func (s *Service) testLogin(c *gin.Context) {
	if os.Getenv("CROND_TEST_LOGIN") == "false" {
		fail(c, 403, "测试登录已关闭")
		return
	}
	account, err := s.seedTest()
	if err != nil {
		result(c, nil, err)
		return
	}
	s.setSession(c, account)
}
func (s *Service) me(c *gin.Context) {
	var account Account
	if err := s.db.First(&account, "id = ?", userID(c)).Error; err != nil {
		fail(c, 401, "用户不存在")
		return
	}
	c.JSON(200, Object{"uid": account.ID, "email": account.Email, "username": account.Name})
}
func (s *Service) logout(c *gin.Context) {
	token, _ := c.Cookie("crond_session")
	if err := s.db.Where("token = ?", token).Delete(&Session{}).Error; err != nil {
		result(c, nil, err)
		return
	}
	http.SetCookie(c.Writer, &http.Cookie{Name: "crond_session", Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	c.JSON(200, Object{"ok": true})
}
func (s *Service) googleLogin(c *gin.Context) {
	data, ok := body(c)
	if !ok {
		return
	}
	key := os.Getenv("FIREBASE_API_KEY")
	if key == "" {
		var config struct {
			APIKey string `json:"apiKey"`
		}
		if contents, err := os.ReadFile("../firebase-applet-config.json"); err == nil {
			_ = json.Unmarshal(contents, &config)
			key = config.APIKey
		}
	}
	if key == "" {
		fail(c, 503, "未配置 Firebase API Key，请使用测试账号登录")
		return
	}
	payload, _ := json.Marshal(Object{"idToken": str(data, "idToken")})
	request, err := http.NewRequestWithContext(c.Request.Context(), "POST", "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+key, bytes.NewReader(payload))
	if err != nil {
		fail(c, 400, "无效的登录请求")
		return
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	if err != nil {
		fail(c, 502, "Google 身份验证服务暂不可用")
		return
	}
	defer response.Body.Close()
	var identity struct {
		Users []struct {
			LocalID     string `json:"localId"`
			Email       string `json:"email"`
			DisplayName string `json:"displayName"`
		} `json:"users"`
	}
	if response.StatusCode != 200 || json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&identity) != nil || len(identity.Users) != 1 {
		fail(c, 401, "Google 登录凭据无效")
		return
	}
	user := identity.Users[0]
	if user.LocalID == "" {
		fail(c, 401, "Google 登录凭据无效")
		return
	}
	account := Account{ID: "google-" + user.LocalID, Email: user.Email, Name: user.DisplayName}
	if account.Name == "" {
		account.Name = account.Email
	}
	if err := s.db.Save(&account).Error; err != nil {
		result(c, nil, err)
		return
	}
	s.setSession(c, account)
}
