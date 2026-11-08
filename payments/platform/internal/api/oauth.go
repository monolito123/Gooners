package api

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// Partner tokens (docs/02 §3.1): the OAuth 2.0 client-credentials grant (RFC 6749 §4.4) with
// mutual-TLS client authentication and certificate-bound access tokens (RFC 8705). A client
// registered with its certificate's thumbprint asks POST /oauth2/token for a token over a TLS
// connection that presents that certificate; the token is valid for five minutes, only for
// the scopes granted, and only on connections presenting the same certificate. Tokens are
// opaque and stored hashed: nothing signs them, so no key needs guarding, and revoking a
// client ends its tokens at once.

// AccessTokenTTL is how long an access token works.
const AccessTokenTTL = 5 * time.Minute

// Thumbprint is RFC 8705's x5t#S256: the base64url SHA-256 of a certificate's DER.
func Thumbprint(der []byte) string {
	sum := sha256.Sum256(der)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// clientCertificate is the certificate the client presented: on the TLS connection, or, behind
// a trusted TLS-terminating proxy, in the header the proxy sets (URL-encoded PEM, as nginx's
// $ssl_client_escaped_cert and AWS's load balancers pass it).
func (s *Server) clientCertificate(r *http.Request) *x509.Certificate {
	if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
		return r.TLS.PeerCertificates[0]
	}
	if !s.cfg.TrustProxy || s.cfg.ClientCertHeader == "" {
		return nil
	}
	raw, err := url.QueryUnescape(r.Header.Get(s.cfg.ClientCertHeader))
	if err != nil {
		return nil
	}
	blk, _ := pem.Decode([]byte(raw))
	if blk == nil {
		return nil
	}
	c, err := x509.ParseCertificate(blk.Bytes)
	if err != nil {
		return nil
	}
	return c
}

func oauthError(w http.ResponseWriter, status int, code, description string) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]string{"error": code, "error_description": description})
}

// token serves POST /oauth2/token.
func (s *Server) token(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/x-www-form-urlencoded") || r.ParseForm() != nil {
		oauthError(w, http.StatusBadRequest, "invalid_request", "send the parameters as application/x-www-form-urlencoded")
		return
	}
	if g := r.PostForm.Get("grant_type"); g != "client_credentials" {
		oauthError(w, http.StatusBadRequest, "unsupported_grant_type", "only client_credentials is supported")
		return
	}
	clientID := r.PostForm.Get("client_id")
	if clientID == "" {
		oauthError(w, http.StatusBadRequest, "invalid_request", "client_id is required")
		return
	}
	invalidClient := func(description string) {
		if ok, wait := s.failures.take(clientIP(r, s.cfg.TrustProxy)); !ok {
			w.Header().Set("Retry-After", retryAfter(wait))
			problem(w, r, http.StatusTooManyRequests, "rate-limited", "Too many failed authentications", "")
			return
		}
		oauthError(w, http.StatusUnauthorized, "invalid_client", description)
	}
	cert := s.clientCertificate(r)
	if cert == nil {
		invalidClient("authenticate with the client's TLS certificate (RFC 8705)")
		return
	}
	var tenant string
	var scopes, thumbprints []string
	err := s.pool.QueryRow(r.Context(), `SELECT tenant_id::text, scopes, cert_thumbprints FROM oauth_clients WHERE id = $1 AND revoked_at IS NULL`, clientID).
		Scan(&tenant, &scopes, &thumbprints)
	tp := Thumbprint(cert.Raw)
	if err != nil || !slices.Contains(thumbprints, tp) {
		invalidClient("unknown client, or not this client's certificate")
		return
	}
	granted := scopes
	if want := strings.Fields(r.PostForm.Get("scope")); len(want) > 0 {
		for _, sc := range want {
			if !slices.Contains(scopes, sc) && !(slices.Contains(scopes, "*") && !explicitOnly[sc]) {
				oauthError(w, http.StatusBadRequest, "invalid_scope", "the client may not have "+sc)
				return
			}
		}
		granted = want
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		s.fail(w, r, err)
		return
	}
	token := "at_" + base64.RawURLEncoding.EncodeToString(b)
	ctx := r.Context()
	if _, err := s.pool.Exec(ctx, `INSERT INTO oauth_tokens (token_hash, client_id, tenant_id, scopes, cert_thumbprint, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		hashKey(token), clientID, tenant, granted, tp, time.Now().Add(AccessTokenTTL)); err != nil {
		s.fail(w, r, err)
		return
	}
	_, _ = s.pool.Exec(ctx, `DELETE FROM oauth_tokens WHERE client_id = $1 AND expires_at < now() - interval '1 hour'`, clientID)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"access_token": token, "token_type": "Bearer", "expires_in": int(AccessTokenTTL.Seconds()), "scope": strings.Join(granted, " ")})
}

var errTokenBinding = errors.New("the token is bound to another certificate (RFC 8705): present the certificate it was issued to")

// tokenPrincipal authenticates an access token: known, unexpired, its client not revoked, and
// presented with the certificate it is bound to.
func (s *Server) tokenPrincipal(r *http.Request, token string) (principal, string, error) {
	var tenant, clientID, bound string
	var scopes []string
	var expired, revoked bool
	err := s.pool.QueryRow(r.Context(), `SELECT t.tenant_id::text, t.client_id, t.scopes, t.cert_thumbprint, t.expires_at <= now(), c.revoked_at IS NOT NULL
		FROM oauth_tokens t JOIN oauth_clients c ON c.id = t.client_id WHERE t.token_hash = $1`, hashKey(token)).
		Scan(&tenant, &clientID, &scopes, &bound, &expired, &revoked)
	switch {
	case err != nil || revoked:
		return principal{}, "invalid-token", errors.New("unknown or revoked access token")
	case expired:
		return principal{}, "invalid-token", errors.New("the access token expired: ask POST /oauth2/token for another")
	}
	cert := s.clientCertificate(r)
	if cert == nil || Thumbprint(cert.Raw) != bound {
		return principal{}, "token-binding", errTokenBinding
	}
	p := principal{tenantID: tenant, scopes: map[string]bool{}, keyID: clientID}
	for _, sc := range scopes {
		p.scopes[sc] = true
	}
	return p, "", nil
}
