package e2e

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/monolito123/Gooners/payments/platform/internal/api"
	"github.com/monolito123/Gooners/payments/platform/internal/testpki"
)

// Partner tokens (docs/02 §3.1): the client-credentials grant over mutual TLS, a token bound
// to the client's certificate (RFC 8705), its scopes, its expiry and revocation.
func TestOAuthClientCredentials(t *testing.T) {
	st := newStack(t)
	ctx := context.Background()
	ca, _ := testpki.NewCA("partner CA")
	serverLeaf, _ := ca.Server("api", "127.0.0.1")
	partner, _ := ca.Client("partner-erp")
	other, _ := ca.Client("someone-else")
	srv := httptest.NewUnstartedServer(st.handler)
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{serverLeaf.TLS}, ClientAuth: tls.RequestClientCert, MinVersion: tls.VersionTLS13}
	srv.StartTLS()
	defer srv.Close()
	clientFor := func(leaf *testpki.Leaf) *http.Client {
		cfg := &tls.Config{RootCAs: ca.Pool(), MinVersion: tls.VersionTLS13}
		if leaf != nil {
			cfg.Certificates = []tls.Certificate{leaf.TLS}
		}
		return &http.Client{Transport: recording(&http.Transport{TLSClientConfig: cfg})}
	}
	withCert, otherCert, noCert := clientFor(partner), clientFor(other), clientFor(nil)

	c, err := st.svc.RegisterOAuthClient(ctx, tenant, "ERP do parceiro", []string{"payments:read", "merchants:write"},
		[]string{api.Thumbprint(partner.TLS.Certificate[0])}, "ops:alice")
	if err != nil {
		t.Fatal(err)
	}
	ask := func(cl *http.Client, form url.Values) (int, map[string]any) {
		t.Helper()
		resp, err := cl.Post(srv.URL+"/oauth2/token", "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}
	grant := func(scope string) url.Values {
		v := url.Values{"grant_type": {"client_credentials"}, "client_id": {c.ID}}
		if scope != "" {
			v.Set("scope", scope)
		}
		return v
	}
	for name, tc := range map[string]struct {
		cl     *http.Client
		form   url.Values
		status int
		err    string
	}{
		"another grant":        {withCert, url.Values{"grant_type": {"password"}, "client_id": {c.ID}}, 400, "unsupported_grant_type"},
		"no certificate":       {noCert, grant(""), 401, "invalid_client"},
		"another certificate":  {otherCert, grant(""), 401, "invalid_client"},
		"an unknown client":    {withCert, url.Values{"grant_type": {"client_credentials"}, "client_id": {"cli_unknown"}}, 401, "invalid_client"},
		"a scope it may not":   {withCert, grant("payouts:write"), 400, "invalid_scope"},
		"compliance by name":   {withCert, grant("compliance:write"), 400, "invalid_scope"},
		"no client identifier": {withCert, url.Values{"grant_type": {"client_credentials"}}, 400, "invalid_request"},
	} {
		if status, out := ask(tc.cl, tc.form); status != tc.status || out["error"] != tc.err {
			t.Errorf("%s: %d %v, want %d %s", name, status, out, tc.status, tc.err)
		}
	}

	status, tok := ask(withCert, grant("payments:read"))
	if status != 200 || tok["token_type"] != "Bearer" || tok["expires_in"] != float64(300) || tok["scope"] != "payments:read" ||
		!strings.HasPrefix(tok["access_token"].(string), "at_") {
		t.Fatalf("token: %d %v", status, tok)
	}
	use := func(cl *http.Client, method, path, token string) (int, string) {
		t.Helper()
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader("{}"))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "0f8fad5b-d9cb-469f-a165-70867728950e")
		resp, err := cl.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	readOnly := tok["access_token"].(string)
	if s, b := use(withCert, "GET", "/v1/payment-intents?limit=1", readOnly); s != 200 {
		t.Fatalf("the token with its certificate: %d %s", s, b)
	}
	if s, b := use(otherCert, "GET", "/v1/payment-intents?limit=1", readOnly); s != 401 || !strings.Contains(b, "token_binding") {
		t.Errorf("the token with another certificate: %d %s", s, b)
	}
	if s, _ := use(noCert, "GET", "/v1/payment-intents?limit=1", readOnly); s != 401 {
		t.Errorf("the token without a certificate: %d", s)
	}
	if s, _ := use(withCert, "POST", "/v1/merchants", readOnly); s != 403 {
		t.Errorf("a payments:read token created a merchant: %d", s)
	}

	// Without scope, the token carries all the client's scopes.
	_, all := ask(withCert, grant(""))
	full := all["access_token"].(string)
	if all["scope"] != "payments:read merchants:write" {
		t.Fatalf("scopes %v", all["scope"])
	}
	if s, b := use(withCert, "GET", "/v1/merchants?limit=1", full); s != 200 {
		t.Fatalf("merchants with the full token: %d %s", s, b)
	}

	// Expired, then revoked: revocation ends live tokens at once.
	if _, err := st.pool.Exec(ctx, `UPDATE oauth_tokens SET expires_at = now() - interval '1 second' WHERE client_id = $1 AND scopes = '{payments:read}'`, c.ID); err != nil {
		t.Fatal(err)
	}
	if s, b := use(withCert, "GET", "/v1/payment-intents?limit=1", readOnly); s != 401 || !strings.Contains(b, "expired") {
		t.Errorf("an expired token: %d %s", s, b)
	}
	if err := st.svc.RevokeOAuthClient(ctx, tenant, c.ID, "partner rotated its certificate", "ops:alice"); err != nil {
		t.Fatal(err)
	}
	if s, _ := use(withCert, "GET", "/v1/merchants?limit=1", full); s != 401 {
		t.Errorf("a revoked client's token: %d", s)
	}
	if status, out := ask(withCert, grant("")); status != 401 || out["error"] != "invalid_client" {
		t.Errorf("a revoked client got a token: %d %v", status, out)
	}
	var audited int
	st.pool.QueryRow(ctx, `SELECT count(*) FROM ops_audit WHERE target = $1 AND action IN ('oauth_client.register', 'oauth_client.revoke')`, c.ID).Scan(&audited)
	if audited != 2 {
		t.Errorf("audit rows %d", audited)
	}
}
