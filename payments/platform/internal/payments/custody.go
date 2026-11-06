package payments

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/assets"
	"github.com/monolito123/Gooners/payments/platform/internal/exchange"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
)

// PlatformTenant owns the reconciliation runs that cover every tenant at once: a venue
// account holds the custody of all of them (docs/09 §8).
const PlatformTenant = "00000000-0000-0000-0000-000000000000"

// CustodyReconHour is the hour (Brasília time) after which each night's custody
// reconciliation runs.
const CustodyReconHour = 2

// ReconcileCustody compares what each exchange says the platform holds with the ledger: per
// venue and asset, the custody accounts of every tenant plus the deposits the venue has
// credited that the ledger has not applied yet (unmatched, late). Any difference is an
// exception for operations: a fee the venue charged differently, a transfer nobody booked,
// or something worse. It also refreshes deposits first, so a payment that just arrived is
// not reported as a difference.
func (s *Service) ReconcileCustody(ctx context.Context, day time.Time) (*ReconRun, error) {
	if s.exchanges == nil {
		return nil, ErrCryptoDisabled
	}
	if _, err := s.PollCryptoDeposits(ctx); err != nil {
		s.log.Warn("custody reconciliation: deposits", "err", err)
	}
	// Deposits arrive when no charge waits for them too (a customer paying twice, a transfer
	// to an old address): the venue's last week of deposits, every asset, is recorded first.
	for _, v := range s.exchanges.Venues {
		s.scanDeposits(ctx, v, s.cfg.Now().Add(-7*24*time.Hour))
	}
	run := &ReconRun{ID: ids.New("rr"), Kind: "custody", Source: day.In(brt).Format("2006-01-02"), Date: day.In(brt).Format("2006-01-02")}
	summary := map[string]any{}
	for _, v := range s.exchanges.Venues {
		venue := v.Name()
		got, err := v.Balances(ctx)
		if err != nil {
			run.Exceptions = append(run.Exceptions, ReconItem{Kind: "custody_unreadable", Reference: venue, Detail: err.Error()})
			continue
		}
		books, err := s.custodyBooks(ctx, venue)
		if err != nil {
			return nil, err
		}
		unapplied, pending, err := s.unappliedDeposits(ctx, venue)
		if err != nil {
			return nil, err
		}
		// Each deposit nobody applied is operations' to return or apply, once.
		run.Exceptions = append(run.Exceptions, pending...)
		codes := map[string]bool{}
		for c := range got {
			codes[c] = true
		}
		for c := range books {
			codes[c] = true
		}
		for c := range unapplied {
			codes[c] = true
		}
		sorted := make([]string, 0, len(codes))
		for c := range codes {
			sorted = append(sorted, c)
		}
		sort.Strings(sorted)
		lines := map[string]any{}
		for _, c := range sorted {
			expected := books[c] + unapplied[c]
			a, _ := assets.Get(c)
			lines[c] = map[string]any{"venue": a.Format(got[c]), "ledger": a.Format(books[c]), "unapplied_deposits": a.Format(unapplied[c])}
			if got[c] != expected {
				run.Exceptions = append(run.Exceptions, ReconItem{Kind: "custody_mismatch", Reference: venue + "/" + c, Expected: i64(expected), Actual: i64(got[c]),
					Detail: fmt.Sprintf("%s holds %s %s; the ledger has %s and %s in deposits not yet applied (difference %s)",
						venue, a.Format(got[c]), c, a.Format(books[c]), a.Format(unapplied[c]), a.Format(got[c]-expected))})
			}
		}
		summary[venue] = lines
	}
	run.Summary = summary
	return run, s.saveRun(ctx, PlatformTenant, run, day.In(brt))
}

// custodyBooks is the ledger's balance of asset.custody.<venue>.<asset>, summed over every
// tenant, per asset.
func (s *Service) custodyBooks(ctx context.Context, venue string) (map[string]int64, error) {
	prefix := strings.ReplaceAll(ledger.Custody(venue, ""), "_", `\_`) + "%"
	rows, err := s.pool.Query(ctx, `SELECT a.currency, COALESCE(SUM(b.balance), 0) FROM ledger_accounts a
		LEFT JOIN balances b ON b.tenant_id = a.tenant_id AND b.account_id = a.account_id
		WHERE a.account_id LIKE $1 GROUP BY a.currency`, prefix)
	if err != nil {
		return nil, err
	}
	out := map[string]int64{}
	defer rows.Close()
	for rows.Next() {
		var code string
		var n int64
		if err := rows.Scan(&code, &n); err != nil {
			return nil, err
		}
		out[strings.TrimSpace(code)] += n
	}
	return out, rows.Err()
}

