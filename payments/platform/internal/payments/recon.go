package payments

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/pkg/apipix"
)

// brt is Brasília time. Brazil has had no daylight saving since 2019, so a fixed zone keeps
// the binary free of a tzdata dependency.
var brt = time.FixedZone("BRT", -3*3600)

// BRT is Brasília time. Business days are calendar dates there: pass a time whose date in
// BRT is the day (time.ParseInLocation(…, payments.BRT) for a typed date).
var BRT = brt

// businessDay returns midnight, Brasília time, of t's date in Brasília.
func businessDay(t time.Time) time.Time {
	d := t.In(brt)
	return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, brt)
}

// SettlementLine is one line of a card settlement report (sponsor acquirer or scheme), in
// the platform's import format (integration/operations-runbook.md §2). Amounts are centavos;
// Net is signed: what the line adds to (or takes from) the cash settled.
type SettlementLine struct {
	Line        int
	RecordType  string // sale, refund, chargeback, chargeback_reversal
	Brand       string
	RRN         string
	AuthCode    string
	Amount      int64
	Interchange int64
	SchemeFees  int64
	Net         int64
	CaseID      string // chargebacks: the network case ID
}

// ParseSettlementCSV reads a settlement report with the header
// record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id.
func ParseSettlementCSV(r io.Reader) ([]SettlementLine, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = 9
	cr.TrimLeadingSpace = true
	head, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("settlement report: %w", err)
	}
	if strings.Join(head, ",") != "record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id" {
		return nil, fmt.Errorf("settlement report: unexpected header %q", strings.Join(head, ","))
	}
	var out []SettlementLine
	for n := 2; ; n++ {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return nil, fmt.Errorf("settlement report line %d: %w", n, err)
		}
		l := SettlementLine{Line: n, RecordType: rec[0], Brand: strings.ToLower(rec[1]), RRN: rec[2], AuthCode: rec[3], CaseID: rec[8]}
		for i, dst := range []*int64{&l.Amount, &l.Interchange, &l.SchemeFees, &l.Net} {
			v := rec[4+i]
			if v == "" {
				continue
			}
			if *dst, err = strconv.ParseInt(v, 10, 64); err != nil {
				return nil, fmt.Errorf("settlement report line %d: %s is not an integer number of centavos", n, v)
			}
		}
		switch l.RecordType {
		case "sale", "chargeback_reversal":
			if l.Net < 0 {
				return nil, fmt.Errorf("settlement report line %d: a %s has a positive net", n, l.RecordType)
			}
		case "refund", "chargeback":
			if l.Net > 0 {
				return nil, fmt.Errorf("settlement report line %d: a %s has a negative net", n, l.RecordType)
			}
		default:
			return nil, fmt.Errorf("settlement report line %d: unknown record type %q", n, l.RecordType)
		}
		if l.Amount <= 0 || l.RRN == "" {
			return nil, fmt.Errorf("settlement report line %d: amount and rrn are required", n)
		}
		out = append(out, l)
	}
}

// ReconRun is the outcome of one reconciliation.
type ReconRun struct {
	ID         string         `json:"id"`
	Kind       string         `json:"kind"`
	Source     string         `json:"source"`
	Date       string         `json:"business_date"`
	Status     string         `json:"status"`
	Summary    map[string]any `json:"summary"`
	Exceptions []ReconItem    `json:"exceptions"`
}

// ReconItem is a difference an operator must resolve.
type ReconItem struct {
	Kind      string `json:"kind"`
	Reference string `json:"reference"`
	Expected  *int64 `json:"expected,omitempty"`
	Actual    *int64 `json:"actual,omitempty"`
	Detail    string `json:"detail,omitempty"`
}

func i64(n int64) *int64 { return &n }

// signed accumulates debit-positive amounts per account and turns them into postings.
type signed map[string]int64

func (b signed) add(account string, debit int64) { b[account] += debit }

func (b signed) postings() []ledger.Posting {
	var ps []ledger.Posting
	for _, acc := range slices.Sorted(maps.Keys(b)) {
		switch n := b[acc]; {
		case n > 0:
			ps = append(ps, ledger.Posting{Account: acc, Direction: ledger.Debit, Amount: n})
		case n < 0:
			ps = append(ps, ledger.Posting{Account: acc, Direction: ledger.Credit, Amount: -n})
		}
	}
	return ps
}

