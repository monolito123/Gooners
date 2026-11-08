package payments

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
)

// Pre-dispute alerts (docs/01 §6, the ALERT state). Through Mastercard's Ethoca or Visa's
// Verifi (CDRN, RDR), an issuer tells the acquirer that a cardholder disputes a sale before
// filing the chargeback. Refunding the sale then ends the dispute: no chargeback, no
// chargeback fee, and no count against the merchant in the schemes' monitoring programs
// (VAMP, ECM). The provider's adapter posts each alert (POST /v1/dispute-alerts/inbound,
// signed); the platform finds the sale by its RRN (DE 37) and authorization code, refunds what
// is still refundable, and answers with the outcome the provider reports back to the issuer.

var mAlerts = metrics.Default.Counter("goonerspay_dispute_alerts_total", "Pre-dispute alerts received, by outcome.", "outcome")

// Alert outcomes.
const (
	AlertRefunded        = "refunded"         // the sale was refunded: the dispute is resolved
	AlertAlreadyRefunded = "already_refunded" // nothing was left to refund
	AlertInDispute       = "in_dispute"       // a chargeback came first: the dispute follows its course
	AlertNotFound        = "not_found"        // no sale matches
	AlertRefundFailed    = "refund_failed"    // the refund was refused (the merchant's balance): operations follow up
)

// AlertInput is an alert as the provider's adapter posts it.
type AlertInput struct {
	AlertID    string `json:"alert_id"` // the provider's ID: an alert is handled once
	Provider   string `json:"provider"` // ethoca, verifi_cdrn or verifi_rdr
	Type       string `json:"type"`     // fraud or dispute
	Amount     int64  `json:"amount"`   // centavos
	Currency   string `json:"currency"`
	RRN        string `json:"rrn"`
	AuthCode   string `json:"auth_code"`
	ReasonCode string `json:"reason_code"`
}

// DisputeAlert is a received alert and what the platform did.
type DisputeAlert struct {
	ID              string `json:"id"`
	Object          string `json:"object"`
	Provider        string `json:"provider"`
	AlertID         string `json:"alert_id"`
	Type            string `json:"type"`
	Amount          int64  `json:"amount"`
	Outcome         string `json:"outcome"`
	PaymentIntentID string `json:"payment_intent_id,omitempty"`
	MerchantID      string `json:"merchant_id,omitempty"`
	RefundID        string `json:"refund_id,omitempty"`
	Detail          string `json:"detail,omitempty"`
	CreatedAt       string `json:"created_at"`
}

