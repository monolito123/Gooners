package netguard

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"
)

func TestIsPublic(t *testing.T) {
	for s, want := range map[string]bool{
		"8.8.8.8": true, "2606:4700:4700::1111": true, "200.160.2.3": true,
		"127.0.0.1": false, "10.1.2.3": false, "172.20.0.5": false, "192.168.1.1": false, "169.254.169.254": false,
		"100.100.100.200": false, "0.0.0.0": false, "::1": false, "fd00::1": false, "fe80::1": false, "::ffff:127.0.0.1": false,
		"::ffff:10.0.0.1": false, "64:ff9b::a00:1": false, "224.0.0.1": false,
	} {
		if got := IsPublic(netip.MustParseAddr(s)); got != want {
			t.Errorf("IsPublic(%s) = %v", s, got)
		}
	}
}

func TestValidateURL(t *testing.T) {
	ctx := context.Background()
	strict := Policy{RequireHTTPS: true}
	for _, bad := range []string{
		"http://hooks.partner.example/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data/", "https://[::1]/x",
		"https://localhost/x", "https://metrics/x", "https://user:pass@hooks.partner.example/x", "ftp://hooks.partner.example/x",
		"https://10.0.0.8:8443/hook", "/relative", "https://[::ffff:192.168.0.1]/x",
	} {
		if err := strict.ValidateURL(ctx, bad); err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
	if err := strict.ValidateURL(ctx, "https://8.8.8.8/hook"); err != nil {
		t.Errorf("public literal refused: %v", err)
	}
	if err := (Policy{AllowPrivate: true}).ValidateURL(ctx, "http://127.0.0.1:9000/hook"); err != nil {
		t.Errorf("sandbox policy refused a local receiver: %v", err)
	}
}

func TestClientRefusesPrivateAndRedirects(t *testing.T) {
	var hits atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer target.Close()
	_, err := Policy{}.Client(2*time.Second).Post(target.URL, "application/json", nil)
	if !errors.Is(err, ErrForbiddenAddress) || hits.Load() != 0 {
		t.Fatalf("loopback reached: err %v, hits %d", err, hits.Load())
	}
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer redirector.Close()
	resp, err := Policy{AllowPrivate: true}.Client(2*time.Second).Post(redirector.URL, "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound || hits.Load() != 0 {
		t.Fatalf("redirect followed: status %d, hits %d", resp.StatusCode, hits.Load())
	}
}
