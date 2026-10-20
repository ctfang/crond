package crond

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func qqConfig() (string, string, string, bool) {
	id, key, callback := os.Getenv("QQ_APP_ID"), os.Getenv("QQ_APP_KEY"), os.Getenv("QQ_REDIRECT_URL")
	parsed, err := url.Parse(callback)
	valid := err == nil && parsed.Host != "" && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.User == nil && parsed.Path == "/api/auth/qq/callback" && parsed.RawQuery == "" && parsed.Fragment == ""
	return id, key, callback, id != "" && key != "" && valid
}

func (s *Service) qqLogin(c *gin.Context) {
	id, _, callback, ready := qqConfig()
	if !ready {
		fail(c, 503, "QQ 登录未配置：请设置 QQ_APP_ID、QQ_APP_KEY 和 QQ_REDIRECT_URL")
		return
	}
	state := OAuthState{State: newID(), ExpiresAt: time.Now().Add(10 * time.Minute)}
	if err := s.db.Create(&state).Error; err != nil {
		result(c, nil, err)
		return
	}
	_ = s.db.Where("expires_at < ?", time.Now()).Delete(&OAuthState{}).Error
	http.SetCookie(c.Writer, &http.Cookie{Name: "crond_qq_state", Value: state.State, Path: "/api/auth/qq", HttpOnly: true, Secure: strings.HasPrefix(callback, "https://"), SameSite: http.SameSiteLaxMode, MaxAge: 600})
	params := url.Values{"response_type": {"code"}, "client_id": {id}, "redirect_uri": {callback}, "state": {state.State}, "scope": {"get_user_info"}}
	c.JSON(200, Object{"url": "https://graph.qq.com/oauth2.0/authorize?" + params.Encode()})
}

func (s *Service) qqGet(c *gin.Context, endpoint string, params url.Values, target interface{}) error {
	request, err := http.NewRequestWithContext(c.Request.Context(), "GET", "https://graph.qq.com"+endpoint+"?"+params.Encode(), nil)
	if err != nil {
		return err
	}
	client := s.qqClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("QQ 服务连接失败")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return errors.New("QQ 服务返回错误")
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(payload) > 1<<20 {
		return errors.New("QQ 响应无效")
	}
	text := strings.TrimSpace(string(payload))
	// OpenID historically uses callback({...}); accept both that and fmt=json.
	if strings.HasPrefix(text, "callback") {
		start, end := strings.Index(text, "("), strings.LastIndex(text, ")")
		if start < 0 || end <= start {
			return errors.New("QQ 响应无效")
		}
		text = text[start+1 : end]
	}
	return json.Unmarshal([]byte(text), target)
}

func (s *Service) qqCallback(c *gin.Context) {
	id, key, callback, ready := qqConfig()
	reject := func(message string) { c.Redirect(http.StatusSeeOther, "/?authError="+url.QueryEscape(message)) }
	if !ready {
		reject("QQ 登录未配置")
		return
	}
	state := c.Query("state")
	cookie, err := c.Cookie("crond_qq_state")
	http.SetCookie(c.Writer, &http.Cookie{Name: "crond_qq_state", Value: "", Path: "/api/auth/qq", HttpOnly: true, Secure: strings.HasPrefix(callback, "https://"), SameSite: http.SameSiteLaxMode, MaxAge: -1})
	if err != nil || state == "" || subtle.ConstantTimeCompare([]byte(cookie), []byte(state)) != 1 {
		reject("QQ 登录校验失败，请重新登录")
		return
	}
	consumed := s.db.Where("state = ? AND expires_at > ?", state, time.Now()).Delete(&OAuthState{})
	if consumed.Error != nil || consumed.RowsAffected != 1 {
		reject("QQ 登录已过期，请重新登录")
		return
	}
	if c.Query("code") == "" || c.Query("error") != "" {
		reject("QQ 登录已取消或授权失败")
		return
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	err = s.qqGet(c, "/oauth2.0/token", url.Values{"grant_type": {"authorization_code"}, "client_id": {id}, "client_secret": {key}, "code": {c.Query("code")}, "redirect_uri": {callback}, "fmt": {"json"}}, &token)
	if err != nil || token.AccessToken == "" {
		reject("QQ 授权码验证失败，请重新登录")
		return
	}
	var identity struct {
		ClientID string `json:"client_id"`
		OpenID   string `json:"openid"`
	}
	err = s.qqGet(c, "/oauth2.0/me", url.Values{"access_token": {token.AccessToken}, "fmt": {"json"}}, &identity)
	if err != nil || identity.ClientID != id || identity.OpenID == "" {
		reject("QQ 身份验证失败")
		return
	}
	var profile struct {
		Ret      *int   `json:"ret"`
		Nickname string `json:"nickname"`
	}
	err = s.qqGet(c, "/user/get_user_info", url.Values{"access_token": {token.AccessToken}, "oauth_consumer_key": {id}, "openid": {identity.OpenID}}, &profile)
	if err != nil || profile.Ret == nil || *profile.Ret != 0 {
		reject("无法获取 QQ 用户信息")
		return
	}
	account := Account{ID: "qq-" + id + "-" + identity.OpenID, Email: identity.OpenID + "." + id + "@qq.crond.local", Name: profile.Nickname}
	if account.Name == "" {
		account.Name = "QQ 用户"
	}
	if err := s.db.Save(&account).Error; err != nil {
		reject("QQ 账号保存失败")
		return
	}
	if s.establishSession(c, account) {
		c.Redirect(http.StatusSeeOther, "/")
	}
}
