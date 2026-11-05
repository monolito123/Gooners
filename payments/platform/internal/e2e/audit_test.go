package e2e

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/payments"
)

// The audit trail is a hash chain whose head each day's signed root publishes (runbook §6):
// an edit inside the database breaks the chain, and a chain rewritten to hide it no longer
// matches the published head.
func TestAuditTrailIsTamperEvident(t *testing.T) {
	st := newStack(t)
	ctx := t.Context()
	_, m := st.call("POST", "/v1/merchants", map[string]any{
		"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": cnpj("456456450001")}, "legal_name": "Loja Auditada Ltda", "trade_name": "Loja Auditada", "mcc": "5812", "city": "Natal"},
		"plan":  map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": true},
	}, 201)
	merchant := m["id"].(string)
	if _, err := st.svc.SetMerchantStatus(ctx, tenant, merchant, payments.MerchantRestricted, "chargeback ratio", "ana@goonerspay.example"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.svc.SetMerchantStatus(ctx, tenant, merchant, payments.MerchantActive, "reviewed", "ana@goonerspay.example"); err != nil {
		t.Fatal(err)
	}
	var endpoint string
	_ = st.pool.QueryRow(ctx, `SELECT id FROM webhook_endpoints WHERE tenant_id = $1 LIMIT 1`, tenant).Scan(&endpoint)
	st.call("POST", "/v1/webhook-endpoints/"+endpoint+"/rotate-secret", nil, 200)

	c, err := st.svc.VerifyAuditChain(ctx)
	if err != nil || !c.OK() || c.Rows < 3 {
		t.Fatalf("a fresh trail: %+v %v", c, err)
	}
	// The day closes: its signed root publishes the trail's head.
	day := time.Now().AddDate(0, 0, -1)
	root, err := st.svc.CloseDay(ctx, day)
	if err != nil {
		t.Fatal(err)
	}
	var content struct {
		Audit struct {
			Seq  int64  `json:"seq"`
			Head string `json:"head"`
		} `json:"audit"`
	}
	_ = json.Unmarshal([]byte(root.Event.Content), &content)
	if content.Audit.Seq != c.Rows || content.Audit.Head != c.Head {
		t.Fatalf("published %+v, trail %d %s", content.Audit, c.Rows, c.Head)
	}
	if c, _ := st.svc.VerifyAuditChain(ctx); !c.OK() || c.Anchors != 1 {
		t.Fatalf("anchored: %+v", c)
	}

	// The application cannot change or remove a row.
	if _, err := st.pool.Exec(ctx, `UPDATE ops_audit SET actor = 'someone else' WHERE seq = 1`); err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("an update went through: %v", err)
	}
	if _, err := st.pool.Exec(ctx, `DELETE FROM ops_audit WHERE seq = 2`); err == nil {
		t.Fatal("a delete went through")
	}
	// A database administrator who lifts the guard and edits a row breaks the chain.
	if _, err := st.pool.Exec(ctx, `ALTER TABLE ops_audit DISABLE TRIGGER ops_audit_append_only`); err != nil {
		t.Fatal(err)
	}
	if _, err := st.pool.Exec(ctx, `UPDATE ops_audit SET detail = '{"reason": "nothing to see"}' WHERE seq = 1`); err != nil {
		t.Fatal(err)
	}
	c, _ = st.svc.VerifyAuditChain(ctx)
	if c.OK() || !strings.Contains(strings.Join(c.Problems, "; "), "row 1 was changed") {
		t.Fatalf("an edited row: %+v", c)
	}
	// Recomputing every hash after the edit makes the chain consistent again, but not the
	// head the signed root already published.
	if _, err := st.pool.Exec(ctx, `DO $$
		DECLARE r RECORD; prev TEXT := repeat('0', 64);
		BEGIN
			FOR r IN SELECT seq FROM ops_audit ORDER BY seq LOOP
				UPDATE ops_audit SET prev_hash = prev WHERE seq = r.seq;
				UPDATE ops_audit SET hash = ops_audit_digest(prev_hash, seq, tenant_id, actor, action, target, detail, at) WHERE seq = r.seq RETURNING hash INTO prev;
			END LOOP;
		END $$`); err != nil {
		t.Fatal(err)
	}
	c, _ = st.svc.VerifyAuditChain(ctx)
	if c.OK() || len(c.Problems) != 1 || !strings.Contains(c.Problems[0], "published row") {
		t.Fatalf("a rewritten chain: %+v", c)
	}
}
