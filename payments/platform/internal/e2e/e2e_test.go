// Package e2e runs the whole platform against the scheme host simulator, the Pix PSP
// simulator (mutual TLS both ways) and PostgreSQL, through the public HTTP API.
package e2e

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/monolito123/Gooners/payments/platform/dialects"
	"github.com/monolito123/Gooners/payments/platform/internal/api"
	"github.com/monolito123/Gooners/payments/platform/internal/authswitch"
	"github.com/monolito123/Gooners/payments/platform/internal/carddata"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/pixout"
	"github.com/monolito123/Gooners/payments/platform/internal/pixsim"
	"github.com/monolito123/Gooners/payments/platform/internal/pricing"
	"github.com/monolito123/Gooners/payments/platform/internal/receipts"
	"github.com/monolito123/Gooners/payments/platform/internal/scheme"
	"github.com/monolito123/Gooners/payments/platform/internal/schemesim"
	"github.com/monolito123/Gooners/payments/platform/internal/testpg"
	"github.com/monolito123/Gooners/payments/platform/internal/testpki"
	"github.com/monolito123/Gooners/payments/platform/internal/vault"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
	"github.com/monolito123/Gooners/payments/platform/pkg/apipix"
	"github.com/monolito123/Gooners/payments/platform/pkg/brcode"
	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

func TestMain(m *testing.M) { testpg.Main(m) }

const tenant = "00000000-0000-4000-8000-0000000000aa"
const platformPixKey = "12345678000195"

type stack struct {
	t        *testing.T
	api      string
	key      string
	sim      *schemesim.Sim
	sw       *authswitch.Switch
	ledger   *ledger.Ledger
	devKey   []byte
	psp      string
	pspHTTP  *http.Client
	hooks    chan delivered
	hookSec  string
	dispatch *webhooks.Dispatcher
	svc      *payments.Service
	pool     *pgxpool.Pool
	vault    *vault.Vault
	logs     *syncBuffer // everything every component logged, at debug level

	receiptsKey, transparencyKey nostr.Keys
}

// syncBuffer collects logs from concurrent goroutines.
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

type delivered struct {
	id, ts, sig string
	body        []byte
}

func rnd(n int) []byte { b := make([]byte, n); _, _ = rand.Read(b); return b }

