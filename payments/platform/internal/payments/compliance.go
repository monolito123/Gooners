package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/assets"
	"github.com/monolito123/Gooners/payments/platform/internal/exchange"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
	"github.com/monolito123/Gooners/payments/platform/internal/screening"
)

// SenderLookup finds the addresses that funded a deposit (chain.Router).
type SenderLookup interface {
	Senders(ctx context.Context, network, asset, txid, to string) ([]string, error)
}

var (
	mDepositScreenings = metrics.Default.Counter("goonerspay_deposit_screenings_total", "Crypto deposits whose senders were screened, by verdict (clear, sanctions_hit, screening_failed).", "verdict")
	mCases             = metrics.Default.Counter("goonerspay_compliance_cases_total", "Compliance cases opened, by reason.", "reason")
)

// Case kinds and reasons (compliance_cases).
const (
	CaseDepositScreening = "deposit_screening"
	CaseTravelRule       = "travel_rule"

	ReasonSanctionsHit        = "sanctions_hit"
	ReasonScreeningFailed     = "screening_failed"
	ReasonOriginatorMissing   = "originator_missing"
	ReasonBeneficiaryMismatch = "beneficiary_mismatch"
)

// ComplianceCase is something compliance must decide: a deposit held because a sender is on
// a sanctions list or could not be screened (release or block), or a travel-rule review
// (close).
type ComplianceCase struct {
	ID              string         `json:"id"`
	Object          string         `json:"object"`
	Kind            string         `json:"kind"`
	Reason          string         `json:"reason"`
	Subject         string         `json:"subject"`
	MerchantID      string         `json:"merchant_id,omitempty"`
	PaymentIntentID string         `json:"payment_intent_id,omitempty"`
	HoldsFunds      bool           `json:"holds_funds"`
	Asset           string         `json:"asset,omitempty"`
	Units           int64          `json:"units,omitempty"`
	Amount          string         `json:"amount,omitempty"`
	Status          string         `json:"status"`
	Detail          map[string]any `json:"detail"`
	DecidedBy       string         `json:"decided_by,omitempty"`
	DecisionNote    string         `json:"decision_note,omitempty"`
	DecidedAt       *string        `json:"decided_at"`
	CreatedAt       string         `json:"created_at"`
}

const caseCols = `id, kind, reason, subject, COALESCE(merchant_id, ''), COALESCE(payment_intent_id, ''), holds_funds, COALESCE(asset, ''), COALESCE(units, 0),
	status, detail, COALESCE(decided_by, ''), COALESCE(decision_note, ''), decided_at, created_at`

func scanCase(row pgx.Row) (*ComplianceCase, error) {
	c := &ComplianceCase{Object: "compliance_case"}
	var detail []byte
	var decided *time.Time
	var created time.Time
	if err := row.Scan(&c.ID, &c.Kind, &c.Reason, &c.Subject, &c.MerchantID, &c.PaymentIntentID, &c.HoldsFunds, &c.Asset, &c.Units,
		&c.Status, &detail, &c.DecidedBy, &c.DecisionNote, &decided, &created); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.Asset = strings.TrimSpace(c.Asset)
	if a, err := assets.Get(c.Asset); err == nil && c.Units != 0 {
		c.Amount = a.Format(c.Units)
	}
	_ = json.Unmarshal(detail, &c.Detail)
	if decided != nil {
		t := decided.UTC().Format(time.RFC3339)
		c.DecidedAt = &t
	}
	c.CreatedAt = created.UTC().Format(time.RFC3339)
	return c, nil
}

// ---------------------------------------------------------------- screening records

// recordScreening keeps a screening's result, clear or not, as the evidence it was made,
// and returns the result: clear, hit or error.
func (s *Service) recordScreening(ctx context.Context, tenantID, merchantID, purpose, reference, network, address string, res screening.Result, err error) (string, error) {
	result := "clear"
	switch {
	case err != nil:
		result = "error"
	case res.Hit:
		result = "hit"
	}
	detail := map[string]any{"matches": res.Matches}
	if err != nil {
		detail["error"] = err.Error()
	}
	d, _ := json.Marshal(detail)
	if _, dbErr := s.pool.Exec(ctx, `INSERT INTO address_screenings (tenant_id, merchant_id, network, address, result, sources, detail, purpose, reference)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, NULLIF($9, ''))`,
		tenantID, merchantID, network, address, result, strings.Join(res.Sources, ","), d, purpose, reference); dbErr != nil {
		return "", dbErr
	}
	mScreenings.Inc(result)
	return result, nil
}

