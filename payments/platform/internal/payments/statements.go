package payments

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/transparency"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// StatementHour is the Brasília hour after which the previous business day is closed into
// statements and a transparency root: late Pix webhooks for the day have arrived by then.
const StatementHour = 1

// maxDaysPerRun bounds one catch-up run after downtime; the next run continues.
const maxDaysPerRun = 31

// Settlement is the API view of a merchant's daily statement (docs/02 §9).
type Settlement struct {
	ID               string         `json:"id"`
	Object           string         `json:"object"`
	MerchantID       string         `json:"merchant_id"`
	Date             string         `json:"date"`
	Currency         string         `json:"currency"`
	Gross            int64          `json:"gross"`
	Fees             int64          `json:"fees"`
	Refunds          int64          `json:"refunds"`
	Chargebacks      int64          `json:"chargebacks"`
	Net              int64          `json:"net"`
	TransactionCount int            `json:"transaction_count"`
	Statement        map[string]any `json:"statement"`
	Transparency     map[string]any `json:"transparency"`

	tenantID  string
	receipts  []string
	leafIndex int
	auditPath []string
	treeSize  int
	logRoot   string
}

// InclusionProof proves a receipt is in a statement and the statement is in the day's log.
type InclusionProof struct {
	ReceiptEventID        string     `json:"receipt_event_id"`
	StatementInclusion    MerklePath `json:"statement_inclusion"`
	TransparencyInclusion MerklePath `json:"transparency_inclusion"`
}

// MerklePath is an RFC 6962 inclusion proof and the root it leads to.
type MerklePath struct {
	LeafIndex int      `json:"leaf_index"`
	TreeSize  int      `json:"tree_size"`
	AuditPath []string `json:"audit_path"`
	Root      string   `json:"root"`
}

// TransparencyRoot is a day's public root.
type TransparencyRoot struct {
	Date      string       `json:"date"`
	TreeSize  int          `json:"tree_size"`
	Root      string       `json:"root"`
	Event     *nostr.Event `json:"event"`
	Previous  string       `json:"prev_event_id,omitempty"`
	CreatedAt string       `json:"created_at"`
}

// settlementMode says how a captured payment reaches the merchant, for its statement line.
func settlementMode(instant bool, parts int) string {
	switch {
	case instant:
		return "instant"
	case parts > 1:
		return "per_installment"
	}
	return "standard"
}

// CloseDueDays closes every business day not yet in the log, up to yesterday in Brasília,
// once the statement hour has passed. It returns the number of days closed.
func (s *Service) CloseDueDays(ctx context.Context, now time.Time) (int, error) {
	if s.transparency == nil || s.receipts == nil {
		return 0, nil
	}
	local := now.In(brt)
	if local.Hour() < StatementHour {
		local = local.AddDate(0, 0, -1)
	}
	yesterday := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, brt).AddDate(0, 0, -1)
	var last *time.Time
	if err := s.pool.QueryRow(ctx, `SELECT max(log_date) FROM transparency_roots`).Scan(&last); err != nil {
		return 0, err
	}
	var next time.Time
	if last != nil {
		next = time.Date(last.Year(), last.Month(), last.Day(), 0, 0, 0, 0, brt).AddDate(0, 0, 1)
	} else {
		// The first run starts at the first capture, so no day with sales is ever skipped.
		var first *time.Time
		if err := s.pool.QueryRow(ctx, `SELECT min(captured_at) FROM payment_intents WHERE captured_at IS NOT NULL`).Scan(&first); err != nil {
			return 0, err
		}
		next = yesterday
		if first != nil {
			f := first.In(brt)
			if d := time.Date(f.Year(), f.Month(), f.Day(), 0, 0, 0, 0, brt); d.Before(next) {
				next = d
			}
		}
	}
	n := 0
	for !next.After(yesterday) && n < maxDaysPerRun {
		if _, err := s.CloseDay(ctx, next); err != nil {
			return n, fmt.Errorf("close %s: %w", next.Format("2006-01-02"), err)
		}
		next = next.AddDate(0, 0, 1)
		n++
	}
	return n, nil
}

type statementDraft struct {
	tenant, merchant, rootPub string
	st                        transparency.Statement
	body                      map[string]any
	commitment, salt          string
	leaf                      []byte
	devices                   []string
}

