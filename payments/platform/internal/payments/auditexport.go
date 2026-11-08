package payments

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
	"github.com/monolito123/Gooners/payments/platform/internal/worm"
)

// The audit trail in WORM storage (integration point 33). After each Brasília day closes, the
// chain's rows written since the last export (contiguous by seq, every one from before the
// day's end) go to the WORM store as JSON lines, locked for the retention period; the export
// is recorded with the chain's head. Each line carries the exact strings the row's hash was
// computed from, so the copy verifies without the database:
//
//	hash = SHA-256( prev_hash | seq | tenant_id | actor | action | target | detail | at )
//
// joined with "|", tenant_id empty when there is none, detail as PostgreSQL prints the JSONB
// ("null" when there is none) and at in UTC to the microsecond. A day without rows is
// exported too, so a gap in the copies is never ambiguous.

var mAuditExports = metrics.Default.Counter("goonerspay_audit_exports_total", "Days of the audit trail copied to WORM storage, by result (exported, error).", "result")

// AuditExportRetention is how long the copies stay locked: ten years (Circular BCB 3.978/2020,
// art. 67), and PCI DSS 10.5.1's one year many times over.
const AuditExportRetention = 10 * 366 * 24 * time.Hour

// AuditExportLine is one exported audit row.
type AuditExportLine struct {
	Seq      int64  `json:"seq"`
	PrevHash string `json:"prev_hash"`
	Hash     string `json:"hash"`
	TenantID string `json:"tenant_id"`
	Actor    string `json:"actor"`
	Action   string `json:"action"`
	Target   string `json:"target"`
	Detail   string `json:"detail"`
	At       string `json:"at"`
}

// ExportAudit copies every finished day not yet exported, oldest first, up to seven a run. A
// day is finished an hour after it ends in Brasília (late commits land in the next day's copy
// anyway: the copies follow the chain, not the clock).
func (s *Service) ExportAudit(ctx context.Context, now time.Time) (int, error) {
	if s.worm == nil {
		return 0, nil
	}
	var last *time.Time
	if err := s.pool.QueryRow(ctx, `SELECT max(day) FROM audit_exports`).Scan(&last); err != nil {
		return 0, err
	}
	var day time.Time
	if last != nil {
		day = last.AddDate(0, 0, 1)
	} else {
		var first *time.Time
		if err := s.pool.QueryRow(ctx, `SELECT min(at) FROM ops_audit`).Scan(&first); err != nil || first == nil {
			return 0, err
		}
		f := first.In(brt)
		day = time.Date(f.Year(), f.Month(), f.Day(), 0, 0, 0, 0, time.UTC)
	}
	exported := 0
	for i := 0; i < 7; i++ {
		end := time.Date(day.Year(), day.Month(), day.Day()+1, 0, 0, 0, 0, brt)
		if now.Before(end.Add(time.Hour)) {
			break
		}
		if err := s.exportAuditDay(ctx, day, end, now); err != nil {
			mAuditExports.Inc("error")
			return exported, fmt.Errorf("audit export of %s: %w", day.Format("2006-01-02"), err)
		}
		mAuditExports.Inc("exported")
		exported++
		day = day.AddDate(0, 0, 1)
	}
	return exported, nil
}

func (s *Service) exportAuditDay(ctx context.Context, day, end, now time.Time) error {
	var afterSeq int64
	head := strings.Repeat("0", 64)
	var lastSeq *int64
	var lastHash *string
	if err := s.pool.QueryRow(ctx, `SELECT last_seq, last_hash FROM audit_exports ORDER BY day DESC LIMIT 1`).Scan(&lastSeq, &lastHash); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if lastHash != nil {
		head = *lastHash
	}
	if lastSeq != nil {
		afterSeq = *lastSeq
	} else if lastHash != nil {
		// The last export had no rows: start after the rows exported before it.
		if err := s.pool.QueryRow(ctx, `SELECT COALESCE(max(last_seq), 0) FROM audit_exports`).Scan(&afterSeq); err != nil {
			return err
		}
	}
	rows, err := s.pool.Query(ctx, `SELECT seq, prev_hash, hash, COALESCE(tenant_id::text, ''), actor, action, target, COALESCE(detail::text, 'null'),
		to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), at < $2 FROM ops_audit WHERE seq > $1 ORDER BY seq LIMIT 100000`, afterSeq, end)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(map[string]any{"type": "header", "day": day.Format("2006-01-02"), "prev_hash": head, "after_seq": afterSeq,
		"hash": "SHA-256(prev_hash|seq|tenant_id|actor|action|target|detail|at), each line's own strings"})
	var first, final int64
	n := 0
	for rows.Next() {
		var l AuditExportLine
		var before bool
		if err := rows.Scan(&l.Seq, &l.PrevHash, &l.Hash, &l.TenantID, &l.Actor, &l.Action, &l.Target, &l.Detail, &l.At, &before); err != nil {
			rows.Close()
			return err
		}
		if !before {
			break // the chain continues tomorrow
		}
		if l.PrevHash != head {
			rows.Close()
			return fmt.Errorf("the chain breaks at seq %d: run platform audit-verify", l.Seq)
		}
		if first == 0 {
			first = l.Seq
		}
		final, head = l.Seq, l.Hash
		n++
		_ = enc.Encode(l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	_ = enc.Encode(map[string]any{"type": "end", "rows": n, "last_hash": head})
	body := buf.Bytes()
	sum := sha256.Sum256(body)
	key := fmt.Sprintf("%saudit/%s/%s.jsonl", s.cfg.AuditExportPrefix, day.Format("2006/01"), day.Format("2006-01-02"))
	retain := now.Add(AuditExportRetention)
	version, err := s.worm.PutLocked(ctx, key, body, "application/x-ndjson", retain)
	if errors.Is(err, worm.ErrExists) {
		// An earlier run wrote it and stopped before recording it: the lock keeps that first
		// copy, which is this one if the bytes are the same.
		stored, v, cerr := s.worm.Checksum(ctx, key)
		if cerr != nil {
			return cerr
		}
		if stored != base64.StdEncoding.EncodeToString(sum[:]) {
			return fmt.Errorf("%s already exists in %s with other content: compare it with the chain (runbook §6)", key, s.worm.Name())
		}
		version, err = v, nil
	}
	if err != nil {
		return err
	}
	var firstArg, lastArg *int64
	if n > 0 {
		firstArg, lastArg = &first, &final
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO audit_exports (day, object_key, store, version, first_seq, last_seq, last_hash, rows, sha256, retain_until)
		VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $9, $10)`, day, key, s.worm.Name(), version, firstArg, lastArg, head, n, hex.EncodeToString(sum[:]), retain)
	return err
}
