package payments

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// What an integrator needs to see its side without keeping its own copy (docs/02): payments,
// merchants and webhook endpoints, listed newest first with cursor pagination.

// IntentFilter narrows GET /v1/payment-intents. Dates are Brasília days, inclusive.
type IntentFilter struct {
	MerchantID, Status, Method string
	From, To                   string // YYYY-MM-DD
	StartingAfter              string
	Limit                      int
}

var intentStatuses = map[string]bool{StatusRequiresPaymentMethod: true, StatusRequiresAction: true, StatusProcessing: true, StatusCaptured: true,
	StatusFailed: true, StatusCanceled: true, StatusPartiallyRefunded: true, StatusRefunded: true}

// Methods are how customers pay, as the summaries and lists name them.
var methods = map[string]bool{"credit": true, "debit": true, "prepaid": true, "card": true, "pix": true, "crypto": true}

// ListIntents lists payment intents, newest first.
func (s *Service) ListIntents(ctx context.Context, tenantID string, f IntentFilter) ([]*Intent, bool, error) {
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 20
	}
	if f.Status != "" && !intentStatuses[f.Status] {
		return nil, false, invalid("status is one of requires_payment_method, requires_action, processing, captured, failed, canceled, partially_refunded or refunded")
	}
	if f.Method != "" && !methods[f.Method] {
		return nil, false, invalid("method is credit, debit, prepaid, card, pix or crypto")
	}
	var from, to *time.Time
	for _, d := range []struct {
		in  string
		out **time.Time
		add int
	}{{f.From, &from, 0}, {f.To, &to, 1}} {
		if d.in == "" {
			continue
		}
		t, err := time.ParseInLocation("2006-01-02", d.in, brt)
		if err != nil {
			return nil, false, invalid("from and to are YYYY-MM-DD")
		}
		t = t.AddDate(0, 0, d.add)
		*d.out = &t
	}
	rows, err := s.pool.Query(ctx, `SELECT `+intentCols+` FROM payment_intents
		WHERE tenant_id = $1 AND ($2 = '' OR merchant_id = $2) AND ($3 = '' OR status = $3) AND ($4 = '' OR `+methodSQL+` = $4)
		  AND ($5::timestamptz IS NULL OR created_at >= $5) AND ($6::timestamptz IS NULL OR created_at < $6)
		  AND ($7 = '' OR (created_at, id) < (SELECT created_at, id FROM payment_intents WHERE tenant_id = $1 AND id = $7))
		ORDER BY created_at DESC, id DESC LIMIT $8`, tenantID, f.MerchantID, f.Status, f.Method, from, to, f.StartingAfter, f.Limit+1)
	if err != nil {
		return nil, false, err
	}
	var out []*Intent
	for rows.Next() {
		in, err := scanIntent(rows)
		if err != nil {
			rows.Close()
			return nil, false, err
		}
		out = append(out, in)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	more := len(out) > f.Limit
	if more {
		out = out[:f.Limit]
	}
	for _, in := range out {
		if in.Channel == "crypto" {
			s.cryptoAction(ctx, in) // the address, amount and price, as GET /v1/payment-intents/{id} shows them
		}
	}
	if out == nil {
		out = []*Intent{}
	}
	return out, more, nil
}

var merchantStatuses = map[string]bool{"kyb_in_review": true, "action_required": true, "active": true, "restricted": true, "closed": true}

