package payments

import (
	"context"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/db"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
)

// PixReconHour is the hour (Brasília time) after which the previous day's Pix is reconciled.
const PixReconHour = 6

// RunPeriodic runs the periodic jobs once, if holder has the jobs lease: scheduled releases,
// payout and dispute sweeps, shortfall recovery and, after 06:00 BRT, the previous day's Pix
// reconciliation for every tenant not yet reconciled. Call it every minute from each replica.
func (s *Service) RunPeriodic(ctx context.Context, holder string) {
	ok, err := db.TryLease(ctx, s.pool, "periodic-jobs", holder, 2*time.Minute)
	if err != nil || !ok {
		if err != nil {
			s.log.Error("jobs lease", "err", err)
		}
		return
	}
	// Each job renews the lease first; if another replica took it meanwhile, stop here.
	renew := func() bool {
		ok, err := db.TryLease(ctx, s.pool, "periodic-jobs", holder, 2*time.Minute)
		return err == nil && ok
	}
	now := s.cfg.Now()
	if n, err := s.ReleaseDue(ctx, now); err != nil {
		s.log.Error("release due", "err", err)
	} else if n > 0 {
		s.log.Info("released receivables", "count", n)
	}
	if !renew() {
		return
	}
	if s.payout != nil {
		if err := s.ReconcilePayouts(ctx); err != nil {
			s.log.Error("reconcile payouts", "err", err)
		}
	}
	if !renew() {
		return
	}
	if n, err := s.SweepDisputes(ctx, now); err != nil {
		s.log.Error("sweep disputes", "err", err)
	} else if n > 0 {
		s.log.Info("disputes accepted at their deadline", "count", n)
	}
	if n, err := s.SyncReceivableUnits(ctx, now); err != nil {
		s.log.Error("register receivable units", "err", err)
	} else if n > 0 {
		s.log.Info("receivable units registered", "count", n)
	}
	if n, err := s.CloseDueDays(ctx, now); err != nil {
		s.log.Error("close days", "err", err)
	} else if n > 0 {
		s.log.Info("days closed into statements", "count", n)
	}
	if !renew() {
		return
	}
	if err := s.PurgeAuthState(ctx); err != nil {
		s.log.Error("purge auth state", "err", err)
	}
	if n, err := s.RecoverShortfalls(ctx); err != nil {
		s.log.Error("recover shortfalls", "err", err)
	} else if n > 0 {
		s.log.Info("recovered merchant shortfalls", "count", n)
	}
	if s.pix != nil && now.In(brt).Hour() >= PixReconHour {
		day := now.In(brt).AddDate(0, 0, -1)
		rows, err := s.pool.Query(ctx, `SELECT DISTINCT m.tenant_id::text FROM merchants m WHERE NOT EXISTS (
			SELECT 1 FROM recon_runs r WHERE r.tenant_id = m.tenant_id AND r.kind = 'pix_daily' AND r.source = $1)`, day.Format("2006-01-02"))
		if err != nil {
			s.log.Error("pix reconciliation", "err", err)
			return
		}
		var tenants []string
		for rows.Next() {
			var t string
			if rows.Scan(&t) == nil {
				tenants = append(tenants, t)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			s.log.Error("pix reconciliation", "err", err)
			return
		}
		for _, t := range tenants {
			if !renew() {
				return
			}
			run, err := s.ReconcilePix(ctx, t, day)
			if err != nil {
				s.log.Error("pix reconciliation", "tenant", t, "err", err)
				continue
			}
			s.log.Info("pix reconciliation", "tenant", t, "date", run.Date, "status", run.Status, "summary", run.Summary, "exceptions", len(run.Exceptions))
		}
	}
}

// Counters updated by the business flows.
var (
	mAuthorizations = metrics.Default.Counter("goonerspay_card_authorizations_total", "Card-present authorizations by outcome.", "outcome")
	mPixReceived    = metrics.Default.Counter("goonerspay_pix_received_total", "Pix payments credited to merchants.")
	mDisputes       = metrics.Default.Counter("goonerspay_disputes_opened_total", "Chargebacks received.", "scheme")
	mMED            = metrics.Default.Counter("goonerspay_pix_med_returns_total", "Pix returned under the MED.", "natureza")
)

// RegisterMetrics adds the database-backed gauges operations alert on (runbook §3).
func (s *Service) RegisterMetrics(r *metrics.Registry) {
	count := func(name, help, sql string) {
		r.Gauge(name, help, func(ctx context.Context) ([]metrics.Sample, error) {
			var n int64
			if err := s.pool.QueryRow(ctx, sql).Scan(&n); err != nil {
				return nil, err
			}
			return []metrics.Sample{{Value: float64(n)}}, nil
		})
	}
	grouped := func(name, help, label, sql string) {
		r.Gauge(name, help, func(ctx context.Context) ([]metrics.Sample, error) {
			rows, err := s.pool.Query(ctx, sql)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			var out []metrics.Sample
			for rows.Next() {
				var k string
				var n float64
				if err := rows.Scan(&k, &n); err != nil {
					return nil, err
				}
				out = append(out, metrics.Sample{Labels: map[string]string{label: k}, Value: n})
			}
			return out, rows.Err()
		})
	}
	count("goonerspay_reversal_queue_depth", "Reversals waiting for store-and-forward delivery.", `SELECT count(*) FROM reversal_queue WHERE NOT done`)
	count("goonerspay_webhook_backlog", "Webhook deliveries not yet delivered.", `SELECT count(*) FROM webhook_deliveries WHERE delivered_at IS NULL AND abandoned_at IS NULL`)
	count("goonerspay_webhook_abandoned", "Webhook deliveries abandoned after 72 hours.", `SELECT count(*) FROM webhook_deliveries WHERE abandoned_at IS NOT NULL`)
	count("goonerspay_payouts_processing", "Payouts whose outcome is not known yet.", `SELECT count(*) FROM payouts WHERE status = 'processing'`)
	grouped("goonerspay_disputes_open", "Open disputes by status.", "status",
		`SELECT status, count(*) FROM disputes WHERE status IN ('evidence_required', 'represented', 'pre_arbitration') GROUP BY status`)
	grouped("goonerspay_recon_exceptions_open", "Unresolved reconciliation exceptions by kind.", "kind",
		`SELECT kind, count(*) FROM recon_exceptions WHERE resolved_at IS NULL GROUP BY kind`)
	grouped("goonerspay_merchants", "Merchants by status.", "status", `SELECT status, count(*) FROM merchants GROUP BY status`)
	// L5 headroom: safeguarding reserve minus client money. Alert well before it reaches zero.
	grouped("goonerspay_safeguarding_headroom_centavos", "Safeguarding reserve minus client liabilities, per tenant.", "tenant",
		`SELECT tenant_id::text, COALESCE(SUM(CASE WHEN account_id = '`+ledger.AccSafeguardingReserve+`' THEN balance ELSE -balance END), 0)
		FROM balances WHERE account_id = '`+ledger.AccSafeguardingReserve+`' OR account_id = '`+ledger.AccPixInTransit+`'
			OR account_id LIKE 'liability.merchant\_wallet.%' OR account_id LIKE 'liability.merchant\_reserve.%'
		GROUP BY tenant_id`)
	grouped("goonerspay_merchant_shortfall_centavos", "Amounts merchants owe (chargebacks and MED returns beyond their balance), per tenant.", "tenant",
		`SELECT tenant_id::text, SUM(balance) FROM balances WHERE account_id LIKE 'asset.merchant\_recoverable.%' GROUP BY tenant_id`)
	grouped("goonerspay_recon_suspense_centavos", "Settlement cash waiting for allocation, per tenant.", "tenant",
		`SELECT tenant_id::text, SUM(balance) FROM balances WHERE account_id = '`+ledger.AccReconSuspense+`' GROUP BY tenant_id`)
}
