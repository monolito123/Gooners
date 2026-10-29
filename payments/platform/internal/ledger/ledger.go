// Package ledger is the double-entry, append-only ledger of docs/04-serverless-backend.md §3:
// journals post atomically under serializable isolation, idempotently, with shard-aware
// balances, a no-negative-balance rule and a transactional outbox.
package ledger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"math/rand/v2"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/monolito123/Gooners/payments/platform/internal/db"
)

// Side of a posting or an account's normal balance.
type Side string

const (
	Debit  Side = "debit"
	Credit Side = "credit"
)

// Account in the chart of accounts.
type Account struct {
	TenantID      string
	ID            string
	Code          string
	Currency      string
	NormalSide    Side
	AllowNegative bool
	Shards        int
}

// Posting is one line of a journal.
type Posting struct {
	Account   string
	Direction Side
	Amount    int64
}

// OutboxEvent is published after commit by the outbox relay.
type OutboxEvent struct {
	Topic   string
	Key     string
	Payload any
}

// Journal is one atomic business event.
type Journal struct {
	TenantID       string
	ID             string
	IdempotencyKey string
	Type           string
	Reference      string
	EffectiveDate  time.Time
	Postings       []Posting
	Metadata       map[string]any
	Outbox         []OutboxEvent
}

// Result of posting.
type Result struct {
	JournalID string
	Replayed  bool
}

// Errors.
var (
	ErrUnbalanced          = errors.New("ledger: journal does not balance")
	ErrInvalidPosting      = errors.New("ledger: invalid posting")
	ErrUnknownAccount      = errors.New("ledger: unknown account")
	ErrInactiveAccount     = errors.New("ledger: account is not active")
	ErrCurrencyMismatch    = errors.New("ledger: currency mismatch")
	ErrIdempotencyConflict = errors.New("ledger: idempotency key reused with different postings")
)

// InsufficientFundsError is returned when a posting would take a non-negative account below zero.
type InsufficientFundsError struct {
	Account string
	Balance int64
	Needed  int64
}

func (e *InsufficientFundsError) Error() string {
	return fmt.Sprintf("ledger: insufficient funds on %s: balance %d, debit %d", e.Account, e.Balance, e.Needed)
}

// Ledger posts journals to PostgreSQL / CockroachDB.
type Ledger struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

// New returns a ledger on pool (already migrated).
func New(pool *pgxpool.Pool, log *slog.Logger) *Ledger {
	if log == nil {
		log = slog.Default()
	}
	return &Ledger{pool: pool, log: log}
}

// Pool exposes the connection pool (for services sharing the database).
func (l *Ledger) Pool() *pgxpool.Pool { return l.pool }

// EnsureAccount creates the account if it does not exist. Existing accounts are not modified.
func (l *Ledger) EnsureAccount(ctx context.Context, a Account) error {
	if a.Shards == 0 {
		a.Shards = 1
	}
	if a.NormalSide != Debit && a.NormalSide != Credit {
		return fmt.Errorf("ledger: account %s: normal side %q", a.ID, a.NormalSide)
	}
	_, err := l.pool.Exec(ctx, `INSERT INTO ledger_accounts (tenant_id, account_id, code, currency, normal_side, allow_negative, shard_count)
		VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id, account_id) DO NOTHING`,
		a.TenantID, a.ID, a.Code, a.Currency, string(a.NormalSide), a.AllowNegative, a.Shards)
	return err
}

