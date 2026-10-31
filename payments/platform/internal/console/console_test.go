package console

import (
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

func get(t *testing.T, path string) *http.Response {
	t.Helper()
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
	return rec.Result()
}

func TestServesTheAppUnderItsPolicy(t *testing.T) {
	for path, ctype := range map[string]string{
		"/console/":                 "text/html",
		"/console/app.js":           "javascript",
		"/console/verify.js":        "javascript",
		"/console/style.css":        "text/css",
		"/console/vendor/qrcode.js": "javascript",
	} {
		r := get(t, path)
		if r.StatusCode != 200 || !strings.Contains(r.Header.Get("Content-Type"), ctype) {
			t.Errorf("%s: %d %q", path, r.StatusCode, r.Header.Get("Content-Type"))
		}
		if r.Header.Get("Content-Security-Policy") != CSP {
			t.Errorf("%s: no CSP", path)
		}
	}
	for _, path := range []string{"/console/vendor/", "/console/nope.js", "/console/../console.go"} {
		if r := get(t, path); r.StatusCode != 404 && r.StatusCode != 301 {
			t.Errorf("%s: %d", path, r.StatusCode)
		}
	}
}

// The policy forbids inline code and style; the files must not need any.
func TestNoInlineCodeOrStyle(t *testing.T) {
	read := func(name string) string {
		b, err := io.ReadAll(get(t, "/console/"+name).Body)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	html := read("")
	if regexp.MustCompile(`<script(?:\s[^>]*)?>\s*[^<\s]|<style|\sstyle=|\son[a-z]+=`).MatchString(html) {
		t.Error("index.html has inline script, style or an event handler attribute")
	}
	for _, s := range regexp.MustCompile(`(?:src|href)="([^"]+)"`).FindAllStringSubmatch(html, -1) {
		if strings.Contains(s[1], "//") {
			t.Errorf("index.html loads %s from another origin", s[1])
		}
	}
	app := read("app.js")
	for _, bad := range []string{"innerHTML", "eval(", "new Function", "document.write", "setAttribute('style'"} {
		if strings.Contains(app, bad) {
			t.Errorf("app.js uses %q", bad)
		}
	}
	// A style attribute set through h() is blocked by the policy; Intl's style option is not one.
	if strings.Count(app, "style: '") != strings.Count(app, "style: 'currency'") {
		t.Error("app.js sets a style attribute")
	}
	if strings.Contains(app, "localStorage.setItem('gp.key") || strings.Contains(app, "sessionStorage") {
		t.Error("app.js must keep the API key in memory only")
	}
}
