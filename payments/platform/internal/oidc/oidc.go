// Package oidc identifies the platform's operators by their company's identity provider
// (OpenID Connect): it verifies ID tokens against the provider's published keys (discovery and
// JWKS), applies the operator policy (a verified e-mail in the company's domains, optionally a
// group), and gets a token for the command line with the device authorization grant (RFC 8628),
// which every major provider offers (Google Workspace, Microsoft Entra ID, Okta, Keycloak).
// Every operator command that changes money or access then records who ran it as the
// provider says, not as typed (integration/operations-runbook.md).
package oidc

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
)

// Skew is the clock difference tolerated on a token's times.
const Skew = time.Minute

// The device grant's polling: at least every five seconds, five more after each slow_down
// (RFC 8628 §3.5). Tests shorten them.
var minInterval, slowDownStep = 5 * time.Second, 5 * time.Second

// Metadata is the part of a provider's discovery document the platform uses.
type Metadata struct {
	Issuer                      string `json:"issuer"`
	JWKSURI                     string `json:"jwks_uri"`
	TokenEndpoint               string `json:"token_endpoint"`
	DeviceAuthorizationEndpoint string `json:"device_authorization_endpoint"`
}

// Provider is an OpenID Connect provider, identified by its issuer URL.
type Provider struct {
	Issuer string
	HTTP   *http.Client

	mu      sync.Mutex
	meta    *Metadata
	keys    map[string]crypto.PublicKey
	fetched time.Time
}

func (p *Provider) client() *http.Client {
	if p.HTTP != nil {
		return p.HTTP
	}
	return &http.Client{Timeout: 15 * time.Second}
}

func (p *Provider) getJSON(ctx context.Context, u string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	resp, err := p.client().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("oidc: %s answered HTTP %d", u, resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}

// Discover reads the provider's discovery document; its issuer must be the one configured.
func (p *Provider) Discover(ctx context.Context) (*Metadata, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.discover(ctx)
}

func (p *Provider) discover(ctx context.Context) (*Metadata, error) {
	if p.meta != nil {
		return p.meta, nil
	}
	if !strings.HasPrefix(p.Issuer, "https://") && !strings.HasPrefix(p.Issuer, "http://127.0.0.1") {
		return nil, errors.New("oidc: the issuer must be an https URL")
	}
	var m Metadata
	if err := p.getJSON(ctx, strings.TrimSuffix(p.Issuer, "/")+"/.well-known/openid-configuration", &m); err != nil {
		return nil, err
	}
	if m.Issuer != p.Issuer || m.JWKSURI == "" {
		return nil, fmt.Errorf("oidc: the discovery document names issuer %q, not %q", m.Issuer, p.Issuer)
	}
	p.meta = &m
	return p.meta, nil
}

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

func (k jwk) publicKey() (crypto.PublicKey, error) {
	b := base64.RawURLEncoding
	switch k.Kty {
	case "RSA":
		n, err1 := b.DecodeString(k.N)
		e, err2 := b.DecodeString(k.E)
		if err1 != nil || err2 != nil || len(e) > 4 || len(n) < 256 {
			return nil, errors.New("oidc: a malformed or short RSA key")
		}
		return &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}, nil
	case "EC":
		x, err1 := b.DecodeString(k.X)
		y, err2 := b.DecodeString(k.Y)
		if err1 != nil || err2 != nil || k.Crv != "P-256" || len(x) != 32 || len(y) != 32 {
			return nil, errors.New("oidc: only P-256 EC keys are accepted")
		}
		return ecdsa.ParseUncompressedPublicKey(elliptic.P256(), append(append([]byte{4}, x...), y...))
	}
	return nil, fmt.Errorf("oidc: key type %q", k.Kty)
}