func contentHash(j Journal) string {
	type line struct {
		A string `json:"a"`
		D Side   `json:"d"`
		N int64  `json:"n"`
	}
	ls := make([]line, len(j.Postings))
	for i, p := range j.Postings {
		ls[i] = line{p.Account, p.Direction, p.Amount}
	}
	b, _ := json.Marshal(struct {
		T string `json:"t"`
		L []line `json:"l"`
	}{j.Type, ls})
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func validate(j Journal) error {
	if j.TenantID == "" || j.ID == "" || j.IdempotencyKey == "" || j.Type == "" {
		return fmt.Errorf("%w: tenant, id, idempotency key and type are required", ErrInvalidPosting)
	}
	if len(j.Postings) < 2 || len(j.Postings) > 64 {
		return fmt.Errorf("%w: a journal has 2..64 postings", ErrInvalidPosting)
	}
	var dr, cr int64
	for _, p := range j.Postings {
		if p.Amount <= 0 {
			return fmt.Errorf("%w: amount must be positive", ErrInvalidPosting)
		}
		switch p.Direction {
		case Debit:
			dr += p.Amount
		case Credit:
			cr += p.Amount
		default:
			return fmt.Errorf("%w: direction %q", ErrInvalidPosting, p.Direction)
		}
	}
	if dr != cr {
		return fmt.Errorf("%w: debits %d, credits %d", ErrUnbalanced, dr, cr)
	}
	return nil
}

func shardOf(journalID string, shards int) int {
	if shards <= 1 {
		return 0
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(journalID))
	return int(h.Sum32() % uint32(shards))
}

// Post posts a journal. Posting the same idempotency key again returns the original journal
// (Replayed) if the postings match, and ErrIdempotencyConflict if they differ.
func (l *Ledger) Post(ctx context.Context, j Journal) (Result, error) {
	if err := validate(j); err != nil {
		return Result{}, err
	}
	if j.EffectiveDate.IsZero() {
		j.EffectiveDate = time.Now()
	}
	hash := contentHash(j)
	var res Result
	var err error
	for attempt := 0; attempt < 8; attempt++ {
		res, err = l.post(ctx, j, hash)
		if err == nil || !db.IsRetryable(err) {
			return res, err
		}
		time.Sleep(time.Duration(1<<attempt)*time.Millisecond + time.Duration(rand.IntN(5))*time.Millisecond)
	}
	return res, fmt.Errorf("ledger: gave up after serialization conflicts: %w", err)
}

type acct struct {
	side     Side
	allowNeg bool
	shards   int
	currency string
	status   string
}

func (l *Ledger) post(ctx context.Context, j Journal, hash string) (Result, error) {
	var res Result
	err := pgx.BeginTxFunc(ctx, l.pool, pgx.TxOptions{IsoLevel: pgx.Serializable}, func(tx pgx.Tx) error {
		meta := map[string]any{}
		for k, v := range j.Metadata {
			meta[k] = v
		}
		meta["content_hash"] = hash
		metaJSON, _ := json.Marshal(meta)

		tag, err := tx.Exec(ctx, `INSERT INTO journals (tenant_id, journal_id, idempotency_key, type, reference, effective_date, metadata)
			VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
			j.TenantID, j.ID, j.IdempotencyKey, j.Type, j.Reference, j.EffectiveDate, metaJSON)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			var existingID, existingHash string
			err := tx.QueryRow(ctx, `SELECT journal_id, COALESCE(metadata->>'content_hash', '') FROM journals WHERE tenant_id = $1 AND idempotency_key = $2`,
				j.TenantID, j.IdempotencyKey).Scan(&existingID, &existingHash)
			if err != nil {
				return err
			}
			if existingHash != hash {
				return ErrIdempotencyConflict
			}
			res = Result{JournalID: existingID, Replayed: true}
			return nil
		}

		ids := make([]string, 0, len(j.Postings))
		seen := map[string]bool{}
		for _, p := range j.Postings {
			if !seen[p.Account] {
				seen[p.Account] = true
				ids = append(ids, p.Account)
			}
		}
		sort.Strings(ids) // a fixed lock order avoids deadlocks between concurrent journals
		accts := map[string]acct{}
		rows, err := tx.Query(ctx, `SELECT account_id, normal_side, allow_negative, shard_count, currency, status
			FROM ledger_accounts WHERE tenant_id = $1 AND account_id = ANY($2)`, j.TenantID, ids)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id, side, cur, status string
			var a acct
			if err := rows.Scan(&id, &side, &a.allowNeg, &a.shards, &cur, &status); err != nil {
				rows.Close()
				return err
			}
			a.side, a.currency, a.status = Side(side), cur, status
			accts[id] = a
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		currency := ""
		delta := map[string]int64{}
		for i, p := range j.Postings {
			a, ok := accts[p.Account]
			if !ok {
				return fmt.Errorf("%w: %s", ErrUnknownAccount, p.Account)
			}
			if a.status != "active" {
				return fmt.Errorf("%w: %s is %s", ErrInactiveAccount, p.Account, a.status)
			}
			if currency == "" {
				currency = a.currency
			} else if a.currency != currency {
				return fmt.Errorf("%w: %s is %s, journal is %s", ErrCurrencyMismatch, p.Account, a.currency, currency)
			}
			if p.Direction == a.side {
				delta[p.Account] += p.Amount
			} else {
				delta[p.Account] -= p.Amount
			}
			shard := shardOf(j.ID, a.shards)
			if _, err := tx.Exec(ctx, `INSERT INTO postings (tenant_id, journal_id, seq, account_id, shard, direction, amount, currency)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, j.TenantID, j.ID, i, p.Account, shard, string(p.Direction), p.Amount, a.currency); err != nil {
				return err
			}
		}

		for _, id := range ids {
			d := delta[id]
			a := accts[id]
			shard := shardOf(j.ID, a.shards)
			if d < 0 && !a.allowNeg {
				// Lock every shard of the account, then check the total.
				var total int64
				r, err := tx.Query(ctx, `SELECT balance FROM balances WHERE tenant_id = $1 AND account_id = $2 FOR UPDATE`, j.TenantID, id)
				if err != nil {
					return err
				}
				for r.Next() {
					var b int64
					if err := r.Scan(&b); err != nil {
						r.Close()
						return err
					}
					total += b
				}
				r.Close()
				if total+d < 0 {
					return &InsufficientFundsError{Account: id, Balance: total, Needed: -d}
				}
			}
			if d == 0 {
				continue
			}
			if _, err := tx.Exec(ctx, `INSERT INTO balances (tenant_id, account_id, shard, balance, version, updated_at)
				VALUES ($1, $2, $3, $4, 1, now())
				ON CONFLICT (tenant_id, account_id, shard) DO UPDATE SET balance = balances.balance + EXCLUDED.balance, version = balances.version + 1, updated_at = now()`,
				j.TenantID, id, shard, d); err != nil {
				return err
			}
		}

		for _, ev := range j.Outbox {
			payload, err := json.Marshal(ev.Payload)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO outbox (tenant_id, topic, key, payload) VALUES ($1, $2, $3, $4)`, j.TenantID, ev.Topic, ev.Key, payload); err != nil {
				return err
			}
		}
		res = Result{JournalID: j.ID}
		return nil
	})
	return res, err
}

// Balance returns the balance of an account in its normal-side terms (sum of shards).
func (l *Ledger) Balance(ctx context.Context, tenantID, accountID string) (int64, error) {
	var exists bool
	if err := l.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ledger_accounts WHERE tenant_id = $1 AND account_id = $2)`, tenantID, accountID).Scan(&exists); err != nil {
		return 0, err
	}
	if !exists {
		return 0, fmt.Errorf("%w: %s", ErrUnknownAccount, accountID)
	}
	var b int64
	err := l.pool.QueryRow(ctx, `SELECT COALESCE(SUM(balance), 0) FROM balances WHERE tenant_id = $1 AND account_id = $2`, tenantID, accountID).Scan(&b)
	return b, err
}

// Entry is a posting as shown to API clients.
type Entry struct {
	JournalID string
	Seq       int
	Direction Side
	Amount    int64
	Type      string
	Reference string
	PostedAt  time.Time
}

// Entries lists postings on an account, newest first.
func (l *Ledger) Entries(ctx context.Context, tenantID, accountID string, limit int) ([]Entry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := l.pool.Query(ctx, `SELECT p.journal_id, p.seq, p.direction, p.amount, j.type, COALESCE(j.reference, ''), j.posted_at
		FROM postings p JOIN journals j USING (tenant_id, journal_id)
		WHERE p.tenant_id = $1 AND p.account_id = $2 ORDER BY j.posted_at DESC, p.journal_id DESC, p.seq LIMIT $3`, tenantID, accountID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Entry
	for rows.Next() {
		var e Entry
		var dir string
		if err := rows.Scan(&e.JournalID, &e.Seq, &dir, &e.Amount, &e.Type, &e.Reference, &e.PostedAt); err != nil {
			return nil, err
		}
		e.Direction = Side(dir)
		out = append(out, e)
	}
	return out, rows.Err()
}

// DrainOutbox hands up to limit outbox events to handle and deletes them in the same
// transaction. If handle fails, nothing is deleted and the events are retried later.
// handle must be idempotent: delivery is at least once.
func (l *Ledger) DrainOutbox(ctx context.Context, limit int, handle func(ctx context.Context, tx pgx.Tx, topic, key string, payload []byte) error) (int, error) {
	n := 0
	err := pgx.BeginFunc(ctx, l.pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT tenant_id::text, event_id::text, topic, key, payload FROM outbox
			ORDER BY created_at, event_id LIMIT $1 FOR UPDATE SKIP LOCKED`, limit)
		if err != nil {
			return err
		}
		type ev struct {
			tenant, id, topic, key string
			payload                []byte
		}
		var evs []ev
		for rows.Next() {
			var e ev
			if err := rows.Scan(&e.tenant, &e.id, &e.topic, &e.key, &e.payload); err != nil {
				rows.Close()
				return err
			}
			evs = append(evs, e)
		}
		rows.Close()
		for _, e := range evs {
			if err := handle(ctx, tx, e.topic, e.key, e.payload); err != nil {
				return fmt.Errorf("outbox %s/%s: %w", e.topic, e.id, err)
			}
			if _, err := tx.Exec(ctx, `DELETE FROM outbox WHERE tenant_id = $1 AND event_id = $2`, e.tenant, e.id); err != nil {
				return err
			}
			n++
		}
		return nil
	})
	return n, err
}
