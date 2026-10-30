package e2e

// Security tests: tenant isolation, authentication and scopes, input hardening, response
// headers, rate limits, webhook SSRF, secrets at rest, and card data never reaching logs or
// unencrypted columns. Findings and their fixes are in payments/integration/security-assessment.md.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/api"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/netguard"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
)

const tenantB = "00000000-0000-4000-8000-0000000000bb"

func (st *stack) merchant(key string) (id, account string) {
	st.t.Helper()
	_, m := st.callAs(key, "POST", "/v1/merchants", map[string]any{
		"legal":      map[string]any{"document": map[string]any{"type": "cnpj", "number": "12345678000195"}, "legal_name": "Loja " + ids.ULID()[20:], "trade_name": "Loja", "mcc": "5812", "city": "Recife"},
		"scheme_mid": "000000004127799",
		"plan":       map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": true},
	}, 201)
	return m["id"].(string), m["account_id"].(string)
}

func TestTenantIsolation(t *testing.T) {
	st := newStack(t)
	ctx := context.Background()
	if err := st.svc.BootstrapTenant(ctx, tenantB, 0); err != nil {
		t.Fatal(err)
	}
	keyB, err := api.NewAPIKey(ctx, st.pool, tenantB, "tenant-b", []string{"*"}, false)
	if err != nil {
		t.Fatal(err)
	}

	// Tenant A: a merchant, a terminal, a captured sale with a dispute, a quote.
	merchantA, accountA := st.merchant(st.key)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchantA}, 201)
	terminalA := term["terminal_id"].(string)
	piA := st.sale(merchantA, terminalA, 5000)
	rrn, code := st.authOf(piA)
	dA, err := st.svc.ApplyDisputeNotice(ctx, tenant, payments.DisputeNotice{Event: payments.NoticeOpened, Scheme: "visa", NetworkCaseID: "ISO-1", ReasonCode: "10.4",
		Category: "fraud", Amount: 1000, RRN: rrn, AuthCode: code, EvidenceDueAt: time.Now().Add(240 * time.Hour), Source: "test"})
	if err != nil {
		t.Fatal(err)
	}
	_, qA := st.call("POST", "/v1/payouts/quotes", map[string]any{"account_id": accountA, "amount": 100, "destination": map[string]any{"type": "pix", "key_type": "CNPJ", "key": "12345678000195"}}, 201)
	balanceBefore := st.ledgerBalance(ledger.MerchantWallet(merchantA))

	// Tenant B sees none of it and can change none of it.
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"GET", "/v1/merchants/" + merchantA, nil},
		{"GET", "/v1/payment-intents/" + piA, nil},
		{"POST", "/v1/payment-intents/" + piA + "/cancel", nil},
		{"POST", "/v1/payment-intents/" + piA + "/confirm", map[string]any{"payment_method_type": "pix"}},
		{"POST", "/v1/payment-intents", map[string]any{"merchant_id": merchantA, "amount": 100}},
		{"POST", "/v1/refunds", map[string]any{"payment_intent_id": piA, "amount": 100}},
		{"GET", "/v1/accounts/" + accountA + "/balance", nil},
		{"GET", "/v1/accounts/" + accountA + "/entries", nil},
		{"POST", "/v1/payouts/quotes", map[string]any{"account_id": accountA, "amount": 100, "destination": map[string]any{"type": "pix", "key_type": "CNPJ", "key": "1"}}},
		{"POST", "/v1/terminals", map[string]any{"merchant_id": merchantA}},
		{"POST", "/v1/terminals/" + terminalA + "/revoke", map[string]any{"reason": "x"}},
		{"GET", "/v1/disputes/" + dA.ID, nil},
		{"POST", "/v1/disputes/" + dA.ID + "/evidence", map[string]any{"explanation": "x", "submit": true}},
		{"POST", "/v1/disputes/" + dA.ID + "/accept", nil},
		{"POST", "/v1/terminal/authorizations", map[string]any{"payment_intent_id": piA, "terminal_id": terminalA, "stan": "000777", "emv_application": "credit",
			"sred": map[string]any{"format": "x", "ksn": "x", "ciphertext": ""}}},
	} {
		if code, out := st.callAs(keyB, c.method, c.path, c.body, 0); code != http.StatusNotFound {
			t.Errorf("tenant B %s %s: HTTP %d %v (want 404)", c.method, c.path, code, out)
		}
	}
	if code, _ := st.callAs(keyB, "POST", "/v1/payouts", map[string]any{"quote_id": qA["id"]}, 0); code != http.StatusConflict {
		t.Errorf("tenant B executing tenant A's quote: HTTP %d", code)
	}
	_, list := st.callAs(keyB, "GET", "/v1/disputes", nil, 200)
	if len(list["data"].([]any)) != 0 {
		t.Error("tenant B lists tenant A's disputes")
	}
	// Nothing moved and A's quote still works for A.
	if got := st.ledgerBalance(ledger.MerchantWallet(merchantA)); got != balanceBefore {
		t.Errorf("tenant A's wallet changed: %d → %d", balanceBefore, got)
	}
	if d, _ := st.svc.GetDispute(ctx, tenant, dA.ID); d.Status != payments.DisputeEvidenceRequired {
		t.Errorf("tenant A's dispute is %s", d.Status)
	}
	st.call("POST", "/v1/payouts", map[string]any{"quote_id": qA["id"]}, 201)

	// The same idempotency key in two tenants is two requests.
	k := ids.ULID()
	post := func(key string, body string) (int, string, map[string]any) {
		req, _ := http.NewRequest("POST", st.api+"/v1/merchants", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Idempotency-Key", k)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, resp.Header.Get("Idempotent-Replayed"), out
	}
	body := `{"legal":{"document":{"type":"cnpj","number":"12345678000195"},"legal_name":"Idem Ltda","trade_name":"Idem","mcc":"5812","city":"Natal"}}`
	ca, _, ma := post(st.key, body)
	cb, replayed, mb := post(keyB, body)
	if ca != 201 || cb != 201 || replayed != "" || ma["id"] == mb["id"] {
		t.Fatalf("idempotency across tenants: %d %d %q %v %v", ca, cb, replayed, ma["id"], mb["id"])
	}
}

