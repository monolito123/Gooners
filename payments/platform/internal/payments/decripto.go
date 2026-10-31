package payments

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/monolito123/Gooners/payments/platform/internal/assets"
	"github.com/monolito123/Gooners/payments/platform/internal/decripto"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/pricing"
)

// DeCriptoReport is a month's DeCripto (IN RFB 2.291/2025): the file the platform files at
// the Receita Federal's Coleta Nacional (e-CAC) for its clients' crypto operations
// (docs/09 §6.3).
type DeCriptoReport struct {
	Period   string          `json:"period"` // YYYY-MM
	DueBy    string          `json:"due_by"` // the last business day of the next month
	SHA256   string          `json:"sha256"`
	Records  decripto.Totals `json:"records"`
	Warnings []string        `json:"warnings"`
	FiledAt  *time.Time      `json:"filed_at,omitempty"`
	Receipt  string          `json:"receipt,omitempty"`
	Content  []byte          `json:"-"`
}

// DeCriptoDue is the filing deadline for a month's operations: the last business day of the
// following month, 23:59:59 Brasília.
func DeCriptoDue(month time.Time) time.Time {
	m := time.Date(month.Year(), month.Month(), 1, 12, 0, 0, 0, brt)
	d := m.AddDate(0, 2, -1) // the last day of the next month
	for !pricing.IsBusinessDay(d) {
		d = d.AddDate(0, 0, -1)
	}
	return d
}

