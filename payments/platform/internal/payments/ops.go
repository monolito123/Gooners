package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
)

// Merchant statuses. Only active merchants take new payments or receive payouts. A
// restricted merchant keeps its balance (refunds and disputes still debit it) until
// risk lifts the restriction or the merchant is closed.
const (
	MerchantKYBInReview = "kyb_in_review"
	MerchantActive      = "active"
	MerchantRestricted  = "restricted"
	MerchantClosed      = "closed"
)

var merchantTransitions = map[string][]string{
	MerchantKYBInReview: {MerchantActive, MerchantClosed},
	MerchantActive:      {MerchantRestricted, MerchantClosed},
	MerchantRestricted:  {MerchantActive, MerchantClosed},
}

// ErrMerchantInactive is returned when a merchant's status forbids the operation.
var ErrMerchantInactive = errors.New("merchant not active")

func requireActive(m *Merchant) error {
	if m.Status != MerchantActive {
		return fmt.Errorf("%w: merchant %s is %s", ErrMerchantInactive, m.ID, m.Status)
	}
	return nil
}

// audit records an access-changing action. Operators are identified by their SSO subject;
// partners by the API key that made the call.
func audit(ctx context.Context, tx pgx.Tx, tenantID, actor, action, target string, detail any) error {
	if actor == "" {
		return invalid("an actor is required for %s", action)
	}
	d, _ := json.Marshal(detail)
	_, err := tx.Exec(ctx, `INSERT INTO ops_audit (tenant_id, actor, action, target, detail) VALUES ($1, $2, $3, $4, $5)`, tenantID, actor, action, target, d)
	return err
}

// SetMerchantStatus moves a merchant through its lifecycle: KYB approval or rejection,
// restriction by risk, reactivation and closure. Closing needs a zero wallet and reserve
// and no receivables still to settle; it revokes the merchant's terminals.
func (s *Service) SetMerchantStatus(ctx context.Context, tenantID, merchantID, to, reason, actor string) (*Merchant, error) {
	if reason == "" {
		return nil, invalid("a reason is required")
	}
	m, err := s.GetMerchant(ctx, tenantID, merchantID)
	if err != nil {
		return nil, err
	}
	if !slices.Contains(merchantTransitions[m.Status], to) {
		return nil, fmt.Errorf("%w: a %s merchant cannot become %s", ErrConflict, m.Status, to)
	}
	if to == MerchantClosed {
		for _, acc := range []string{ledger.MerchantWallet(m.ID), ledger.MerchantReserve(m.ID), ledger.MerchantPayable(m.ID)} {
			b, err := s.ledger.Balance(ctx, tenantID, acc)
			if err != nil {
				return nil, err
			}
			if b != 0 {
				return nil, fmt.Errorf("%w: %s holds %d; pay it out or settle it before closing", ErrConflict, acc, b)
			}
		}
	}
	from := m.Status
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE merchants SET status = $3, status_reason = $4 WHERE tenant_id = $1 AND id = $2 AND status = $5`, tenantID, m.ID, to, reason, from)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: merchant status changed concurrently", ErrConflict)
		}
		if to == MerchantClosed {
			if _, err := tx.Exec(ctx, `UPDATE terminals SET status = 'revoked', revoked_at = now(), revoked_reason = 'merchant closed' WHERE tenant_id = $1 AND merchant_id = $2 AND status = 'active'`, tenantID, m.ID); err != nil {
				return err
			}
		}
		if err := audit(ctx, tx, tenantID, actor, "merchant.status", m.ID, map[string]string{"from": from, "to": to, "reason": reason}); err != nil {
			return err
		}
		typ := "merchant.status_changed"
		switch {
		case from == MerchantKYBInReview && to == MerchantActive:
			typ = "merchant.kyb.approved"
		case from == MerchantKYBInReview && to == MerchantClosed:
			typ = "merchant.kyb.rejected"
		}
		return webhooks.Enqueue(ctx, tx, tenantID, typ, map[string]any{"id": m.ID, "object": "merchant", "status": to, "previous_status": from})
	})
	if err != nil {
		return nil, err
	}
	return s.GetMerchant(ctx, tenantID, m.ID)
}

// RevokeTerminal stops a terminal for good (lost, stolen or decommissioned device). Its
// certificate no longer authenticates and its terminal ID takes no authorizations.
func (s *Service) RevokeTerminal(ctx context.Context, tenantID, terminalID, reason, actor string) (*Terminal, error) {
	if reason == "" {
		return nil, invalid("a reason is required")
	}
	t := &Terminal{Object: "terminal"}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `UPDATE terminals SET status = 'revoked', revoked_at = now(), revoked_reason = $3 WHERE tenant_id = $1 AND id = $2 AND status = 'active'
			RETURNING id, merchant_id, type, status`, tenantID, terminalID, reason).Scan(&t.ID, &t.MerchantID, &t.Type, &t.Status)
		if errors.Is(err, pgx.ErrNoRows) {
			var status string
			if err := tx.QueryRow(ctx, `SELECT status FROM terminals WHERE tenant_id = $1 AND id = $2`, tenantID, terminalID).Scan(&status); err != nil {
				return ErrNotFound
			}
			return fmt.Errorf("%w: terminal is already %s", ErrConflict, status)
		}
		if err != nil {
			return err
		}
		if err := audit(ctx, tx, tenantID, actor, "terminal.revoke", t.ID, map[string]string{"reason": reason}); err != nil {
			return err
		}
		return webhooks.Enqueue(ctx, tx, tenantID, "terminal.revoked", map[string]any{"terminal_id": t.ID, "merchant_id": t.MerchantID, "reason": reason})
	})
	if err != nil {
		return nil, err
	}
	return t, nil
}

// APIKey describes an API key without revealing it. The ID is derived from the key's hash.
type APIKey struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Scopes    []string  `json:"scopes"`
	CreatedAt time.Time `json:"created_at"`
	Revoked   bool      `json:"revoked"`
}

// APIKeyID is the public identifier of a key: "ak_" and the first 16 hex digits of its hash.
func APIKeyID(keyHash string) string { return "ak_" + keyHash[:16] }

// ListAPIKeys lists a tenant's API keys.
func (s *Service) ListAPIKeys(ctx context.Context, tenantID string) ([]APIKey, error) {
	rows, err := s.pool.Query(ctx, `SELECT key_hash, name, scopes, created_at, revoked_at IS NOT NULL FROM api_clients WHERE tenant_id = $1 ORDER BY created_at`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []APIKey
	for rows.Next() {
		var k APIKey
		var hash string
		if err := rows.Scan(&hash, &k.Name, &k.Scopes, &k.CreatedAt, &k.Revoked); err != nil {
			return nil, err
		}
		k.ID = APIKeyID(hash)
		out = append(out, k)
	}
	return out, rows.Err()
}

// RevokeAPIKey revokes a key by its ID. Requests with it fail from the next call.
func (s *Service) RevokeAPIKey(ctx context.Context, tenantID, keyID, reason, actor string) error {
	if len(keyID) != 19 || keyID[:3] != "ak_" {
		return invalid("key IDs look like ak_ followed by 16 hex digits")
	}
	if reason == "" {
		return invalid("a reason is required")
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE api_clients SET revoked_at = now(), revoked_reason = $3 WHERE tenant_id = $1 AND left(key_hash, 16) = $2 AND revoked_at IS NULL`, tenantID, keyID[3:], reason)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: no active key %s", ErrNotFound, keyID)
		}
		return audit(ctx, tx, tenantID, actor, "api_key.revoke", keyID, map[string]string{"reason": reason})
	})
}