// newStack starts the platform, the simulators and PostgreSQL; opts adjust the service's
// dependencies (a strict attestor, for instance).
func newStack(t *testing.T, opts ...func(*payments.Deps)) *stack {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	pool := testpg.Pool(t)
	st := &stack{t: t, hooks: make(chan delivered, 64), devKey: rnd(32), logs: &syncBuffer{}}
	log := slog.New(slog.NewTextHandler(st.logs, &slog.HandlerOptions{Level: slog.LevelDebug}))

	// Scheme host simulator and the switch.
	codec := iso8583.NewCodec(dialects.MustLoad(dialects.Generic))
	st.sim = schemesim.New(codec)
	addr, err := st.sim.Listen("127.0.0.1:0", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.sim.Close)
	sess := scheme.NewSession(scheme.Config{Name: "sponsor-a", Addr: addr, Codec: codec, SignOn: true, AcquirerID: "12345678", Logger: log})
	poolRoute := scheme.NewPool("sponsor", sess)
	go poolRoute.Run(ctx)
	wc, wcancel := context.WithTimeout(ctx, 3*time.Second)
	defer wcancel()
	if err := poolRoute.WaitReady(wc); err != nil {
		t.Fatal(err)
	}
	kek, _ := vault.NewLocalKEK("kek-test", rnd(32))
	v, _ := vault.New(pool, kek, rnd(32))
	st.sw = authswitch.New([]*authswitch.Route{{Name: "sponsor", Pool: poolRoute, Codec: codec, AcquirerID: "12345678", ApprovalPrior: 0.9}},
		authswitch.NewPgStore(pool), v, authswitch.Config{CardPresentTimeout: 600 * time.Millisecond, ReversalTimeout: 600 * time.Millisecond, Logger: log})

	// Pix: PSP simulator and the platform's webhook receiver, each verifying the other's certificate.
	ca, _ := testpki.NewCA("e2e-ca")
	pspServer, _ := ca.Server("psp", "127.0.0.1")
	pspCaller, _ := ca.Client("psp-webhooks")
	platServer, _ := ca.Server("platform", "127.0.0.1")
	platClient, _ := ca.Client("platform")
	sim := pixsim.New(pixsim.Config{ClientID: "platform", ClientSecret: "s3cret", Keys: []string{platformPixKey}, Logger: log,
		WebhookTLS: &tls.Config{Certificates: []tls.Certificate{pspCaller.TLS}, RootCAs: ca.Pool()}})
	psp := httptest.NewUnstartedServer(sim.Handler())
	psp.TLS = &tls.Config{Certificates: []tls.Certificate{pspServer.TLS}, ClientCAs: ca.Pool(), ClientAuth: tls.RequireAndVerifyClientCert}
	psp.StartTLS()
	t.Cleanup(psp.Close)
	st.psp = psp.URL
	clientTLS := &tls.Config{Certificates: []tls.Certificate{platClient.TLS}, RootCAs: ca.Pool(), MinVersion: tls.VersionTLS13}
	st.pspHTTP = &http.Client{Transport: &http.Transport{TLSClientConfig: clientTLS}}
	pix := apipix.New(apipix.Config{BaseURL: psp.URL + "/api/v2", TokenURL: psp.URL + "/oauth/token", ClientID: "platform", ClientSecret: "s3cret", TLS: clientTLS, Logger: log})
	sender := pixout.NewHTTPSender(pixout.HTTPConfig{BaseURL: psp.URL + "/api/v2", Token: pix.Token, TLS: clientTLS})

	dec, _ := carddata.NewDev(st.devKey)
	signer, _ := nostr.GenerateKeys()
	st.transparencyKey, _ = nostr.GenerateKeys()
	deps := payments.Deps{
		Pool: pool, Ledger: ledger.New(pool, log), Switch: st.sw, Vault: v, Decryptor: dec, Pix: pix, Payout: sender,
		Receipts: &receipts.Issuer{Author: signer, ClaimBase: "https://r.goonerspay.example/c"}, Transparency: st.transparencyKey, Logger: log,
	}
	for _, o := range opts {
		o(&deps)
	}
	svc := payments.New(payments.Config{Env: "sandbox", AcquirerID: "12345678", PixKey: platformPixKey, RelayURL: "wss://relay.goonerspay.example", TransparencyPadTo: 8}, deps)
	st.receiptsKey = signer
	st.ledger = ledger.New(pool, log)
	st.svc, st.pool, st.vault = svc, pool, v
	if err := svc.BootstrapTenant(ctx, tenant, 100_000_000); err != nil {
		t.Fatal(err)
	}
	srv := api.New(api.Config{Env: "sandbox"}, svc, pool, log)
	apiServer := httptest.NewServer(srv.Handler())
	t.Cleanup(apiServer.Close)
	st.api = apiServer.URL
	if st.key, err = api.NewAPIKey(ctx, pool, tenant, "e2e", []string{"*"}, false); err != nil {
		t.Fatal(err)
	}

	hook := httptest.NewUnstartedServer(srv.PixWebhookHandler())
	hook.TLS = &tls.Config{Certificates: []tls.Certificate{platServer.TLS}, ClientCAs: ca.Pool(), ClientAuth: tls.RequireAndVerifyClientCert}
	hook.StartTLS()
	t.Cleanup(hook.Close)
	if err := pix.ConfigureWebhook(ctx, platformPixKey, hook.URL); err != nil {
		t.Fatal(err)
	}

	// Partner webhook endpoint (receives Standard Webhooks deliveries).
	var mu sync.Mutex
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		st.hooks <- delivered{r.Header.Get("webhook-id"), r.Header.Get("webhook-timestamp"), r.Header.Get("webhook-signature"), b}
		mu.Unlock()
	}))
	t.Cleanup(receiver.Close)
	_, we := st.call("POST", "/v1/webhook-endpoints", map[string]any{"url": receiver.URL, "events": []string{"*"}}, 201)
	st.hookSec = we["secret"].(string)
	st.dispatch = &webhooks.Dispatcher{Pool: pool, Logger: log, Policy: svc.WebhookPolicy(), Secrets: v}
	return st
}

func (st *stack) call(method, path string, body any, want int) (int, map[string]any) {
	st.t.Helper()
	return st.callAs(st.key, method, path, body, want)
}

// callAs calls the API with another credential.
func (st *stack) callAs(key, method, path string, body any, want int) (int, map[string]any) {
	st.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, st.api+path, rd)
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Api-Version", "2026-10-01")
	if method == "POST" {
		req.Header.Set("Idempotency-Key", ids.ULID())
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		st.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	raw, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(raw, &out)
	if want != 0 && resp.StatusCode != want {
		st.t.Fatalf("%s %s: HTTP %d, want %d: %s", method, path, resp.StatusCode, want, raw)
	}
	return resp.StatusCode, out
}