// ---------------------------------------------------------------- deposit senders

// depositVerdict is what screening a deposit's senders concluded.
type depositVerdict struct {
	reason  string // "" when clear, else sanctions_hit or screening_failed
	senders []string
	matches []string
	errs    []string
}

// screenDeposit finds who sent a deposit and screens every sender (docs/09 §6.5). It fails
// closed: no lookup, no screener, a lookup that fails, or a screening that cannot be
// completed holds the deposit just as a hit does, so nothing unscreened is ever settled.
func (s *Service) screenDeposit(ctx context.Context, tenantID, merchantID, venue string, d exchange.Deposit) (depositVerdict, error) {
	v := depositVerdict{senders: []string{}}
	ref := venue + "/" + d.ID
	switch {
	case s.screener == nil:
		v.errs = append(v.errs, "no sanctions screening is configured")
	case s.senders == nil:
		v.errs = append(v.errs, "no sender lookup is configured for deposits")
	case d.TxID == "":
		v.errs = append(v.errs, "the venue reported no transaction id")
	default:
		senders, err := s.senders.Senders(ctx, d.Network, d.Asset, d.TxID, d.Address)
		if err != nil {
			v.errs = append(v.errs, "sender lookup: "+err.Error())
			break
		}
		v.senders = append(v.senders, senders...)
		for _, a := range senders {
			res, err := s.screener.Screen(ctx, d.Network, a)
			result, dbErr := s.recordScreening(ctx, tenantID, merchantID, "deposit_sender", ref, d.Network, a, res, err)
			if dbErr != nil {
				return v, dbErr
			}
			switch result {
			case "hit":
				v.matches = append(v.matches, res.Matches...)
			case "error":
				v.errs = append(v.errs, a+": "+err.Error())
			}
		}
	}
	switch {
	case len(v.matches) > 0:
		v.reason = ReasonSanctionsHit
	case len(v.errs) > 0:
		v.reason = ReasonScreeningFailed
	}
	verdict := v.reason
	if verdict == "" {
		verdict = "clear"
	}
	mDepositScreenings.Inc(verdict)
	return v, nil
}