// key returns the provider's key kid, fetching the JWKS when the key is unknown (a provider
// rotates its keys), at most once a minute.
func (p *Provider) key(ctx context.Context, kid string, now time.Time) (crypto.PublicKey, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if k, ok := p.keys[kid]; ok {
		return k, nil
	}
	if p.keys != nil && now.Sub(p.fetched) < time.Minute {
		return nil, fmt.Errorf("oidc: unknown signing key %q", kid)
	}
	m, err := p.discover(ctx)
	if err != nil {
		return nil, err
	}
	var set struct {
		Keys []jwk `json:"keys"`
	}
	if err := p.getJSON(ctx, m.JWKSURI, &set); err != nil {
		return nil, err
	}
	p.keys, p.fetched = map[string]crypto.PublicKey{}, now
	for _, k := range set.Keys {
		if k.Use != "" && k.Use != "sig" {
			continue
		}
		if pk, err := k.publicKey(); err == nil {
			p.keys[k.Kid] = pk
		}
	}
	if k, ok := p.keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("oidc: unknown signing key %q", kid)
}

// Claims are an ID token's claims the platform reads.
type Claims struct {
	Issuer        string   `json:"iss"`
	Subject       string   `json:"sub"`
	Audience      audience `json:"aud"`
	Expiry        int64    `json:"exp"`
	NotBefore     int64    `json:"nbf"`
	IssuedAt      int64    `json:"iat"`
	Email         string   `json:"email"`
	EmailVerified any      `json:"email_verified"` // a boolean, or "true" from some providers
	Name          string   `json:"name"`
	Groups        []string `json:"groups"`
}

type audience []string

func (a *audience) UnmarshalJSON(b []byte) error {
	var one string
	if json.Unmarshal(b, &one) == nil {
		*a = []string{one}
		return nil
	}
	var many []string
	if err := json.Unmarshal(b, &many); err != nil {
		return err
	}
	*a = many
	return nil
}

// Verify checks an ID token: signed by one of the provider's keys with RS256 or ES256, issued
// by the provider for clientID, and valid now.
func (p *Provider) Verify(ctx context.Context, raw, clientID string, now time.Time) (*Claims, error) {
	parts := strings.Split(strings.TrimSpace(raw), ".")
	if len(parts) != 3 {
		return nil, errors.New("oidc: not a signed JWT")
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	hb, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(hb, &header) != nil {
		return nil, errors.New("oidc: a malformed token header")
	}
	if header.Alg != "RS256" && header.Alg != "ES256" {
		return nil, fmt.Errorf("oidc: algorithm %q is not accepted (RS256 or ES256)", header.Alg)
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, errors.New("oidc: a malformed signature")
	}
	key, err := p.key(ctx, header.Kid, now)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	switch k := key.(type) {
	case *rsa.PublicKey:
		if header.Alg != "RS256" || rsa.VerifyPKCS1v15(k, crypto.SHA256, digest[:], sig) != nil {
			return nil, errors.New("oidc: the signature does not verify")
		}
	case *ecdsa.PublicKey:
		if header.Alg != "ES256" || len(sig) != 64 ||
			!ecdsa.Verify(k, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
			return nil, errors.New("oidc: the signature does not verify")
		}
	default:
		return nil, errors.New("oidc: unsupported key")
	}
	pb, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("oidc: a malformed payload")
	}
	var c Claims
	if err := json.Unmarshal(pb, &c); err != nil {
		return nil, errors.New("oidc: a malformed payload")
	}
	switch {
	case c.Issuer != p.Issuer:
		return nil, fmt.Errorf("oidc: issued by %q, not %q", c.Issuer, p.Issuer)
	case !slices.Contains(c.Audience, clientID):
		return nil, errors.New("oidc: the token was issued to another client")
	case c.Expiry == 0 || now.After(time.Unix(c.Expiry, 0).Add(Skew)):
		return nil, errors.New("oidc: the token expired: log in again (platform login)")
	case c.NotBefore != 0 && now.Add(Skew).Before(time.Unix(c.NotBefore, 0)):
		return nil, errors.New("oidc: the token is not valid yet")
	case c.IssuedAt != 0 && now.Add(Skew).Before(time.Unix(c.IssuedAt, 0)):
		return nil, errors.New("oidc: the token was issued in the future")
	}
	return &c, nil
}