func (st *stack) pspControl(path string) {
	st.t.Helper()
	resp, err := st.pspHTTP.Post(st.psp+path, "application/json", nil)
	if err != nil {
		st.t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		st.t.Fatalf("psp control %s: HTTP %d", path, resp.StatusCode)
	}
}

var stan int

func (st *stack) tap(pi, terminal string, pan, aid, app string) map[string]any {
	st.t.Helper()
	stan++
	_, out := st.tapWithSTAN(pi, terminal, pan, aid, app, fmt.Sprintf("%06d", stan), 200)
	return out
}

// tapWithSTAN sends a terminal authorization with an explicit terminal STAN.
func (st *stack) tapWithSTAN(pi, terminal, pan, aid, app, terminalSTAN string, want int) (int, map[string]any) {
	st.t.Helper()
	ksn := fmt.Sprintf("FFFF9876543210E%05d", len(terminalSTAN)+int(time.Now().UnixNano()%90000))
	blob, err := carddata.DevEncrypt(st.devKey, ksn, carddata.Card{PAN: pan, Expiry: "2911", AID: aid,
		EMVHex: "9F2608A1B2C3D4E5F607089F2701809F3704C0FFEE119F360200429A032610299C0100"})
	if err != nil {
		st.t.Fatal(err)
	}
	return st.call("POST", "/v1/terminal/authorizations", map[string]any{
		"payment_intent_id": pi, "terminal_id": terminal, "stan": terminalSTAN, "emv_application": app,
		"local_time": time.Now().Format(time.RFC3339),
		"sred":       map[string]any{"format": carddata.DevFormat, "ksn": ksn, "ciphertext": base64.StdEncoding.EncodeToString(blob)},
	}, want)
}

func (st *stack) balance(acc string) map[string]any {
	_, b := st.call("GET", "/v1/accounts/"+acc+"/balance", nil, 200)
	return b
}

func num(v any) int64 { f, _ := v.(float64); return int64(f) }