// ReceiveDisputeAlert handles an alert, once per provider and alert ID.
func (s *Service) ReceiveDisputeAlert(ctx context.Context, in AlertInput) (*DisputeAlert, error) {
	switch {
	case !slices.Contains([]string{"ethoca", "verifi_cdrn", "verifi_rdr"}, in.Provider):
		return nil, invalid("provider is ethoca, verifi_cdrn or verifi_rdr")
	case in.Type != "fraud" && in.Type != "dispute":
		return nil, invalid("type is fraud or dispute")
	case in.AlertID == "" || in.RRN == "" || in.Amount <= 0:
		return nil, invalid("alert_id, rrn and a positive amount are required")
	case in.Currency != "" && in.Currency != s.cfg.Currency:
		return nil, invalid("currency %s: the platform's sales are in %s", in.Currency, s.cfg.Currency)
	}
	if a, err := s.alertBy(ctx, `provider = $1 AND external_id = $2`, in.Provider, in.AlertID); err == nil {
		return a, nil // delivered again: the same answer
	}
	a := &DisputeAlert{ID: ids.New("dal"), Object: "dispute_alert", Provider: in.Provider, AlertID: in.AlertID, Type: in.Type, Amount: in.Amount}
	var tenantID string
	err := s.pool.QueryRow(ctx, `SELECT tenant_id::text, payment_intent_id FROM authorizations WHERE rrn = $1 AND ($2 = '' OR auth_code = $2)
		AND kind = 'purchase' AND status = 'approved' AND payment_intent_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`, in.RRN, in.AuthCode).Scan(&tenantID, &a.PaymentIntentID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		a.Outcome, a.Detail = AlertNotFound, "no approved sale with this RRN and authorization code"
	case err != nil:
		return nil, err
	default:
		s.resolveAlert(ctx, tenantID, a)
	}
	mAlerts.Inc(a.Outcome)
	var tenant *string
	if tenantID != "" {
		tenant = &tenantID
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO dispute_alerts (id, tenant_id, provider, external_id, type, amount, reason_code, rrn, auth_code, payment_intent_id, merchant_id, outcome, refund_id, detail)
			VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), $12, NULLIF($13, ''), NULLIF($14, ''))
			ON CONFLICT (provider, external_id) DO NOTHING`,
			a.ID, tenant, a.Provider, a.AlertID, a.Type, a.Amount, in.ReasonCode, in.RRN, in.AuthCode, a.PaymentIntentID, a.MerchantID, a.Outcome, a.RefundID, a.Detail)
		if err != nil || tag.RowsAffected() == 0 || tenant == nil {
			return err
		}
		if err := audit(ctx, tx, tenantID, "alerts:"+a.Provider, "dispute_alert."+a.Outcome, a.ID, map[string]any{"alert_id": a.AlertID, "payment_intent_id": a.PaymentIntentID, "amount": a.Amount}); err != nil {
			return err
		}
		return webhooks.Enqueue(ctx, tx, tenantID, "dispute.alert", map[string]any{"id": a.ID, "object": "dispute_alert", "type": a.Type, "outcome": a.Outcome,
			"payment_intent_id": a.PaymentIntentID, "merchant_id": a.MerchantID, "amount": a.Amount, "refund_id": a.RefundID})
	})
	if err != nil {
		return nil, err
	}
	return s.alertBy(ctx, `provider = $1 AND external_id = $2`, in.Provider, in.AlertID)
}

// resolveAlert refunds what the alert disputes, if the sale can still be refunded.
func (s *Service) resolveAlert(ctx context.Context, tenantID string, a *DisputeAlert) {
	pi, err := s.GetIntent(ctx, tenantID, a.PaymentIntentID)
	if err != nil {
		a.Outcome, a.Detail = AlertNotFound, err.Error()
		return
	}
	a.MerchantID = pi.MerchantID
	var disputed bool
	_ = s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM disputes WHERE tenant_id = $1 AND payment_intent_id = $2)`, tenantID, pi.ID).Scan(&disputed)
	refundable := pi.AmountCaptured - pi.AmountRefunded
	switch {
	case disputed:
		a.Outcome, a.Detail = AlertInDispute, "a chargeback for this sale was already received"
		return
	case refundable <= 0:
		a.Outcome, a.Detail = AlertAlreadyRefunded, "the sale was already refunded"
		return
	}
	amount := min(a.Amount, refundable)
	ref, err := s.CreateRefund(ctx, tenantID, pi.ID, amount)
	if err != nil {
		a.Outcome, a.Detail = AlertRefundFailed, err.Error()
		s.log.Warn("a pre-dispute alert could not be refunded", "alert", a.AlertID, "payment_intent", pi.ID, "err", err)
		return
	}
	a.Outcome, a.RefundID = AlertRefunded, ref.ID
	if amount < a.Amount {
		a.Detail = fmt.Sprintf("refunded %d, what was left of the sale", amount)
	}
}

// ListDisputeAlerts lists a tenant's alerts, newest first.
func (s *Service) ListDisputeAlerts(ctx context.Context, tenantID string, limit int) ([]*DisputeAlert, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `SELECT `+alertCols+` FROM dispute_alerts WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`, tenantID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*DisputeAlert{}
	for rows.Next() {
		a, err := scanAlert(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

const alertCols = `id, provider, external_id, type, amount, outcome, COALESCE(payment_intent_id, ''), COALESCE(merchant_id, ''), COALESCE(refund_id, ''), COALESCE(detail, ''), created_at`

func scanAlert(row pgx.Row) (*DisputeAlert, error) {
	a := &DisputeAlert{Object: "dispute_alert"}
	var at time.Time
	if err := row.Scan(&a.ID, &a.Provider, &a.AlertID, &a.Type, &a.Amount, &a.Outcome, &a.PaymentIntentID, &a.MerchantID, &a.RefundID, &a.Detail, &at); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	a.CreatedAt = at.UTC().Format(time.RFC3339)
	return a, nil
}

func (s *Service) alertBy(ctx context.Context, where string, args ...any) (*DisputeAlert, error) {
	return scanAlert(s.pool.QueryRow(ctx, `SELECT `+alertCols+` FROM dispute_alerts WHERE `+where, args...))
}
