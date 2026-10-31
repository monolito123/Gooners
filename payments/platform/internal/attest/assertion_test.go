package attest_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/attest"
	"github.com/monolito123/Gooners/payments/platform/internal/attest/attesttest"
)

func TestAppAttestAssertion(t *testing.T) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	client := []byte("e0c2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2")
	att, kid, roots, err := attesttest.AppAttestObject(attesttest.AppAttest{AppID: app, ClientData: client, Key: key})
	if err != nil {
		t.Fatal(err)
	}
	cfg := attest.AppAttestConfig{Roots: roots, AppID: app}
	res, err := attest.VerifyAppAttest(cfg, kid, att, client)
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"payment_intent_id":"pi_1","stan":"000001"}`)
	a1, _ := attesttest.AppAttestAssertion(key, app, 1, body)
	n, err := attest.VerifyAppAttestAssertion(cfg, res.PublicKey, 0, a1, body)
	if err != nil || n != 1 {
		t.Fatalf("a good assertion: %d %v", n, err)
	}
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	forged, _ := attesttest.AppAttestAssertion(other, app, 2, body)
	wrongApp, _ := attesttest.AppAttestAssertion(key, "ZZZZZ99999.com.other.app", 2, body)
	for name, tc := range map[string]struct {
		assertion, body []byte
		last            uint32
		want            string
	}{
		"replayed":          {a1, body, 1, "replayed"},
		"another body":      {a1, []byte(`{"payment_intent_id":"pi_2","stan":"000001"}`), 0, "signature"},
		"another key":       {forged, body, 1, "signature"},
		"another app":       {wrongApp, body, 1, "App ID"},
		"not an assertion":  {[]byte("garbage"), body, 0, "assertion"},
		"missing signature": {[]byte{0xa0}, body, 0, "required"},
	} {
		if _, err := attest.VerifyAppAttestAssertion(cfg, res.PublicKey, tc.last, tc.assertion, tc.body); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v, want %q", name, err, tc.want)
		}
	}
}

func TestRevocationList(t *testing.T) {
	digest := sha256.Sum256([]byte("play app signing certificate"))
	challenge := attest.Challenge("e0c2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2")
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	p, err := attesttest.AndroidChain(key, attesttest.Genuine(challenge, "br.com.gooners.pay", digest[:]))
	if err != nil {
		t.Fatal(err)
	}
	inter, _ := x509.ParseCertificate(p.Chain[1])
	now := time.Now()
	dir := t.TempDir()
	write := func(name, body string) string {
		f := filepath.Join(dir, name)
		if err := os.WriteFile(f, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		return f
	}
	clean := &attest.RevocationSource{Location: write("clean.json", `{"entries":{"2c8cdddfd5e03bfc":{"status":"REVOKED","reason":"KEY_COMPROMISE"}}}`), Now: func() time.Time { return now }}
	revoked := &attest.RevocationSource{Location: write("revoked.json", `{"entries":{"`+inter.SerialNumber.Text(16)+`":{"status":"SUSPENDED","reason":"SOFTWARE_FLAW"}}}`)}
	cfg := func(src *attest.RevocationSource) attest.KeyAttestationConfig {
		return attest.KeyAttestationConfig{Roots: p.Roots, PackageName: "br.com.gooners.pay", SigningDigests: [][]byte{digest[:]}, Revocations: src.Current}
	}
	if _, err := attest.VerifyKeyAttestation(cfg(clean), p.Chain, challenge); err == nil || !strings.Contains(err.Error(), "not fetched") {
		t.Fatalf("no list yet must fail closed: %v", err)
	}
	for _, s := range []*attest.RevocationSource{clean, revoked} {
		if err := s.Refresh(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := attest.VerifyKeyAttestation(cfg(clean), p.Chain, challenge); err != nil {
		t.Fatalf("a chain the list does not name: %v", err)
	}
	if _, err := attest.VerifyKeyAttestation(cfg(revoked), p.Chain, challenge); err == nil || !strings.Contains(err.Error(), "suspended") {
		t.Fatalf("a suspended intermediate: %v", err)
	}
	now = now.Add(73 * time.Hour)
	if _, err := attest.VerifyKeyAttestation(cfg(clean), p.Chain, challenge); err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("a stale list must fail closed: %v", err)
	}
	// A failed refresh keeps the last good list until it is too old.
	clean.Location = filepath.Join(dir, "missing.json")
	if err := clean.Refresh(t.Context()); err == nil {
		t.Fatal("a missing list must be an error")
	}
	if _, err := attest.ParseRevocationList([]byte(`{"no":"entries"}`)); err == nil {
		t.Fatal("a list without entries must be refused")
	}

	// Over HTTP, as from Google; an error status is a failed refresh.
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"entries":{}}`))
	}))
	defer srv.Close()
	web := &attest.RevocationSource{Location: srv.URL}
	if err := web.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	if l, err := web.Current(); err != nil || len(l.Entries) != 0 {
		t.Fatalf("over HTTP: %v %v", l, err)
	}
	status = http.StatusServiceUnavailable
	if err := web.Refresh(t.Context()); err == nil || !strings.Contains(err.Error(), "503") {
		t.Fatalf("HTTP 503: %v", err)
	}
}
