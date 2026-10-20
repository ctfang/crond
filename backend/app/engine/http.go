package engine

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/php-any/origami/runtime"
)

func loadScriptHTTP(vm *runtime.VM) {
	vm.RegisterFunction("script_http_request", scriptHTTPRequest)
}

// JSON and base64 keep the VM boundary independent of PHP array and binary conversions.
func scriptHTTPRequest(method, address, headerJSON, encodedBody string, timeout float64) string {
	result := map[string]interface{}{}
	fail := func(err error) string {
		data, _ := json.Marshal(map[string]string{"error": "HTTP request failed: " + err.Error()})
		return string(data)
	}
	parsed, err := url.Parse(address)
	if err != nil {
		return fail(err)
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return fail(fmt.Errorf("invalid HTTP URL"))
	}
	if math.IsNaN(timeout) || math.IsInf(timeout, 0) || timeout <= 0 || timeout >= float64(math.MaxInt64)/float64(time.Second) {
		return fail(fmt.Errorf("invalid timeout"))
	}
	headers := map[string]string{}
	// An empty PHP array is encoded as [] rather than {}.
	if headerJSON != "[]" {
		if err := json.Unmarshal([]byte(headerJSON), &headers); err != nil {
			return fail(err)
		}
	}
	body, err := base64.StdEncoding.DecodeString(encodedBody)
	if err != nil {
		return fail(err)
	}
	req, err := http.NewRequest(method, address, bytes.NewReader(body))
	if err != nil {
		return fail(err)
	}
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	client := &http.Client{Timeout: time.Duration(timeout * float64(time.Second)), CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return fail(err)
	}
	defer response.Body.Close()
	content, err := io.ReadAll(response.Body)
	if err != nil {
		return fail(err)
	}
	normalized := map[string][]string{}
	for name, values := range response.Header {
		normalized[strings.ToLower(name)] = values
	}
	result["status"], result["headers"], result["body"] = response.StatusCode, normalized, base64.StdEncoding.EncodeToString(content)
	encoded, err := json.Marshal(result)
	if err != nil {
		return fail(err)
	}
	return string(encoded)
}
