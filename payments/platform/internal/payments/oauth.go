package payments

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
)

// OAuthClient is a partner's client for POST /oauth2/token (docs/02 §3.1). It authenticates
// with a TLS client certificate whose SHA-256 thumbprint (x5t#S256) is registered, and its
// access tokens are bound to that certificate (RFC 8705).
type OAuthClient struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Scopes      []string `json:"scopes"`
	Thumbprints []string `json:"cert_thumbprints"`
	CreatedAt   string   `json:"created_at"`
	Revoked     bool     `json:"revoked"`
}

var thumbprintRE = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

// RegisterOAuthClient registers a client for the certificates' thumbprints. Recorded in the
// audit trail.
func (s *Service) RegisterOAuthClient(ctx context.Context, tenantID, name string, scopes, thumbprints []string, actor string) (*OAuthClient, error) {
	switch {
	case name == "":
		return nil, invalid("a client needs a name")
	case len(scopes) == 0:
		return nil, invalid("a client needs its scopes")
	case len(thumbprints) == 0:
		return nil, invalid("a client needs the thumbprint of at least one certificate")
	}
	for _, t := range thumbprints {
		if !thumbprintRE.MatchString(t) {
			return nil, invalid("a certificate thumbprint is the base64url SHA-256 of its DER (43 characters)")
		}
	}
	c := &OAuthClient{ID: ids.New("cli"), Name: name, Scopes: scopes, Thumbprints: thumbprints, CreatedAt: s.cfg.Now().UTC().Format(time.RFC3339)}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO oauth_clients (id, tenant_id, name, scopes, cert_thumbprints) VALUES ($1, $2, $3, $4, $5)`,
			c.ID, tenantID, name, scopes, thumbprints); err != nil {
			return err
		}
		return audit(ctx, tx, tenantID, actor, "oauth_client.register", c.ID, map[string]any{"name": name, "scopes": scopes, "cert_thumbprints": thumbprints})
	})
	if err != nil {
		return nil, err
	}
	return c, nil
}

// RevokeOAuthClient stops a client and its live tokens at once. Recorded in the audit trail.
func (s *Service) RevokeOAuthClient(ctx context.Context, tenantID, id, reason, actor string) error {
	if reason == "" {
		return invalid("a reason is required")
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE oauth_clients SET revoked_at = now(), revoked_reason = $3 WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`, tenantID, id, reason)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: no active client %s", ErrNotFound, id)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM oauth_tokens WHERE client_id = $1`, id); err != nil {
			return err
		}
		return audit(ctx, tx, tenantID, actor, "oauth_client.revoke", id, map[string]string{"reason": reason})
	})
}

// ListOAuthClients lists a tenant's clients, newest first.
func (s *Service) ListOAuthClients(ctx context.Context, tenantID string) ([]OAuthClient, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, scopes, cert_thumbprints, created_at, revoked_at IS NOT NULL FROM oauth_clients WHERE tenant_id = $1 ORDER BY created_at DESC`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OAuthClient{}
	for rows.Next() {
		var c OAuthClient
		var at time.Time
		if err := rows.Scan(&c.ID, &c.Name, &c.Scopes, &c.Thumbprints, &at, &c.Revoked); err != nil {
			return nil, err
		}
		c.CreatedAt = at.UTC().Format(time.RFC3339)
		out = append(out, c)
	}
	return out, rows.Err()
}
