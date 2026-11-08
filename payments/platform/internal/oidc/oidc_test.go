package oidc

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// idp is a fake identity provider: discovery, JWKS, and the device authorization grant.
type idp struct {
	srv      *httptest.Server
	rsaKey   *rsa.PrivateKey
	ecKey    *ecdsa.PrivateKey
	rotated  *rsa.PrivateKey // published only after rotate()
	rotate   atomic.Bool
	polls    atomic.Int32
	idToken  string
	jwksHits atomic.Int32
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func newIDP(t *testing.T) *idp {
	t.Helper()
	p := &idp{}
	p.rsaKey, _ = rsa.GenerateKey(rand.Reader, 2048)
	p.rotated, _ = rsa.GenerateKey(rand.Reader, 2048)
	p.ecKey, _ = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	mux := http.NewServeMux()
	p.srv = httptest.NewServer(mux)
	t.Cleanup(p.srv.Close)
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"issuer": p.srv.URL, "jwks_uri": p.srv.URL + "/keys",
			"token_endpoint": p.srv.URL + "/token", "device_authorization_endpoint": p.srv.URL + "/device"})
	})
	mux.HandleFunc("GET /keys", func(w http.ResponseWriter, r *http.Request) {
		p.jwksHits.Add(1)
		ecPoint, _ := p.ecKey.PublicKey.Bytes()
		keys := []map[string]string{
			{"kty": "RSA", "kid": "r1", "use": "sig", "n": b64(p.rsaKey.N.Bytes()), "e": "AQAB"},
			{"kty": "EC", "kid": "e1", "crv": "P-256", "x": b64(ecPoint[1:33]), "y": b64(ecPoint[33:])},
			{"kty": "RSA", "kid": "enc", "use": "enc", "n": b64(p.rsaKey.N.Bytes()), "e": "AQAB"},
		}
		if p.rotate.Load() {
			keys = append(keys, map[string]string{"kty": "RSA", "kid": "r2", "n": b64(p.rotated.N.Bytes()), "e": "AQAB"})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": keys})
	})
	mux.HandleFunc("POST /device", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.PostForm.Get("client_id") != "operators-cli" || !strings.Contains(r.PostForm.Get("scope"), "email") {
			w.WriteHeader(400)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"device_code": "dev-123", "user_code": "WDJB-MJHT", "verification_uri": p.srv.URL + "/activate",
			"expires_in": 30, "interval": 0})
	})
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.PostForm.Get("device_code") != "dev-123" || r.PostForm.Get("grant_type") != "urn:ietf:params:oauth:grant-type:device_code" {
			w.WriteHeader(400)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
			return
		}
		switch p.polls.Add(1) {
		case 1:
			w.WriteHeader(400)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "authorization_pending"})
		case 2:
			w.WriteHeader(400)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "slow_down"})
		default:
			_ = json.NewEncoder(w).Encode(map[string]string{"id_token": p.idToken, "token_type": "Bearer"})
		}
	})
	return p
}

// sign makes a JWT with key (RS256 for RSA, ES256 for EC) under kid.
func sign(t *testing.T, key crypto.Signer, alg, kid string, claims map[string]any) string {
	t.Helper()
	h, _ := json.Marshal(map[string]string{"alg": alg, "kid": kid, "typ": "JWT"})
	c, _ := json.Marshal(claims)
	in := b64(h) + "." + b64(c)
	d := sha256.Sum256([]byte(in))
	var sig []byte
	switch k := key.(type) {
	case *rsa.PrivateKey:
		sig, _ = rsa.SignPKCS1v15(rand.Reader, k, crypto.SHA256, d[:])
	case *ecdsa.PrivateKey:
		r, s, _ := ecdsa.Sign(rand.Reader, k, d[:])
		sig = append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	}
	return in + "." + b64(sig)
}

