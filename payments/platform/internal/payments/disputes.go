package payments

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
)

// Dispute statuses (docs/01 §7.1). Pre-dispute alerts and arbitration are handled by
// operations at the sponsor and are not modelled here.
const (
	DisputeEvidenceRequired = "evidence_required"
	DisputeRepresented      = "represented"
	DisputePreArbitration   = "pre_arbitration"
	DisputeAccepted         = "accepted"
	DisputeWon              = "won"
	DisputeLost             = "lost"
)

// Dispute notices, as the sponsor's chargeback file (or the scheme's case system) reports them.
const (
	NoticeOpened         = "opened"
	NoticePreArbitration = "pre_arbitration"
	NoticeWon            = "won"
	NoticeLost           = "lost"
)

// DisputeNotice is one lifecycle notice for a chargeback.
type DisputeNotice struct {
	Event         string
	Scheme        string // visa, mastercard, elo
	NetworkCaseID string
	ReasonCode    string
	Category      string // fraud, authorization, processing_error, consumer_dispute
	Amount        int64
	// The original sale: its RRN (DE 37) and authorization code (DE 38), or the payment intent.
	RRN, AuthCode   string
	PaymentIntentID string
	EvidenceDueAt   time.Time
	Source          string // file and line, for the audit trail
}

// Dispute is the API view (docs/02 §5).
type Dispute struct {
	ID              string         `json:"id"`
	Object          string         `json:"object"`
	PaymentIntentID string         `json:"payment_intent_id"`
	MerchantID      string         `json:"merchant_id"`
	Scheme          string         `json:"scheme"`
	NetworkCaseID   string         `json:"network_case_id"`
	ReasonCode      string         `json:"reason_code"`
	Category        string         `json:"category"`
	Amount          int64          `json:"amount"`
	Currency        string         `json:"currency"`
	Status          string         `json:"status"`
	EvidenceDueAt   string         `json:"evidence_due_at"`
	Ledger          map[string]any `json:"ledger"`
	AutoEvidence    map[string]any `json:"auto_evidence"`
	Recommendation  string         `json:"recommendation"`
	Evidence        map[string]any `json:"evidence,omitempty"`
	CreatedAt       string         `json:"created_at"`

	tenantID                string
	heldWallet, heldRecover int64
}

const disputeCols = `id, tenant_id::text, payment_intent_id, merchant_id, scheme, network_case_id, reason_code, category, amount, currency, status,
	evidence_due_at, COALESCE(evidence, 'null'::jsonb), held_wallet, held_recoverable, created_at`

