package e2e

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/exchange"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/screening"
)

type downScreener struct{}

func (downScreener) Name() string { return "provider" }
func (downScreener) Screen(context.Context, string, string) (bool, string, error) {
	return false, "", errors.New("timeout")
}

// Sanctions screening, the nightly custody reconciliation and the DeCripto, through the
// flows that feed them (docs/09 §6 and §8).
func TestComplianceForDigitalAssets(t *testing.T) {
	venue := exchange.NewMemory("simex")
	st := newStack(t,
		func(c *payments.Config) {
			c.RiskMode = payments.RiskShadow
			c.PlatformDocument, c.ReportingName, c.ReportingURL = "22.222.222/0001-91", "goonersPAY Teste", "https://goonerspay.example"
		},
		func(d *payments.Deps) { d.Exchanges = &exchange.Router{Venues: []exchange.Exchange{venue}} })
	ctx := t.Context()
	_, m := st.call("POST", "/v1/merchants", map[string]any{
		"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": cnpj("998877660001")}, "legal_name": "Cripto Café Ltda", "trade_name": "Cripto Café", "mcc": "5812", "city": "Natal"},
		"plan":  map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": true},
	}, 201)
	merchant, document := m["id"].(string), cnpj("998877660001")

	// A crypto payment, a purchase and a sale of bitcoin, and two withdrawals.
	_, cp := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 500_00, "channel": "crypto"}, 201)
	st.call("POST", "/v1/payment-intents/"+cp["id"].(string)+"/confirm", map[string]any{"payment_method_type": "crypto", "asset": "USDT", "network": "tron"}, 200)
	st.call("POST", "/v1/sandbox/crypto/payments/"+cp["id"].(string), nil, 200)
	_, buy := st.call("POST", "/v1/conversions", map[string]any{"merchant_id": merchant, "side": "buy", "asset": "BTC", "brl_amount": 350_00}, 201)
	st.call("POST", "/v1/conversions/"+buy["id"].(string)+"/execute", nil, 200)
	_, sell := st.call("POST", "/v1/conversions", map[string]any{"merchant_id": merchant, "side": "sell", "asset": "BTC", "amount": "0.0002"}, 201)
	st.call("POST", "/v1/conversions/"+sell["id"].(string)+"/execute", nil, 200)

	// ---- screening ----
	withdraw := func(address, network, asset, amount, kind string, want int) map[string]any {
		_, out := st.call("POST", "/v1/crypto/withdrawals", map[string]any{"merchant_id": merchant, "asset": asset, "network": network,
			"address": address, "amount": amount, "destination_type": kind}, want)
		return out
	}
	refused := withdraw("0x0000000000000000000000000000000000000BAD", "ethereum", "BTC", "0.0001", "", 422) // BTC does not move on ethereum
	if refused["code"] != "invalid_request" {
		t.Fatalf("%v", refused)
	}
	withdraw("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "bitcoin", "BTC", "0.0001", "exchange", 201)
	withdraw("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "bitcoin", "BTC", "0.00005", "", 201)
	withdraw("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "bitcoin", "BTC", "0.00001", "bank", 422)
	// The sandbox's sanctioned test address, in any letter case: refused before anything moves.
	_, usdt := st.call("POST", "/v1/conversions", map[string]any{"merchant_id": merchant, "side": "buy", "asset": "USDT", "brl_amount": 54_00}, 201)
	st.call("POST", "/v1/conversions/"+usdt["id"].(string)+"/execute", nil, 200)
	before := holding(t, st, merchant, "USDT")
	if out := withdraw("0x0000000000000000000000000000000000000BAD", "ethereum", "USDT", "1", "", 403); out["code"] != "address_refused" {
		t.Fatalf("a sanctioned address: %v", out)
	}
	if holding(t, st, merchant, "USDT") != before {
		t.Fatal("a refused withdrawal moved money")
	}
	var hits, clears int
	_ = st.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE result = 'hit'), count(*) FILTER (WHERE result = 'clear') FROM address_screenings WHERE merchant_id = $1`, merchant).Scan(&hits, &clears)
	if hits != 1 || clears != 2 {
		t.Fatalf("screenings recorded: %d hits, %d clear", hits, clears)
	}

	// ---- custody reconciliation ----
	run, err := st.svc.ReconcileCustody(ctx, time.Now())
	if err != nil || run.Status != "balanced" {
		t.Fatalf("after the flows the venue and the ledger agree: %v %+v", err, run)
	}
	// A transfer that matches no charge, at a quiet time (no charge pending): the night's run
	// finds it, accounts for it, and gives it to operations, not as a custody difference.
	addr, _, _ := venue.DepositAddress(ctx, "USDT", "tron")
	stray := venue.SimulateDeposit("USDT", "tron", addr, "", 1_234_567)
	run, err = st.svc.ReconcileCustody(ctx, time.Now())
	if err != nil || run.Status != "exceptions" || len(run.Exceptions) != 1 || run.Exceptions[0].Kind != "unapplied_crypto_deposit" ||
		run.Exceptions[0].Reference != "simex/"+stray.ID {
		t.Fatalf("an unmatched deposit: %v %+v", err, run)
	}
	// Bitcoin leaves the venue without a journal: the night's run says where and how much.
	venue.Fund("BTC", -1_000)
	run, err = st.svc.ReconcileCustody(ctx, time.Now())
	var mismatch *payments.ReconItem
	for i, e := range run.Exceptions {
		if e.Kind == "custody_mismatch" {
			mismatch = &run.Exceptions[i]
		}
	}
	if err != nil || mismatch == nil || len(run.Exceptions) != 2 {
		t.Fatalf("a venue-side difference: %v %+v", err, run)
	}
	if mismatch.Reference != "simex/BTC" || *mismatch.Expected-*mismatch.Actual != 1_000 {
		t.Fatalf("exception %+v", mismatch)
	}
	open, err := st.svc.OpenExceptions(ctx, payments.PlatformTenant)
	if err != nil || len(open) != 2 {
		t.Fatalf("open platform exceptions (the deposit once, the difference): %v %v", open, err)
	}

	// ---- DeCripto ----
	rep, err := st.svc.BuildDeCripto(ctx, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(string(rep.Content), "\r\n"), "\r\n")
	if lines[0] != "0000|22222222000191|goonersPAY Teste|https://goonerspay.example" || !strings.HasPrefix(lines[len(lines)-1], "9999|") {
		t.Fatalf("header and trailer: %q … %q", lines[0], lines[len(lines)-1])
	}
	count := func(prefix string) (n int, sample string) {
		for _, l := range lines {
			if strings.HasPrefix(l, prefix+"|") && strings.Contains(l, document) {
				n, sample = n+1, l
			}
		}
		return n, sample
	}
	// The payment: received for goods (0350, type 6) and sold to the platform (0110).
	if n, l := count("0350"); n != 1 || !strings.Contains(l, "|III|6|500,00||USDT|") {
		t.Fatalf("0350: %d %q", n, l)
	}
	// Four sales and purchases: the payment's sale, BTC bought and sold, USDT bought.
	if n, _ := count("0110"); n != 4 {
		t.Fatalf("0110: %d\n%s", n, rep.Content)
	}
	if n, l := count("0450"); n != 1 || !strings.Contains(l, "|IV|1|") {
		t.Fatalf("0450 (to another provider): %d %q", n, l)
	}
	if n, l := count("0650"); n != 1 || !strings.Contains(l, "|VI|") || !strings.Contains(l, "|BTC|0,00005000|") {
		t.Fatalf("0650 (to a wallet): %d %q", n, l)
	}
	if rep.Records["0110"].Count != 4 || rep.Records["0350"].Value != 500_00 || len(rep.Warnings) != 0 {
		t.Fatalf("records %+v warnings %v", rep.Records, rep.Warnings)
	}
	if !strings.HasPrefix(lines[len(lines)-1], "9999|4|") {
		t.Fatalf("9999: %q", lines[len(lines)-1])
	}
	// Filed once, with the receipt; then it is not rewritten.
	if err := st.svc.MarkDeCriptoFiled(ctx, time.Now(), "00", "REC-1", "ops@goonerspay"); !errors.Is(err, payments.ErrNotFound) {
		t.Fatalf("filing another file: %v", err)
	}
	if err := st.svc.MarkDeCriptoFiled(ctx, time.Now(), rep.SHA256, "REC-1", "ops@goonerspay"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.svc.BuildDeCripto(ctx, time.Now()); !errors.Is(err, payments.ErrConflict) {
		t.Fatalf("a filed month is not rewritten: %v", err)
	}
	// December's file carries the year-end balances and the CARF identification.
	dec, err := st.svc.BuildDeCripto(ctx, time.Date(time.Now().Year(), time.December, 10, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if s := string(dec.Content); !strings.Contains(s, "\r\n1000|3112") || !strings.Contains(s, "\r\n1010|USDT|") || !strings.Contains(s, "\r\n2000|CARF902|BR\r\n") {
		t.Fatalf("december:\n%s", s)
	}
	if due := payments.DeCriptoDue(time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)); due.Format("2006-01-02") != "2026-08-31" {
		t.Fatalf("July 2026 is due on 31/08/2026, got %s", due.Format("2006-01-02"))
	}
}

// Without screening, or when it cannot answer, nothing is sent (fail closed).
func TestWithdrawalsWaitForScreening(t *testing.T) {
	for _, c := range []struct {
		screener payments.AddressScreener
		want     int
	}{{nil, 503}, {screening.Set{downScreener{}}, 503}} {
		st := newStack(t, func(cfg *payments.Config) { cfg.RiskMode = payments.RiskShadow }, func(d *payments.Deps) { d.Screener = c.screener })
		_, m := st.call("POST", "/v1/merchants", map[string]any{
			"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": cnpj("112233440001")}, "legal_name": "Loja", "trade_name": "Loja", "mcc": "5812", "city": "Natal"},
			"plan":  map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": true},
		}, 201)
		_, cp := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": m["id"], "amount": 400_00, "channel": "crypto"}, 201)
		st.call("POST", "/v1/payment-intents/"+cp["id"].(string)+"/confirm", map[string]any{"payment_method_type": "crypto", "asset": "USDT", "network": "tron"}, 200)
		st.call("POST", "/v1/sandbox/crypto/payments/"+cp["id"].(string), nil, 200)
		_, q := st.call("POST", "/v1/conversions", map[string]any{"merchant_id": m["id"], "side": "buy", "asset": "USDT", "brl_amount": 54_00}, 201)
		st.call("POST", "/v1/conversions/"+q["id"].(string)+"/execute", nil, 200)
		st.call("POST", "/v1/crypto/withdrawals", map[string]any{"merchant_id": m["id"], "asset": "USDT", "network": "tron",
			"address": "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8", "amount": "1"}, c.want)
	}
}

func holding(t *testing.T, st *stack, merchant, asset string) int64 {
	t.Helper()
	_, hs := st.call("GET", "/v1/holdings?merchant_id="+merchant, nil, 200)
	for _, h := range hs["data"].([]any) {
		if h := h.(map[string]any); h["asset"] == asset {
			return num(h["units"])
		}
	}
	return 0
}