func TestVerify(t *testing.T) {
	p := newIDP(t)
	ctx, now := context.Background(), time.Now()
	prov := &Provider{Issuer: p.srv.URL}
	claims := func(mod func(map[string]any)) map[string]any {
		c := map[string]any{"iss": p.srv.URL, "sub": "248289761001", "aud": "operators-cli", "exp": now.Add(time.Hour).Unix(), "iat": now.Unix(),
			"email": "Ana@GoonersPay.com.br", "email_verified": true, "groups": []string{"payments-ops"}}
		if mod != nil {
			mod(c)
		}
		return c
	}
	pol := Policy{ClientID: "operators-cli", Domains: []string{"goonerspay.com.br"}, Group: "payments-ops"}
	for _, tc := range []struct {
		name, alg, kid string
		key            crypto.Signer
		claims         map[string]any
	}{
		{"RS256", "RS256", "r1", p.rsaKey, claims(nil)},
		{"ES256", "ES256", "e1", p.ecKey, claims(nil)},
		{"an audience list", "RS256", "r1", p.rsaKey, claims(func(c map[string]any) { c["aud"] = []string{"other", "operators-cli"} })},
		{"email_verified as a string", "RS256", "r1", p.rsaKey, claims(func(c map[string]any) { c["email_verified"] = "true" })},
	} {
		c, err := prov.Verify(ctx, sign(t, tc.key, tc.alg, tc.kid, tc.claims), "operators-cli", now)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		op, err := pol.Authorize(c)
		if err != nil || op.Email != "ana@goonerspay.com.br" || op.Subject != "248289761001" {
			t.Fatalf("%s: %+v %v", tc.name, op, err)
		}
	}
	for _, tc := range []struct {
		name, alg, kid string
		key            crypto.Signer
		claims         map[string]any
		want           string
	}{
		{"another audience", "RS256", "r1", p.rsaKey, claims(func(c map[string]any) { c["aud"] = "someone-else" }), "another client"},
		{"another issuer", "RS256", "r1", p.rsaKey, claims(func(c map[string]any) { c["iss"] = "https://evil.example" }), "issued by"},
		{"expired", "RS256", "r1", p.rsaKey, claims(func(c map[string]any) { c["exp"] = now.Add(-2 * time.Minute).Unix() }), "expired"},
		{"not yet valid", "RS256", "r1", p.rsaKey, claims(func(c map[string]any) { c["nbf"] = now.Add(5 * time.Minute).Unix() }), "not valid yet"},
		{"an unknown key", "RS256", "zz", p.rsaKey, claims(nil), "unknown signing key"},
		{"a key for encryption", "RS256", "enc", p.rsaKey, claims(nil), "unknown signing key"},
		{"the EC key under RS256", "RS256", "e1", p.ecKey, claims(nil), "does not verify"},
		{"HS256", "HS256", "r1", p.rsaKey, claims(nil), "not accepted"},
		{"none", "none", "r1", p.rsaKey, claims(nil), "not accepted"},
	} {
		if _, err := prov.Verify(ctx, sign(t, tc.key, tc.alg, tc.kid, tc.claims), "operators-cli", now); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v", tc.name, err)
		}
	}
	// A payload changed after signing.
	tok := sign(t, p.rsaKey, "RS256", "r1", claims(nil))
	parts := strings.Split(tok, ".")
	forged, _ := json.Marshal(claims(func(c map[string]any) { c["email"] = "boss@goonerspay.com.br" }))
	if _, err := prov.Verify(ctx, parts[0]+"."+b64(forged)+"."+parts[2], "operators-cli", now); err == nil {
		t.Fatal("a forged payload accepted")
	}
	// The policy: domain, verified e-mail, group.
	for name, mod := range map[string]func(map[string]any){
		"another domain":   func(c map[string]any) { c["email"] = "ana@gmail.com" },
		"unverified":       func(c map[string]any) { c["email_verified"] = false },
		"no e-mail":        func(c map[string]any) { delete(c, "email") },
		"not in the group": func(c map[string]any) { c["groups"] = []string{"marketing"} },
	} {
		c, err := prov.Verify(ctx, sign(t, p.rsaKey, "RS256", "r1", claims(mod)), "operators-cli", now)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pol.Authorize(c); err == nil {
			t.Errorf("%s: authorized", name)
		}
	}
	// Key rotation: an unknown kid refreshes the JWKS (at most once a minute).
	hits := p.jwksHits.Load()
	p.rotate.Store(true)
	if _, err := prov.Verify(ctx, sign(t, p.rotated, "RS256", "r2", claims(nil)), "operators-cli", now.Add(2*time.Minute)); err != nil {
		t.Fatalf("a rotated key: %v", err)
	}
	if p.jwksHits.Load() != hits+1 {
		t.Fatalf("JWKS fetched %d times", p.jwksHits.Load()-hits)
	}
	for i := 0; i < 3; i++ {
		_, _ = prov.Verify(ctx, sign(t, p.rsaKey, "RS256", "nope", claims(nil)), "operators-cli", now.Add(2*time.Minute))
	}
	if p.jwksHits.Load() != hits+1 {
		t.Fatal("unknown kids made the platform hammer the provider's JWKS")
	}
	// A discovery document naming another issuer is refused.
	if _, err := (&Provider{Issuer: p.srv.URL + "/"}).Discover(ctx); err == nil {
		t.Fatal("a mismatched issuer accepted")
	}
}

func TestDeviceLogin(t *testing.T) {
	p := newIDP(t)
	now := time.Now()
	p.idToken = sign(t, p.rsaKey, "RS256", "r1", map[string]any{"iss": p.srv.URL, "sub": "1", "aud": "operators-cli", "exp": now.Add(time.Hour).Unix(),
		"email": "ana@goonerspay.com.br", "email_verified": true})
	prov := &Provider{Issuer: p.srv.URL}
	var shown string
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	minInterval, slowDownStep = 10*time.Millisecond, 10*time.Millisecond
	defer func() { minInterval, slowDownStep = 5*time.Second, 5*time.Second }()
	tok, err := prov.DeviceLogin(ctx, "operators-cli", "", func(uri, code, _ string) { shown = uri + " " + code })
	if err != nil || tok != p.idToken || !strings.HasSuffix(shown, "/activate WDJB-MJHT") || p.polls.Load() != 3 {
		t.Fatalf("%q %v %q polls %d", tok, err, shown, p.polls.Load())
	}
	if _, err := prov.Verify(ctx, tok, "operators-cli", now); err != nil {
		t.Fatal(err)
	}
}