// BuildDeCripto writes and stores the DeCripto of the month that contains month. Each
// operation of the platform's clients is a record: a crypto payment is a transfer in for
// the sale of goods (0350) and the sale of the coins to the platform (0110); a conversion is
// a purchase or sale with the platform as counterparty (0110); a withdrawal goes to another
// provider (0450) or to a wallet no provider keeps (0650). The December file also carries
// the year-end balances (1000/1010) and the platform's CARF identification (2000/2999).
// A month already filed is not regenerated.
func (s *Service) BuildDeCripto(ctx context.Context, month time.Time) (*DeCriptoReport, error) {
	start := time.Date(month.In(brt).Year(), month.In(brt).Month(), 1, 0, 0, 0, 0, brt)
	end := start.AddDate(0, 1, 0)
	period := start.Format("2006-01")
	var filed *time.Time
	err := s.pool.QueryRow(ctx, `SELECT filed_at FROM decripto_reports WHERE period = $1`, start).Scan(&filed)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if filed != nil {
		return nil, fmt.Errorf("%w: the DeCripto of %s was filed on %s; a correction is a rectifying file, prepared by hand", ErrConflict, period, filed.In(brt).Format("02/01/2006"))
	}
	doc := strings.Map(keepDigits, s.cfg.PlatformDocument)
	if len(doc) != 14 {
		return nil, fmt.Errorf("%w: the DeCripto needs the platform's CNPJ (PLATFORM_DOCUMENT)", ErrDisabled)
	}
	name := s.cfg.ReportingName
	if name == "" {
		name = "goonersPAY"
	}
	platform := decripto.Person{Document: doc, Country: "BR", Name: name}
	r := decripto.Report{CNPJ: doc, Name: name, URL: s.cfg.ReportingURL}
	var warnings []string

	// Crypto payments to merchants, sold for reais on arrival.
	rows, err := s.pool.Query(ctx, `SELECT c.payment_intent_id, c.asset, c.units, c.paid_at, p.amount, COALESCE(p.fee, 0), m.document, m.legal_name
		FROM crypto_charges c JOIN payment_intents p ON p.id = c.payment_intent_id JOIN merchants m ON m.id = c.merchant_id
		WHERE c.status = 'paid' AND c.paid_at >= $1 AND c.paid_at < $2`, start, end)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, code, mdoc, mname string
		var units, amount, fee int64
		var at time.Time
		if err := rows.Scan(&id, &code, &units, &at, &amount, &fee, &mdoc, &mname); err != nil {
			rows.Close()
			return nil, err
		}
		client := merchantPerson(mdoc, mname)
		q := quantityOf(code, units)
		r.Ops = append(r.Ops,
			decripto.Op{Record: "0350", Date: at, ID: id, TransferType: decripto.EntradaVendaBensServicos, Value: amount, Asset: code, Quantity: q, Client: client},
			decripto.Op{Record: "0110", Date: at, ID: id + "-venda", Value: amount, Fees: fee, Asset: code, Quantity: q, Buyer: platform, Seller: client})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Conversions between reais and crypto, with the platform as counterparty.
	rows, err = s.pool.Query(ctx, `SELECT c.id, c.side, c.asset, c.asset_units, c.brl_units, c.fee, c.executed_at, m.document, m.legal_name
		FROM conversions c JOIN merchants m ON m.id = c.merchant_id
		WHERE c.kind = 'crypto' AND c.status = 'executed' AND c.executed_at >= $1 AND c.executed_at < $2`, start, end)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, side, code, mdoc, mname string
		var units, brl, fee int64
		var at time.Time
		if err := rows.Scan(&id, &side, &code, &units, &brl, &fee, &at, &mdoc, &mname); err != nil {
			rows.Close()
			return nil, err
		}
		op := decripto.Op{Record: "0110", Date: at, ID: id, Value: brl, Fees: fee, Asset: code, Quantity: quantityOf(code, units)}
		if client := merchantPerson(mdoc, mname); side == "buy" {
			op.Buyer, op.Seller = client, platform
		} else {
			op.Buyer, op.Seller = platform, client
		}
		r.Ops = append(r.Ops, op)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Withdrawals: to another provider (0450) or to a wallet no provider keeps (0650).
	rows, err = s.pool.Query(ctx, `SELECT t.id, t.asset, t.units, t.fee_units, t.value_brl, COALESCE(t.destination->>'type', 'wallet'), t.created_at, m.document, m.legal_name
		FROM asset_transfers t JOIN merchants m ON m.id = t.merchant_id
		WHERE t.kind = 'crypto' AND t.status = 'sent' AND t.created_at >= $1 AND t.created_at < $2`, start, end)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, code, kind, mdoc, mname string
		var units, feeUnits int64
		var value *int64
		var at time.Time
		if err := rows.Scan(&id, &code, &units, &feeUnits, &value, &kind, &at, &mdoc, &mname); err != nil {
			rows.Close()
			return nil, err
		}
		if value == nil || *value <= 0 {
			warnings = append(warnings, fmt.Sprintf("withdrawal %s has no value in reais (no price when it was sent): value it and add it before filing", id))
			continue
		}
		op := decripto.Op{Record: "0650", Date: at, ID: id, Value: *value, Fees: *value * feeUnits / units, Asset: code, Quantity: quantityOf(code, units),
			Client: merchantPerson(mdoc, mname)}
		if kind == "exchange" {
			op.Record, op.TransferType = "0450", decripto.SaidaParaPrestadora
		}
		r.Ops = append(r.Ops, op)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if start.Month() == time.December {
		r.CARF, r.YearEndDate = true, end.AddDate(0, 0, -1)
		ye, err := s.yearEndHoldings(ctx, end)
		if err != nil {
			return nil, err
		}
		r.YearEnd = ye
	}
	content, totals, w, err := r.Encode()
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	warnings = append(warnings, w...)
	sum := sha256.Sum256(content)
	rep := &DeCriptoReport{Period: period, DueBy: DeCriptoDue(start).Format("2006-01-02"), SHA256: hex.EncodeToString(sum[:]), Records: totals,
		Warnings: warnings, Content: content}
	if rep.Warnings == nil {
		rep.Warnings = []string{}
	}
	recs, _ := json.Marshal(map[string]any{"totals": totals, "warnings": rep.Warnings})
	if _, err := s.pool.Exec(ctx, `INSERT INTO decripto_reports (period, content, sha256, records) VALUES ($1, $2, $3, $4)
		ON CONFLICT (period) DO UPDATE SET content = EXCLUDED.content, sha256 = EXCLUDED.sha256, records = EXCLUDED.records, generated_at = now()
		WHERE decripto_reports.filed_at IS NULL`, start, string(content), rep.SHA256, recs); err != nil {
		return nil, err
	}
	return rep, nil
}

