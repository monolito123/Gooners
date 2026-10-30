package authswitch

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PgStore persists authorizations and the reversal queue in PostgreSQL / CockroachDB.
type PgStore struct{ pool *pgxpool.Pool }

// NewPgStore returns a store on a migrated database.
func NewPgStore(pool *pgxpool.Pool) *PgStore { return &PgStore{pool: pool} }

const recCols = `auth_id, tenant_id::text, COALESCE(payment_intent_id, ''), kind, terminal_id, terminal_stan, local_date, amount, currency_numeric,
	COALESCE(route, ''), COALESCE(network_stan, ''), COALESCE(rrn, ''), COALESCE(transmission_dt, ''), processing_code, COALESCE(entry_mode, ''),
	COALESCE(pan_ref, ''), merchant_mid, mcc, COALESCE(merchant_name, ''), COALESCE(merchant_city, ''), COALESCE(acquirer_id, ''), status,
	COALESCE(response_code, ''), COALESCE(auth_code, ''), COALESCE(network_txn_id, ''), reversed_amount, created_at, updated_at`

func scanRecord(row pgx.Row) (*Record, error) {
	var r Record
	var kind, status string
	err := row.Scan(&r.AuthID, &r.TenantID, &r.PaymentIntentID, &kind, &r.TerminalID, &r.TerminalSTAN, &r.LocalDate, &r.Amount, &r.CurrencyNumeric,
		&r.Route, &r.NetworkSTAN, &r.RRN, &r.TransmissionDT, &r.ProcessingCode, &r.EntryMode, &r.PANRef, &r.MerchantMID, &r.MCC,
		&r.MerchantName, &r.MerchantCity, &r.AcquirerID, &status, &r.ResponseCode, &r.AuthCode, &r.NetworkTxnID, &r.ReversedAmount,
		&r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	r.Kind, r.Status = Kind(kind), Status(status)
	return &r, err
}

func (s *PgStore) Begin(ctx context.Context, r *Record) (*Record, error) {
	tag, err := s.pool.Exec(ctx, `INSERT INTO authorizations (auth_id, tenant_id, payment_intent_id, kind, terminal_id, terminal_stan, local_date,
			amount, currency_numeric, processing_code, entry_mode, pan_ref, merchant_mid, mcc, merchant_name, merchant_city, acquirer_id, status)
		VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8, $9, $10, NULLIF($11, ''), NULLIF($12, ''), $13, $14, $15, $16, NULLIF($17, ''), $18)
		ON CONFLICT (tenant_id, terminal_id, terminal_stan, local_date) DO NOTHING`,
		r.AuthID, r.TenantID, r.PaymentIntentID, string(r.Kind), r.TerminalID, r.TerminalSTAN, r.LocalDate, r.Amount, r.CurrencyNumeric,
		r.ProcessingCode, r.EntryMode, r.PANRef, r.MerchantMID, r.MCC, r.MerchantName, r.MerchantCity, r.AcquirerID, string(r.Status))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 1 {
		return nil, nil
	}
	return scanRecord(s.pool.QueryRow(ctx, `SELECT `+recCols+` FROM authorizations
		WHERE tenant_id = $1 AND terminal_id = $2 AND terminal_stan = $3 AND local_date = $4`, r.TenantID, r.TerminalID, r.TerminalSTAN, r.LocalDate))
}

func (s *PgStore) MarkSent(ctx context.Context, authID, route, stan, rrn, de7 string) error {
	return s.exec1(ctx, `UPDATE authorizations SET route = $2, network_stan = $3, rrn = $4, transmission_dt = $5, status = 'sent', updated_at = now()
		WHERE auth_id = $1`, authID, route, stan, rrn, de7)
}

func (s *PgStore) Complete(ctx context.Context, authID string, st Status, rc, code, ntid string) error {
	return s.exec1(ctx, `UPDATE authorizations SET status = $2, response_code = NULLIF($3, ''), auth_code = NULLIF($4, ''), network_txn_id = NULLIF($5, ''), updated_at = now()
		WHERE auth_id = $1`, authID, string(st), rc, code, ntid)
}

func (s *PgStore) Get(ctx context.Context, authID string) (*Record, error) {
	return scanRecord(s.pool.QueryRow(ctx, `SELECT `+recCols+` FROM authorizations WHERE auth_id = $1`, authID))
}

func (s *PgStore) AddReversed(ctx context.Context, authID string, amount int64, st Status) error {
	return s.exec1(ctx, `UPDATE authorizations SET reversed_amount = reversed_amount + $2, status = $3, updated_at = now() WHERE auth_id = $1`, authID, amount, string(st))
}

func (s *PgStore) EnqueueReversal(ctx context.Context, r Reversal) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO reversal_queue (auth_id, route, amount, reason, network_stan, de7, attempts, next_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, r.AuthID, r.Route, r.Amount, r.Reason, r.NetworkSTAN, r.DE7, r.Attempts, r.NextAt)
	return err
}

// DueReversals leases due items for 30 s (SKIP LOCKED), so several switch instances share the queue.
func (s *PgStore) DueReversals(ctx context.Context, now time.Time, limit int) ([]Reversal, error) {
	rows, err := s.pool.Query(ctx, `UPDATE reversal_queue SET next_at = $1::timestamptz + interval '30 seconds'
		WHERE id IN (SELECT id FROM reversal_queue WHERE NOT done AND next_at <= $1 ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED)
		RETURNING id, auth_id, route, amount, reason, network_stan, de7, attempts, next_at, created_at, done, COALESCE(last_error, '')`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Reversal
	for rows.Next() {
		var r Reversal
		if err := rows.Scan(&r.ID, &r.AuthID, &r.Route, &r.Amount, &r.Reason, &r.NetworkSTAN, &r.DE7, &r.Attempts, &r.NextAt, &r.CreatedAt, &r.Done, &r.LastError); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *PgStore) UpdateReversal(ctx context.Context, id int64, done bool, attempts int, next time.Time, lastErr string) error {
	return s.exec1(ctx, `UPDATE reversal_queue SET done = $2, attempts = $3, next_at = $4, last_error = NULLIF($5, '') WHERE id = $1`, id, done, attempts, next, lastErr)
}

func (s *PgStore) exec1(ctx context.Context, sql string, args ...any) error {
	tag, err := s.pool.Exec(ctx, sql, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
