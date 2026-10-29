package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/pixout"
	"github.com/monolito123/Gooners/payments/platform/internal/pricing"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
)

// Balance is the API view of an account balance (docs/02 §6.2).
type Balance struct {
	AccountID       string           `json:"account_id"`
	Currency        string           `json:"currency"`
	Available       int64            `json:"available"`
	Pending         int64            `json:"pending"`
	Reserved        int64            `json:"reserved"`
	InstantEligible int64            `json:"instant_eligible"`
	PendingByDate   []map[string]any `json:"pending_by_date"`
	AsOf            string           `json:"as_of"`
}

// GetBalance reads a merchant account's balance.
func (s *Service) GetBalance(ctx context.Context, tenantID, accountID string) (*Balance, error) {
	m, err := s.merchantByAccount(ctx, tenantID, accountID)
	if err != nil {
		return nil, err
	}
	avail, err := s.ledger.Balance(ctx, tenantID, ledger.MerchantWallet(m.ID))
	if err != nil {
		return nil, err
	}
	reserved, err := s.ledger.Balance(ctx, tenantID, ledger.MerchantReserve(m.ID))
	if err != nil {
		return nil, err
	}
	b := &Balance{AccountID: accountID, Currency: s.cfg.Currency, Available: avail, Reserved: reserved, PendingByDate: []map[string]any{}, AsOf: s.cfg.Now().UTC().Format(time.RFC3339)}
	rows, err := s.pool.Query(ctx, `SELECT settles_on, SUM(amount) FROM receivables WHERE tenant_id = $1 AND merchant_id = $2 AND status = 'pending'
		GROUP BY settles_on ORDER BY settles_on`, tenantID, m.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var d time.Time
		var n int64
		if err := rows.Scan(&d, &n); err != nil {
			return nil, err
		}
		b.Pending += n
		b.PendingByDate = append(b.PendingByDate, map[string]any{"date": d.Format("2006-01-02"), "amount": n})
	}
	if _, ok := s.cfg.Costs.AnnualRate(m.Plan.Tier); ok {
		b.InstantEligible = b.Pending
	}
	return b, rows.Err()
}

// Entries lists the wallet's ledger postings.
func (s *Service) Entries(ctx context.Context, tenantID, accountID string, limit int) ([]map[string]any, error) {
	m, err := s.merchantByAccount(ctx, tenantID, accountID)
	if err != nil {
		return nil, err
	}
	es, err := s.ledger.Entries(ctx, tenantID, ledger.MerchantWallet(m.ID), limit)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(es))
	for _, e := range es {
		out = append(out, map[string]any{"journal_id": e.JournalID, "direction": e.Direction, "amount": e.Amount, "type": e.Type, "reference": e.Reference, "posted_at": e.PostedAt.UTC().Format(time.RFC3339)})
	}
	return out, nil
}

// Destination of a payout.
type Destination struct {
	Type    string `json:"type"`
	KeyType string `json:"key_type"`
	Key     string `json:"key"`
}

type advanceLine struct {
	ReceivableID int64  `json:"receivable_id"`
	Date         string `json:"receivable_date"`
	Amount       int64  `json:"amount"`
	BusinessDays int    `json:"business_days"`
	Fee          int64  `json:"fee"`
}

// Quote is the API view of a payout quote (docs/02 §7.1).
type Quote struct {
	ID               string         `json:"id"`
	Object           string         `json:"object"`
	Amount           int64          `json:"amount"`
	Currency         string         `json:"currency"`
	Funding          map[string]any `json:"funding"`
	FeeTotal         int64          `json:"fee_total"`
	NetToDestination int64          `json:"net_to_destination"`
	EffectiveMonthly int64          `json:"effective_monthly_rate_bps"`
	RiskTier         string         `json:"risk_tier"`
	ExpiresAt        string         `json:"expires_at"`
}