// CloseDay builds every merchant's statement for the Brasília business day of day, the
// day's padded log and its signed root chained to the previous one, stores them in one
// transaction and publishes them. Closing a day twice returns the stored root.
func (s *Service) CloseDay(ctx context.Context, day time.Time) (*TransparencyRoot, error) {
	if s.transparency == nil || s.receipts == nil {
		return nil, fmt.Errorf("%w: statements need the receipts and transparency signers", ErrDisabled)
	}
	d := day.In(brt)
	start := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, brt)
	end := start.AddDate(0, 0, 1)
	date := start.Format("2006-01-02")
	if r, err := s.GetTransparencyRoot(ctx, date); err == nil {
		return r, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	drafts, err := s.statementDrafts(ctx, start, end, date)
	if err != nil {
		return nil, err
	}
	leaves := make([][]byte, len(drafts))
	for i, dr := range drafts {
		leaves[i] = dr.leaf
	}
	padTo := s.cfg.TransparencyPadTo
	if padTo <= 0 {
		padTo = transparency.DefaultPadTo
	}
	log, err := transparency.BuildLog(leaves, padTo)
	if err != nil {
		return nil, err
	}
	var prev string
	if err := s.pool.QueryRow(ctx, `SELECT COALESCE((SELECT event_id FROM transparency_roots WHERE log_date < $1 ORDER BY log_date DESC LIMIT 1), '')`, start).Scan(&prev); err != nil {
		return nil, err
	}
	now := s.cfg.Now()
	rootEv, err := transparency.RootEvent(date, log, prev, s.cfg.RelayURL, transparency.Padding(padTo), now)
	if err != nil {
		return nil, err
	}
	if err := s.transparency.SignEvent(rootEv, nil); err != nil {
		return nil, err
	}

	type signed struct {
		dr    statementDraft
		id    string
		index int
		ev    *nostr.Event
	}
	var out []signed
	for _, dr := range drafts {
		idx := log.Index(dr.leaf)
		ev, err := transparency.StatementEvent(dr.body, dr.commitment, dr.salt, rootEv.ID, idx, log, dr.rootPub, s.cfg.RelayURL, now)
		if err != nil {
			return nil, err
		}
		if err := s.receipts.Author.SignEvent(ev, nil); err != nil {
			return nil, err
		}
		out = append(out, signed{dr, ids.New("st"), idx, ev})
	}

	rootJSON, _ := json.Marshal(rootEv)
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO transparency_roots (log_date, event_id, root, tree_size, prev_event_id, event) VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6)`,
			start, rootEv.ID, hex.EncodeToString(log.Root), len(log.Leaves), prev, rootJSON); err != nil {
			return err
		}
		for _, x := range out {
			t := x.dr.body["totals"].(map[string]any)
			evJSON, _ := json.Marshal(x.ev)
			receiptIDs := make([]string, len(x.dr.st.Lines))
			for i, l := range x.dr.st.Lines {
				receiptIDs[i] = l.ReceiptEventID
			}
			if _, err := tx.Exec(ctx, `INSERT INTO settlements (id, tenant_id, merchant_id, settle_date, currency, gross, fees, refunds, chargebacks, net,
				transaction_count, receipts, receipts_root, commitment, leaf_salt, leaf_index, audit_path, log_date, statement_event_id, statement_event)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $4, $18, $19)`,
				x.id, x.dr.tenant, x.dr.merchant, start, x.dr.st.Currency, t["gross"], t["fees"], t["refunds"], t["chargebacks"], t["net"],
				len(x.dr.st.Lines), receiptIDs, x.dr.body["receipts_root"], x.dr.commitment, x.dr.salt, x.index,
				transparency.HexPath(transparency.AuditPath(x.index, log.Leaves)), x.ev.ID, evJSON); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if r, gerr := s.GetTransparencyRoot(ctx, date); gerr == nil {
			return r, nil // another replica closed the day first
		}
		return nil, err
	}

	// Publish the public root and gift-wrap each statement to the merchant's root key and devices.
	events := []*nostr.Event{rootEv}
	for _, x := range out {
		for _, pub := range append([]string{x.dr.rootPub}, x.dr.devices...) {
			if pub == "" {
				continue
			}
			if _, w, err := nostr.Wrap(x.ev, s.receipts.Author, pub, nostr.WrapOptions{}); err == nil {
				events = append(events, w)
			}
		}
		s.notify(ctx, x.dr.tenant, "settlement.published", map[string]any{"id": x.id, "object": "settlement", "merchant_id": x.dr.merchant,
			"date": date, "net": x.dr.body["totals"].(map[string]any)["net"], "statement_event_id": x.ev.ID, "root_event_id": rootEv.ID})
	}
	if s.publisher != nil {
		go func() {
			c, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
			defer cancel()
			if _, err := s.publisher.Publish(c, events...); err != nil {
				s.log.Warn("publish statements", "date", date, "err", err)
			}
		}()
	}
	s.log.Info("day closed", "date", date, "statements", len(out), "tree_size", len(log.Leaves), "root_event", rootEv.ID)
	return s.GetTransparencyRoot(ctx, date)
}

// statementDrafts gathers the day's captures, refunds and chargebacks by merchant.
func (s *Service) statementDrafts(ctx context.Context, start, end time.Time, date string) ([]statementDraft, error) {
	byMerchant := map[string]*statementDraft{}
	var order []string
	get := func(tenant, merchant string) *statementDraft {
		if d, ok := byMerchant[merchant]; ok {
			return d
		}
		d := &statementDraft{tenant: tenant, merchant: merchant, st: transparency.Statement{MerchantID: merchant, Date: date, Currency: s.cfg.Currency, Lines: []transparency.Line{}}}
		byMerchant[merchant] = d
		order = append(order, merchant)
		return d
	}
	scan := func(q string, f func(pgx.Rows) error) error {
		rows, err := s.pool.Query(ctx, q, start, end)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			if err := f(rows); err != nil {
				return err
			}
		}
		return rows.Err()
	}
	err := scan(`SELECT tenant_id::text, merchant_id, receipt_event_id, amount_captured, COALESCE(fee, 0), COALESCE(settlement_mode, 'standard')
		FROM payment_intents WHERE captured_at >= $1 AND captured_at < $2 AND receipt_event_id IS NOT NULL
		ORDER BY merchant_id, captured_at, id`, func(r pgx.Rows) error {
		var tenant, merchant string
		var l transparency.Line
		if err := r.Scan(&tenant, &merchant, &l.ReceiptEventID, &l.Amount, &l.Fee, &l.Settles); err != nil {
			return err
		}
		d := get(tenant, merchant)
		d.st.Lines = append(d.st.Lines, l)
		return nil
	})
	if err != nil {
		return nil, err
	}
	err = scan(`SELECT p.tenant_id::text, p.merchant_id, sum(r.amount) FROM refunds r JOIN payment_intents p ON p.id = r.payment_intent_id
		WHERE r.status = 'succeeded' AND r.updated_at >= $1 AND r.updated_at < $2 GROUP BY 1, 2`, func(r pgx.Rows) error {
		var tenant, merchant string
		var amount int64
		if err := r.Scan(&tenant, &merchant, &amount); err != nil {
			return err
		}
		get(tenant, merchant).st.Refunds = amount
		return nil
	})
	if err != nil {
		return nil, err
	}
	err = scan(`SELECT tenant_id::text, merchant_id, sum(amount) FROM disputes WHERE created_at >= $1 AND created_at < $2 GROUP BY 1, 2`, func(r pgx.Rows) error {
		var tenant, merchant string
		var amount int64
		if err := r.Scan(&tenant, &merchant, &amount); err != nil {
			return err
		}
		get(tenant, merchant).st.Chargebacks = amount
		return nil
	})
	if err != nil {
		return nil, err
	}

	out := make([]statementDraft, 0, len(order))
	for _, merchant := range order {
		d := byMerchant[merchant]
		if err := s.pool.QueryRow(ctx, `SELECT COALESCE(root_pubkey, '') FROM merchants WHERE id = $1`, merchant).Scan(&d.rootPub); err != nil {
			return nil, err
		}
		rows, err := s.pool.Query(ctx, `SELECT pubkey FROM devices WHERE merchant_id = $1 AND status = 'active'`, merchant)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var p string
			if rows.Scan(&p) == nil {
				d.devices = append(d.devices, p)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		if d.body, err = d.st.Body(); err != nil {
			return nil, err
		}
		if d.commitment, err = transparency.Commitment(d.body); err != nil {
			return nil, err
		}
		salt := make([]byte, 32)
		if _, err := rand.Read(salt); err != nil {
			return nil, err
		}
		d.salt = hex.EncodeToString(salt)
		if d.leaf, err = transparency.LeafData(d.salt, d.commitment); err != nil {
			return nil, err
		}
		out = append(out, *d)
	}
	return out, nil
}

const settlementCols = `id, tenant_id::text, merchant_id, settle_date, currency, gross, fees, refunds, chargebacks, net, transaction_count,
	receipts, receipts_root, leaf_index, audit_path, statement_event_id, (SELECT root FROM transparency_roots t WHERE t.log_date = s.log_date),
	(SELECT event_id FROM transparency_roots t WHERE t.log_date = s.log_date), (SELECT tree_size FROM transparency_roots t WHERE t.log_date = s.log_date)`

func scanSettlement(row pgx.Row) (*Settlement, error) {
	st := &Settlement{Object: "settlement"}
	var day time.Time
	var receiptsRoot, statementID, rootEventID string
	if err := row.Scan(&st.ID, &st.tenantID, &st.MerchantID, &day, &st.Currency, &st.Gross, &st.Fees, &st.Refunds, &st.Chargebacks, &st.Net,
		&st.TransactionCount, &st.receipts, &receiptsRoot, &st.leafIndex, &st.auditPath, &statementID, &st.logRoot, &rootEventID, &st.treeSize); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	st.Date = day.Format("2006-01-02")
	st.Statement = map[string]any{"nostr_event_id": statementID, "merkle_root": receiptsRoot, "leaf_count": len(st.receipts)}
	st.Transparency = map[string]any{"log_date": st.Date, "root_event_id": rootEventID}
	return st, nil
}

// GetSettlement returns one statement of the tenant.
func (s *Service) GetSettlement(ctx context.Context, tenantID, id string) (*Settlement, error) {
	return scanSettlement(s.pool.QueryRow(ctx, `SELECT `+settlementCols+` FROM settlements s WHERE tenant_id = $1 AND id = $2`, tenantID, id))
}

// ListSettlements pages through statements, newest day first, optionally for one merchant.
func (s *Service) ListSettlements(ctx context.Context, tenantID, merchantID, startingAfter string, limit int) ([]*Settlement, bool, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx, `SELECT `+settlementCols+` FROM settlements s WHERE tenant_id = $1 AND ($2 = '' OR merchant_id = $2)
		AND ($3 = '' OR (settle_date, id) < (SELECT settle_date, id FROM settlements WHERE id = $3))
		ORDER BY settle_date DESC, id DESC LIMIT $4`, tenantID, merchantID, startingAfter, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	var out []*Settlement
	for rows.Next() {
		st, err := scanSettlement(rows)
		if err != nil {
			return nil, false, err
		}
		out = append(out, st)
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

// SettlementProof proves receiptEventID is in the statement and the statement in the log.
func (s *Service) SettlementProof(ctx context.Context, tenantID, id, receiptEventID string) (*InclusionProof, error) {
	st, err := s.GetSettlement(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	leaves := make([][]byte, len(st.receipts))
	index := -1
	for i, r := range st.receipts {
		if leaves[i], err = hex.DecodeString(r); err != nil {
			return nil, err
		}
		if r == receiptEventID {
			index = i
		}
	}
	if index < 0 {
		return nil, fmt.Errorf("%w: receipt %s is not in settlement %s", ErrNotFound, receiptEventID, id)
	}
	return &InclusionProof{
		ReceiptEventID: receiptEventID,
		StatementInclusion: MerklePath{LeafIndex: index, TreeSize: len(leaves),
			AuditPath: transparency.HexPath(transparency.AuditPath(index, leaves)), Root: hex.EncodeToString(transparency.MTH(leaves))},
		TransparencyInclusion: MerklePath{LeafIndex: st.leafIndex, TreeSize: st.treeSize, AuditPath: st.auditPath, Root: st.logRoot},
	}, nil
}

// StatementEvent returns the signed kind 7713 of a settlement, for the merchant to verify.
func (s *Service) StatementEvent(ctx context.Context, tenantID, id string) (*nostr.Event, error) {
	var raw []byte
	if err := s.pool.QueryRow(ctx, `SELECT statement_event FROM settlements WHERE tenant_id = $1 AND id = $2`, tenantID, id).Scan(&raw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	var ev nostr.Event
	return &ev, json.Unmarshal(raw, &ev)
}

// GetTransparencyRoot returns a day's public root. It is public data: anyone may verify it.
func (s *Service) GetTransparencyRoot(ctx context.Context, date string) (*TransparencyRoot, error) {
	day, err := time.ParseInLocation("2006-01-02", date, brt)
	if err != nil {
		return nil, invalid("date must be YYYY-MM-DD")
	}
	r := &TransparencyRoot{Date: date}
	var raw []byte
	var prev *string
	var created time.Time
	if err := s.pool.QueryRow(ctx, `SELECT tree_size, root, prev_event_id, event, created_at FROM transparency_roots WHERE log_date = $1`, day).
		Scan(&r.TreeSize, &r.Root, &prev, &raw, &created); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: no transparency root for %s", ErrNotFound, date)
		}
		return nil, err
	}
	if prev != nil {
		r.Previous = *prev
	}
	r.CreatedAt = created.UTC().Format(time.RFC3339)
	r.Event = &nostr.Event{}
	return r, json.Unmarshal(raw, r.Event)
}