func TestAuthenticationAndScopes(t *testing.T) {
	st := newStack(t)
	ctx := context.Background()
	merchant, _ := st.merchant(st.key)
	_, pi := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 1000}, 201)
	path := "/v1/payment-intents/" + pi["id"].(string)

	do := func(auth string) int {
		req, _ := http.NewRequest("GET", st.api+path, nil)
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	for _, auth := range []string{"", "Bearer ", "Bearer sk_test_wrong", "Basic " + st.key, st.key, "bearer " + st.key, "Bearer  " + st.key} {
		if code := do(auth); code != http.StatusUnauthorized {
			t.Errorf("Authorization %q: HTTP %d", auth, code)
		}
	}
	if code := do("Bearer " + st.key); code != http.StatusOK {
		t.Fatalf("valid key: HTTP %d", code)
	}

	readOnly, _ := api.NewAPIKey(ctx, st.pool, tenant, "reader", []string{"payments:read"}, false)
	if code, _ := st.callAs(readOnly, "GET", path, nil, 0); code != http.StatusOK {
		t.Errorf("read scope cannot read: %d", code)
	}
	for _, c := range [][2]string{{"POST", "/v1/payment-intents"}, {"POST", "/v1/refunds"}, {"GET", "/v1/disputes"}, {"POST", "/v1/payouts/quotes"}, {"POST", "/v1/webhook-endpoints"}, {"POST", "/v1/merchants"}} {
		if code, _ := st.callAs(readOnly, c[0], c[1], map[string]any{}, 0); code != http.StatusForbidden {
			t.Errorf("read-only key %s %s: HTTP %d (want 403)", c[0], c[1], code)
		}
	}

	// In production a terminal must present its certificate; an API key is not enough.
	prod := httptest.NewServer(api.New(api.Config{Env: "production"}, st.svc, st.pool, nil).Handler())
	defer prod.Close()
	b, _ := json.Marshal(map[string]any{"payment_intent_id": pi["id"], "terminal_id": "T0000001", "stan": "000001", "sred": map[string]any{"format": "x", "ksn": "x", "ciphertext": ""}})
	req, _ := http.NewRequest("POST", prod.URL+"/v1/terminal/authorizations", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+st.key)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("production terminal authorization with an API key: HTTP %d", resp.StatusCode)
	}
}