// MarkDeCriptoFiled records that operations filed a month's file, with the receipt the
// Coleta Nacional gave. The file filed must be the one stored (its SHA-256).
func (s *Service) MarkDeCriptoFiled(ctx context.Context, month time.Time, sha, receipt, actor string) error {
	if receipt == "" || actor == "" {
		return invalid("receipt and actor are required")
	}
	start := time.Date(month.In(brt).Year(), month.In(brt).Month(), 1, 0, 0, 0, 0, brt)
	tag, err := s.pool.Exec(ctx, `UPDATE decripto_reports SET filed_at = now(), filed_by = $3, receipt = $4 WHERE period = $1 AND sha256 = $2 AND filed_at IS NULL`,
		start, sha, actor, receipt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: no unfiled DeCripto of %s with that SHA-256", ErrNotFound, start.Format("2006-01"))
	}
	return nil
}

// deCriptoDue reports whether last month's DeCripto has not been generated yet (the job
// writes it on the first days of each month, so operations have weeks to review and file).
func (s *Service) deCriptoDue(ctx context.Context, now time.Time) (time.Time, bool, error) {
	if s.exchanges == nil || len(strings.Map(keepDigits, s.cfg.PlatformDocument)) != 14 {
		return time.Time{}, false, nil
	}
	b := now.In(brt)
	last := time.Date(b.Year(), b.Month(), 1, 0, 0, 0, 0, brt).AddDate(0, -1, 0)
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM decripto_reports WHERE period = $1)`, last).Scan(&exists)
	return last, !exists && b.Hour() >= 4, err
}

// yearEndHoldings are the merchants' crypto balances and their reais at the end of the
// year (before end), from the ledger's postings.
func (s *Service) yearEndHoldings(ctx context.Context, end time.Time) ([]decripto.YearEnd, error) {
	holdingPrefix := strings.ReplaceAll(ledger.MerchantHolding("", ""), "_", `\_`)
	rows, err := s.pool.Query(ctx, `SELECT a.account_id, a.currency, SUM(CASE WHEN p.direction = a.normal_side THEN p.amount ELSE -p.amount END)
		FROM ledger_accounts a JOIN postings p ON p.tenant_id = a.tenant_id AND p.account_id = a.account_id
		JOIN journals j ON j.tenant_id = p.tenant_id AND j.journal_id = p.journal_id
		WHERE a.account_id LIKE $1 AND j.posted_at < $2 GROUP BY a.account_id, a.currency`, strings.TrimSuffix(holdingPrefix, ".")+"%", end)
	if err != nil {
		return nil, err
	}
	byMerchant := map[string][]decripto.Holding{}
	for rows.Next() {
		var acct, code string
		var units int64
		if err := rows.Scan(&acct, &code, &units); err != nil {
			rows.Close()
			return nil, err
		}
		code = strings.TrimSpace(code)
		a, err := assets.Get(code)
		if err != nil || a.Kind != "crypto" || units <= 0 {
			continue
		}
		rest := strings.TrimPrefix(acct, "liability.merchant_holding.")
		m := rest[:strings.LastIndex(rest, ".")]
		byMerchant[m] = append(byMerchant[m], decripto.Holding{Asset: code, Quantity: a.Format(units)})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []decripto.YearEnd
	for m, hs := range byMerchant {
		var mdoc, mname, tenant string
		if err := s.pool.QueryRow(ctx, `SELECT document, legal_name, tenant_id::text FROM merchants WHERE id = $1`, m).Scan(&mdoc, &mname, &tenant); err != nil {
			return nil, err
		}
		var brl int64
		if err := s.pool.QueryRow(ctx, `SELECT COALESCE(SUM(CASE WHEN p.direction = 'credit' THEN p.amount ELSE -p.amount END), 0)
			FROM postings p JOIN journals j ON j.tenant_id = p.tenant_id AND j.journal_id = p.journal_id
			WHERE p.tenant_id = $1 AND p.account_id = $2 AND j.posted_at < $3`, tenant, ledger.MerchantWallet(m), end).Scan(&brl); err != nil {
			return nil, err
		}
		out = append(out, decripto.YearEnd{Client: merchantPerson(mdoc, mname), BRL: brl, Holdings: hs})
	}
	return out, nil
}

func merchantPerson(document, name string) decripto.Person {
	return decripto.Person{Document: strings.Map(keepDigits, document), Country: "BR", Name: name}
}

func quantityOf(code string, units int64) string {
	a, err := assets.Get(code)
	if err != nil {
		return ""
	}
	return a.Format(units)
}

func keepDigits(r rune) rune {
	if r >= '0' && r <= '9' {
		return r
	}
	return -1
}
