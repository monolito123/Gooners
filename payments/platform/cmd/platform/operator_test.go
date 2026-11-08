package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/oidc/oidctest"
)

// Operator commands record who ran them as the identity provider says: the logged-in token
// decides, -actor may only repeat it, and production refuses to run without SSO.
func TestOperatorIdentity(t *testing.T) {
	ctx := context.Background()
	idp := oidctest.New()
	defer idp.Close()
	tokenFile := filepath.Join(t.TempDir(), "operator-token")
	t.Setenv("OPERATOR_TOKEN_FILE", tokenFile)
	t.Setenv("OPERATOR_ID_TOKEN", "")

	// Without SSO: -actor as typed in the sandbox; refused in production.
	t.Setenv("PLATFORM_ENV", "sandbox")
	t.Setenv("OPERATOR_OIDC_ISSUER", "")
	if who, err := operatorIdentity(ctx, "ana@goonerspay.example"); err != nil || who != "ana@goonerspay.example" {
		t.Fatalf("%q %v", who, err)
	}
	if _, err := operatorIdentity(ctx, ""); err == nil {
		t.Fatal("no actor accepted")
	}
	t.Setenv("PLATFORM_ENV", "production")
	if _, err := operatorIdentity(ctx, "ana@goonerspay.example"); err == nil || !strings.Contains(err.Error(), "OPERATOR_OIDC_ISSUER") {
		t.Fatalf("production without SSO: %v", err)
	}

	// With SSO.
	t.Setenv("OPERATOR_OIDC_ISSUER", idp.URL)
	t.Setenv("OPERATOR_OIDC_CLIENT_ID", "operators-cli")
	t.Setenv("OPERATOR_OIDC_DOMAINS", "goonerspay.com.br")
	if _, err := operatorIdentity(ctx, ""); err == nil || !strings.Contains(err.Error(), "platform login") {
		t.Fatalf("not logged in: %v", err)
	}
	_ = os.WriteFile(tokenFile, []byte(idp.Token("operators-cli", "Ana@GoonersPay.com.br", nil)), 0o600)
	if who, err := operatorIdentity(ctx, ""); err != nil || who != "ana@goonerspay.com.br" {
		t.Fatalf("logged in: %q %v", who, err)
	}
	if who, err := operatorIdentity(ctx, "ana@goonerspay.com.br"); err != nil || who != "ana@goonerspay.com.br" {
		t.Fatalf("-actor repeating the login: %q %v", who, err)
	}
	if _, err := operatorIdentity(ctx, "boss@goonerspay.com.br"); err == nil || !strings.Contains(err.Error(), "says you are") {
		t.Fatalf("-actor naming someone else: %v", err)
	}
	for name, tok := range map[string]string{
		"another domain": idp.Token("operators-cli", "ana@gmail.com", nil),
		"another client": idp.Token("someone-else", "ana@goonerspay.com.br", nil),
		"expired":        idp.Token("operators-cli", "ana@goonerspay.com.br", map[string]any{"exp": time.Now().Add(-time.Hour).Unix()}),
		"garbage":        "not.a.token",
	} {
		_ = os.WriteFile(tokenFile, []byte(tok), 0o600)
		if _, err := operatorIdentity(ctx, ""); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	// A workload identity in automation takes precedence over the file.
	t.Setenv("OPERATOR_ID_TOKEN", idp.Token("operators-cli", "recon-bot@goonerspay.com.br", nil))
	if who, err := operatorIdentity(ctx, ""); err != nil || who != "recon-bot@goonerspay.com.br" {
		t.Fatalf("OPERATOR_ID_TOKEN: %q %v", who, err)
	}
	// Production with SSO but no limit on who may operate.
	t.Setenv("OPERATOR_OIDC_DOMAINS", "")
	if _, err := operatorIdentity(ctx, ""); err == nil || !strings.Contains(err.Error(), "OPERATOR_OIDC_DOMAINS") {
		t.Fatalf("production without domains or group: %v", err)
	}
}