// QuotePayout prices a payout: available balance first, then pending receivables in date
// order, each advanced at amount × ((1 + r)^(du/252) − 1).
func (s *Service) QuotePayout(ctx context.Context, tenantID, accountID string, amount int64, dest Destination) (*Quote, error) {
	if amount <= 0 {
		return nil, invalid("amount must be positive")
	}
	if dest.Type != "pix" || dest.Key == "" || dest.KeyType == "" {
		return nil, invalid("destination must be a Pix key with key_type")
	}
	m, err := s.merchantByAccount(ctx, tenantID, accountID)
	if err != nil {
		return nil, err
	}
	avail, err := s.ledger.Balance(ctx, tenantID, ledger.MerchantWallet(m.ID))
	if err != nil {
		return nil, err
	}
	fromAvail := min(avail, amount)
	need := amount - fromAvail
	var lines []advanceLine
	var advanced, fees int64
	annual, eligible := s.cfg.Costs.AnnualRate(m.Plan.Tier)
	if need > 0 {
		if !eligible {
			return nil, fmt.Errorf("%w: available balance is %d and the merchant is not eligible for advances", ErrFunds, avail)
		}
		rows, err := s.pool.Query(ctx, `SELECT id, settles_on, amount FROM receivables WHERE tenant_id = $1 AND merchant_id = $2 AND status = 'pending'
			ORDER BY settles_on, id`, tenantID, m.ID)
		if err != nil {
			return nil, err
		}
		for rows.Next() && advanced < need {
			var l advanceLine
			var d time.Time
			if err := rows.Scan(&l.ReceivableID, &d, &l.Amount); err != nil {
				rows.Close()
				return nil, err
			}
			l.Date = d.Format("2006-01-02")
			l.BusinessDays = pricing.BusinessDaysBetween(s.cfg.Now(), d)
			l.Fee = pricing.AdvanceFee(l.Amount, annual, l.BusinessDays)
			lines = append(lines, l)
			advanced += l.Amount
			fees += l.Fee
		}
		rows.Close()
		// Whole receivables are advanced; anything above the request stays in the wallet.
		if advanced < need {
			return nil, fmt.Errorf("%w: available %d plus receivables %d is less than %d", ErrFunds, avail, advanced, amount)
		}
	}
	net := amount - fees
	q := &Quote{ID: ids.New("pq"), Object: "payout_quote", Amount: amount, Currency: s.cfg.Currency, FeeTotal: fees, NetToDestination: net, RiskTier: m.Plan.Tier,
		Funding:   map[string]any{"from_available": fromAvail, "advanced": advanced, "advance_detail": lines},
		ExpiresAt: s.cfg.Now().Add(s.cfg.QuoteTTL).UTC().Format(time.RFC3339)}
	if eligible {
		q.EffectiveMonthly = int64(pricingMonthlyBps(annual))
	}
	detail, _ := json.Marshal(lines)
	destJSON, _ := json.Marshal(dest)
	if _, err := s.pool.Exec(ctx, `INSERT INTO payout_quotes (id, tenant_id, merchant_id, amount, fee_total, detail, destination, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		q.ID, tenantID, m.ID, amount, fees, detail, destJSON, s.cfg.Now().Add(s.cfg.QuoteTTL)); err != nil {
		return nil, err
	}
	return q, nil
}

func pricingMonthlyBps(annual float64) float64 {
	return float64(int64((pow(1+annual, 21.0/252)-1)*10000 + 0.5))
}

// Payout is the API view of a payout.
type Payout struct {
	ID         string `json:"id"`
	Object     string `json:"object"`
	Status     string `json:"status"`
	Amount     int64  `json:"amount"`
	Currency   string `json:"currency"`
	Rail       string `json:"rail"`
	EndToEndID string `json:"end_to_end_id,omitempty"`
	QuoteID    string `json:"quote_id"`
	Reason     string `json:"reason,omitempty"`
}

// ExecutePayout advances the quoted receivables, debits the wallet and sends the Pix.
func (s *Service) ExecutePayout(ctx context.Context, tenantID, quoteID string) (*Payout, error) {
	if s.payout == nil {
		return nil, fmt.Errorf("%w: payout bank", ErrDisabled)
	}
	var merchantID string
	var amount, fees int64
	var detail, destJSON []byte
	var expires time.Time
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `UPDATE payout_quotes SET used = true WHERE tenant_id = $1 AND id = $2 AND NOT used
			RETURNING merchant_id, amount, fee_total, detail, destination, expires_at`, tenantID, quoteID).Scan(&merchantID, &amount, &fees, &detail, &destJSON, &expires)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: quote not found or already used", ErrConflict)
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	if s.cfg.Now().After(expires) {
		return nil, fmt.Errorf("%w: quote expired at %s", ErrExpired, expires.UTC().Format(time.RFC3339))
	}
	var lines []advanceLine
	_ = json.Unmarshal(detail, &lines)
	var dest Destination
	_ = json.Unmarshal(destJSON, &dest)

	for _, l := range lines {
		tag, err := s.pool.Exec(ctx, `UPDATE receivables SET status = 'advanced', advance_fee = $3 WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`, tenantID, l.ReceivableID, l.Fee)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() == 0 {
			return nil, fmt.Errorf("%w: receivable %d is no longer pending", ErrConflict, l.ReceivableID)
		}
		if err := s.post(ctx, tenantID, fmt.Sprintf("advance:%d", l.ReceivableID), "instant_release", quoteID, releaseInstant(merchantID, l.Amount, l.Fee)); err != nil {
			return nil, err
		}
	}
	net := amount - fees
	po := &Payout{ID: ids.New("po"), Object: "payout", Status: "processing", Amount: net, Currency: s.cfg.Currency, Rail: "pix", QuoteID: quoteID}
	if err := s.post(ctx, tenantID, "payout:"+po.ID, "payout_send", po.ID, ledger.PayoutSend(merchantID, net, 0)); err != nil {
		return nil, err
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO payouts (id, tenant_id, merchant_id, quote_id, amount, status) VALUES ($1, $2, $3, $4, $5, 'processing')`,
		po.ID, tenantID, merchantID, quoteID, net); err != nil {
		return nil, err
	}
	res, err := s.payout.Send(ctx, pixout.Transfer{IdempotencyKey: po.ID, Amount: net, KeyType: dest.KeyType, Key: dest.Key, Description: "Repasse " + po.ID})
	if err != nil && !errors.Is(err, pixout.ErrRejected) {
		s.log.Warn("payout outcome unknown; ReconcilePayouts will resolve it", "payout", po.ID, "err", err)
		return po, nil
	}
	if errors.Is(err, pixout.ErrRejected) {
		res = pixout.Result{ID: po.ID, Status: pixout.StatusFailed, Reason: err.Error()}
	}
	return s.settlePayout(ctx, tenantID, po, res)
}

