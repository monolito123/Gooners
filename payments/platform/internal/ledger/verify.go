package ledger

import (
	"context"
	"fmt"
)

// Violation of a ledger invariant (docs/04-serverless-backend.md §3.3).
type Violation struct {
	Invariant string
	Detail    string
}

// VerifyOptions names the accounts used by the safeguarding invariant L5.
type VerifyOptions struct {
	SafeguardingReserve     string   // e.g. asset.safeguarding_reserve
	ClientLiabilityPrefixes []string // e.g. liability.merchant_wallet., liability.merchant_reserve.
	ClientLiabilityAccounts []string // e.g. liability.pix_in_transit
}

// DefaultVerifyOptions matches the chart of accounts in Chart.
var DefaultVerifyOptions = VerifyOptions{
	SafeguardingReserve:     AccSafeguardingReserve,
	ClientLiabilityPrefixes: []string{"liability.merchant_wallet.", "liability.merchant_reserve."},
	ClientLiabilityAccounts: []string{AccPixInTransit},
}

// Verify checks invariants L1–L5 for every tenant and returns the violations found.
func (l *Ledger) Verify(ctx context.Context, opt VerifyOptions) ([]Violation, error) {
	var out []Violation
	q := func(inv, sql string, args ...any) error {
		rows, err := l.pool.Query(ctx, sql, args...)
		if err != nil {
			return fmt.Errorf("%s: %w", inv, err)
		}
		defer rows.Close()
		for rows.Next() {
			var detail string
			if err := rows.Scan(&detail); err != nil {
				return err
			}
			out = append(out, Violation{inv, detail})
		}
		return rows.Err()
	}
	if err := q("L1 journal balances", `SELECT tenant_id::text || ' ' || journal_id FROM postings GROUP BY tenant_id, journal_id
		HAVING SUM(CASE direction WHEN 'debit' THEN amount ELSE -amount END) <> 0`); err != nil {
		return nil, err
	}
	if err := q("L2 balances equal postings", `WITH p AS (
			SELECT p.tenant_id, p.account_id, p.shard, SUM(CASE WHEN p.direction = a.normal_side THEN p.amount ELSE -p.amount END) AS s
			FROM postings p JOIN ledger_accounts a USING (tenant_id, account_id) GROUP BY 1, 2, 3)
		SELECT COALESCE(p.account_id, b.account_id) || ' shard ' || COALESCE(p.shard, b.shard)::text
		FROM p FULL JOIN balances b ON b.tenant_id = p.tenant_id AND b.account_id = p.account_id AND b.shard = p.shard
		WHERE COALESCE(p.s, 0) IS DISTINCT FROM COALESCE(b.balance, 0)`); err != nil {
		return nil, err
	}
	if err := q("L3 no forbidden negative balance", `SELECT b.account_id || ' = ' || SUM(b.balance)::text FROM balances b
		JOIN ledger_accounts a USING (tenant_id, account_id) WHERE NOT a.allow_negative
		GROUP BY b.tenant_id, b.account_id HAVING SUM(b.balance) < 0`); err != nil {
		return nil, err
	}
	if err := q("L4 trial balance", `SELECT b.tenant_id::text || ' ' || a.currency || ' = ' || SUM(CASE a.normal_side WHEN 'debit' THEN b.balance ELSE -b.balance END)::text
		FROM balances b JOIN ledger_accounts a USING (tenant_id, account_id)
		GROUP BY b.tenant_id, a.currency HAVING SUM(CASE a.normal_side WHEN 'debit' THEN b.balance ELSE -b.balance END) <> 0`); err != nil {
		return nil, err
	}
	if opt.SafeguardingReserve != "" {
		likes := make([]string, len(opt.ClientLiabilityPrefixes))
		for i, p := range opt.ClientLiabilityPrefixes {
			likes[i] = p + "%"
		}
		if err := q("L5 safeguarding", `SELECT tenant_id::text || ' liabilities ' || liab::text || ' > reserve ' || res::text FROM (
				SELECT tenant_id,
					SUM(CASE WHEN account_id LIKE ANY($1) OR account_id = ANY($2) THEN balance ELSE 0 END) AS liab,
					SUM(CASE WHEN account_id = $3 THEN balance ELSE 0 END) AS res
				FROM balances GROUP BY tenant_id) x WHERE liab > res`, likes, opt.ClientLiabilityAccounts, opt.SafeguardingReserve); err != nil {
			return nil, err
		}
	}
	return out, nil
}