func (b signed) residual() int64 {
	var t int64
	for _, n := range b {
		t += n
	}
	return t
}

// ReconcileCardReport matches a settlement report against captures, refunds and disputes,
// posts one settlement journal (cash, receivables, payables, interchange and scheme-fee
// true-ups), parks anything unmatched in liability.recon_suspense, and records exceptions.
// Running the same report twice posts nothing new.
func (s *Service) ReconcileCardReport(ctx context.Context, tenantID, reportID string, day time.Time, lines []SettlementLine) (*ReconRun, error) {
	if reportID == "" {
		return nil, invalid("a report ID is required")
	}
	if err := s.ledger.EnsureAccount(ctx, ledger.Account{TenantID: tenantID, ID: ledger.AccReconSuspense, Code: "liability.recon_suspense", Currency: s.cfg.Currency, NormalSide: ledger.Credit, AllowNegative: true}); err != nil {
		return nil, err
	}
	var done bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM journals WHERE tenant_id = $1 AND idempotency_key = $2)`, tenantID, "card-settlement:"+reportID).Scan(&done); err != nil {
		return nil, err
	}
	if done {
		return nil, fmt.Errorf("%w: report %s is already reconciled", ErrConflict, reportID)
	}
	day = businessDay(day)
	run := &ReconRun{ID: ids.New("rec"), Kind: "card_settlement", Source: reportID, Date: day.Format("2006-01-02")}
	bal := signed{}
	counts := map[string]int{}
	var cash int64
	type record struct {
		l   SettlementLine
		ref string
	}
	var records []record
	seen := map[string]bool{}
	for _, l := range lines {
		counts[l.RecordType]++
		cash += l.Net
		bal.add(ledger.AccSettlementBank, l.Net)
		ref, items, err := s.matchSettlementLine(ctx, tenantID, reportID, l, bal, seen)
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", l.Line, err)
		}
		run.Exceptions = append(run.Exceptions, items...)
		records = append(records, record{l, ref})
	}
	// Whatever did not match exactly (unknown sales, amount differences) waits in suspense.
	if r := bal.residual(); r != 0 {
		bal.add(ledger.AccReconSuspense, -r)
	}
	// The lines are stored first (a retry after a failed posting finds them as this report's
	// own), then the journal posts; its idempotency key marks the report as reconciled.
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		for _, r := range records {
			l := r.l
			if _, err := tx.Exec(ctx, `INSERT INTO settlement_records (tenant_id, report_id, line, record_type, brand, rrn, auth_code, amount, interchange, scheme_fees, net, matched_ref)
				VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, $9, $10, $11, NULLIF($12, '')) ON CONFLICT DO NOTHING`,
				tenantID, reportID, l.Line, l.RecordType, l.Brand, l.RRN, l.AuthCode, l.Amount, l.Interchange, l.SchemeFees, l.Net, r.ref); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if ps := bal.postings(); len(ps) > 0 {
		if err := s.post(ctx, tenantID, "card-settlement:"+reportID, "scheme_settlement", reportID, ps); err != nil {
			return nil, err
		}
	}
	missing, err := s.unsettledCaptures(ctx, tenantID, day)
	if err != nil {
		return nil, err
	}
	run.Exceptions = append(run.Exceptions, missing...)
	run.Summary = map[string]any{"lines": len(lines), "by_type": counts, "cash": cash, "suspense": -bal[ledger.AccReconSuspense]}
	return run, s.saveRun(ctx, tenantID, run, day)
}

// matchSettlementLine finds what a line settles and adds its ledger effect to bal.
// It returns the matched reference ("" when unmatched) and any exceptions.
func (s *Service) matchSettlementLine(ctx context.Context, tenantID, reportID string, l SettlementLine, bal signed, seen map[string]bool) (string, []ReconItem, error) {
	exc := func(kind, detail string, expected, actual *int64) []ReconItem {
		return []ReconItem{{Kind: kind, Reference: fmt.Sprintf("line %d rrn %s", l.Line, l.RRN), Expected: expected, Actual: actual, Detail: detail}}
	}
	if l.Net != 0 && l.RecordType == "sale" && l.Net != l.Amount-l.Interchange-l.SchemeFees {
		return "", exc("inconsistent_line", "net ≠ amount − interchange − scheme_fees", i64(l.Amount-l.Interchange-l.SchemeFees), i64(l.Net)), nil
	}
	switch l.RecordType {
	case "sale":
		var piID, status string
		err := s.pool.QueryRow(ctx, `SELECT a.payment_intent_id, p.status FROM authorizations a JOIN payment_intents p ON p.id = a.payment_intent_id
			WHERE a.tenant_id = $1 AND a.rrn = $2 AND ($3 = '' OR a.auth_code = $3) AND a.kind = 'purchase' AND a.status = 'approved'
			ORDER BY a.created_at DESC LIMIT 1`, tenantID, l.RRN, l.AuthCode).Scan(&piID, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", exc("unmatched_sale", "the network settled a sale the platform has no approval for", nil, i64(l.Net)), nil
		}
		if err != nil {
			return "", nil, err
		}
		if status == StatusCanceled {
			return "", exc("settled_after_reversal", "a canceled payment was settled: the reversal did not reach the issuer; file a credit or a reversal claim", nil, i64(l.Net)), nil
		}
		if dup, err := s.alreadySettled(ctx, tenantID, reportID, "sale", piID, seen); err != nil || dup {
			return "", exc("duplicate_settlement", "payment "+piID+" was settled by an earlier report", nil, i64(l.Net)), err
		}
		booked, err := s.journalLines(ctx, tenantID, "capture:"+piID)
		if err != nil {
			return "", nil, err
		}
		receivable, ic, fees := booked[ledger.SchemeReceivable(l.Brand)], booked[ledger.AccExpenseInterchange], booked[ledger.AccExpenseSchemeFees]
		if receivable == 0 {
			return "", exc("brand_mismatch", "no "+l.Brand+" receivable for payment "+piID, nil, i64(l.Net)), nil
		}
		var gross int64
		if err := s.pool.QueryRow(ctx, `SELECT amount_captured FROM payment_intents WHERE id = $1`, piID).Scan(&gross); err != nil {
			return "", nil, err
		}
		bal.add(ledger.SchemeReceivable(l.Brand), -receivable)
		var items []ReconItem
		if gross != l.Amount {
			items = exc("amount_mismatch", "settled amount differs from the captured amount of "+piID, i64(gross), i64(l.Amount))
		} else {
			// Estimated at capture, actual now: the difference is the true-up.
			bal.add(ledger.AccExpenseInterchange, l.Interchange-ic)
			bal.add(ledger.AccExpenseSchemeFees, l.SchemeFees-fees)
		}
		return piID, items, nil
	case "refund":
		var refundID string
		var amount int64
		err := s.pool.QueryRow(ctx, `SELECT r.id, r.amount FROM authorizations a JOIN refunds r ON r.auth_id = a.auth_id
			WHERE a.tenant_id = $1 AND a.rrn = $2 AND a.kind = 'refund' AND a.status = 'approved' LIMIT 1`, tenantID, l.RRN).Scan(&refundID, &amount)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", exc("unmatched_refund", "the network settled a refund the platform did not send", nil, i64(l.Net)), nil
		}
		if err != nil {
			return "", nil, err
		}
		if dup, err := s.alreadySettled(ctx, tenantID, reportID, "refund", refundID, seen); err != nil || dup {
			return "", exc("duplicate_settlement", "refund "+refundID+" was settled by an earlier report", nil, i64(l.Net)), err
		}
		bal.add(ledger.SchemePayable(l.Brand), amount)
		if amount != -l.Net {
			return refundID, exc("amount_mismatch", "refund "+refundID, i64(-amount), i64(l.Net)), nil
		}
		return refundID, nil, nil
	default: // chargeback, chargeback_reversal
		var dpID string
		var amount int64
		var status string
		err := s.pool.QueryRow(ctx, `SELECT id, amount, status FROM disputes WHERE tenant_id = $1 AND scheme = $2 AND network_case_id = $3`, tenantID, l.Brand, l.CaseID).Scan(&dpID, &amount, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", exc("unmatched_"+l.RecordType, "no dispute with case "+l.CaseID+"; import the chargeback notice, then allocate the suspense", nil, i64(l.Net)), nil
		}
		if err != nil {
			return "", nil, err
		}
		if dup, err := s.alreadySettled(ctx, tenantID, reportID, l.RecordType, dpID, seen); err != nil || dup {
			return "", exc("duplicate_settlement", "dispute "+dpID+" was settled by an earlier report", nil, i64(l.Net)), err
		}
		if l.RecordType == "chargeback" {
			bal.add(ledger.SchemePayable(l.Brand), amount)
			if amount != -l.Net {
				return dpID, exc("amount_mismatch", "chargeback "+dpID, i64(-amount), i64(l.Net)), nil
			}
			return dpID, nil, nil
		}
		if status != DisputeWon {
			return "", exc("unexpected_reversal", "the scheme reversed dispute "+dpID+" which is "+status+"; record the outcome, then allocate the suspense", nil, i64(l.Net)), nil
		}
		bal.add(ledger.SchemeReceivable(l.Brand), -amount)
		if amount != l.Net {
			return dpID, exc("amount_mismatch", "chargeback reversal "+dpID, i64(amount), i64(l.Net)), nil
		}
		return dpID, nil, nil
	}
}

// alreadySettled reports whether an earlier line of this report, or another report, settled ref.
func (s *Service) alreadySettled(ctx context.Context, tenantID, reportID, recordType, ref string, seen map[string]bool) (bool, error) {
	if seen[recordType+" "+ref] {
		return true, nil
	}
	seen[recordType+" "+ref] = true
	var dup bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM settlement_records WHERE tenant_id = $1 AND record_type = $2 AND matched_ref = $3 AND report_id <> $4)`,
		tenantID, recordType, ref, reportID).Scan(&dup)
	return dup, err
}