// holdDeposit keeps a deposit whose screening did not clear it out of the merchant's reach:
// the coins are booked to a compliance hold (custody against liability.compliance_hold), the
// charge waits (or stays late), and a case asks compliance to release or block it. Under Lei
// 13.810/2019 the assets of a person a sanctions list names are frozen, not returned: a hit
// is never sent back to the sender.
func (s *Service) holdDeposit(ctx context.Context, venue string, d exchange.Deposit, tenantID, merchantID, piID, chargeStatus string, v depositVerdict) error {
	custody, hold := ledger.Custody(venue, d.Asset), ledger.ComplianceHold(d.Asset)
	if err := s.ensure(ctx, tenantID, custodyAcct(venue, d.Asset),
		ledger.Account{ID: hold, Code: "liability.compliance_hold", Currency: d.Asset, NormalSide: ledger.Credit}); err != nil {
		return err
	}
	subject := "deposit:" + venue + "/" + d.ID
	if err := s.post(ctx, tenantID, "deposit_hold:"+venue+"/"+d.ID, "compliance_hold", subject, []ledger.Posting{
		{Account: custody, Direction: ledger.Debit, Amount: d.Units}, {Account: hold, Direction: ledger.Credit, Amount: d.Units}}); err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE crypto_deposits SET screening = 'held' WHERE exchange = $1 AND deposit_id = $2`, venue, d.ID); err != nil {
		return err
	}
	if piID != "" {
		if chargeStatus == "pending" {
			// The customer paid in time: the sale waits for compliance. The terminal shows the
			// payment as processing; neither it nor the merchant is told why (no tipping off,
			// Lei 9.613/1998 art. 11).
			if _, err := s.pool.Exec(ctx, `UPDATE crypto_charges SET status = 'held', deposit_id = $2, txid = $3 WHERE payment_intent_id = $1`, piID, d.ID, d.TxID); err != nil {
				return err
			}
			if _, err := s.pool.Exec(ctx, `UPDATE payment_intents SET status = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`, tenantID, piID, StatusProcessing); err != nil {
				return err
			}
			s.notify(ctx, tenantID, "payment_intent.processing", map[string]any{"id": piID, "reason": "under_review"})
		} else if _, err := s.pool.Exec(ctx, `UPDATE crypto_charges SET status = 'late', deposit_id = $2, txid = $3 WHERE payment_intent_id = $1`, piID, d.ID, d.TxID); err != nil {
			return err
		}
	}
	detail := map[string]any{"venue": venue, "deposit_id": d.ID, "network": d.Network, "address": d.Address, "txid": d.TxID, "senders": v.senders}
	if len(v.matches) > 0 {
		detail["matches"] = v.matches
	}
	if len(v.errs) > 0 {
		detail["errors"] = v.errs
	}
	c, err := s.openCase(ctx, tenantID, merchantID, CaseDepositScreening, v.reason, subject, piID, true, d.Asset, d.Units, detail)
	if err != nil {
		return err
	}
	if v.reason == ReasonSanctionsHit {
		s.log.Warn("deposit from a sanctioned address held", "case", c, "venue", venue, "deposit", d.ID, "matches", v.matches)
	} else {
		s.log.Error("deposit held: its senders could not be screened", "case", c, "venue", venue, "deposit", d.ID, "errors", v.errs)
	}
	return nil
}

// openCase records a case once per kind, reason and subject, and tells the tenant one exists.
func (s *Service) openCase(ctx context.Context, tenantID, merchantID, kind, reason, subject, piID string, holds bool, asset string, units int64, detail map[string]any) (string, error) {
	d, _ := json.Marshal(detail)
	id := ids.New("cc")
	var unitsArg *int64
	if units != 0 {
		unitsArg = &units
	}
	err := s.pool.QueryRow(ctx, `INSERT INTO compliance_cases (id, tenant_id, merchant_id, kind, reason, subject, payment_intent_id, holds_funds, asset, units, detail)
		VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, NULLIF($7, ''), $8, NULLIF($9, ''), $10, $11)
		ON CONFLICT (kind, reason, subject) DO UPDATE SET updated_at = now() RETURNING id`,
		id, tenantID, merchantID, kind, reason, subject, piID, holds, asset, unitsArg, d).Scan(&id)
	if err != nil {
		return "", err
	}
	mCases.Inc(reason)
	s.notify(ctx, tenantID, "compliance.case_opened", map[string]any{"id": id, "kind": kind, "reason": reason, "holds_funds": holds})
	return id, nil
}

// ---------------------------------------------------------------- decisions

// Case actions.
const (
	CaseRelease = "release"
	CaseBlock   = "block"
	CaseClose   = "close"
)

// DecideCase records compliance's decision on a case, with a note saying why:
//
//   - release (a held deposit): the screening was a false positive or, once screening works
//     again, came back clear. The hold is undone and a charge that waited is settled; a
//     deposit no charge matches becomes an ordinary unapplied deposit for operations.
//   - block (a held deposit): the funds stay frozen in liability.compliance_hold and the
//     charge is canceled. Operations then reports it (runbook §4.12): to the Ministério da
//     Justiça e Segurança Pública under Lei 13.810/2019, and to the COAF.
//   - close (a review): the review is done; nothing was held.
func (s *Service) DecideCase(ctx context.Context, tenantID, id, action, note, actor string) (*ComplianceCase, error) {
	if !slices.Contains([]string{CaseRelease, CaseBlock, CaseClose}, action) {
		return nil, invalid("action must be release, block or close")
	}
	if strings.TrimSpace(note) == "" {
		return nil, invalid("a note saying why is required")
	}
	c, err := s.GetCase(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if c.Status != "open" {
		return nil, fmt.Errorf("%w: the case is already %s", ErrConflict, c.Status)
	}
	if c.HoldsFunds == (action == CaseClose) {
		if c.HoldsFunds {
			return nil, invalid("a case holding funds is released or blocked")
		}
		return nil, invalid("a review holds no funds: close it")
	}
	status := map[string]string{CaseRelease: "released", CaseBlock: "blocked", CaseClose: "closed"}[action]
	if c.Kind == CaseDepositScreening {
		var err error
		if action == CaseRelease {
			err = s.releaseDeposit(ctx, tenantID, c)
		} else {
			err = s.blockDeposit(ctx, tenantID, c)
		}
		if err != nil {
			return nil, err
		}
	}
	tag, err := s.pool.Exec(ctx, `UPDATE compliance_cases SET status = $3, decided_by = $4, decision_note = $5, decided_at = $6, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND status = 'open'`, tenantID, id, status, actor, note, s.cfg.Now())
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("%w: the case was decided meanwhile", ErrConflict)
	}
	s.log.Info("compliance case decided", "case", id, "decision", status, "by", actor)
	s.notify(ctx, tenantID, "compliance.case_decided", map[string]any{"id": id, "kind": c.Kind, "status": status})
	return s.GetCase(ctx, tenantID, id)
}

func depositOf(c *ComplianceCase) (venue, depositID string, ok bool) {
	return strings.Cut(strings.TrimPrefix(c.Subject, "deposit:"), "/")
}

// heldDeposit reads back a held deposit as the venue reported it.
func (s *Service) heldDeposit(ctx context.Context, c *ComplianceCase) (exchange.Exchange, exchange.Deposit, string, error) {
	venueName, depID, ok := depositOf(c)
	if !ok {
		return nil, exchange.Deposit{}, "", fmt.Errorf("case %s names no deposit", c.ID)
	}
	d := exchange.Deposit{ID: depID, Confirmed: true}
	var screeningStatus string
	if err := s.pool.QueryRow(ctx, `SELECT asset, units, COALESCE(network, ''), COALESCE(address, ''), memo, COALESCE(txid, ''), screening FROM crypto_deposits
		WHERE exchange = $1 AND deposit_id = $2`, venueName, depID).Scan(&d.Asset, &d.Units, &d.Network, &d.Address, &d.Memo, &d.TxID, &screeningStatus); err != nil {
		return nil, d, "", err
	}
	d.Asset = strings.TrimSpace(d.Asset)
	if s.exchanges == nil {
		return nil, d, screeningStatus, ErrCryptoDisabled
	}
	v, ok := s.exchanges.Venue(venueName)
	if !ok {
		return nil, d, screeningStatus, fmt.Errorf("%w: venue %s is not configured", ErrUnavailable, venueName)
	}
	return v, d, screeningStatus, nil
}

func (s *Service) releaseDeposit(ctx context.Context, tenantID string, c *ComplianceCase) error {
	venue, d, st, err := s.heldDeposit(ctx, c)
	if err != nil {
		return err
	}
	if st != "held" && st != "released" {
		return fmt.Errorf("%w: the deposit is %s", ErrConflict, st)
	}
	// Each step is idempotent, so a release that failed halfway (the venue refused the sale)
	// is simply asked again.
	if err := s.post(ctx, tenantID, "deposit_release:"+venue.Name()+"/"+d.ID, "compliance_release", c.Subject, []ledger.Posting{
		{Account: ledger.ComplianceHold(d.Asset), Direction: ledger.Debit, Amount: d.Units}, {Account: ledger.Custody(venue.Name(), d.Asset), Direction: ledger.Credit, Amount: d.Units}}); err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE crypto_deposits SET screening = 'released' WHERE exchange = $1 AND deposit_id = $2`, venue.Name(), d.ID); err != nil {
		return err
	}
	if c.PaymentIntentID == "" {
		return nil
	}
	var chargeStatus, merchantID string
	if err := s.pool.QueryRow(ctx, `SELECT status, merchant_id FROM crypto_charges WHERE payment_intent_id = $1`, c.PaymentIntentID).Scan(&chargeStatus, &merchantID); err != nil {
		return err
	}
	if chargeStatus != "held" {
		return nil // paid late: an ordinary unapplied deposit now, for operations
	}
	// The customer paid in time and the wait was the platform's: the merchant receives the
	// intent's amount, whatever the market did meanwhile (the result account absorbs it).
	if _, err := s.settleCharge(ctx, venue, d, c.PaymentIntentID, tenantID, merchantID); err != nil {
		return fmt.Errorf("%w: released, but the sale failed (ask again to retry): %v", ErrUnavailable, err)
	}
	return nil
}