func (s *Service) settlePayout(ctx context.Context, tenantID string, po *Payout, res pixout.Result) (*Payout, error) {
	var merchantID string
	if err := s.pool.QueryRow(ctx, `SELECT merchant_id FROM payouts WHERE id = $1`, po.ID).Scan(&merchantID); err != nil {
		return nil, err
	}
	switch res.Status {
	case pixout.StatusDone:
		if err := s.post(ctx, tenantID, "payout-done:"+po.ID, "payout_confirm", po.ID, outflowConfirmed(po.Amount)); err != nil {
			return nil, err
		}
		po.Status, po.EndToEndID = "paid", res.EndToEndID
		s.notify(ctx, tenantID, "payout.paid", map[string]any{"id": po.ID, "amount": po.Amount, "end_to_end_id": res.EndToEndID})
	case pixout.StatusFailed:
		if err := s.post(ctx, tenantID, "payout-failed:"+po.ID, "payout_returned", po.ID, ledger.PayoutReturned(merchantID, po.Amount)); err != nil {
			return nil, err
		}
		po.Status, po.Reason = "failed", res.Reason
		s.notify(ctx, tenantID, "payout.failed", map[string]any{"id": po.ID, "reason": res.Reason})
	default:
		return po, nil
	}
	_, err := s.pool.Exec(ctx, `UPDATE payouts SET status = $2, transfer_id = $3, e2e_id = NULLIF($4, ''), reason = NULLIF($5, ''), updated_at = now() WHERE id = $1`,
		po.ID, po.Status, res.ID, res.EndToEndID, po.Reason)
	return po, err
}