// Policy is who may operate the platform.
type Policy struct {
	ClientID string
	// Domains are the e-mail domains operators belong to (goonerspay.com.br); empty takes any
	// verified e-mail the provider vouches for.
	Domains []string
	// Group, when set, must be among the token's groups claim.
	Group string
}

// Operator is a verified operator.
type Operator struct {
	Email, Subject, Issuer string
}

// Authorize applies the policy to verified claims.
func (pol Policy) Authorize(c *Claims) (*Operator, error) {
	verified := c.EmailVerified == true || c.EmailVerified == "true"
	if c.Email == "" || !verified {
		return nil, errors.New("oidc: the token carries no verified e-mail (ask for the email scope)")
	}
	if len(pol.Domains) > 0 {
		_, domain, _ := strings.Cut(c.Email, "@")
		if !slices.Contains(pol.Domains, strings.ToLower(domain)) {
			return nil, fmt.Errorf("oidc: %s is not in the operators' domains", c.Email)
		}
	}
	if pol.Group != "" && !slices.Contains(c.Groups, pol.Group) {
		return nil, fmt.Errorf("oidc: %s is not in the group %s", c.Email, pol.Group)
	}
	return &Operator{Email: strings.ToLower(c.Email), Subject: c.Subject, Issuer: c.Issuer}, nil
}

// DeviceLogin gets an ID token with the device authorization grant (RFC 8628): show tells the
// operator where to go and which code to enter; it then waits for the provider's answer.
// clientSecret is for providers that require one even for this grant (Google); empty otherwise.
func (p *Provider) DeviceLogin(ctx context.Context, clientID, clientSecret string, show func(uri, code, complete string)) (string, error) {
	m, err := p.Discover(ctx)
	if err != nil {
		return "", err
	}
	if m.DeviceAuthorizationEndpoint == "" {
		return "", errors.New("oidc: the provider offers no device authorization endpoint")
	}
	form := url.Values{"client_id": {clientID}, "scope": {"openid email profile"}}
	if clientSecret != "" {
		form.Set("client_secret", clientSecret)
	}
	var auth struct {
		DeviceCode string `json:"device_code"`
		UserCode   string `json:"user_code"`
		URI        string `json:"verification_uri"`
		URL        string `json:"verification_url"` // Google's name for it
		Complete   string `json:"verification_uri_complete"`
		ExpiresIn  int    `json:"expires_in"`
		Interval   int    `json:"interval"`
	}
	if status, err := p.postForm(ctx, m.DeviceAuthorizationEndpoint, form, &auth); err != nil || status != http.StatusOK {
		return "", fmt.Errorf("oidc: device authorization: HTTP %d %v", status, err)
	}
	if auth.URI == "" {
		auth.URI = auth.URL
	}
	show(auth.URI, auth.UserCode, auth.Complete)
	interval := max(time.Duration(auth.Interval)*time.Second, minInterval)
	deadline := time.Now().Add(time.Duration(max(auth.ExpiresIn, 60)) * time.Second)
	poll := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:device_code"}, "device_code": {auth.DeviceCode}, "client_id": {clientID}}
	if clientSecret != "" {
		poll.Set("client_secret", clientSecret)
	}
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(interval):
		}
		var tok struct {
			IDToken string `json:"id_token"`
			Error   string `json:"error"`
		}
		status, err := p.postForm(ctx, m.TokenEndpoint, poll, &tok)
		if err != nil {
			return "", err
		}
		switch {
		case status == http.StatusOK && tok.IDToken != "":
			return tok.IDToken, nil
		case tok.Error == "authorization_pending":
		case tok.Error == "slow_down":
			interval += slowDownStep
		case tok.Error != "":
			return "", fmt.Errorf("oidc: the login was not completed: %s", tok.Error)
		default:
			return "", fmt.Errorf("oidc: the token endpoint answered HTTP %d without an ID token", status)
		}
	}
	return "", errors.New("oidc: the code expired before the login was completed")
}

func (p *Provider) postForm(ctx context.Context, u string, form url.Values, out any) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(form.Encode()))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := p.client().Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}