func (s *Service) blockDeposit(ctx context.Context, tenantID string, c *ComplianceCase) error {
	venueName, depID, _ := depositOf(c)
	tag, err := s.pool.Exec(ctx, `UPDATE crypto_deposits SET screening = 'blocked' WHERE exchange = $1 AND deposit_id = $2 AND screening = 'held'`, venueName, depID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: the deposit is no longer held", ErrConflict)
	}
	if c.PaymentIntentID == "" {
		return nil
	}
	if _, err := s.pool.Exec(ctx, `UPDATE crypto_charges SET status = 'blocked' WHERE payment_intent_id = $1 AND status = 'held'`, c.PaymentIntentID); err != nil {
		return err
	}
	tag, err = s.pool.Exec(ctx, `UPDATE payment_intents SET status = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = $4`,
		tenantID, c.PaymentIntentID, StatusCanceled, StatusProcessing)
	if err == nil && tag.RowsAffected() > 0 {
		s.notify(ctx, tenantID, "payment_intent.canceled", map[string]any{"id": c.PaymentIntentID, "reason": "compliance"})
	}
	return err
}

// RescreenHeldDeposits asks screening again about deposits held because it could not be
// completed (a lookup or list that was down). A deposit that now comes back clear is
// released by the system; one that hits stays held as a sanctions case. It returns how many
// cases it settled.
func (s *Service) RescreenHeldDeposits(ctx context.Context) (int, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+caseCols+`, tenant_id::text FROM compliance_cases
		WHERE kind = $1 AND reason = $2 AND status = 'open' AND updated_at < $3 ORDER BY created_at LIMIT 50`,
		CaseDepositScreening, ReasonScreeningFailed, s.cfg.Now().Add(-10*time.Minute))
	if err != nil {
		return 0, err
	}
	type item struct {
		c      *ComplianceCase
		tenant string
	}
	var items []item
	for rows.Next() {
		c := &ComplianceCase{Object: "compliance_case"}
		var detail []byte
		var decided *time.Time
		var created time.Time
		var tenant string
		if err := rows.Scan(&c.ID, &c.Kind, &c.Reason, &c.Subject, &c.MerchantID, &c.PaymentIntentID, &c.HoldsFunds, &c.Asset, &c.Units,
			&c.Status, &detail, &c.DecidedBy, &c.DecisionNote, &decided, &created, &tenant); err != nil {
			rows.Close()
			return 0, err
		}
		items = append(items, item{c, tenant})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	done := 0
	for _, it := range items {
		venue, d, st, err := s.heldDeposit(ctx, it.c)
		if err != nil || st != "held" {
			continue
		}
		v, err := s.screenDeposit(ctx, it.tenant, it.c.MerchantID, venue.Name(), d)
		if err != nil {
			return done, err
		}
		_, _ = s.pool.Exec(ctx, `UPDATE crypto_deposits SET senders = $3 WHERE exchange = $1 AND deposit_id = $2`, venue.Name(), d.ID, v.senders)
		switch v.reason {
		case "":
			if _, err := s.DecideCase(ctx, it.tenant, it.c.ID, CaseRelease, "re-screened after the screening outage: every sender is clear", "system"); err != nil {
				s.log.Error("release a re-screened deposit", "case", it.c.ID, "err", err)
				continue
			}
			done++
		case ReasonSanctionsHit:
			b, _ := json.Marshal(map[string]any{"matches": v.matches, "senders": v.senders})
			_, _ = s.pool.Exec(ctx, `UPDATE compliance_cases SET reason = $2, detail = detail || $3::jsonb, updated_at = now() WHERE id = $1`, it.c.ID, ReasonSanctionsHit, b)
			s.log.Warn("re-screened deposit hit a sanctions list", "case", it.c.ID)
			done++
		default:
			_, _ = s.pool.Exec(ctx, `UPDATE compliance_cases SET updated_at = now() WHERE id = $1`, it.c.ID)
		}
	}
	return done, nil
}

