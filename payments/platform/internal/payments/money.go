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
	"github.com/monolito123/Gooners/payments/platform/internal/netguard"
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

// AccountMerchant returns the merchant that owns an account.
func (s *Service) AccountMerchant(ctx context.Context, tenantID, accountID string) (string, error) {
	m, err := s.merchantByAccount(ctx, tenantID, accountID)
	if err != nil {
		return "", err
	}
	return m.ID, nil
}

// QuoteMerchant returns the merchant a payout quote belongs to.
func (s *Service) QuoteMerchant(ctx context.Context, tenantID, quoteID string) (string, error) {
	var m string
	err := s.pool.QueryRow(ctx, `SELECT merchant_id FROM payout_quotes WHERE tenant_id = $1 AND id = $2`, tenantID, quoteID).Scan(&m)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("%w: quote not found or already used", ErrConflict)
	}
	return m, err
}

// Entries lists the wallet's latest ledger postings and whether there are older ones.
func (s *Service) Entries(ctx context.Context, tenantID, accountID string, limit int) ([]map[string]any, bool, error) {
	m, err := s.merchantByAccount(ctx, tenantID, accountID)
	if err != nil {
		return nil, false, err
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	es, err := s.ledger.Entries(ctx, tenantID, ledger.MerchantWallet(m.ID), limit+1)
	if err != nil {
		return nil, false, err
	}
	more := len(es) > limit
	if more {
		es = es[:limit]
	}
	out := make([]map[string]any, 0, len(es))
	for _, e := range es {
		out = append(out, map[string]any{"journal_id": e.JournalID, "direction": e.Direction, "amount": e.Amount, "type": e.Type, "reference": e.Reference, "posted_at": e.PostedAt.UTC().Format(time.RFC3339)})
	}
	return out, more, nil
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
	if amount <= 0 || amount > MaxAmount {
		return nil, invalid("amount must be positive and at most %d centavos", MaxAmount)
	}
	if dest.Type != "pix" || dest.Key == "" || dest.KeyType == "" {
		return nil, invalid("destination must be a Pix key with key_type")
	}
	m, err := s.merchantByAccount(ctx, tenantID, accountID)
	if err != nil {
		return nil, err
	}
	if err := requireActive(m); err != nil {
		return nil, err // restricted merchants' funds stay held
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
		if err := rows.Err(); err != nil {
			return nil, err
		}
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
	var used bool
	err := s.pool.QueryRow(ctx, `SELECT merchant_id, amount, fee_total, detail, destination, expires_at, used FROM payout_quotes WHERE tenant_id = $1 AND id = $2`,
		tenantID, quoteID).Scan(&merchantID, &amount, &fees, &detail, &destJSON, &expires, &used)
	if errors.Is(err, pgx.ErrNoRows) || used {
		return nil, fmt.Errorf("%w: quote not found or already used", ErrConflict)
	}
	if err != nil {
		return nil, err
	}
	// Check everything that can refuse the payout before the quote is spent.
	if s.cfg.Now().After(expires) {
		return nil, fmt.Errorf("%w: quote expired at %s", ErrExpired, expires.UTC().Format(time.RFC3339))
	}
	m, err := s.GetMerchant(ctx, tenantID, merchantID)
	if err != nil {
		return nil, err
	}
	if err := requireActive(m); err != nil {
		return nil, err // restricted after the quote was issued
	}
	tag, err := s.pool.Exec(ctx, `UPDATE payout_quotes SET used = true WHERE tenant_id = $1 AND id = $2 AND NOT used`, tenantID, quoteID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("%w: quote not found or already used", ErrConflict) // a concurrent request spent it
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
	if err := rows.Err(); err != nil {
		return err
	}
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
	if err := rows.Err(); err != nil {
		return 0, err
	}
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

// RecordSchemeSettlement posts cash received from a scheme against the scheme receivable,
// by hand. ReconcileCardReport is the normal path; this one is for reports that cannot be
// imported line by line, and it is recorded in the audit trail.
func (s *Service) RecordSchemeSettlement(ctx context.Context, tenantID, brand, reportID string, amount int64, actor string) error {
	if actor == "" {
		return invalid("an actor is required")
	}
	if err := s.post(ctx, tenantID, "scheme-settlement:"+reportID, "scheme_settlement", reportID, ledger.SchemeSettlement(brand, amount)); err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		return audit(ctx, tx, tenantID, actor, "settlement.manual", reportID, map[string]any{"brand": brand, "amount": amount})
	})
}

// WebhookEndpoint is the API view of a webhook endpoint (the secret is returned once).
type WebhookEndpoint struct {
	ID     string   `json:"id"`
	Object string   `json:"object"`
	URL    string   `json:"url"`
	Events []string `json:"events"`
	Secret string   `json:"secret,omitempty"`
}

// ReplayWebhooks schedules an endpoint's deliveries in [since, until) again (docs/02 §10).
func (s *Service) ReplayWebhooks(ctx context.Context, tenantID, endpointID string, since, until time.Time) (int64, error) {
	if until.IsZero() {
		until = s.cfg.Now()
	}
	if !since.Before(until) || since.Before(s.cfg.Now().Add(-30*24*time.Hour)) {
		return 0, invalid("since must be before until and within the last 30 days")
	}
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM webhook_endpoints WHERE tenant_id = $1 AND id = $2)`, tenantID, endpointID).Scan(&exists); err != nil {
		return 0, err
	}
	if !exists {
		return 0, ErrNotFound
	}
	return webhooks.Replay(ctx, s.pool, tenantID, endpointID, since, until)
}

// WebhookPolicy is where partner webhook URLs may point: anywhere in the sandbox (partners'
// local receivers), public https addresses everywhere else.
func (s *Service) WebhookPolicy() netguard.Policy {
	sandbox := s.cfg.Env == "" || s.cfg.Env == "sandbox"
	return netguard.Policy{AllowPrivate: sandbox, RequireHTTPS: !sandbox}
}

// CreateWebhookEndpoint registers an endpoint. The signing secret is returned once and
// stored sealed under the vault's KEK.
func (s *Service) CreateWebhookEndpoint(ctx context.Context, tenantID, url string, events []string) (*WebhookEndpoint, error) {
	if err := s.WebhookPolicy().ValidateURL(ctx, url); err != nil {
		return nil, invalid("%v", err)
	}
	if len(events) == 0 {
		events = []string{"*"}
	}
	e := &WebhookEndpoint{ID: ids.New("we"), Object: "webhook_endpoint", URL: url, Events: events, Secret: webhooks.NewSecret()}
	stored := e.Secret
	if s.vault != nil {
		sealed, err := s.vault.SealSecret(ctx, e.Secret, e.ID)
		if err != nil {
			return nil, err
		}
		stored = sealed
	} else if s.cfg.Env == "production" {
		return nil, fmt.Errorf("%w: the vault is required to store webhook secrets", ErrDisabled)
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO webhook_endpoints (id, tenant_id, url, secret, events) VALUES ($1, $2, $3, $4, $5)`, e.ID, tenantID, url, stored, events)
	return e, err
}

func pow(x, y float64) float64 { return math.Pow(x, y) }