// journalLines returns the debit-positive amount per account of the journal with this key.
func (s *Service) journalLines(ctx context.Context, tenantID, key string) (map[string]int64, error) {
	rows, err := s.pool.Query(ctx, `SELECT p.account_id, SUM(CASE p.direction WHEN 'debit' THEN p.amount ELSE -p.amount END)
		FROM journals j JOIN postings p ON p.tenant_id = j.tenant_id AND p.journal_id = j.journal_id
		WHERE j.tenant_id = $1 AND j.idempotency_key = $2 GROUP BY p.account_id`, tenantID, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var acc string
		var n int64
		if err := rows.Scan(&acc, &n); err != nil {
			return nil, err
		}
		out[acc] = n
	}
	return out, rows.Err()
}

// unsettledCaptures lists card captures two to seven days old that no report has settled.
func (s *Service) unsettledCaptures(ctx context.Context, tenantID string, day time.Time) ([]ReconItem, error) {
	end := businessDay(day).AddDate(0, 0, -1)
	rows, err := s.pool.Query(ctx, `SELECT p.id, p.amount_captured FROM payment_intents p
		WHERE p.tenant_id = $1 AND p.auth_id IS NOT NULL AND p.amount_captured > 0 AND p.status <> 'canceled'
		AND p.created_at >= $2 AND p.created_at < $3
		AND NOT EXISTS (SELECT 1 FROM settlement_records r WHERE r.tenant_id = p.tenant_id AND r.record_type = 'sale' AND r.matched_ref = p.id)
		ORDER BY p.created_at`, tenantID, end.AddDate(0, 0, -6), end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReconItem
	for rows.Next() {
		var id string
		var n int64
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out = append(out, ReconItem{Kind: "unsettled_capture", Reference: id, Expected: i64(n), Detail: "captured but not in any settlement report after two days"})
	}
	return out, rows.Err()
}

// ReconcilePix compares the Pix the PSP received on a business day (Brasília time) with the
// ledger. Missed webhooks are healed by replaying the Pix through OnPix, which re-reads it
// from the PSP and is idempotent; MED returns and refunds listed on each Pix are applied the
// same way. What cannot be healed becomes an exception.
func (s *Service) ReconcilePix(ctx context.Context, tenantID string, day time.Time) (*ReconRun, error) {
	if s.pix == nil {
		return nil, fmt.Errorf("%w: Pix PSP", ErrDisabled)
	}
	start := businessDay(day)
	end := start.AddDate(0, 0, 1)
	list, err := s.pix.ListPix(ctx, start, end)
	if err != nil {
		return nil, err
	}
	run := &ReconRun{ID: ids.New("rec"), Kind: "pix_daily", Source: start.Format("2006-01-02"), Date: start.Format("2006-01-02")}
	var pspTotal, healedTotal int64
	healed, unidentified := 0, 0
	seen := map[string]bool{}
	for _, p := range list {
		amount, err := apipix.ParseValor(p.Valor)
		if err != nil {
			return nil, err
		}
		var piTenant, piID string
		var expected int64
		err = s.pool.QueryRow(ctx, `SELECT tenant_id::text, id, amount FROM payment_intents WHERE pix_txid = $1`, p.TxID).Scan(&piTenant, &piID, &expected)
		if p.TxID == "" || errors.Is(err, pgx.ErrNoRows) {
			unidentified++
			run.Exceptions = append(run.Exceptions, ReconItem{Kind: "unidentified_pix", Reference: p.EndToEndID, Actual: i64(amount),
				Detail: "received without a known txid: return it with a devolução or allocate it"})
			continue
		}
		if err != nil {
			return nil, err
		}
		if piTenant != tenantID {
			continue // another tenant shares the PSP account; its own run covers it
		}
		seen[p.EndToEndID] = true
		pspTotal += amount
		var credited bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM journals WHERE tenant_id = $1 AND idempotency_key = $2)`, tenantID, "pix:"+p.EndToEndID).Scan(&credited); err != nil {
			return nil, err
		}
		if err := s.OnPix(ctx, p); err != nil {
			run.Exceptions = append(run.Exceptions, ReconItem{Kind: "replay_failed", Reference: p.EndToEndID, Actual: i64(amount), Detail: err.Error()})
			continue
		}
		if !credited {
			healed++
			healedTotal += amount
		}
		if amount != expected {
			run.Exceptions = append(run.Exceptions, ReconItem{Kind: "amount_mismatch", Reference: piID, Expected: i64(expected), Actual: i64(amount), Detail: "paid amount differs from the charge"})
		}
	}
	// Credited in the ledger that day but not listed by the PSP.
	rows, err := s.pool.Query(ctx, `SELECT substr(idempotency_key, 5), reference FROM journals WHERE tenant_id = $1 AND type = 'pix_received' AND posted_at >= $2 AND posted_at < $3`, tenantID, start, end)
	if err != nil {
		return nil, err
	}
	var notAtPSP []ReconItem
	for rows.Next() {
		var e2e, piID string
		if err := rows.Scan(&e2e, &piID); err != nil {
			rows.Close()
			return nil, err
		}
		if !seen[e2e] {
			notAtPSP = append(notAtPSP, ReconItem{Kind: "not_at_psp", Reference: piID, Detail: "credited for " + e2e + " but the PSP does not list it for this day"})
		}
	}
	rows.Close()
	run.Exceptions = append(run.Exceptions, notAtPSP...)
	run.Summary = map[string]any{"psp_pix": len(list), "psp_total": pspTotal, "healed": healed, "healed_total": healedTotal, "unidentified": unidentified}
	return run, s.saveRun(ctx, tenantID, run, start)
}

func (s *Service) saveRun(ctx context.Context, tenantID string, run *ReconRun, day time.Time) error {
	run.Status = "balanced"
	if len(run.Exceptions) > 0 {
		run.Status = "exceptions"
	}
	if run.Exceptions == nil {
		run.Exceptions = []ReconItem{}
	}
	sum, _ := json.Marshal(run.Summary)
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO recon_runs (id, tenant_id, kind, source, business_date, status, summary) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			run.ID, tenantID, run.Kind, run.Source, day, run.Status, sum); err != nil {
			return err
		}
		for _, e := range run.Exceptions {
			d, _ := json.Marshal(map[string]string{"detail": e.Detail})
			// An exception still open from an earlier run is not raised twice.
			if _, err := tx.Exec(ctx, `INSERT INTO recon_exceptions (run_id, tenant_id, kind, reference, expected, actual, detail)
				SELECT $1, $2, $3, $4, $5, $6, $7 WHERE NOT EXISTS (SELECT 1 FROM recon_exceptions WHERE tenant_id = $2 AND kind = $3 AND reference = $4 AND resolved_at IS NULL)`,
				run.ID, tenantID, e.Kind, e.Reference, e.Expected, e.Actual, d); err != nil {
				return err
			}
		}
		return nil
	})
}

// ResolveException closes a reconciliation exception with the operator's explanation.
func (s *Service) ResolveException(ctx context.Context, tenantID string, id int64, resolution, actor string) error {
	if resolution == "" || actor == "" {
		return invalid("resolution and actor are required")
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE recon_exceptions SET resolved_at = now(), resolved_by = $3, resolution = $4 WHERE tenant_id = $1 AND id = $2 AND resolved_at IS NULL`, tenantID, id, actor, resolution)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: no open exception %d", ErrNotFound, id)
		}
		return audit(ctx, tx, tenantID, actor, "recon.resolve", strconv.FormatInt(id, 10), map[string]string{"resolution": resolution})
	})
}