// ---------------------------------------------------------------- reading

// GetCase reads one case.
func (s *Service) GetCase(ctx context.Context, tenantID, id string) (*ComplianceCase, error) {
	return scanCase(s.pool.QueryRow(ctx, `SELECT `+caseCols+` FROM compliance_cases WHERE tenant_id = $1 AND id = $2`, tenantID, id))
}

// ListCases lists a tenant's cases with a status (open by default; "all" for every one),
// newest first.
func (s *Service) ListCases(ctx context.Context, tenantID, status, startingAfter string, limit int) ([]*ComplianceCase, bool, error) {
	if status == "" {
		status = "open"
	}
	if !slices.Contains([]string{"open", "released", "blocked", "closed", "all"}, status) {
		return nil, false, invalid("status must be open, released, blocked, closed or all")
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `SELECT `+caseCols+` FROM compliance_cases WHERE tenant_id = $1 AND ($2 = 'all' OR status = $2)
		AND ($3 = '' OR (created_at, id) < (SELECT created_at, id FROM compliance_cases WHERE tenant_id = $1 AND id = $3))
		ORDER BY created_at DESC, id DESC LIMIT $4`, tenantID, status, startingAfter, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []*ComplianceCase{}
	for rows.Next() {
		c, err := scanCase(rows)
		if err != nil {
			return nil, false, err
		}
		out = append(out, c)
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

// Screening is one recorded screening of an address.
type Screening struct {
	ID         int64          `json:"id"`
	Object     string         `json:"object"`
	Purpose    string         `json:"purpose"` // withdrawal or deposit_sender
	MerchantID string         `json:"merchant_id,omitempty"`
	Network    string         `json:"network"`
	Address    string         `json:"address"`
	Result     string         `json:"result"` // clear, hit or error
	Sources    []string       `json:"sources"`
	Reference  string         `json:"reference,omitempty"`
	Detail     map[string]any `json:"detail"`
	CreatedAt  string         `json:"created_at"`
}

// ListScreenings lists a tenant's address screenings, newest first, optionally only one
// purpose or result.
func (s *Service) ListScreenings(ctx context.Context, tenantID, purpose, result string, before int64, limit int) ([]*Screening, bool, error) {
	if purpose != "" && purpose != "withdrawal" && purpose != "deposit_sender" {
		return nil, false, invalid("purpose is withdrawal or deposit_sender")
	}
	if result != "" && result != "clear" && result != "hit" && result != "error" {
		return nil, false, invalid("result is clear, hit or error")
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `SELECT id, purpose, COALESCE(merchant_id, ''), network, address, result, sources, COALESCE(reference, ''), COALESCE(detail, '{}'), created_at
		FROM address_screenings WHERE tenant_id = $1 AND ($2 = '' OR purpose = $2) AND ($3 = '' OR result = $3) AND ($4 = 0 OR id < $4)
		ORDER BY id DESC LIMIT $5`, tenantID, purpose, result, before, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []*Screening{}
	for rows.Next() {
		sc := &Screening{Object: "address_screening"}
		var sources string
		var detail []byte
		var at time.Time
		if err := rows.Scan(&sc.ID, &sc.Purpose, &sc.MerchantID, &sc.Network, &sc.Address, &sc.Result, &sources, &sc.Reference, &detail, &at); err != nil {
			return nil, false, err
		}
		sc.Sources = strings.Split(sources, ",")
		_ = json.Unmarshal(detail, &sc.Detail)
		sc.CreatedAt = at.UTC().Format(time.RFC3339)
		out = append(out, sc)
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
