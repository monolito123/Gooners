package console

import (
	"io"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// The claim page: its files only, each with its type, under a policy that names the relays and
// nothing else; no inline code, no third parties.
func TestClaimPage(t *testing.T) {
	h := ClaimHandler([]string{"wss://relay.goonerspay.com.br", "wss://relay2.example.org/nostr", "https://not-a-relay"})
	get := func(path string) (int, string, string, string) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		b, _ := io.ReadAll(rec.Body)
		return rec.Code, rec.Header().Get("Content-Type"), rec.Header().Get("Content-Security-Policy"), string(b)
	}
	code, typ, csp, html := get("/c")
	if code != 200 || !strings.HasPrefix(typ, "text/html") {
		t.Fatalf("/c: %d %s", code, typ)
	}
	if !strings.Contains(csp, "connect-src 'self' wss://relay.goonerspay.com.br wss://relay2.example.org;") || strings.Contains(csp, "not-a-relay") ||
		!strings.Contains(csp, "script-src 'self';") || !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Fatalf("policy %q", csp)
	}
	if regexp.MustCompile(`<script(?:\s[^>]*)?>\s*[^<\s]|<style|\sstyle=|\son[a-z]+=`).MatchString(html) {
		t.Error("the claim page has inline script, style or an event handler attribute")
	}
	for _, s := range regexp.MustCompile(`(?:src|href)="([^"]+)"`).FindAllStringSubmatch(html, -1) {
		if strings.Contains(s[1], "//") {
			t.Errorf("the claim page loads %s from another origin", s[1])
		}
		if code, _, _, _ := get(s[1]); code != 200 {
			t.Errorf("%s: %d", s[1], code)
		}
	}
	for _, p := range []string{"/c/claim/claim.js", "/c/claim/nostr.js", "/c/verify.js"} {
		code, typ, _, body := get(p)
		if code != 200 || !strings.Contains(typ, "javascript") {
			t.Errorf("%s: %d %s", p, code, typ)
		}
		for _, bad := range []string{"innerHTML", "eval(", "new Function", "document.write", "localStorage", "document.cookie"} {
			if strings.Contains(body, bad) {
				t.Errorf("%s uses %q", p, bad)
			}
		}
	}
	for _, p := range []string{"/c/app.js", "/c/claim/", "/c/../console.go", "/c/vendor/qrcode.js", "/c/claim/index.html"} {
		if code, _, _, _ := get(p); code != 404 {
			t.Errorf("%s: %d, want 404", p, code)
		}
	}
}
