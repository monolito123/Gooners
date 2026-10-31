package e2e

import (
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/api"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
)

// API keys expire, and a webhook secret is rotated with an overlap during which deliveries
// carry both signatures (docs/02 §3.1 and §10.1).
func TestKeysExpireAndSecretsRotate(t *testing.T) {
	st := newStack(t)
	ctx := t.Context()

	// ---- API keys ----
	expired, err := api.NewAPIKeyUntil(ctx, st.pool, tenant, "old", []string{"*"}, false, time.Now().Add(-time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, out := st.callAs(expired, "GET", "/v1/crypto/markets", nil, 401); out["code"] != "key_expired" {
		t.Fatalf("an expired key: %v", out)
	}
	fresh, _ := api.NewAPIKeyUntil(ctx, st.pool, tenant, "new", []string{"*"}, false, time.Now().Add(time.Hour))
	st.callAs(fresh, "GET", "/v1/crypto/markets", nil, 200)
	keys, err := st.svc.ListAPIKeys(ctx, tenant)
	if err != nil {
		t.Fatal(err)
	}
	withExpiry := 0
	for _, k := range keys {
		if k.ExpiresAt != nil {
			withExpiry++
		}
	}
	if withExpiry != 2 {
		t.Fatalf("keys with an expiry listed: %d of %v", withExpiry, keys)
	}

	// ---- webhook secrets ----
	_, m := st.call("POST", "/v1/merchants", map[string]any{
		"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": cnpj("123123120001")}, "legal_name": "Loja Chaves Ltda", "trade_name": "Loja Chaves", "mcc": "5812", "city": "Natal"},
		"plan":  map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": true},
	}, 201)
	event := func() {
		_, pi := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": m["id"], "amount": 100_00, "channel": "crypto"}, 201)
		st.call("POST", "/v1/payment-intents/"+pi["id"].(string)+"/confirm", map[string]any{"payment_method_type": "crypto", "asset": "USDT", "network": "tron"}, 200)
	}
	// deliveries returns, for each delivery, whether each secret verifies it.
	deliveries := func(secrets ...string) [][]bool {
		t.Helper()
		n, err := st.dispatch.Once(ctx)
		if err != nil || n == 0 {
			t.Fatalf("delivered %d: %v", n, err)
		}
		var out [][]bool
		for i := 0; i < n; i++ {
			d := <-st.hooks
			var row []bool
			for _, sec := range secrets {
				row = append(row, webhooks.Verify(sec, d.id, d.ts, d.sig, d.body, 5*time.Minute, time.Now()) == nil)
			}
			out = append(out, row)
		}
		return out
	}
	event()
	deliveries(st.hookSec)
	var endpoint string
	_ = st.pool.QueryRow(ctx, `SELECT id FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, tenant).Scan(&endpoint)
	_, rot := st.call("POST", "/v1/webhook-endpoints/"+endpoint+"/rotate-secret", map[string]any{"overlap_hours": 1}, 200)
	second := rot["secret"].(string)
	if second == st.hookSec || rot["previous_secret_expires_at"] == nil {
		t.Fatalf("rotation: %v", rot)
	}
	// During the overlap a receiver with either secret accepts every delivery.
	event()
	for _, ok := range deliveries(st.hookSec, second) {
		if !ok[0] || !ok[1] {
			t.Fatalf("during the overlap: old %v, new %v", ok[0], ok[1])
		}
	}
	// A leaked secret is rotated at once: the old one signs nothing more.
	_, rot = st.call("POST", "/v1/webhook-endpoints/"+endpoint+"/rotate-secret", map[string]any{"overlap_hours": 0}, 200)
	third := rot["secret"].(string)
	event()
	for _, ok := range deliveries(second, third) {
		if ok[0] || !ok[1] {
			t.Fatalf("after an immediate rotation: old %v, new %v", ok[0], ok[1])
		}
	}
	st.call("POST", "/v1/webhook-endpoints/"+endpoint+"/rotate-secret", map[string]any{"overlap_hours": 200}, 422)
	st.call("POST", "/v1/webhook-endpoints/we_01M68ZT7GTR3WAHDDZF05WFGNW/rotate-secret", nil, 404)
}