// unappliedDeposits is what the venue has credited for deposits the ledger has not applied
// (unmatched transfers, charges paid too late), per asset, and an exception for each.
func (s *Service) unappliedDeposits(ctx context.Context, venue string) (map[string]int64, []ReconItem, error) {
	// A deposit compliance holds or blocked is in the books already (the compliance hold).
	rows, err := s.pool.Query(ctx, `SELECT d.deposit_id, d.asset, d.units, COALESCE(d.matched_to, ''), d.screening FROM crypto_deposits d
		LEFT JOIN crypto_charges c ON c.payment_intent_id = d.matched_to
		WHERE d.exchange = $1 AND d.screening NOT IN ('held', 'blocked') AND (d.matched_to IS NULL OR c.status IS DISTINCT FROM 'paid') ORDER BY d.deposit_id`, venue)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	sums := map[string]int64{}
	var items []ReconItem
	for rows.Next() {
		var id, code, charge, screened string
		var n int64
		if err := rows.Scan(&id, &code, &n, &charge, &screened); err != nil {
			return nil, nil, err
		}
		code = strings.TrimSpace(code)
		sums[code] += n
		a, _ := assets.Get(code)
		detail := "a deposit that matches no charge: return it to the sender or apply it by hand"
		switch {
		case screened == "pending":
			detail = "its senders' screening never finished: nothing may be done with it until compliance screens it (runbook §4.12)"
		case charge != "":
			detail = "paid after charge " + charge + " expired: return it, or settle at the market with the customer's agreement"
		}
		items = append(items, ReconItem{Kind: "unapplied_crypto_deposit", Reference: venue + "/" + id, Actual: i64(n),
			Detail: fmt.Sprintf("%s %s: %s", a.Format(n), code, detail)})
	}
	return sums, items, rows.Err()
}

// scanDeposits records the venue's confirmed deposits since, for every crypto asset: matched
// ones settle as usual, the rest are kept for operations. Venues that do not list deposits
// through their API are skipped.
func (s *Service) scanDeposits(ctx context.Context, v exchange.Exchange, since time.Time) {
	for _, a := range assets.All() {
		if a.Kind != "crypto" {
			continue
		}
		deps, err := v.Deposits(ctx, a.Code, since)
		if err != nil {
			if !errors.Is(err, exchange.ErrUnsupported) {
				s.log.Warn("custody reconciliation: deposits", "venue", v.Name(), "asset", a.Code, "err", err)
			}
			continue
		}
		for _, d := range deps {
			if d.Confirmed {
				if _, err := s.settleDeposit(ctx, v, d); err != nil {
					s.log.Error("custody reconciliation: deposit", "venue", v.Name(), "deposit", d.ID, "err", err)
				}
			}
		}
	}
}

// fundVenue mirrors a sandbox treasury top-up of a custody account at the venue that holds
// it, so the venue's balance and the ledger stay equal (production funds venues by hand).
func (s *Service) fundVenue(account string, units int64) {
	if s.exchanges == nil || !strings.HasPrefix(account, "asset.custody.") {
		return
	}
	venue, code, ok := strings.Cut(strings.TrimPrefix(account, "asset.custody."), ".")
	if !ok {
		return
	}
	v, ok := s.exchanges.Venue(venue)
	if !ok {
		return
	}
	if f, ok := v.(interface{ Fund(string, int64) }); ok {
		f.Fund(strings.ToUpper(code), units)
	}
}

// custodyReconDue reports whether today's custody reconciliation has not run yet.
func (s *Service) custodyReconDue(ctx context.Context, now time.Time) (bool, error) {
	if s.exchanges == nil || now.In(brt).Hour() < CustodyReconHour {
		return false, nil
	}
	var done bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM recon_runs WHERE tenant_id = $1 AND kind = 'custody' AND source = $2)`,
		PlatformTenant, now.In(brt).Format("2006-01-02")).Scan(&done)
	return !done, err
}
