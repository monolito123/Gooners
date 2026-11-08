package e2e

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/worm"
)

// The audit trail's daily copies in WORM storage verify on their own: every line's hash is
// recomputed from the line, each day continues the previous day's chain, and a copy written by
// a run that stopped before recording it is recognized, not rewritten (integration point 33).
func TestAuditExport(t *testing.T) {
	store := worm.NewMemory()
	st := newStack(t, func(d *payments.Deps) { d.Audit = store })
	ctx := context.Background()
	merchant, _ := st.merchant(st.key)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant}, 201)
	st.call("POST", "/v1/terminals/"+term["terminal_id"].(string)+"/revoke", map[string]any{"reason": "device lost | pipe in the reason"}, 200)
	c, err := st.svc.RegisterOAuthClient(ctx, tenant, "ERP", []string{"payments:read"}, []string{strings.Repeat("A", 43)}, "ops:alice")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.svc.RevokeOAuthClient(ctx, tenant, c.ID, "rotated", "ops:alice"); err != nil {
		t.Fatal(err)
	}

	// Nothing is exported before the day is over.
	if n, err := st.svc.ExportAudit(ctx, time.Now()); err != nil || n != 0 {
		t.Fatalf("an unfinished day exported: %d %v", n, err)
	}
	later := time.Now().Add(49 * time.Hour)
	n, err := st.svc.ExportAudit(ctx, later)
	if err != nil || n < 2 {
		t.Fatalf("export: %d %v", n, err)
	}
	if again, _ := st.svc.ExportAudit(ctx, later); again != 0 {
		t.Fatalf("days exported twice: %d", again)
	}

	// Every copy verifies without the database, and each continues the previous one.
	var dbRows int
	_ = st.pool.QueryRow(ctx, `SELECT count(*) FROM ops_audit`).Scan(&dbRows)
	head, exported := strings.Repeat("0", 64), 0
	rows, _ := st.pool.Query(ctx, `SELECT object_key, rows, last_hash FROM audit_exports ORDER BY day`)
	type rec struct {
		key, last string
		n         int
	}
	var recs []rec
	for rows.Next() {
		var r rec
		_ = rows.Scan(&r.key, &r.n, &r.last)
		recs = append(recs, r)
	}
	rows.Close()
	for _, r := range recs {
		body := store.Objects[r.key]
		sc := bufio.NewScanner(bytes.NewReader(body))
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		var lines []map[string]any
		for sc.Scan() {
			var m map[string]any
			if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
				t.Fatalf("%s: %v", r.key, err)
			}
			lines = append(lines, m)
		}
		if lines[0]["type"] != "header" || lines[0]["prev_hash"] != head || lines[len(lines)-1]["type"] != "end" {
			t.Fatalf("%s: framing %v ... %v (want prev %s)", r.key, lines[0], lines[len(lines)-1], head)
		}
		for _, l := range lines[1 : len(lines)-1] {
			fields := []string{l["prev_hash"].(string), strconv.FormatInt(int64(l["seq"].(float64)), 10), l["tenant_id"].(string), l["actor"].(string),
				l["action"].(string), l["target"].(string), l["detail"].(string), l["at"].(string)}
			sum := sha256.Sum256([]byte(strings.Join(fields, "|")))
			if l["prev_hash"] != head || hex.EncodeToString(sum[:]) != l["hash"] {
				t.Fatalf("%s: seq %v does not verify", r.key, l["seq"])
			}
			head = l["hash"].(string)
			exported++
		}
		if lines[len(lines)-1]["last_hash"] != head || head != r.last || int(lines[len(lines)-1]["rows"].(float64)) != r.n {
			t.Fatalf("%s: end %v, recorded %s", r.key, lines[len(lines)-1], r.last)
		}
	}
	if exported != dbRows || dbRows < 3 {
		t.Fatalf("exported %d of %d rows", exported, dbRows)
	}

	// A run that wrote its copy and stopped before recording it: the next run finds the same
	// bytes in the store and records them.
	last := recs[len(recs)-1]
	if _, err := st.pool.Exec(ctx, `DELETE FROM audit_exports WHERE object_key = $1`, last.key); err != nil {
		t.Fatal(err)
	}
	if n, err := st.svc.ExportAudit(ctx, later); err != nil || n != 1 {
		t.Fatalf("recovering an unrecorded copy: %d %v", n, err)
	}
}
