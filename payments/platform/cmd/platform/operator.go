package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/config"
	"github.com/monolito123/Gooners/payments/platform/internal/oidc"
)

// Operator identity (runbook §6, integration point 24). With OPERATOR_OIDC_ISSUER set, every
// operator command takes who ran it from an ID token the company's identity provider signed:
// the one platform login stored, or OPERATOR_ID_TOKEN (a workload identity in automation).
// -actor, if given, must name the same person. Production refuses to run a command that
// changes money or access without it; outside production, -actor alone is accepted.

// operatorTokenFile is where platform login keeps the ID token.
func operatorTokenFile() (string, error) {
	if f := os.Getenv("OPERATOR_TOKEN_FILE"); f != "" {
		return f, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "goonerspay", "operator-token"), nil
}

// operatorIdentity is the identity an operator command records: the verified e-mail when SSO
// is configured, else (outside production) what -actor says.
func operatorIdentity(ctx context.Context, typed string) (string, error) {
	sso := config.ReadOperatorSSO()
	if sso.Issuer == "" {
		if sso.Production {
			return "", errors.New("production identifies operators through the identity provider: set OPERATOR_OIDC_ISSUER, OPERATOR_OIDC_CLIENT_ID and OPERATOR_OIDC_DOMAINS, then run platform login")
		}
		if typed == "" {
			return "", errors.New("-actor is required (or configure OPERATOR_OIDC_ISSUER and run platform login)")
		}
		return typed, nil
	}
	op, err := verifiedOperator(ctx, sso)
	if err != nil {
		return "", err
	}
	if typed != "" && !strings.EqualFold(typed, op.Email) {
		return "", fmt.Errorf("-actor says %s, but the identity provider says you are %s", typed, op.Email)
	}
	return op.Email, nil
}

func verifiedOperator(ctx context.Context, sso config.OperatorSSO) (*oidc.Operator, error) {
	if sso.Production && len(sso.Domains) == 0 && sso.Group == "" {
		return nil, errors.New("OPERATOR_OIDC_DOMAINS or OPERATOR_OIDC_GROUP must limit who operates production: any account the provider knows would do otherwise")
	}
	raw := os.Getenv("OPERATOR_ID_TOKEN")
	if raw == "" {
		file, err := operatorTokenFile()
		if err != nil {
			return nil, err
		}
		b, err := os.ReadFile(file) // #nosec G304 -- the operator's own token file
		if err != nil {
			return nil, errors.New("not logged in: run platform login")
		}
		raw = string(b)
	}
	c, err := (&oidc.Provider{Issuer: sso.Issuer}).Verify(ctx, raw, sso.ClientID, time.Now())
	if err != nil {
		return nil, err
	}
	return oidc.Policy{ClientID: sso.ClientID, Domains: sso.Domains, Group: sso.Group}.Authorize(c)
}

// login gets an ID token from the identity provider with the device grant, checks that it
// identifies an operator, and keeps it for the next commands (until it expires, usually an
// hour).
func login(ctx context.Context, _ []string) error {
	sso := config.ReadOperatorSSO()
	if sso.Issuer == "" || sso.ClientID == "" {
		return errors.New("set OPERATOR_OIDC_ISSUER and OPERATOR_OIDC_CLIENT_ID (the identity provider and the operators' client)")
	}
	prov := &oidc.Provider{Issuer: sso.Issuer}
	raw, err := prov.DeviceLogin(ctx, sso.ClientID, sso.ClientSecret, func(uri, code, complete string) {
		fmt.Fprintf(os.Stderr, "Open %s and enter the code %s", uri, code)
		if complete != "" {
			fmt.Fprintf(os.Stderr, " (or open %s)", complete)
		}
		fmt.Fprintln(os.Stderr)
	})
	if err != nil {
		return err
	}
	c, err := prov.Verify(ctx, raw, sso.ClientID, time.Now())
	if err != nil {
		return err
	}
	op, err := oidc.Policy{ClientID: sso.ClientID, Domains: sso.Domains, Group: sso.Group}.Authorize(c)
	if err != nil {
		return err
	}
	file, err := operatorTokenFile()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(file, []byte(raw), 0o600); err != nil {
		return err
	}
	fmt.Printf("logged in as %s until %s\n", op.Email, time.Unix(c.Expiry, 0).Format(time.RFC3339))
	return nil
}

// whoami prints the identity the operator commands will record.
func whoami(ctx context.Context, _ []string) error {
	who, err := operatorIdentity(ctx, os.Getenv("OPERATOR_ACTOR"))
	if err != nil {
		return err
	}
	fmt.Println(who)
	return nil
}
