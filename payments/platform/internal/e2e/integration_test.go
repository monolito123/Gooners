package e2e

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
)

// What an integrator relies on beyond the payment flows (docs/02 §1): the version and rate
// limit headers, lists with cursors, webhook endpoint management, ledger entries page by page,
// and the period summary behind the 7- and 30-day charts.
func TestIntegrationSurface(t *testing.T) {
	st := newStack(t)
	ctx := t.Context()

	// ---- conventions ----
	raw := func(version string) *http.Response {
		req, _ := http.NewRequest("GET", st.api+"/v1/merchants?limit=1", nil)
		req.Header.Set("Authorization", "Bearer "+st.key)
		if version != "" {
			req.Header.Set("Api-Version", version)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp
	}
	if resp := raw(""); resp.StatusCode != 200 || resp.Header.Get("Api-Version") != "2026-10-01" || resp.Header.Get("Request-Id") == "" ||
		!strings.HasPrefix(resp.Header.Get("RateLimit-Policy"), `"per-key";q=`) || !strings.Contains(resp.Header.Get("RateLimit"), ";r=") {
		t.Fatalf("headers of a call without Api-Version: %d %v", resp.StatusCode, resp.Header)
	}
	if resp := raw("2031-01-01"); resp.StatusCode != 400 || resp.Header.Get("Api-Version") != "2026-10-01" {
		t.Fatalf("an unknown Api-Version: %d %v", resp.StatusCode, resp.Header)
	}
	if resp := raw("2026-10-01"); resp.StatusCode != 200 {
		t.Fatalf("the current Api-Version named: %d", resp.StatusCode)
	}

	// ---- merchants ----
	var made []string
	for _, name := range []string{"Loja Um", "Loja Dois", "Loja Tres"} {
		_, m := st.call("POST", "/v1/merchants", map[string]any{
			"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": cnpj("4455667700" + string(rune('1'+len(made))) + "0")}, "legal_name": name + " Ltda",
				"trade_name": name, "mcc": "5812", "city": "Recife"},
			"plan": map[string]any{"credit_bps": 299, "debit_bps": 129, "installment_bps": 459, "pix_bps": 0, "tier": "A", "instant": true},
		}, 201)
		if plan := m["plan"].(map[string]any); num(plan["credit_bps"]) != 299 || plan["tier"] != "A" {
			t.Fatalf("the plan in snake_case: %v", plan)
		}
		made = append(made, m["id"].(string))
	}
	_, page := st.call("GET", "/v1/merchants?limit=2", nil, 200)
	first := page["data"].([]any)
	if len(first) != 2 || page["has_more"] != true || first[0].(map[string]any)["id"] != made[2] || first[1].(map[string]any)["id"] != made[1] {
		t.Fatalf("merchants, newest first: %v", page)
	}
	_, next := st.call("GET", "/v1/merchants?limit=2&starting_after="+page["next_cursor"].(string), nil, 200)
	if rest := next["data"].([]any); len(rest) == 0 || rest[0].(map[string]any)["id"] != made[0] {
		t.Fatalf("the next page: %v", next)
	}
	st.call("GET", "/v1/merchants?status=sleeping", nil, 422)

	// ---- payments ----
	merchant := made[0]
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant}, 201)
	st.sale(merchant, term["terminal_id"].(string), 4000)
	st.sale(merchant, term["terminal_id"].(string), 6000)
	_, pix := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 1500, "channel": "pix"}, 201)
	st.call("POST", "/v1/payment-intents/"+pix["id"].(string)+"/confirm", map[string]any{"payment_method_type": "pix"}, 200)
	_, all := st.call("GET", "/v1/payment-intents?merchant_id="+merchant, nil, 200)
	if got := all["data"].([]any); len(got) != 3 || got[0].(map[string]any)["id"] != pix["id"] {
		t.Fatalf("a merchant's payments, newest first: %v", all)
	}
	_, captured := st.call("GET", "/v1/payment-intents?merchant_id="+merchant+"&status=captured&method=credit", nil, 200)
	if len(captured["data"].([]any)) != 2 {
		t.Fatalf("captured credit sales: %v", captured)
	}
	_, one := st.call("GET", "/v1/payment-intents?merchant_id="+merchant+"&limit=1", nil, 200)
	_, two := st.call("GET", "/v1/payment-intents?merchant_id="+merchant+"&limit=1&starting_after="+one["next_cursor"].(string), nil, 200)
	if one["has_more"] != true || two["data"].([]any)[0].(map[string]any)["id"] == one["data"].([]any)[0].(map[string]any)["id"] {
		t.Fatalf("payments page by page: %v / %v", one, two)
	}
	today := time.Now().In(brtLoc()).Format("2006-01-02")
	_, dated := st.call("GET", "/v1/payment-intents?merchant_id="+merchant+"&from="+today+"&to="+today, nil, 200)
	_, before := st.call("GET", "/v1/payment-intents?merchant_id="+merchant+"&to="+time.Now().In(brtLoc()).AddDate(0, 0, -1).Format("2006-01-02"), nil, 200)
	if len(dated["data"].([]any)) != 3 || len(before["data"].([]any)) != 0 {
		t.Fatalf("by date: %d today, %d before", len(dated["data"].([]any)), len(before["data"].([]any)))
	}
	st.call("GET", "/v1/payment-intents?status=lost", nil, 422)
	st.call("GET", "/v1/payment-intents?from=07/11/2026", nil, 422)
	// A capture on a payment that is not waiting for one is refused, not repeated.
	st.call("POST", "/v1/payment-intents/"+pix["id"].(string)+"/capture", map[string]any{}, 409)

	// ---- ledger entries, page by page ----
	_, m0 := st.call("GET", "/v1/merchants/"+merchant, nil, 200)
	account := m0["account_id"].(string)
	_, e1 := st.call("GET", "/v1/accounts/"+account+"/entries?limit=1", nil, 200)
	if e1["has_more"] != true || e1["next_cursor"] == nil {
		t.Fatalf("a first page of entries: %v", e1)
	}
	_, e2 := st.call("GET", "/v1/accounts/"+account+"/entries?limit=1&starting_after="+e1["next_cursor"].(string), nil, 200)
	a, b := e1["data"].([]any)[0].(map[string]any), e2["data"].([]any)[0].(map[string]any)
	if a["id"] == b["id"] || b["id"] == nil {
		t.Fatalf("the second page repeats the first: %v / %v", a, b)
	}
	st.call("GET", "/v1/accounts/"+account+"/entries?starting_after=nonsense", nil, 422)

	// ---- webhook endpoints ----
	_, ep := st.call("POST", "/v1/webhook-endpoints", map[string]any{"url": "http://127.0.0.1:9/hook", "events": []string{"payment_intent.succeeded"}}, 201)
	id := ep["id"].(string)
	_, eps := st.call("GET", "/v1/webhook-endpoints", nil, 200)
	found := false
	for _, x := range eps["data"].([]any) {
		e := x.(map[string]any)
		if _, leaks := e["secret"]; leaks {
			t.Fatalf("a listed endpoint shows its secret: %v", e)
		}
		found = found || (e["id"] == id && e["status"] == "enabled")
	}
	if !found {
		t.Fatalf("the new endpoint is not listed: %v", eps)
	}
	_, off := st.call("DELETE", "/v1/webhook-endpoints/"+id, nil, 200)
	if off["status"] != "disabled" || off["disabled_at"] == nil {
		t.Fatalf("a disabled endpoint: %v", off)
	}
	st.call("DELETE", "/v1/webhook-endpoints/"+id, nil, 200) // again: the same answer
	st.call("POST", "/v1/webhook-endpoints/"+id+"/replay", map[string]any{"since": time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)}, 409)
	st.sale(merchant, term["terminal_id"].(string), 700)
	var queued int
	if err := st.pool.QueryRow(ctx, `SELECT count(*) FROM webhook_deliveries WHERE endpoint_id = $1 AND abandoned_at IS NULL`, id).Scan(&queued); err != nil || queued != 0 {
		t.Fatalf("deliveries for a disabled endpoint: %d %v", queued, err)
	}
	st.call("GET", "/v1/webhook-endpoints/we_01M6VSBMDWZVGDAE4BC12M7XCN", nil, 404)

	// ---- the period summary ----
	// Two days ago, and the same day of the week before (the previous period of a 7-day range).
	put := func(daysAgo int, amount int64, channel string) {
		at := time.Now().AddDate(0, 0, -daysAgo)
		if _, err := st.pool.Exec(ctx, `INSERT INTO payment_intents (id, tenant_id, merchant_id, status, amount, currency, channel, capture_method, amount_captured, fee, captured_at, created_at)
			VALUES ($3, $1, $2, 'captured', $4, 'BRL', $5, 'automatic', $4, 0, $6, $6)`, tenant, merchant, ids.New("pi"), amount, channel, at); err != nil {
			t.Fatal(err)
		}
	}
	put(2, 9000, "pix")
	put(9, 3000, "pix")
	put(400, 100, "pix") // long ago: in no period below
	_, week := st.call("GET", "/v1/merchants/"+merchant+"/summary/period?from="+time.Now().In(brtLoc()).AddDate(0, 0, -6).Format("2006-01-02"), nil, 200)
	daily := week["daily"].([]any)
	if week["object"] != "period_summary" || num(week["days"]) != 7 || len(daily) != 7 || daily[6].(map[string]any)["date"] != today {
		t.Fatalf("seven days ending today: %v", week)
	}
	var sum int64
	for _, d := range daily {
		sum += num(d.(map[string]any)["gross"])
	}
	if sum != num(week["gross"]) || num(daily[4].(map[string]any)["gross"]) != 9000 {
		t.Fatalf("the days add up to the period: %d vs %v; two days ago %v", sum, week["gross"], daily[4])
	}
	prev := week["previous"].(map[string]any)
	if num(prev["gross"]) != 3000 || num(prev["daily"].([]any)[4]) != 3000 || len(prev["daily"].([]any)) != 7 {
		t.Fatalf("the week before, day by day: %v", prev)
	}
	if want := float64(num(week["gross"])-3000) * 100 / 3000; prev["change_pct"].(float64) < want-0.1 || prev["change_pct"].(float64) > want+0.1 {
		t.Fatalf("change %v, want %.1f", prev["change_pct"], want)
	}
	_, month := st.call("GET", "/v1/merchants/"+merchant+"/summary/period", nil, 200)
	if num(month["days"]) != 30 || month["to"] != today {
		t.Fatalf("the default period: the last 30 days: %v %v", month["days"], month["to"])
	}
	st.call("GET", "/v1/merchants/"+merchant+"/summary/period?from="+today+"&to="+time.Now().In(brtLoc()).AddDate(0, 0, -1).Format("2006-01-02"), nil, 422)
	st.call("GET", "/v1/merchants/"+merchant+"/summary/period?from=2026-01-01&to=2026-06-30", nil, 422) // more than 92 days
	st.call("GET", "/v1/merchants/"+merchant+"/summary/period?to="+time.Now().In(brtLoc()).AddDate(0, 0, 2).Format("2006-01-02"), nil, 422)
	st.call("GET", "/v1/merchants/mer_01M69K0V3GC8TSECSX0HV48PR3/summary/period", nil, 404)

	// ---- the sandbox pays a Pix charge, as a bank app would ----
	_, cob := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 2500, "channel": "pix"}, 201)
	st.call("POST", "/v1/sandbox/pix/payments/"+cob["id"].(string), nil, 409) // not confirmed yet: no QR to pay
	st.call("POST", "/v1/payment-intents/"+cob["id"].(string)+"/confirm", map[string]any{"payment_method_type": "pix"}, 200)
	if _, paid := st.call("POST", "/v1/sandbox/pix/payments/"+cob["id"].(string), nil, 200); paid["status"] != "captured" || num(paid["amount_captured"]) != 2500 {
		t.Fatalf("a simulated Pix payment: %v", paid)
	}
	st.call("POST", "/v1/sandbox/pix/payments/"+cob["id"].(string), nil, 409) // paid already

	// ---- the rest of the contract the suite had not called ----
	_, conv := st.call("POST", "/v1/conversions", map[string]any{"merchant_id": merchant, "side": "buy", "asset": "BTC", "brl_amount": 100_00}, 201)
	if _, got := st.call("GET", "/v1/conversions/"+conv["id"].(string), nil, 200); got["id"] != conv["id"] {
		t.Fatalf("a conversion read back: %v", got)
	}
	st.call("GET", "/v1/investments/profile?merchant_id="+merchant, nil, 404) // no suitability answers yet
	st.call("GET", "/v1/risk/reviews/rv_01M69K0V3GC8TSECSX0HV48PR3", nil, 404)
}
