package e2e

import (
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
)

// Crypto, international accounts and B3 through the API (docs/09): a payment in USDT settled
// in reais, conversions both ways, a withdrawal, a foreign account paid from abroad and paying
// out, and shares bought and sold at B3 with D+2 settlement; the ledger holds L1–L6 after.
func TestDigitalAssetsInternationalAndB3(t *testing.T) {
	// The fraud shield watches in shadow: a new merchant's large sale would otherwise be held.
	st := newStack(t, func(c *payments.Config) { c.RiskMode = payments.RiskShadow })
	ctx := t.Context()
	_, m := st.call("POST", "/v1/merchants", map[string]any{
		"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": cnpj("556677880001")}, "legal_name": "Loja Global", "trade_name": "Global", "mcc": "5812", "city": "Recife"},
		"plan":  map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": true},
	}, 201)
	merchant, account := m["id"].(string), m["account_id"].(string)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant, "type": "mpoc_cots"}, 201)
	_, pi := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 9000_00, "channel": "card_present"}, 201)
	if r := st.tap(pi["id"].(string), term["terminal_id"].(string), "4111111111111111", visaAID, "credit"); r["status"] != "approved" {
		t.Fatalf("a card sale to fund the wallet: %v", r)
	}
	wallet := func() int64 { return num(st.balance(account)["available"]) }
	start := wallet()

	// ---- a payment in USDT on Tron, settled in reais ----
	_, cp := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 100_00, "channel": "crypto"}, 201)
	st.call("POST", "/v1/payment-intents/"+cp["id"].(string)+"/confirm", map[string]any{"payment_method_type": "crypto", "asset": "USDT", "network": "bitcoin"}, 422)
	_, q := st.call("POST", "/v1/payment-intents/"+cp["id"].(string)+"/confirm", map[string]any{"payment_method_type": "crypto", "asset": "USDT", "network": "tron"}, 200)
	act, _ := q["next_action"].(map[string]any)
	if q["status"] != "requires_action" || act["type"] != "crypto_transfer" || !strings.HasPrefix(act["address"].(string), "T") || num(act["amount_units"]) < 18_500_000 {
		t.Fatalf("crypto charge: %v", q)
	}
	_, cp2 := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 100_00, "channel": "crypto"}, 201)
	_, q2 := st.call("POST", "/v1/payment-intents/"+cp2["id"].(string)+"/confirm", map[string]any{"payment_method_type": "crypto", "asset": "USDT", "network": "tron"}, 200)
	if q2["next_action"].(map[string]any)["amount_units"] == act["amount_units"] {
		t.Fatal("two charges to one address must ask for different amounts")
	}
	_, paid := st.call("POST", "/v1/sandbox/crypto/payments/"+cp["id"].(string), nil, 200)
	if paid["status"] != "captured" || paid["receipt"] == nil || paid["latest_attempt"].(map[string]any)["txid"] == nil {
		t.Fatalf("paid: %v", paid)
	}
	if got := wallet() - start; got != 98_50 {
		t.Fatalf("the wallet got %d, want R$ 100,00 less the 1,5%% fee", got)
	}
	st.call("POST", "/v1/sandbox/crypto/payments/"+cp["id"].(string), nil, 404)                          // nothing pending any more
	st.call("POST", "/v1/refunds", map[string]any{"payment_intent_id": cp["id"], "amount": 100_00}, 409) // returned in crypto, by hand

	// ---- buy and sell bitcoin ----
	_, cq := st.call("POST", "/v1/conversions", map[string]any{"merchant_id": merchant, "side": "buy", "asset": "BTC", "brl_amount": 350_00}, 201)
	if cq["status"] != "quoted" || num(cq["total"]) != 350_00+num(cq["fee"]) || num(cq["asset_units"]) < 99_000 {
		t.Fatalf("quote: %v", cq)
	}
	before := wallet()
	_, cx := st.call("POST", "/v1/conversions/"+cq["id"].(string)+"/execute", nil, 200)
	if cx["status"] != "executed" || before-wallet() != num(cq["total"]) {
		t.Fatalf("executed: %v (wallet %d → %d)", cx, before, wallet())
	}
	st.call("POST", "/v1/conversions/"+cq["id"].(string)+"/execute", nil, 200) // idempotent
	if before-wallet() != num(cq["total"]) {
		t.Fatal("executing twice charged twice")
	}
	_, hs := st.call("GET", "/v1/holdings?merchant_id="+merchant, nil, 200)
	btc := hs["data"].([]any)[0].(map[string]any)
	if btc["asset"] != "BTC" || num(btc["units"]) != num(cx["asset_units"]) || btc["value_brl"] == nil {
		t.Fatalf("holdings: %v", hs)
	}
	_, sq := st.call("POST", "/v1/conversions", map[string]any{"merchant_id": merchant, "side": "sell", "asset": "BTC", "amount": "0.0005"}, 201)
	before = wallet()
	st.call("POST", "/v1/conversions/"+sq["id"].(string)+"/execute", nil, 200)
	if wallet()-before != num(sq["total"]) {
		t.Fatalf("a sale credits its total: %d vs %v", wallet()-before, sq["total"])
	}
	_, big := st.call("POST", "/v1/conversions", map[string]any{"merchant_id": merchant, "side": "sell", "asset": "BTC", "amount": "5"}, 201)
	st.call("POST", "/v1/conversions/"+big["id"].(string)+"/execute", nil, 422) // more than held

	// ---- send bitcoin out ----
	st.call("POST", "/v1/crypto/withdrawals", map[string]any{"merchant_id": merchant, "asset": "BTC", "network": "bitcoin", "address": "not-an-address", "amount": "0.0001"}, 422)
	_, wd := st.call("POST", "/v1/crypto/withdrawals", map[string]any{"merchant_id": merchant, "asset": "BTC", "network": "bitcoin",
		"address": "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "amount": "0.0001"}, 201)
	if wd["status"] != "sent" || num(wd["network_fee_units"]) != 10_000 {
		t.Fatalf("withdrawal: %v", wd)
	}

	// ---- an account in dollars ----
	_, fq := st.call("POST", "/v1/conversions", map[string]any{"merchant_id": merchant, "side": "buy", "asset": "USD", "brl_amount": 108_00}, 201)
	if num(fq["tax"]) != 378 || num(fq["asset_units"]) < 19_90 { // IOF 3,5% on R$ 108,00
		t.Fatalf("fx quote: %v", fq)
	}
	st.call("POST", "/v1/conversions/"+fq["id"].(string)+"/execute", nil, 200)
	_, accts := st.call("POST", "/v1/sandbox/international/credits", map[string]any{"merchant_id": merchant, "currency": "USD", "amount": "100.00", "payer": "Client LLC"}, 200)
	var usd map[string]any
	for _, a := range accts["data"].([]any) {
		if a.(map[string]any)["currency"] == "USD" {
			usd = a.(map[string]any)
		}
	}
	recv := usd["receive"].(map[string]any)
	if num(usd["units"]) != num(fq["asset_units"])+100_00 || recv["routing_number"] == "" || !strings.HasPrefix(recv["reference"].(string), "GP") {
		t.Fatalf("usd account: %v", usd)
	}
	ben := map[string]any{"name": "Acme Inc", "type": "business", "country": "US", "routing_number": "026009593", "account_number": "12345678"}
	st.call("POST", "/v1/international/payouts", map[string]any{"merchant_id": merchant, "currency": "USD", "amount": "50.00", "beneficiary": map[string]any{"name": "Acme", "type": "business", "country": "US", "routing_number": "123"}}, 422)
	_, ip := st.call("POST", "/v1/international/payouts", map[string]any{"merchant_id": merchant, "currency": "USD", "amount": "50.00", "reference": "Invoice 7", "beneficiary": ben}, 201)
	if ip["status"] != "sent" || ip["fee"] != "5.00" {
		t.Fatalf("payout abroad: %v", ip)
	}
	_, accts = st.call("GET", "/v1/international/accounts?merchant_id="+merchant, nil, 200)
	for _, a := range accts["data"].([]any) {
		if a := a.(map[string]any); a["currency"] == "USD" && num(a["units"]) != num(usd["units"])-55_00 {
			t.Fatalf("after the payout: %v", a)
		}
	}

	// ---- shares at B3 ----
	order := map[string]any{"merchant_id": merchant, "ticker": "PETR4", "side": "buy", "quantity": 150}
	st.call("POST", "/v1/investments/orders", order, 404) // no suitability on file
	st.call("PUT", "/v1/investments/profile", map[string]any{"merchant_id": merchant, "answers": map[string]any{"horizon": 0, "tolerance": 0, "experience": 0}}, 200)
	st.call("POST", "/v1/investments/orders", order, 409) // conservative: no variable income
	_, prof := st.call("PUT", "/v1/investments/profile", map[string]any{"merchant_id": merchant, "answers": map[string]any{"horizon": 2, "tolerance": 2, "experience": 1}}, 200)
	if prof["profile"] != "arrojado" {
		t.Fatalf("profile %v", prof)
	}
	if _, q := st.call("GET", "/v1/investments/quotes/PETR4", nil, 200); q["last"] != "38.50" || q["lot"] != float64(100) {
		t.Fatalf("quote %v", q)
	}
	before = wallet()
	_, buy := st.call("POST", "/v1/investments/orders", order, 201)
	if len(buy["legs"].([]any)) != 2 || num(buy["gross"]) != 577500 || before-wallet() != num(buy["total"]) {
		t.Fatalf("buy: %v (wallet %d → %d)", buy, before, wallet())
	}
	st.call("POST", "/v1/investments/orders", map[string]any{"merchant_id": merchant, "ticker": "PETR4", "side": "sell", "quantity": 151}, 422)
	_, sell := st.call("POST", "/v1/investments/orders", map[string]any{"merchant_id": merchant, "ticker": "PETR4", "side": "sell", "quantity": 50}, 201)
	_, pf := st.call("GET", "/v1/investments/positions?merchant_id="+merchant, nil, 200)
	pos := pf["positions"].([]any)[0].(map[string]any)
	if num(pos["quantity"]) != 100 || pos["value"] == nil || len(pf["orders"].([]any)) != 2 {
		t.Fatalf("positions: %v", pf)
	}
	before = wallet()
	if n, err := st.svc.SettleInvestments(ctx, time.Now().AddDate(0, 0, 7)); err != nil || n != 2 {
		t.Fatalf("settled %d: %v", n, err)
	}
	if wallet()-before != num(sell["total"]) {
		t.Fatalf("the sale's proceeds at D+2: %d, want %v", wallet()-before, sell["total"])
	}
	st.call("GET", "/v1/investments/quotes/NOPE", nil, 422)

	if v, err := st.ledger.Verify(ctx, ledger.DefaultVerifyOptions); err != nil || len(v) > 0 {
		t.Fatalf("ledger invariants: %v %v", v, err)
	}
}