func TestInputHardening(t *testing.T) {
	st := newStack(t)
	merchant, account := st.merchant(st.key)
	raw := func(method, path string, body []byte, idem bool) (int, http.Header, string) {
		req, _ := http.NewRequest(method, st.api+path, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+st.key)
		if idem {
			req.Header.Set("Idempotency-Key", ids.ULID())
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		out, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, resp.Header, string(out)
	}
	big := []byte(`{"merchant_id":"` + merchant + `","amount":100,"description":"` + strings.Repeat("A", api.MaxBody) + `"}`)
	if code, _, _ := raw("POST", "/v1/payment-intents", big, true); code != http.StatusRequestEntityTooLarge {
		t.Errorf("2 MiB body: HTTP %d", code)
	}
	if code, _, _ := raw("POST", "/v1/terminals/T0000001/revoke", big, true); code != http.StatusRequestEntityTooLarge {
		t.Errorf("2 MiB body on a non-idempotent decode path: HTTP %d", code)
	}
	for name, body := range map[string]string{
		"trailing object": `{"merchant_id":"` + merchant + `","amount":100}{"amount":1}`,
		"string amount":   `{"merchant_id":"` + merchant + `","amount":"100"}`,
		"float amount":    `{"merchant_id":"` + merchant + `","amount":1.5}`,
		"huge number":     `{"merchant_id":"` + merchant + `","amount":1e30}`,
		"not JSON":        `merchant_id=x`,
		"unknown field":   `{"merchant_id":"` + merchant + `","amount":100,"is_admin":true}`,
	} {
		if code, _, out := raw("POST", "/v1/payment-intents", []byte(body), true); code != http.StatusBadRequest {
			t.Errorf("%s: HTTP %d %s", name, code, out)
		}
	}
	for name, amount := range map[string]int64{"zero": 0, "negative": -500, "above the limit": 100_000_001, "above the rails": payments.MaxAmount + 1} {
		if code, _ := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": amount}, 0); code != http.StatusUnprocessableEntity {
			t.Errorf("amount %s: HTTP %d", name, code)
		}
	}
	// Pix keys and documents that cannot exist are refused before reaching the PSP.
	for name, dest := range map[string]map[string]any{
		"unknown key type":  {"type": "pix", "key_type": "iban", "key": "DE89370400440532013000"},
		"CNPJ check digits": {"type": "pix", "key_type": "cnpj", "key": "12345678000194"},
		"CPF all equal":     {"type": "pix", "key_type": "cpf", "key": "11111111111"},
		"phone not E.164":   {"type": "pix", "key_type": "phone", "key": "11987654321"},
		"EVP not a UUID":    {"type": "pix", "key_type": "evp", "key": "' OR 1=1 --"},
	} {
		if code, _ := st.call("POST", "/v1/payouts/quotes", map[string]any{"account_id": account, "amount": 100, "destination": dest}, 0); code != http.StatusUnprocessableEntity {
			t.Errorf("payout to %s: HTTP %d", name, code)
		}
	}
	if code, _ := st.call("POST", "/v1/merchants", map[string]any{"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": "12345678000194"},
		"legal_name": "Erro Ltda", "trade_name": "Erro", "mcc": "5812", "city": "Natal"}}, 0); code != http.StatusUnprocessableEntity {
		t.Errorf("a CNPJ with wrong check digits: HTTP %d", code)
	}
	if code, _, _ := raw("POST", "/v1/payment-intents", []byte(`{}`), false); code != http.StatusBadRequest {
		t.Errorf("missing Idempotency-Key: HTTP %d", code)
	}
	req, _ := http.NewRequest("POST", st.api+"/v1/payment-intents", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer "+st.key)
	req.Header.Set("Idempotency-Key", strings.Repeat("k", 65))
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("65-character Idempotency-Key: HTTP %d", resp.StatusCode)
	}

	// Injection strings are data: they find nothing and change nothing.
	var before int
	_ = st.pool.QueryRow(context.Background(), `SELECT count(*) FROM payment_intents`).Scan(&before)
	for _, inj := range []string{`' OR '1'='1`, `pi_1'; DROP TABLE payment_intents;--`, `%27%20OR%201=1--`, `../../etc/passwd`} {
		if code, _ := st.call("GET", "/v1/payment-intents/"+url.PathEscape(inj), nil, 0); code != http.StatusNotFound && code != http.StatusMovedPermanently {
			t.Errorf("GET intent %q: HTTP %d", inj, code)
		}
		code, out := st.call("GET", "/v1/disputes?status="+url.QueryEscape(inj)+"&merchant_id="+url.QueryEscape(inj), nil, 0)
		if code != http.StatusOK || len(out["data"].([]any)) != 0 {
			t.Errorf("dispute filter %q: HTTP %d %v", inj, code, out)
		}
	}
	// NUL and invalid UTF-8 are refused before they reach PostgreSQL (which would fail with a 500).
	for _, path := range []string{"/v1/payment-intents/pi_%00", "/v1/disputes?status=%00", "/v1/payment-intents/pi_%ff"} {
		if code, _ := st.call("GET", path, nil, 0); code != http.StatusBadRequest {
			t.Errorf("GET %s: HTTP %d", path, code)
		}
	}
	for _, body := range []string{`{"merchant_id":"` + merchant + `","amount":100,"description":"a\u0000b"}`, "{\"merchant_id\":\"" + merchant + "\",\"amount\":100,\"description\":\"\xff\"}"} {
		if code, _, out := raw("POST", "/v1/payment-intents", []byte(body), true); code != http.StatusBadRequest {
			t.Errorf("body %q: HTTP %d %s", body, code, out)
		}
	}
	var after int
	_ = st.pool.QueryRow(context.Background(), `SELECT count(*) FROM payment_intents`).Scan(&after)
	if after != before {
		t.Errorf("payment intents %d → %d after injection attempts", before, after)
	}

	// Every response, errors included, carries the hardening headers and no internals.
	for _, path := range []string{"/v1/payment-intents/pi_nope", "/v1/nowhere", "/readyz"} {
		code, h, body := raw("GET", path, nil, false)
		if h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Cache-Control") != "no-store" || !strings.Contains(h.Get("Content-Security-Policy"), "default-src 'none'") {
			t.Errorf("%s (HTTP %d): headers %v", path, code, h)
		}
		for _, leak := range []string{"pgx", "SQLSTATE", "goroutine", "postgres://", ".go:"} {
			if strings.Contains(body, leak) {
				t.Errorf("%s leaks %q: %s", path, leak, body)
			}
		}
	}
}