func TestEndToEnd(t *testing.T) {
	st := newStack(t)
	ctx := context.Background()

	// ---- onboarding ----
	root, _ := nostr.GenerateKeys()
	npub, _ := nostr.EncodeNpub(root.PubHex)
	_, m := st.call("POST", "/v1/merchants", map[string]any{
		"legal":      map[string]any{"document": map[string]any{"type": "cnpj", "number": "12345678000195"}, "legal_name": "Cafe Aurora Ltda", "trade_name": "Café Aurora", "mcc": "5812", "city": "São Paulo"},
		"scheme_mid": "000000004127731", "root_npub": npub,
		"plan": map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": true},
	}, 201)
	merchant, account := m["id"].(string), m["account_id"].(string)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant, "type": "mpoc_cots"}, 201)
	terminal := term["terminal_id"].(string)

	// ---- 1. card-present credit tap, approved, instant settlement ----
	_, pi := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 12990, "currency": "BRL", "channel": "card_present"}, 201)
	res := st.tap(pi["id"].(string), terminal, "4111111111111111", "A0000000031010", "credit")
	if res["status"] != "approved" || len(res["authorization_code"].(string)) != 6 {
		t.Fatalf("tap: %v", res)
	}
	settle := res["settlement"].(map[string]any)
	if settle["mode"] != "instant" || num(settle["merchant_discount"]) != 414 {
		t.Fatalf("settlement %v", settle)
	}
	if res["receipt"] == nil || !strings.Contains(res["receipt"].(map[string]any)["claim_qr"].(string), "#k=") {
		t.Fatal("no receipt claim QR")
	}
	net1 := num(settle["net_available"])
	expectedFee := pricing.AdvanceFee(12990-414, 0.165, pricing.BusinessDaysBetween(time.Now(), pricing.SettlementDates(time.Now(), "credit", 1)[0]))
	if net1 != 12990-414-expectedFee {
		t.Fatalf("net available %d, want %d", net1, 12990-414-expectedFee)
	}
	if got := num(st.balance(account)["available"]); got != net1 {
		t.Fatalf("available %d, want %d", got, net1)
	}
	sent := st.sim.ReceivedMTI("0100")
	if de := sent[len(sent)-1]; de.Get(43)[:11] != "CAFE AURORA" || de.Get(41) != terminal {
		t.Fatalf("DE43/41 on the wire: %q %q", de.Get(43), de.Get(41))
	}
	_, got := st.call("GET", "/v1/payment-intents/"+pi["id"].(string), nil, 200)
	if got["status"] != "captured" {
		t.Fatalf("intent %v", got["status"])
	}

	// ---- 2. decline ----
	_, pi2 := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 4551, "channel": "card_present"}, 201)
	if r := st.tap(pi2["id"].(string), terminal, "5555555555554444", "A0000000041010", "debit"); r["status"] != "declined" || r["decline_code"] != "insufficient_funds" {
		t.Fatalf("decline: %v", r)
	}

	// ---- 3. timeout → reversal through store-and-forward ----
	_, pi3 := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 1098, "channel": "card_present"}, 201)
	if r := st.tap(pi3["id"].(string), terminal, "4111111111111111", "A0000000031010", "credit"); r["status"] != "timeout" {
		t.Fatalf("timeout: %v", r)
	}
	st.sw.ProcessReversals(ctx)
	if len(st.sim.ReceivedMTI("0400")) != 1 {
		t.Fatal("timeout reversal not delivered")
	}

	// ---- 4. approve then cancel (reversal + ledger reversal) ----
	_, pi4 := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 2000, "channel": "card_present"}, 201)
	st.tap(pi4["id"].(string), terminal, "4111111111111111", "A0000000031010", "credit")
	before := num(st.balance(account)["available"])
	_, c := st.call("POST", "/v1/payment-intents/"+pi4["id"].(string)+"/cancel", nil, 200)
	if c["status"] != "canceled" || len(st.sim.ReceivedMTI("0400")) != 2 {
		t.Fatalf("cancel: %v", c["status"])
	}
	if after := num(st.balance(account)["available"]); after >= before {
		t.Fatalf("cancel did not debit the instant release: %d → %d", before, after)
	}

	// ---- 5. Pix: dynamic QR, payer pays, webhook (mTLS), capture ----
	_, pix := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 2390, "payment_method_types": []string{"pix"}}, 201)
	_, conf := st.call("POST", "/v1/payment-intents/"+pix["id"].(string)+"/confirm", map[string]any{"payment_method_type": "pix"}, 200)
	na := conf["next_action"].(map[string]any)
	if _, err := brcode.Decode(na["br_code"].(string)); err != nil {
		t.Fatalf("BR Code: %v", err)
	}
	availBeforePix := num(st.balance(account)["available"])
	st.pspControl("/sim/pagar/" + na["txid"].(string))
	_, pixDone := st.call("GET", "/v1/payment-intents/"+pix["id"].(string), nil, 200)
	if pixDone["status"] != "captured" {
		t.Fatalf("pix intent %v", pixDone["status"])
	}
	if got := num(st.balance(account)["available"]); got != availBeforePix+2390 {
		t.Fatalf("pix credit: %d → %d", availBeforePix, got)
	}

	// ---- 6. Pix refund (devolução) settled by webhook ----
	_, ref := st.call("POST", "/v1/refunds", map[string]any{"payment_intent_id": pix["id"].(string), "amount": 1000}, 201)
	if ref["status"] != "pending" || ref["method"] != "pix_return" {
		t.Fatalf("pix refund %v", ref)
	}
	e2e := pixDone["latest_attempt"].(map[string]any)["end_to_end_id"].(string)
	st.pspControl("/sim/devolucao/" + e2e + "/" + strings.ToLower(ref["id"].(string)[3:]) + "/liquidar")
	if _, r := st.call("GET", "/v1/refunds/"+ref["id"].(string), nil, 200); r["status"] != "succeeded" {
		t.Fatalf("pix refund after DEVOLVIDO: %v", r["status"])
	}

	// ---- 7. card refund (online refund authorization) ----
	_, cref := st.call("POST", "/v1/refunds", map[string]any{"payment_intent_id": pi["id"].(string), "amount": 990}, 201)
	if cref["status"] != "succeeded" {
		t.Fatalf("card refund %v", cref)
	}
	refunds := st.sim.ReceivedMTI("0100")
	if last := refunds[len(refunds)-1]; last.Get(3) != "200000" || last.Get(2) != "4111111111111111" {
		t.Fatalf("refund authorization on the wire: DE3 %s", last.Get(3))
	}

	// ---- 8. payout: quote and Pix out ----
	avail := num(st.balance(account)["available"])
	_, q := st.call("POST", "/v1/payouts/quotes", map[string]any{"account_id": account, "amount": avail, "speed": "instant",
		"destination": map[string]any{"type": "pix", "key_type": "CNPJ", "key": "12345678000195"}}, 201)
	_, po := st.call("POST", "/v1/payouts", map[string]any{"quote_id": q["id"]}, 201)
	if po["status"] != "paid" || len(po["end_to_end_id"].(string)) != 32 {
		t.Fatalf("payout %v", po)
	}
	if got := num(st.balance(account)["available"]); got != 0 {
		t.Fatalf("wallet after paying out everything: %d", got)
	}
	if code, _ := st.call("POST", "/v1/payouts", map[string]any{"quote_id": q["id"]}, 0); code != http.StatusConflict {
		t.Fatalf("a quote must be usable once, got %d", code)
	}

	// ---- 9. idempotency ----
	body := map[string]any{"merchant_id": merchant, "amount": 500, "channel": "card_present"}
	b1, _ := json.Marshal(body)
	do := func(key string, b []byte) (int, string, string) {
		req, _ := http.NewRequest("POST", st.api+"/v1/payment-intents", bytes.NewReader(b))
		req.Header.Set("Authorization", "Bearer "+st.key)
		req.Header.Set("Idempotency-Key", key)
		resp, _ := http.DefaultClient.Do(req)
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return resp.StatusCode, resp.Header.Get("Idempotent-Replayed"), string(raw)
	}
	k := ids.ULID()
	c1, _, r1 := do(k, b1)
	c2, replayed, r2 := do(k, b1)
	b2, _ := json.Marshal(map[string]any{"merchant_id": merchant, "amount": 501, "channel": "card_present"})
	c3, _, _ := do(k, b2)
	if c1 != 201 || c2 != 201 || replayed != "true" || r1 != r2 || c3 != 422 {
		t.Fatalf("idempotency: %d %d %q %d", c1, c2, replayed, c3)
	}

	// ---- 10. the ledger is consistent: L1–L5 ----
	v, err := st.ledger.Verify(ctx, ledger.DefaultVerifyOptions)
	if err != nil || len(v) > 0 {
		t.Fatalf("ledger invariants: %v %v", v, err)
	}

	// ---- 11. webhooks are delivered and correctly signed ----
	n, err := st.dispatch.Once(ctx)
	if err != nil || n < 5 {
		t.Fatalf("delivered %d webhooks: %v", n, err)
	}
	types := map[string]bool{}
	for i := 0; i < n; i++ {
		d := <-st.hooks
		if err := webhooks.Verify(st.hookSec, d.id, d.ts, d.sig, d.body, 5*time.Minute, time.Now()); err != nil {
			t.Fatalf("webhook signature: %v", err)
		}
		var ev map[string]any
		_ = json.Unmarshal(d.body, &ev)
		types[ev["type"].(string)] = true
	}
	for _, want := range []string{"payment_intent.captured", "payment_intent.failed", "payment_intent.canceled", "refund.succeeded", "payout.paid"} {
		if !types[want] {
			t.Errorf("missing webhook %s (got %v)", want, types)
		}
	}
}

func TestProductionGuards(t *testing.T) {
	st := newStack(t)
	// Card-not-present needs the 3DS server: the API says so instead of pretending.
	_, m := st.call("POST", "/v1/merchants", map[string]any{
		"legal":      map[string]any{"document": map[string]any{"type": "cnpj", "number": "12345678000195"}, "legal_name": "X Ltda", "trade_name": "X", "mcc": "5812", "city": "Rio"},
		"scheme_mid": "1",
	}, 201)
	_, pi := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": m["id"], "amount": 1000, "channel": "ecommerce"}, 201)
	if code, _ := st.call("POST", "/v1/payment-intents/"+pi["id"].(string)+"/confirm", map[string]any{"payment_method_type": "card", "payment_method": "pm_card_x"}, 0); code != http.StatusNotImplemented {
		t.Fatalf("CNP confirm: %d", code)
	}
	// Unknown fields are rejected rather than silently ignored.
	if code, _ := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": m["id"], "amount": 1000, "surprise": true}, 0); code != http.StatusBadRequest {
		t.Fatalf("unknown field: %d", code)
	}
	// No API key.
	resp, _ := http.Get(st.api + "/v1/payment-intents/" + pi["id"].(string))
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no key: %d", resp.StatusCode)
	}
}
