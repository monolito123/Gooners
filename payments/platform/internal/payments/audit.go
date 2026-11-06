package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
	"github.com/monolito123/Gooners/payments/platform/internal/transparency"
)

var mAuditBroken = metrics.Default.Counter("goonerspay_audit_chain_failures_total", "Verifications of the audit trail's hash chain that found it broken (runbook §6).")

// auditHead is the last row of the audit trail's hash chain (seq 0 and no hash when empty).
func (s *Service) auditHead(ctx context.Context) (*transparency.AuditHead, error) {
	h := &transparency.AuditHead{}
	err := s.pool.QueryRow(ctx, `SELECT seq, hash FROM ops_audit ORDER BY seq DESC LIMIT 1`).Scan(&h.Seq, &h.Head)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return h, err
}

// AuditCheck is what verifying the audit trail found.
type AuditCheck struct {
	Rows     int64    `json:"rows"`
	Head     string   `json:"head,omitempty"`
	Anchors  int      `json:"anchors"` // published heads compared
	Problems []string `json:"problems"`
}

// OK reports whether the chain and every published head hold.
func (c *AuditCheck) OK() bool { return len(c.Problems) == 0 }

// VerifyAuditChain walks the audit trail in its chain's order, recomputing each row's hash
// from its fields and the previous hash, and then compares the heads the signed transparency
// roots published with the chain: an edit inside the database breaks the chain; a chain
// rewritten consistently no longer matches what was published.
func (s *Service) VerifyAuditChain(ctx context.Context) (*AuditCheck, error) {
	c := &AuditCheck{Problems: []string{}}
	rows, err := s.pool.Query(ctx, `SELECT seq, prev_hash, hash, ops_audit_digest(prev_hash, seq, tenant_id, actor, action, target, detail, at) FROM ops_audit ORDER BY seq`)
	if err != nil {
		return nil, err
	}
	prev := strings.Repeat("0", 64)
	hashes := map[int64]string{}
	for rows.Next() {
		var seq int64
		var prevHash, hash, recomputed string
		if err := rows.Scan(&seq, &prevHash, &hash, &recomputed); err != nil {
			rows.Close()
			return nil, err
		}
		c.Rows++
		switch {
		case seq != c.Rows:
			c.Problems = append(c.Problems, fmt.Sprintf("row %d is missing (the chain jumps to %d)", c.Rows, seq))
			c.Rows = seq
		case prevHash != prev:
			c.Problems = append(c.Problems, fmt.Sprintf("row %d does not follow row %d", seq, seq-1))
		}
		if hash != recomputed {
			c.Problems = append(c.Problems, fmt.Sprintf("row %d was changed after it was written", seq))
		}
		prev, hashes[seq], c.Head = hash, hash, hash
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	roots, err := s.pool.Query(ctx, `SELECT log_date::text, event FROM transparency_roots ORDER BY log_date`)
	if err != nil {
		return nil, err
	}
	defer roots.Close()
	for roots.Next() {
		var date string
		var evJSON []byte
		if err := roots.Scan(&date, &evJSON); err != nil {
			return nil, err
		}
		var ev struct {
			Content string `json:"content"`
		}
		var content struct {
			Audit *transparency.AuditHead `json:"audit"`
		}
		if json.Unmarshal(evJSON, &ev) != nil || json.Unmarshal([]byte(ev.Content), &content) != nil || content.Audit == nil {
			continue // a root from before the audit trail was anchored
		}
		c.Anchors++
		if got, ok := hashes[content.Audit.Seq]; !ok || got != content.Audit.Head {
			c.Problems = append(c.Problems, fmt.Sprintf("the root of %s published row %d as %s; the trail now has %q", date, content.Audit.Seq, content.Audit.Head, got))
		}
	}
	if err := roots.Err(); err != nil {
		return nil, err
	}
	if !c.OK() {
		mAuditBroken.Inc()
		s.log.Error("the audit trail's hash chain is broken", "problems", c.Problems)
	}
	return c, nil
}