// ReconcilePayouts resolves payouts whose outcome was unknown (network errors after sending).
func (s *Service) ReconcilePayouts(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT id, tenant_id::text, amount, quote_id FROM payouts WHERE status = 'processing' AND updated_at < now() - interval '30 seconds'`)
	if err != nil {
		return err
	}
	type p struct {
		id, tenant, quote string
		amount            int64
	}
	var ps []p
	for rows.Next() {
		var x p
		if err := rows.Scan(&x.id, &x.tenant, &x.amount, &x.quote); err != nil {
			rows.Close()
			return err
		}
		ps = append(ps, x)
	}
	rows.Close()
	for _, x := range ps {
		res, err := s.payout.Get(ctx, x.id)
		if err != nil {
			continue
		}
		if _, err := s.settlePayout(ctx, x.tenant, &Payout{ID: x.id, Amount: x.amount, QuoteID: x.quote}, res); err != nil {
			s.log.Error("reconcile payout", "payout", x.id, "err", err)
		}
	}
	return nil
}

// ReleaseDue makes receivables available on their settlement date (standard settlement).
func (s *Service) ReleaseDue(ctx context.Context, day time.Time) (int, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, tenant_id::text, merchant_id, amount FROM receivables WHERE status = 'pending' AND settles_on <= $1 ORDER BY id`, pricing.Date(day))
	if err != nil {
		return 0, err
	}
	type r struct {
		id            int64
		tenant, merch string
		amount        int64
	}
	var rs []r
	for rows.Next() {
		var x r
		if err := rows.Scan(&x.id, &x.tenant, &x.merch, &x.amount); err != nil {
			rows.Close()
			return 0, err
		}
		rs = append(rs, x)
	}
	rows.Close()
	n := 0
	for _, x := range rs {
		if err := s.post(ctx, x.tenant, fmt.Sprintf("release-scheduled:%d", x.id), "scheduled_release", fmt.Sprint(x.id), releaseScheduled(x.merch, x.amount)); err != nil {
			return n, err
		}
		if _, err := s.pool.Exec(ctx, `UPDATE receivables SET status = 'released' WHERE id = $1 AND status = 'pending'`, x.id); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// RecordSchemeSettlement posts cash received from a scheme (from the sponsor's or the
// scheme's settlement report) against the scheme receivable.
func (s *Service) RecordSchemeSettlement(ctx context.Context, tenantID, brand, reportID string, amount int64) error {
	return s.post(ctx, tenantID, "scheme-settlement:"+reportID, "scheme_settlement", reportID, ledger.SchemeSettlement(brand, amount))
}

// WebhookEndpoint is the API view of a webhook endpoint (the secret is returned once).
type WebhookEndpoint struct {
	ID     string   `json:"id"`
	Object string   `json:"object"`
	URL    string   `json:"url"`
	Events []string `json:"events"`
	Secret string   `json:"secret,omitempty"`
}

// CreateWebhookEndpoint registers an endpoint.
func (s *Service) CreateWebhookEndpoint(ctx context.Context, tenantID, url string, events []string) (*WebhookEndpoint, error) {
	if len(url) < 8 || (url[:8] != "https://" && s.cfg.Env == "production") {
		return nil, invalid("webhook URLs must be https")
	}
	if len(events) == 0 {
		events = []string{"*"}
	}
	e := &WebhookEndpoint{ID: ids.New("we"), Object: "webhook_endpoint", URL: url, Events: events, Secret: webhooks.NewSecret()}
	_, err := s.pool.Exec(ctx, `INSERT INTO webhook_endpoints (id, tenant_id, url, secret, events) VALUES ($1, $2, $3, $4, $5)`, e.ID, tenantID, url, e.Secret, events)
	return e, err
}

func pow(x, y float64) float64 { return math.Pow(x, y) }
