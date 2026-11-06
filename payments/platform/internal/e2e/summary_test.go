package e2e

import (
	"testing"
	"time"
)

// A merchant's day at a glance (docs/02 §8.5): what was sold, by method and by hour, against
// the same weekday last week, what still waits, and the latest payments.
func TestDaySummary(t *testing.T) {
	st := newStack(t)
	ctx := t.Context()
	_, m := st.call("POST", "/v1/merchants", map[string]any{
		"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": cnpj("321321320001")}, "legal_name": "Padaria Resumo Ltda", "trade_name": "Padaria Resumo", "mcc": "5812", "city": "Natal"},
		"plan":  map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": true},
	}, 201)
	merchant := m["id"].(string)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant}, 201)
	terminal := term["terminal_id"].(string)

	// Nothing yet: zeros, an empty curve and lists, not nulls.
	_, empty := st.call("GET", "/v1/merchants/"+merchant+"/summary", nil, 200)
	if num(empty["sales"]) != 0 || len(empty["hourly"].([]any)) != 24 || len(empty["recent"].([]any)) != 0 || len(empty["by_method"].([]any)) != 0 {
		t.Fatalf("an empty day: %v", empty)
	}

	st.sale(merchant, terminal, 10000)
	st.sale(merchant, terminal, 2000)
	// A crypto charge shown and not yet paid waits.
	_, pi := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 5000, "channel": "crypto"}, 201)
	st.call("POST", "/v1/payment-intents/"+pi["id"].(string)+"/confirm", map[string]any{"payment_method_type": "crypto", "asset": "USDT", "network": "tron"}, 200)
	// Last week's same weekday sold 8.000 by now: today's 12.000 is 50% more.
	if _, err := st.pool.Exec(ctx, `INSERT INTO payment_intents (id, tenant_id, merchant_id, status, amount, currency, channel, capture_method, amount_captured, fee, captured_at, created_at)
		VALUES ('pi_lastweek', $1, $2, 'captured', 8000, 'BRL', 'pix', 'automatic', 8000, 0, now() - interval '7 days' - interval '1 second', now() - interval '7 days' - interval '1 second')`,
		tenant, merchant); err != nil {
		t.Fatal(err)
	}

	_, sum := st.call("GET", "/v1/merchants/"+merchant+"/summary", nil, 200)
	if sum["object"] != "day_summary" || num(sum["sales"]) != 2 || num(sum["gross"]) != 12000 || num(sum["average_ticket"]) != 6000 {
		t.Fatalf("the day: %v", sum)
	}
	if num(sum["fees"]) <= 0 || num(sum["net"]) != 12000-num(sum["fees"]) {
		t.Fatalf("fees and net: %v", sum)
	}
	methods := sum["by_method"].([]any)
	if len(methods) != 1 || methods[0].(map[string]any)["method"] != "credit" || num(methods[0].(map[string]any)["gross"]) != 12000 {
		t.Fatalf("by method: %v", methods)
	}
	var hourly int64
	for _, v := range sum["hourly"].([]any) {
		hourly += num(v)
	}
	if hourly != 12000 {
		t.Fatalf("the hourly curve adds up to %d", hourly)
	}
	lw := sum["last_week"].(map[string]any)
	if num(lw["gross"]) != 8000 || lw["change_pct"].(float64) != 50 || lw["date"] != time.Now().In(brtLoc()).AddDate(0, 0, -7).Format("2006-01-02") {
		t.Fatalf("last week: %v", lw)
	}
	if w := sum["waiting"].(map[string]any); num(w["count"]) != 1 || num(w["amount"]) != 5000 {
		t.Fatalf("waiting: %v", w)
	}
	recent := sum["recent"].([]any)
	if len(recent) != 3 || recent[0].(map[string]any)["method"] != "crypto" || recent[1].(map[string]any)["card"] == "" {
		t.Fatalf("recent: %v", recent)
	}

	// Another day, a bad date, a future date, someone else's merchant.
	_, past := st.call("GET", "/v1/merchants/"+merchant+"/summary?date="+time.Now().In(brtLoc()).AddDate(0, 0, -7).Format("2006-01-02"), nil, 200)
	if num(past["gross"]) != 8000 || past["by_method"].([]any)[0].(map[string]any)["method"] != "pix" {
		t.Fatalf("last week's day: %v", past)
	}
	st.call("GET", "/v1/merchants/"+merchant+"/summary?date=31/10/2026", nil, 422)
	st.call("GET", "/v1/merchants/"+merchant+"/summary?date="+time.Now().AddDate(0, 0, 3).Format("2006-01-02"), nil, 422)
	st.call("GET", "/v1/merchants/mer_01M69K0V3GC8TSECSX0HV48PR3/summary", nil, 404)
}

func brtLoc() *time.Location { return time.FixedZone("BRT", -3*3600) }