func TestRateLimits(t *testing.T) {
	st := newStack(t)
	srv := httptest.NewServer(api.New(api.Config{Env: "sandbox", RatePerSecond: 0.5, RateBurst: 3, AuthFailuresPerMinute: 3}, st.svc, st.pool, nil).Handler())
	defer srv.Close()
	get := func(key string) (int, string) {
		req, _ := http.NewRequest("GET", srv.URL+"/v1/disputes", nil)
		req.Header.Set("Authorization", "Bearer "+key)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode, resp.Header.Get("Retry-After")
	}
	for i := 0; i < 3; i++ {
		if code, _ := get(st.key); code != http.StatusOK {
			t.Fatalf("request %d within the burst: HTTP %d", i, code)
		}
	}
	if code, ra := get(st.key); code != http.StatusTooManyRequests || ra == "" {
		t.Fatalf("over the burst: HTTP %d, Retry-After %q", code, ra)
	}
	other, _ := api.NewAPIKey(context.Background(), st.pool, tenant, "other", []string{"*"}, false)
	if code, _ := get(other); code != http.StatusOK {
		t.Fatalf("another key is limited too: HTTP %d", code)
	}
	// Failed authentications from one address are throttled; a valid key from it is not.
	codes := []int{}
	for i := 0; i < 5; i++ {
		c, _ := get("sk_test_guess" + fmt.Sprint(i))
		codes = append(codes, c)
	}
	if codes[2] != http.StatusUnauthorized || codes[3] != http.StatusTooManyRequests {
		t.Fatalf("failed authentications: %v", codes)
	}
	third, _ := api.NewAPIKey(context.Background(), st.pool, tenant, "third", []string{"*"}, false)
	if code, _ := get(third); code != http.StatusOK {
		t.Fatalf("a valid key from a throttled address: HTTP %d", code)
	}
}