// ListMerchants lists a tenant's merchants, newest first.
func (s *Service) ListMerchants(ctx context.Context, tenantID, status, startingAfter string, limit int) ([]*Merchant, bool, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if status != "" && !merchantStatuses[status] {
		return nil, false, invalid("status is kyb_in_review, action_required, active, restricted or closed")
	}
	rows, err := s.pool.Query(ctx, `SELECT `+merchantCols+` FROM merchants WHERE tenant_id = $1 AND ($2 = '' OR status = $2)
		AND ($3 = '' OR (created_at, id) < (SELECT created_at, id FROM merchants WHERE tenant_id = $1 AND id = $3))
		ORDER BY created_at DESC, id DESC LIMIT $4`, tenantID, status, startingAfter, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []*Merchant{}
	for rows.Next() {
		m, err := s.merchant(ctx, rows)
		if err != nil {
			return nil, false, err
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, nil
}

// webhookCols are an endpoint's public fields: never its secrets.
const webhookCols = `id, url, events, created_at, disabled_at`

func scanEndpoint(row pgx.Row) (*WebhookEndpoint, error) {
	e := &WebhookEndpoint{Object: "webhook_endpoint", Status: "enabled"}
	var created time.Time
	var disabled *time.Time
	if err := row.Scan(&e.ID, &e.URL, &e.Events, &created, &disabled); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	e.CreatedAt = created.UTC().Format(time.RFC3339)
	if disabled != nil {
		e.Status, e.DisabledAt = "disabled", disabled.UTC().Format(time.RFC3339)
	}
	return e, nil
}

// ListWebhookEndpoints lists a tenant's endpoints, newest first, enabled or not.
func (s *Service) ListWebhookEndpoints(ctx context.Context, tenantID string) ([]*WebhookEndpoint, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+webhookCols+` FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*WebhookEndpoint{}
	for rows.Next() {
		e, err := scanEndpoint(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetWebhookEndpoint loads one endpoint.
func (s *Service) GetWebhookEndpoint(ctx context.Context, tenantID, id string) (*WebhookEndpoint, error) {
	return scanEndpoint(s.pool.QueryRow(ctx, `SELECT `+webhookCols+` FROM webhook_endpoints WHERE tenant_id = $1 AND id = $2`, tenantID, id))
}

// DisableWebhookEndpoint stops sending to an endpoint, for good: no new events are queued for
// it and the deliveries still pending are abandoned. Its history stays, so a replay of past
// events to a new endpoint remains possible. Recorded in the audit trail.
func (s *Service) DisableWebhookEndpoint(ctx context.Context, tenantID, id, actor string) (*WebhookEndpoint, error) {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE webhook_endpoints SET disabled_at = now() WHERE tenant_id = $1 AND id = $2 AND disabled_at IS NULL`, tenantID, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil // already disabled, or not found: answered below
		}
		if _, err := tx.Exec(ctx, `UPDATE webhook_deliveries SET abandoned_at = now() WHERE endpoint_id = $1 AND delivered_at IS NULL AND abandoned_at IS NULL`, id); err != nil {
			return err
		}
		return audit(ctx, tx, tenantID, actor, "webhook_endpoint.disable", id, nil)
	})
	if err != nil {
		return nil, err
	}
	return s.GetWebhookEndpoint(ctx, tenantID, id)
}

// SimulatePixPayment, outside production, has the PSP simulator pay a Pix charge as the
// customer would, then waits briefly for the PSP's webhook to capture it: an integrator can
// watch the whole flow, webhooks included, without a bank app.
func (s *Service) SimulatePixPayment(ctx context.Context, tenantID, id string) (*Intent, error) {
	if s.cfg.Env == "production" || s.pix == nil {
		return nil, fmt.Errorf("%w: no sandbox PSP", ErrDisabled)
	}
	pi, err := s.GetIntent(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if pi.Channel != "pix" || pi.txid == "" || pi.Status != StatusRequiresAction {
		return nil, fmt.Errorf("%w: not a Pix charge waiting for payment (confirm it with payment_method_type pix first)", ErrConflict)
	}
	if err := s.pix.SimulatePayment(ctx, pi.txid); err != nil {
		return nil, err
	}
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		if cur, err := s.GetIntent(ctx, tenantID, id); err == nil && cur.Status != StatusRequiresAction {
			return cur, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return s.GetIntent(ctx, tenantID, id)
}