func scanDispute(row pgx.Row) (*Dispute, error) {
	d := &Dispute{Object: "dispute"}
	var due, created time.Time
	var ev []byte
	err := row.Scan(&d.ID, &d.tenantID, &d.PaymentIntentID, &d.MerchantID, &d.Scheme, &d.NetworkCaseID, &d.ReasonCode, &d.Category, &d.Amount, &d.Currency, &d.Status,
		&due, &ev, &d.heldWallet, &d.heldRecover, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(ev, &d.Evidence)
	d.EvidenceDueAt, d.CreatedAt = due.UTC().Format(time.RFC3339), created.UTC().Format(time.RFC3339)
	return d, nil
}

// GetDispute loads a dispute with its automatic evidence and recommendation.
func (s *Service) GetDispute(ctx context.Context, tenantID, id string) (*Dispute, error) {
	d, err := scanDispute(s.pool.QueryRow(ctx, `SELECT `+disputeCols+` FROM disputes WHERE tenant_id = $1 AND id = $2`, tenantID, id))
	if err != nil {
		return nil, err
	}
	return d, s.enrich(ctx, d)
}

// ListDisputes lists a tenant's disputes, newest first, optionally by status and merchant.
// startingAfter is the last ID of the previous page; hasMore says whether another page exists.
func (s *Service) ListDisputes(ctx context.Context, tenantID, status, merchantID, startingAfter string, limit int) (out []*Dispute, hasMore bool, err error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx, `SELECT `+disputeCols+` FROM disputes d WHERE tenant_id = $1 AND ($2 = '' OR status = $2) AND ($3 = '' OR merchant_id = $3)
		AND ($4 = '' OR (created_at, id) < (SELECT created_at, id FROM disputes WHERE tenant_id = $1 AND id = $4))
		ORDER BY created_at DESC, id DESC LIMIT $5`, tenantID, status, merchantID, startingAfter, limit+1)
	if err != nil {
		return nil, false, err
	}
	for rows.Next() {
		d, err := scanDispute(rows)
		if err != nil {
			rows.Close()
			return nil, false, err
		}
		out = append(out, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	if len(out) > limit {
		out, hasMore = out[:limit], true
	}
	for _, d := range out {
		if err := s.enrich(ctx, d); err != nil {
			return nil, false, err
		}
	}
	return out, hasMore, nil
}

// enrich assembles the evidence the platform already holds (docs/01 §7.2) and a recommendation.
func (s *Service) enrich(ctx context.Context, d *Dispute) error {
	pi, err := s.GetIntent(ctx, d.tenantID, d.PaymentIntentID)
	if err != nil {
		return err
	}
	m, err := s.GetMerchant(ctx, d.tenantID, d.MerchantID)
	if err != nil {
		return err
	}
	d.Ledger = map[string]any{"held_from_account": m.AccountID, "amount": d.heldWallet + d.heldRecover, "from_balance": d.heldWallet, "owed_by_merchant": d.heldRecover}
	ev := map[string]any{"nostr_receipt": map[string]any{"delivered": pi.Receipt != nil, "claimed_by_customer": false}}
	var entry, terminal, rrn, authCode string
	err = s.pool.QueryRow(ctx, `SELECT COALESCE(entry_mode, ''), terminal_id, COALESCE(rrn, ''), COALESCE(auth_code, '') FROM authorizations WHERE auth_id = $1`, pi.authID).
		Scan(&entry, &terminal, &rrn, &authCode)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	chip := strings.HasPrefix(entry, "07") || strings.HasPrefix(entry, "05")
	if pi.authID != "" {
		ev["card_present"] = map[string]any{"entry_mode": entry, "emv_cryptogram": chip, "terminal_id": terminal, "rrn": rrn, "authorization_code": authCode}
	}
	if pi.AmountRefunded > 0 {
		ev["refunds"] = map[string]any{"amount_refunded": pi.AmountRefunded}
	}
	d.AutoEvidence = ev
	switch {
	case pi.AmountRefunded >= d.Amount:
		d.Recommendation = "represent" // credit already issued
	case d.Category == "fraud" && chip:
		d.Recommendation = "represent" // EMV chip or contactless: counterfeit-fraud liability sits with the issuer
	case d.Category == "processing_error" || d.Category == "consumer_dispute":
		d.Recommendation = "refund"
	default:
		d.Recommendation = "accept"
	}
	return nil
}

// ApplyDisputeNotice applies one notice. Each (dispute, event) applies once, so a file
// can be imported again safely.
func (s *Service) ApplyDisputeNotice(ctx context.Context, tenantID string, n DisputeNotice) (*Dispute, error) {
	if n.Scheme == "" || n.NetworkCaseID == "" {
		return nil, invalid("scheme and network_case_id are required")
	}
	if n.Event == NoticeOpened {
		return s.openDispute(ctx, tenantID, n)
	}
	d, err := scanDispute(s.pool.QueryRow(ctx, `SELECT `+disputeCols+` FROM disputes WHERE tenant_id = $1 AND scheme = $2 AND network_case_id = $3`, tenantID, n.Scheme, n.NetworkCaseID))
	if err != nil {
		return nil, fmt.Errorf("%w: case %s/%s", err, n.Scheme, n.NetworkCaseID)
	}
	var to string
	var from []string
	switch n.Event {
	case NoticePreArbitration:
		to, from = DisputePreArbitration, []string{DisputeRepresented}
	case NoticeWon:
		to, from = DisputeWon, []string{DisputeRepresented, DisputePreArbitration}
	case NoticeLost:
		to, from = DisputeLost, []string{DisputeEvidenceRequired, DisputeRepresented, DisputePreArbitration}
	default:
		return nil, invalid("unknown dispute event %q", n.Event)
	}
	if done, err := s.disputeEventDone(ctx, d.ID, n.Event); err != nil || done {
		if err != nil {
			return nil, err
		}
		return s.GetDispute(ctx, tenantID, d.ID)
	}
	if !slices.Contains(from, d.Status) {
		return nil, fmt.Errorf("%w: a %s dispute cannot become %s", ErrConflict, d.Status, to)
	}
	if n.Event == NoticeWon {
		// The issuer withdrew the chargeback: the scheme owes the amount back (cleared by the
		// chargeback_reversal line of a later settlement report) and the merchant is credited.
		// Any shortfall still booked as owed is recovered from this credit by RecoverShortfalls.
		ps := []ledger.Posting{{Account: ledger.SchemeReceivable(d.Scheme), Direction: ledger.Debit, Amount: d.Amount}, {Account: ledger.MerchantWallet(d.MerchantID), Direction: ledger.Credit, Amount: d.Amount}}
		if err := s.post(ctx, tenantID, "chargeback-won:"+d.ID, "chargeback_won", d.ID, append(ps, ledger.SafeguardTopup(d.Amount)...)); err != nil {
			return nil, err
		}
	}
	if err := s.moveDispute(ctx, d, to, n.Event, n.Source, from...); err != nil {
		return nil, err
	}
	return s.GetDispute(ctx, tenantID, d.ID)
}

func (s *Service) disputeEventDone(ctx context.Context, id, event string) (bool, error) {
	var done bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM dispute_events WHERE dispute_id = $1 AND event = $2)`, id, event).Scan(&done)
	return done, err
}

// moveDispute changes the status, records the event and sends the webhook in one transaction.
func (s *Service) moveDispute(ctx context.Context, d *Dispute, to, event, source string, from ...string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE disputes SET status = $2, updated_at = now() WHERE id = $1 AND status = ANY($3)`, d.ID, to, from)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: dispute %s is %s", ErrConflict, d.ID, d.Status)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO dispute_events (dispute_id, event, source) VALUES ($1, $2, $3)`, d.ID, event, source); err != nil {
			return err
		}
		typ := map[string]string{DisputeWon: "dispute.won", DisputeLost: "dispute.lost", DisputeAccepted: "dispute.lost"}[to]
		if typ == "" {
			return nil
		}
		return webhooks.Enqueue(ctx, tx, d.tenantID, typ, map[string]any{"id": d.ID, "object": "dispute", "status": to})
	})
}