func TestWebhookSSRFAndSecrets(t *testing.T) {
	st := newStack(t)
	ctx := context.Background()
	// Outside the sandbox only public https URLs can be registered.
	prodSvc := payments.New(payments.Config{Env: "production"}, payments.Deps{Pool: st.pool, Ledger: st.ledger, Vault: st.vault})
	for _, u := range []string{"https://127.0.0.1/hook", "https://169.254.169.254/latest/meta-data/iam/", "http://hooks.partner.example/x", "https://[::1]:8443/x",
		"https://localhost/x", "https://user:pw@8.8.8.8/x", "gopher://8.8.8.8/x", "https://10.0.0.5/x"} {
		if _, err := prodSvc.CreateWebhookEndpoint(ctx, tenant, u, nil); err == nil {
			t.Errorf("production accepted webhook URL %s", u)
		}
	}
	if code, _ := st.call("POST", "/v1/webhook-endpoints", map[string]any{"url": "file:///etc/passwd"}, 0); code != http.StatusUnprocessableEntity {
		t.Errorf("file URL: HTTP %d", code)
	}

	// Secrets are stored sealed, never in the clear.
	var stored string
	_ = st.pool.QueryRow(ctx, `SELECT secret FROM webhook_endpoints ORDER BY created_at LIMIT 1`).Scan(&stored)
	if !strings.HasPrefix(stored, "sealed.v1.") || strings.Contains(stored, strings.TrimPrefix(st.hookSec, "whsec_")) {
		t.Fatalf("webhook secret at rest: %q", stored)
	}

	// A dispatcher with the production policy will not call a loopback receiver, even one
	// registered while in the sandbox, nor follow a redirect to one.
	var hits atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits.Add(1) }))
	defer internal.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, internal.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	for _, u := range []string{internal.URL, redirect.URL} {
		st.call("POST", "/v1/webhook-endpoints", map[string]any{"url": u, "events": []string{"*"}}, 201)
	}
	merchant, _ := st.merchant(st.key) // nothing is enqueued yet; create an event
	st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 100, "payment_method_types": []string{"pix"}}, 201)
	_, err := st.svc.SetMerchantStatus(ctx, tenant, merchant, payments.MerchantRestricted, "test", "ops:test")
	if err != nil {
		t.Fatal(err)
	}
	strict := &webhooks.Dispatcher{Pool: st.pool, Policy: netguard.Policy{RequireHTTPS: true}, Secrets: st.vault, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if _, err := strict.Once(ctx); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	if hits.Load() != 0 {
		t.Fatalf("the strict dispatcher reached an internal address %d times", hits.Load())
	}
	// The sandbox dispatcher calls the redirector but does not follow it.
	if _, err := st.pool.Exec(ctx, `UPDATE webhook_deliveries SET next_at = now() WHERE delivered_at IS NULL`); err != nil { // skip the retry delay
		t.Fatal(err)
	}
	if _, err := st.dispatch.Once(ctx); err != nil {
		t.Fatal(err)
	}
	if hits.Load() == 0 {
		t.Fatal("sandbox delivery to the local receiver did not happen")
	}
	before := hits.Load()
	var redirected int
	_ = st.pool.QueryRow(ctx, `SELECT count(*) FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE e.url = $1 AND d.last_status = 307 AND d.delivered_at IS NULL`, redirect.URL).Scan(&redirected)
	if redirected == 0 || hits.Load() != before {
		t.Fatalf("redirect handling: %d deliveries left undelivered with 307", redirected)
	}
}