// AllocateSuspense moves settlement cash out of liability.recon_suspense once an operator
// knows where it belongs: back to the bank (returned to the sponsor), to a scheme receivable
// or payable, to a cost line, or to a merchant. Amount is positive to clear a credit
// balance (cash received), negative to clear a debit balance (cash taken).
func (s *Service) AllocateSuspense(ctx context.Context, tenantID string, amount int64, account, reason, actor string) error {
	if amount == 0 || reason == "" || actor == "" {
		return invalid("amount, reason and actor are required")
	}
	allowed := account == ledger.AccSettlementBank || account == ledger.AccExpenseInterchange || account == ledger.AccExpenseSchemeFees ||
		account == ledger.AccExpenseFraudLoss || strings.HasPrefix(account, "asset.scheme_receivable.") || strings.HasPrefix(account, "liability.scheme_payable.") ||
		strings.HasPrefix(account, "liability.merchant_wallet.")
	if !allowed {
		return invalid("suspense can go to the settlement bank, a scheme receivable or payable, interchange, scheme fees, fraud loss or a merchant wallet")
	}
	ps := []ledger.Posting{{Account: ledger.AccReconSuspense, Direction: ledger.Debit, Amount: amount}, {Account: account, Direction: ledger.Credit, Amount: amount}}
	if amount < 0 {
		ps = ledger.Reverse([]ledger.Posting{{Account: ledger.AccReconSuspense, Direction: ledger.Debit, Amount: -amount}, {Account: account, Direction: ledger.Credit, Amount: -amount}})
	}
	if strings.HasPrefix(account, "liability.merchant_wallet.") && amount > 0 {
		ps = append(ps, ledger.SafeguardTopup(amount)...) // new client money is safeguarded at once
	}
	if err := s.post(ctx, tenantID, ids.New("alloc"), "suspense_allocation", reason, ps); err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		return audit(ctx, tx, tenantID, actor, "recon.allocate", account, map[string]any{"amount": amount, "reason": reason})
	})
}

// OpenExceptions lists unresolved reconciliation exceptions.
func (s *Service) OpenExceptions(ctx context.Context, tenantID string) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, `SELECT e.id, r.kind, e.kind, e.reference, e.expected, e.actual, COALESCE(e.detail->>'detail', ''), e.created_at
		FROM recon_exceptions e JOIN recon_runs r ON r.id = e.run_id WHERE e.tenant_id = $1 AND e.resolved_at IS NULL ORDER BY e.id`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int64
		var run, kind, ref, detail string
		var expected, actual *int64
		var at time.Time
		if err := rows.Scan(&id, &run, &kind, &ref, &expected, &actual, &detail, &at); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"id": id, "run": run, "kind": kind, "reference": ref, "expected": expected, "actual": actual, "detail": detail, "created_at": at.UTC().Format(time.RFC3339)})
	}
	return out, rows.Err()
}
