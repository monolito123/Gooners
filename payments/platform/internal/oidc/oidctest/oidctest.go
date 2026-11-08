// Package oidctest is a fake OpenID Connect provider for tests: discovery, a JWKS with one
// RS256 key, and ID tokens signed with it.
package oidctest

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"time"
)

// IDP is a running fake provider; its issuer is URL.
type IDP struct {
	URL string
	srv *httptest.Server
	key *rsa.PrivateKey
}

// New starts a provider; Close stops it.
func New() *IDP {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(err)
	}
	p := &IDP{key: key}
	mux := http.NewServeMux()
	p.srv = httptest.NewServer(mux)
	p.URL = p.srv.URL
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"issuer": p.URL, "jwks_uri": p.URL + "/keys", "token_endpoint": p.URL + "/token"})
	})
	mux.HandleFunc("GET /keys", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{"kty": "RSA", "kid": "k1", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": "AQAB"}}})
	})
	return p
}

// Close stops the provider.
func (p *IDP) Close() { p.srv.Close() }

// Token is an ID token for email issued to clientID, valid for an hour; extra claims are
// added or replace the defaults.
func (p *IDP) Token(clientID, email string, extra map[string]any) string {
	now := time.Now()
	claims := map[string]any{"iss": p.URL, "sub": "sub-" + email, "aud": clientID, "iat": now.Unix(), "exp": now.Add(time.Hour).Unix(),
		"email": email, "email_verified": true}
	for k, v := range extra {
		claims[k] = v
	}
	h, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": "k1", "typ": "JWT"})
	c, _ := json.Marshal(claims)
	in := base64.RawURLEncoding.EncodeToString(h) + "." + base64.RawURLEncoding.EncodeToString(c)
	d := sha256.Sum256([]byte(in))
	sig, err := rsa.SignPKCS1v15(rand.Reader, p.key, crypto.SHA256, d[:])
	if err != nil {
		panic(err)
	}
	return in + "." + base64.RawURLEncoding.EncodeToString(sig)
}