func TestCardDataNeverLeaks(t *testing.T) {
	st := newStack(t)
	ctx := context.Background()
	merchant, _ := st.merchant(st.key)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant}, 201)
	terminal := term["terminal_id"].(string)
	const pan = "4000056655665556"
	_, pi := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 4321}, 201)
	if r := st.tap(pi["id"].(string), terminal, pan, visaAID, "credit"); r["status"] != "approved" {
		t.Fatalf("tap: %v", r)
	}
	st.call("POST", "/v1/refunds", map[string]any{"payment_intent_id": pi["id"], "amount": 321}, 201) // reveals the PAN from the vault
	_, pi2 := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 1098}, 201)
	st.tap(pi2["id"].(string), terminal, pan, visaAID, "credit") // times out: a reversal with the PAN
	st.sw.ProcessReversals(ctx)
	if _, err := st.dispatch.Once(ctx); err != nil {
		t.Fatal(err)
	}

	logs := st.logs.String()
	if strings.Count(logs, "msg=sent") < 3 { // the 0100s, the refund and the reversal, dumped at debug level
		t.Fatalf("message dumps were not captured, the check below would prove nothing (%d):\n%s", strings.Count(logs, "msg=sent"), logs)
	}
	for _, s := range []string{pan, pan[:6] + pan[6:12], "=2911", "F" + pan} {
		if strings.Contains(logs, s) {
			i := strings.Index(logs, s)
			t.Fatalf("card data %q in the logs: …%s…", s, logs[max(0, i-120):min(len(logs), i+40)])
		}
	}

	// No column holds the PAN in the clear; the vault's ciphertext does not contain it either.
	rows, err := st.pool.Query(ctx, `SELECT table_name, column_name, data_type FROM information_schema.columns
		WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'character', 'jsonb', 'json', 'bytea')`)
	if err != nil {
		t.Fatal(err)
	}
	type col struct{ table, name, typ string }
	var cols []col
	for rows.Next() {
		var c col
		if err := rows.Scan(&c.table, &c.name, &c.typ); err != nil {
			t.Fatal(err)
		}
		cols = append(cols, c)
	}
	rows.Close()
	if len(cols) < 50 {
		t.Fatalf("only %d columns scanned", len(cols))
	}
	for _, c := range cols {
		cond := fmt.Sprintf(`position($1 in %q::text) > 0`, c.name)
		if c.typ == "bytea" {
			cond = fmt.Sprintf(`position(convert_to($1, 'UTF8') in %q) > 0`, c.name)
		}
		var n int
		if err := st.pool.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM %q WHERE %s`, c.table, cond), pan).Scan(&n); err != nil {
			t.Fatalf("%s.%s: %v", c.table, c.name, err)
		}
		if n > 0 {
			t.Errorf("the PAN is in the clear in %s.%s (%d rows)", c.table, c.name, n)
		}
	}
	var stored int
	_ = st.pool.QueryRow(ctx, `SELECT count(*) FROM card_vault WHERE last4 = $1 AND bin = $2`, pan[12:], pan[:6]).Scan(&stored)
	if stored != 1 {
		t.Fatalf("the vault holds %d records for the card", stored)
	}
}

// A terminal STAN identifies one request for idempotent retries. Reusing it for another
// payment must never return the earlier approval: that would capture a payment no issuer
// authorized (found by this assessment; see security-assessment.md, F-01).
func TestSTANReuseIsNotAnApproval(t *testing.T) {
	st := newStack(t)
	merchant, _ := st.merchant(st.key)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant}, 201)
	terminal := term["terminal_id"].(string)
	_, pi1 := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 1000}, 201)
	if _, r := st.tapWithSTAN(pi1["id"].(string), terminal, "4111111111111111", visaAID, "credit", "424242", 200); r["status"] != "approved" {
		t.Fatalf("first sale: %v", r)
	}
	sent := len(st.sim.ReceivedMTI("0100"))
	wallet := st.ledgerBalance(ledger.MerchantWallet(merchant))

	_, pi2 := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 99999}, 201)
	code, r := st.tapWithSTAN(pi2["id"].(string), terminal, "5555555555554444", "A0000000041010", "credit", "424242", 0)
	if code != http.StatusConflict || r["status"] == "approved" {
		t.Fatalf("a reused STAN on a new payment: HTTP %d %v", code, r)
	}
	if _, got := st.call("GET", "/v1/payment-intents/"+pi2["id"].(string), nil, 200); got["status"] == "captured" {
		t.Fatal("the second payment was captured without an authorization")
	}
	if got := st.ledgerBalance(ledger.MerchantWallet(merchant)); got != wallet {
		t.Fatalf("the merchant was credited: %d → %d", wallet, got)
	}
	if n := len(st.sim.ReceivedMTI("0100")); n != sent {
		t.Fatalf("%d messages sent for the reused STAN", n-sent)
	}

	// A platform-initiated refund never takes a STAN the terminal will use next.
	_, ref := st.call("POST", "/v1/refunds", map[string]any{"payment_intent_id": pi1["id"], "amount": 100}, 201)
	if ref["status"] != "succeeded" {
		t.Fatalf("refund %v", ref)
	}
	_, pi3 := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 700}, 201)
	if _, r := st.tapWithSTAN(pi3["id"].(string), terminal, "4111111111111111", visaAID, "credit", "424243", 200); r["status"] != "approved" {
		t.Fatalf("the terminal's next STAN after a refund: %v", r)
	}
	// Malformed STANs are refused before anything is stored.
	_, pi4 := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 700}, 201)
	for _, bad := range []string{"R00001", "12345", "1234567", "12a456"} {
		if code, _ := st.tapWithSTAN(pi4["id"].(string), terminal, "4111111111111111", visaAID, "credit", bad, 0); code != http.StatusUnprocessableEntity {
			t.Errorf("terminal STAN %q: HTTP %d", bad, code)
		}
	}
}
