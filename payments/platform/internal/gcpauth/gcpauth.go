// Package gcpauth obtains OAuth 2.0 access tokens for Google Cloud APIs (Cloud KMS, Play
// Integrity) without the client libraries: from a service-account key through the JWT bearer
// grant (RFC 7523), or from the metadata server on GCE, GKE and Cloud Run.
package gcpauth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// TokenSource returns a bearer token for the scopes it was made for.
type TokenSource interface {
	Token(ctx context.Context) (string, error)
}

// FromEnvironment uses GOOGLE_APPLICATION_CREDENTIALS (a service-account key file) when set,
// and the metadata server otherwise.
func FromEnvironment(scopes ...string) (TokenSource, error) {
	if f := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"); f != "" {
		b, err := os.ReadFile(f) // #nosec G304 G703 -- set by the operator
		if err != nil {
			return nil, fmt.Errorf("gcpauth: %w", err)
		}
		return ServiceAccountFromJSON(b, scopes...)
	}
	return &cached{src: &Metadata{Endpoint: "http://metadata.google.internal", Scopes: scopes}}, nil
}

// ServiceAccount signs a JWT with the account's key and exchanges it for an access token.
type ServiceAccount struct {
	Email    string
	KeyID    string
	Key      *rsa.PrivateKey
	TokenURI string
	Scopes   []string
	HTTP     *http.Client
	Now      func() time.Time
}

// ServiceAccountFromJSON reads a service-account key file as the Cloud console downloads it.
func ServiceAccountFromJSON(b []byte, scopes ...string) (TokenSource, error) {
	var f struct {
		Type         string `json:"type"`
		ClientEmail  string `json:"client_email"`
		PrivateKeyID string `json:"private_key_id"`
		PrivateKey   string `json:"private_key"`
		TokenURI     string `json:"token_uri"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, fmt.Errorf("gcpauth: key file: %w", err)
	}
	if f.Type != "service_account" || f.ClientEmail == "" {
		return nil, errors.New("gcpauth: not a service-account key file")
	}
	blk, _ := pem.Decode([]byte(f.PrivateKey))
	if blk == nil {
		return nil, errors.New("gcpauth: no private key in the key file")
	}
	k, err := x509.ParsePKCS8PrivateKey(blk.Bytes)
	if err != nil {
		return nil, fmt.Errorf("gcpauth: private key: %w", err)
	}
	rk, ok := k.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("gcpauth: the key is not RSA")
	}
	if f.TokenURI == "" {
		f.TokenURI = "https://oauth2.googleapis.com/token"
	}
	return &cached{src: &ServiceAccount{Email: f.ClientEmail, KeyID: f.PrivateKeyID, Key: rk, TokenURI: f.TokenURI, Scopes: scopes}}, nil
}

type token struct {
	value   string
	expires time.Time
}

func (s *ServiceAccount) fetch(ctx context.Context) (token, error) {
	now := time.Now
	if s.Now != nil {
		now = s.Now
	}
	t := now()
	enc := func(v any) string { b, _ := json.Marshal(v); return base64.RawURLEncoding.EncodeToString(b) }
	head := enc(map[string]string{"alg": "RS256", "typ": "JWT", "kid": s.KeyID})
	claims := enc(map[string]any{"iss": s.Email, "scope": strings.Join(s.Scopes, " "), "aud": s.TokenURI, "iat": t.Unix(), "exp": t.Add(time.Hour).Unix()})
	digest := sha256.Sum256([]byte(head + "." + claims))
	sig, err := rsa.SignPKCS1v15(rand.Reader, s.Key, crypto.SHA256, digest[:])
	if err != nil {
		return token{}, err
	}
	assertion := head + "." + claims + "." + base64.RawURLEncoding.EncodeToString(sig)
	form := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"}, "assertion": {assertion}}
	req, _ := http.NewRequestWithContext(ctx, "POST", s.TokenURI, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return exchange(s.HTTP, req, t)
}

// Metadata asks the metadata server for the attached service account's token.
type Metadata struct {
	Endpoint string
	Scopes   []string
	HTTP     *http.Client
}

func (m *Metadata) fetch(ctx context.Context) (token, error) {
	u := m.Endpoint + "/computeMetadata/v1/instance/service-accounts/default/token"
	if len(m.Scopes) > 0 {
		u += "?scopes=" + url.QueryEscape(strings.Join(m.Scopes, ","))
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("Metadata-Flavor", "Google")
	return exchange(m.HTTP, req, time.Now())
}

func exchange(hc *http.Client, req *http.Request, now time.Time) (token, error) {
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := hc.Do(req)
	if err != nil {
		return token{}, fmt.Errorf("gcpauth: %w", err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return token{}, fmt.Errorf("gcpauth: token endpoint: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(b, &out); err != nil || out.AccessToken == "" {
		return token{}, fmt.Errorf("gcpauth: token response: %v", err)
	}
	return token{value: out.AccessToken, expires: now.Add(time.Duration(out.ExpiresIn) * time.Second)}, nil
}

type fetcher interface {
	fetch(ctx context.Context) (token, error)
}

// cached reuses a token until a minute before it expires.
type cached struct {
	src fetcher
	mu  sync.Mutex
	cur token
}

func (c *cached) Token(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cur.value != "" && time.Now().Add(time.Minute).Before(c.cur.expires) {
		return c.cur.value, nil
	}
	t, err := c.src.fetch(ctx)
	if err != nil {
		return "", err
	}
	c.cur = t
	return t.value, nil
}

// Static is a fixed token (tests).
type Static string

// Token implements TokenSource.
func (s Static) Token(context.Context) (string, error) { return string(s), nil }