func (s *Service) openDispute(ctx context.Context, tenantID string, n DisputeNotice) (*Dispute, error) {
	switch n.Category {
	case "fraud", "authorization", "processing_error", "consumer_dispute":
	default:
		return nil, invalid("category must be fraud, authorization, processing_error or consumer_dispute")
	}
	if n.Amount <= 0 || n.ReasonCode == "" || n.EvidenceDueAt.IsZero() {
		return nil, invalid("amount, reason_code and evidence_due_at are required")
	}
	piID := n.PaymentIntentID
	if piID == "" {
		err := s.pool.QueryRow(ctx, `SELECT payment_intent_id FROM authorizations WHERE tenant_id = $1 AND rrn = $2 AND ($3 = '' OR auth_code = $3)
			AND kind = 'purchase' AND status = 'approved' AND payment_intent_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`, tenantID, n.RRN, n.AuthCode).Scan(&piID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: no approved sale with RRN %s", ErrNotFound, n.RRN)
		}
		if err != nil {
			return nil, err
		}
	}
	pi, err := s.GetIntent(ctx, tenantID, piID)
	if err != nil {
		return nil, err
	}
	if pi.authID == "" || pi.AmountCaptured == 0 {
		return nil, invalid("payment intent %s is not a captured card payment", pi.ID)
	}
	if n.Amount > pi.AmountCaptured {
		return nil, invalid("chargeback %d exceeds the captured amount %d", n.Amount, pi.AmountCaptured)
	}
	id := ids.New("dp")
	if _, err := s.pool.Exec(ctx, `INSERT INTO disputes (id, tenant_id, merchant_id, payment_intent_id, scheme, network_case_id, reason_code, category, amount, currency, status, evidence_due_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (tenant_id, scheme, network_case_id) DO NOTHING`,
		id, tenantID, pi.MerchantID, pi.ID, n.Scheme, n.NetworkCaseID, n.ReasonCode, n.Category, n.Amount, pi.Currency, DisputeEvidenceRequired, n.EvidenceDueAt); err != nil {
		return nil, err
	}
	d, err := scanDispute(s.pool.QueryRow(ctx, `SELECT `+disputeCols+` FROM disputes WHERE tenant_id = $1 AND scheme = $2 AND network_case_id = $3`, tenantID, n.Scheme, n.NetworkCaseID))
	if err != nil {
		return nil, err
	}
	if done, err := s.disputeEventDone(ctx, d.ID, NoticeOpened); err != nil || done {
		if err != nil {
			return nil, err
		}
		return s.GetDispute(ctx, tenantID, d.ID)
	}
	// The scheme debits the acquirer at once. The merchant's balance covers it; what the
	// balance cannot cover is booked as owed by the merchant (docs/04 §3.4, chargeback).
	// The split is stored before posting so a retry posts identical lines.
	for attempt := 0; ; attempt++ {
		if d.heldWallet+d.heldRecover != d.Amount {
			avail, err := s.ledger.Balance(ctx, tenantID, ledger.MerchantWallet(d.MerchantID))
			if err != nil {
				return nil, err
			}
			d.heldWallet = min(max(avail, 0), d.Amount)
			d.heldRecover = d.Amount - d.heldWallet
			if _, err := s.pool.Exec(ctx, `UPDATE disputes SET held_wallet = $2, held_recoverable = $3 WHERE id = $1`, d.ID, d.heldWallet, d.heldRecover); err != nil {
				return nil, err
			}
		}
		err := s.post(ctx, tenantID, "chargeback:"+d.ID, "chargeback", d.ID, chargebackPostings(d))
		if err == nil {
			break
		}
		if !errors.Is(err, ErrFunds) || attempt == 2 {
			return nil, err
		}
		d.heldWallet, d.heldRecover = 0, 0 // the balance moved: split again
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO dispute_events (dispute_id, event, source) VALUES ($1, $2, $3)`, d.ID, NoticeOpened, n.Source); err != nil {
			return err
		}
		// Thin payload (docs/02 §10.2): the partner fetches the dispute with GET /v1/disputes/{id}.
		return webhooks.Enqueue(ctx, tx, tenantID, "dispute.opened", map[string]any{"id": d.ID, "object": "dispute", "status": DisputeEvidenceRequired})
	})
	if err != nil {
		return nil, err
	}
	mDisputes.Inc(d.Scheme)
	return s.GetDispute(ctx, tenantID, d.ID)
}

func chargebackPostings(d *Dispute) []ledger.Posting {
	ps := []ledger.Posting{{Account: ledger.SchemePayable(d.Scheme), Direction: ledger.Credit, Amount: d.Amount}}
	if d.heldWallet > 0 {
		ps = append(ps, ledger.Posting{Account: ledger.MerchantWallet(d.MerchantID), Direction: ledger.Debit, Amount: d.heldWallet})
		ps = append(ps, ledger.SafeguardRelease(d.heldWallet)...)
	}
	if d.heldRecover > 0 {
		ps = append(ps, ledger.Posting{Account: ledger.MerchantRecoverable(d.MerchantID), Direction: ledger.Debit, Amount: d.heldRecover})
	}
	return ps
}

// EvidenceInput is the body of POST /v1/disputes/{id}/evidence.
type EvidenceInput struct {
	Files           []string `json:"files"`
	Explanation     string   `json:"explanation"`
	UseAutoEvidence *bool    `json:"use_auto_evidence"`
	Submit          bool     `json:"submit"`
}

// SubmitEvidence stores the merchant's evidence and, with submit, queues the representment
// for operations to file with the sponsor or the scheme before the deadline.
func (s *Service) SubmitEvidence(ctx context.Context, tenantID, id string, in EvidenceInput) (*Dispute, error) {
	d, err := s.GetDispute(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if d.Status != DisputeEvidenceRequired {
		return nil, fmt.Errorf("%w: dispute is %s", ErrConflict, d.Status)
	}
	if len(in.Explanation) > 4000 {
		return nil, invalid("explanation is limited to 4000 characters")
	}
	auto := in.UseAutoEvidence == nil || *in.UseAutoEvidence
	ev := map[string]any{"files": in.Files, "explanation": in.Explanation, "use_auto_evidence": auto}
	if auto {
		ev["auto_evidence"] = d.AutoEvidence
	}
	b, _ := json.Marshal(ev)
	if _, err := s.pool.Exec(ctx, `UPDATE disputes SET evidence = $2, updated_at = now() WHERE id = $1`, d.ID, b); err != nil {
		return nil, err
	}
	if in.Submit {
		if err := s.moveDispute(ctx, d, DisputeRepresented, "represented", "api", DisputeEvidenceRequired); err != nil {
			return nil, err
		}
		if _, err := s.pool.Exec(ctx, `UPDATE disputes SET submitted_at = now() WHERE id = $1`, d.ID); err != nil {
			return nil, err
		}
	}
	return s.GetDispute(ctx, tenantID, d.ID)
}

// AcceptDispute accepts liability: the held amount stays debited.
func (s *Service) AcceptDispute(ctx context.Context, tenantID, id string) (*Dispute, error) {
	d, err := s.GetDispute(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if err := s.moveDispute(ctx, d, DisputeAccepted, "accepted", "api", DisputeEvidenceRequired); err != nil {
		return nil, err
	}
	return s.GetDispute(ctx, tenantID, d.ID)
}

// SweepDisputes warns 48 hours before a deadline and accepts disputes whose deadline passed
// without evidence (docs/01 §7.1: "deadline passes").
func (s *Service) SweepDisputes(ctx context.Context, now time.Time) (expired int, err error) {
	rows, err := s.pool.Query(ctx, `UPDATE disputes SET due_soon_notified = true WHERE status = $1 AND NOT due_soon_notified AND evidence_due_at < $2
		RETURNING id, tenant_id::text`, DisputeEvidenceRequired, now.Add(48*time.Hour))
	if err != nil {
		return 0, err
	}
	type soon struct{ id, tenant string }
	var ss []soon
	for rows.Next() {
		var x soon
		if err := rows.Scan(&x.id, &x.tenant); err != nil {
			rows.Close()
			return 0, err
		}
		ss = append(ss, x)
	}
	rows.Close()
	for _, x := range ss {
		s.notify(ctx, x.tenant, "dispute.evidence_due_soon", map[string]any{"id": x.id, "object": "dispute", "status": DisputeEvidenceRequired})
	}
	rows, err = s.pool.Query(ctx, `SELECT `+disputeCols+` FROM disputes WHERE status = $1 AND evidence_due_at < $2`, DisputeEvidenceRequired, now)
	if err != nil {
		return 0, err
	}
	var due []*Dispute
	for rows.Next() {
		d, err := scanDispute(rows)
		if err != nil {
			rows.Close()
			return 0, err
		}
		due = append(due, d)
	}
	rows.Close()
	for _, d := range due {
		if err := s.moveDispute(ctx, d, DisputeAccepted, "expired", "deadline", DisputeEvidenceRequired); err != nil && !errors.Is(err, ErrConflict) {
			return expired, err
		}
		expired++
	}
	return expired, nil
}

// RecoverShortfalls collects amounts merchants owe (chargebacks larger than their balance,
// MED returns) from their available balance as it comes in.
func (s *Service) RecoverShortfalls(ctx context.Context) (int, error) {
	rows, err := s.pool.Query(ctx, `WITH b AS (SELECT tenant_id, account_id, SUM(balance) AS balance FROM balances
			WHERE account_id LIKE 'asset.merchant\_recoverable.%' OR account_id LIKE 'liability.merchant\_wallet.%' GROUP BY tenant_id, account_id)
		SELECT r.tenant_id::text, substr(r.account_id, 28), r.balance, w.balance FROM b r
		JOIN b w ON w.tenant_id = r.tenant_id AND w.account_id = 'liability.merchant_wallet.' || substr(r.account_id, 28)
		WHERE r.account_id LIKE 'asset.merchant\_recoverable.%' AND r.balance > 0 AND w.balance > 0`)
	if err != nil {
		return 0, err
	}
	type owed struct {
		tenant, merchant string
		owed, wallet     int64
	}
	var debts []owed
	for rows.Next() {
		var x owed
		if err := rows.Scan(&x.tenant, &x.merchant, &x.owed, &x.wallet); err != nil {
			rows.Close()
			return 0, err
		}
		debts = append(debts, x)
	}
	rows.Close()
	n := 0
	for _, x := range debts {
		amt := min(x.owed, x.wallet)
		ps := append([]ledger.Posting{{Account: ledger.MerchantWallet(x.merchant), Direction: ledger.Debit, Amount: amt}, {Account: ledger.MerchantRecoverable(x.merchant), Direction: ledger.Credit, Amount: amt}},
			ledger.SafeguardRelease(amt)...)
		// A fresh key per attempt: the no-negative rule on both accounts makes a repeat harmless.
		if err := s.post(ctx, x.tenant, ids.New("recover"), "shortfall_recovery", x.merchant, ps); err != nil {
			if errors.Is(err, ErrFunds) {
				continue // the balance moved; the next sweep retries
			}
			return n, err
		}
		n++
	}
	return n, nil
}

// WriteOffShortfall books what a merchant still owes as a loss (closed merchant, recovery
// exhausted). It is an operator decision, recorded in the audit trail.
func (s *Service) WriteOffShortfall(ctx context.Context, tenantID, merchantID, reason, actor string) (int64, error) {
	if reason == "" {
		return 0, invalid("a reason is required")
	}
	owed, err := s.ledger.Balance(ctx, tenantID, ledger.MerchantRecoverable(merchantID))
	if err != nil {
		return 0, err
	}
	if owed <= 0 {
		return 0, nil
	}
	if err := s.post(ctx, tenantID, ids.New("writeoff"), "shortfall_write_off", merchantID,
		[]ledger.Posting{{Account: ledger.AccExpenseFraudLoss, Direction: ledger.Debit, Amount: owed}, {Account: ledger.MerchantRecoverable(merchantID), Direction: ledger.Credit, Amount: owed}}); err != nil {
		return 0, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		return audit(ctx, tx, tenantID, actor, "merchant.write_off", merchantID, map[string]any{"amount": owed, "reason": reason})
	})
	return owed, err
}

// ParseDisputeCSV reads a chargeback notice file with the header
// event,scheme,network_case_id,reason_code,category,amount,rrn,auth_code,evidence_due_at
// (integration/operations-runbook.md §2). Lifecycle rows after "opened" need only the first
// three columns.
func ParseDisputeCSV(r io.Reader, source string) ([]DisputeNotice, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = 9
	cr.TrimLeadingSpace = true
	head, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("dispute file: %w", err)
	}
	if strings.Join(head, ",") != "event,scheme,network_case_id,reason_code,category,amount,rrn,auth_code,evidence_due_at" {
		return nil, fmt.Errorf("dispute file: unexpected header %q", strings.Join(head, ","))
	}
	var out []DisputeNotice
	for n := 2; ; n++ {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return nil, fmt.Errorf("dispute file line %d: %w", n, err)
		}
		dn := DisputeNotice{Event: rec[0], Scheme: strings.ToLower(rec[1]), NetworkCaseID: rec[2], ReasonCode: rec[3], Category: rec[4], RRN: rec[6], AuthCode: rec[7],
			Source: fmt.Sprintf("%s:%d", source, n)}
		if rec[5] != "" {
			if dn.Amount, err = strconv.ParseInt(rec[5], 10, 64); err != nil {
				return nil, fmt.Errorf("dispute file line %d: amount %q is not centavos", n, rec[5])
			}
		}
		if rec[8] != "" {
			if dn.EvidenceDueAt, err = time.Parse(time.RFC3339, rec[8]); err != nil {
				return nil, fmt.Errorf("dispute file line %d: evidence_due_at must be RFC 3339", n)
			}
		}
		out = append(out, dn)
	}
}
