package e2e

import (
	"fmt"
	"slices"
	"testing"

	"github.com/monolito123/Gooners/payments/platform/internal/payments"
)

// luhnPAN completes a 15-digit prefix with its check digit.
func luhnPAN(prefix string) string {
	sum := 0
	for i := len(prefix) - 1; i >= 0; i-- {
		d := int(prefix[i] - '0')
		if (len(prefix)-i)%2 == 1 {
			if d *= 2; d > 9 {
				d -= 9
			}
		}
		sum += d
	}
	return prefix + fmt.Sprint((10-sum%10)%10)
}

func strs(v any) []string {
	var out []string
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

// The fraud shield (docs/07 §3) through the API: the policy of §3.6 on real authorizations,
// holds that keep money from moving until a review, frozen terminals, and the review flow.
func TestFraudShield(t *testing.T) {
	st := newStack(t)
	_, m := st.call("POST", "/v1/merchants", map[string]any{
		"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": cnpj("223344550001")}, "legal_name": "Loja Risco", "trade_name": "Loja", "mcc": "5812", "city": "Recife"},
		"plan":  map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": true},
	}, 201)
	merchant, account := m["id"].(string), m["account_id"].(string)
	newTerminal := func() string {
		_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant, "type": "mpoc_cots"}, 201)
		return term["terminal_id"].(string)
	}
	terminal := newTerminal()
	intent := func(amount int) string {
		_, pi := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": amount, "channel": "card_present"}, 201)
		return pi["id"].(string)
	}
	clean := map[string]any{"score": 0.0, "model": "gp-device-1", "signals": []string{}}
	debugger := map[string]any{"score": 0.6, "model": "gp-device-1", "signals": []string{"debugger"}}
	reviews := func(status string) []map[string]any {
		_, l := st.call("GET", "/v1/risk/reviews?status="+status, nil, 200)
		var out []map[string]any
		for _, x := range l["data"].([]any) {
			out = append(out, x.(map[string]any))
		}
		return out
	}
	visa := "A0000000031010"

	// 1. An ordinary sale with a clean phone: approved and advanced at once.
	card := luhnPAN("411111111100001")
	_, r := st.tapWith(tapOpts{pi: intent(5000), terminal: terminal, pan: card, aid: visa, app: "credit", atc: 10, deviceRisk: clean})
	if r["status"] != "approved" || r["settlement"].(map[string]any)["mode"] != "instant" {
		t.Fatalf("clean sale: %v", r)
	}

	// 2. A new merchant's first large sale (server: medium) with a clean phone: approved, but
	// held: no instant release, not in pending, not available to advance, until a review.
	pi := intent(1_500_00)
	_, r = st.tapWith(tapOpts{pi: pi, terminal: terminal, pan: card, aid: visa, app: "credit", atc: 11, deviceRisk: clean})
	settle := r["settlement"].(map[string]any)
	if r["status"] != "approved" || settle["mode"] != "standard" || settle["held"] != true {
		t.Fatalf("held sale: %v", r)
	}
	b := st.balance(account)
	if num(b["held"]) == 0 || num(b["held"]) != num(settle["net_available"]) {
		t.Fatalf("balance while held: %v", b)
	}
	open := reviews("open")
	if len(open) != 1 || open[0]["action"] != "allow_hold" || open[0]["payment_intent_id"] != pi ||
		!slices.Contains(strs(open[0]["server"].(map[string]any)["signals"]), "new_merchant_large_amount") {
		t.Fatalf("open reviews: %v", open)
	}
	if code, _ := st.call("POST", "/v1/risk/reviews/"+open[0]["id"].(string)+"/resolve", map[string]any{"resolution": "release"}, 422); code != 422 {
		t.Fatal("a resolution needs a note")
	}
	_, rv := st.call("POST", "/v1/risk/reviews/"+open[0]["id"].(string)+"/resolve", map[string]any{"resolution": "release", "note": "customer known to the store"}, 200)
	if rv["status"] != "released" || rv["reviewed_by"] == nil {
		t.Fatalf("released: %v", rv)
	}
	if b2 := st.balance(account); num(b2["held"]) != 0 || num(b2["pending"]) != num(b["pending"])+num(b["held"]) {
		t.Fatalf("balance after release: %v (before %v)", b2, b)
	}
	st.call("POST", "/v1/risk/reviews/"+open[0]["id"].(string)+"/resolve", map[string]any{"resolution": "fraud", "note": "again"}, 409)

	// 3. The same, from a phone with a debugger attached (device: medium): the PIN is asked
	// for, and nothing reaches the issuer.
	sentBefore := len(st.sim.Received())
	_, r = st.tapWith(tapOpts{pi: intent(1_200_00), terminal: terminal, pan: card, aid: visa, app: "credit", atc: 12, deviceRisk: debugger})
	if r["status"] != "pin_required" || r["decline_code"] != "authentication_required" {
		t.Fatalf("step-up: %v", r)
	}
	if len(st.sim.Received()) != sentBefore {
		t.Fatal("a step-up without a PIN must not reach the issuer")
	}

	// 4. A cloned card (the counter goes back) from that phone: declined by the platform.
	_, r = st.tapWith(tapOpts{pi: intent(30_00), terminal: terminal, pan: card, aid: visa, app: "credit", atc: 9, deviceRisk: debugger})
	if r["status"] != "declined" || r["decline_code"] != "risk_declined" {
		t.Fatalf("clone: %v", r)
	}

	// 5. A phone reporting hooking and root with a score of zero, replaying a counter: the
	// platform recomputes the score, declines and freezes the terminal.
	tampered := map[string]any{"score": 0.0, "model": "gp-device-1", "signals": []string{"hooking", "root_indicators"}}
	_, r = st.tapWith(tapOpts{pi: intent(30_00), terminal: terminal, pan: card, aid: visa, app: "credit", atc: 12, deviceRisk: tampered})
	if r["status"] != "declined" || r["decline_code"] != "risk_declined" {
		t.Fatalf("tampered: %v", r)
	}
	st.tapWith(tapOpts{pi: intent(30_00), terminal: terminal, pan: luhnPAN("411111111100002"), aid: visa, app: "credit", atc: 1, deviceRisk: clean, want: 409})
	open = reviews("open")
	if len(open) != 1 || open[0]["action"] != "decline_freeze" || !slices.Contains(strs(open[0]["server"].(map[string]any)["signals"]), "device_score_inconsistent") {
		t.Fatalf("freeze review: %v", open)
	}
	st.call("POST", "/v1/risk/reviews/"+open[0]["id"].(string)+"/resolve", map[string]any{"resolution": "release", "note": "test phone, debugger off now"}, 200)
	_, r = st.tapWith(tapOpts{pi: intent(30_00), terminal: terminal, pan: luhnPAN("411111111100002"), aid: visa, app: "credit", atc: 1, deviceRisk: clean})
	if r["status"] != "approved" {
		t.Fatalf("after release the terminal sells again: %v", r)
	}

	// 6. Card testing on a fresh terminal: many cards and BINs in minutes, the issuer
	// declining. Even from a clean phone the next card needs its PIN; with it the sale goes
	// through, held. A confirmed fraud keeps the money held for the chargeback.
	tester := newTerminal()
	for i := range 6 {
		pan := luhnPAN(fmt.Sprintf("4%d1111111120%03d", i, i))
		st.tapWith(tapOpts{pi: intent(10_51), terminal: tester, pan: pan, aid: visa, app: "credit", atc: 1, deviceRisk: clean})
	}
	next := luhnPAN("455511111130000")
	_, r = st.tapWith(tapOpts{pi: intent(9_00), terminal: tester, pan: next, aid: visa, app: "credit", atc: 1, deviceRisk: clean})
	if r["status"] != "pin_required" || len(reviews("open")) != 0 {
		t.Fatalf("card testing: %v\n%v", r, reviews("open"))
	}
	pi = intent(9_00)
	_, r = st.tapWith(tapOpts{pi: pi, terminal: tester, pan: next, aid: visa, app: "credit", atc: 2, deviceRisk: clean, pinBlock: "041234FFFFFFFFFF"})
	if r["status"] != "approved" || r["settlement"].(map[string]any)["held"] != true {
		t.Fatalf("card testing with the PIN: %v", r)
	}
	open = reviews("open")
	if len(open) != 1 || open[0]["terminal_id"] != tester || open[0]["action"] != "step_up_hold" {
		t.Fatalf("card testing review: %v", open)
	}
	sigs := strs(open[0]["server"].(map[string]any)["signals"])
	for _, want := range []string{"terminal_card_testing", "terminal_bin_spread", "terminal_decline_streak"} {
		if !slices.Contains(sigs, want) {
			t.Errorf("card testing signals %v lack %s", sigs, want)
		}
	}
	_, rv = st.call("POST", "/v1/risk/reviews/"+open[0]["id"].(string)+"/resolve", map[string]any{"resolution": "fraud", "note": "card testing"}, 200)
	if rv["status"] != "fraud" || len(reviews("fraud")) != 1 {
		t.Fatalf("fraud: %v", rv)
	}

	// The API refuses a score outside [0, 1], and drops signal codes it does not know.
	st.tapWith(tapOpts{pi: intent(10_00), terminal: terminal, pan: card, aid: visa, app: "credit", atc: 40, deviceRisk: map[string]any{"score": 1.5}, want: 422})
	pi = intent(10_00)
	st.tapWith(tapOpts{pi: pi, terminal: terminal, pan: card, aid: visa, app: "credit", atc: 41, want: 200,
		deviceRisk: map[string]any{"score": 0.0, "model": "gp-device-1", "signals": []string{"<script>", "screen_captured"}}})
	var stored []string
	if err := st.pool.QueryRow(t.Context(), `SELECT device_signals FROM risk_assessments WHERE payment_intent_id = $1`, pi).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(stored, []string{"screen_captured"}) {
		t.Errorf("stored signals %v", stored)
	}
}

// In shadow mode every decision is recorded and nothing is enforced.
func TestFraudShieldShadow(t *testing.T) {
	st := newStack(t, func(c *payments.Config) { c.RiskMode = payments.RiskShadow })
	_, m := st.call("POST", "/v1/merchants", map[string]any{
		"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": cnpj("223344560001")}, "legal_name": "Loja Sombra", "trade_name": "Loja", "mcc": "5812", "city": "Recife"},
		"plan":  map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": true},
	}, 201)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": m["id"], "type": "mpoc_cots"}, 201)
	_, pi := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": m["id"], "amount": 30_00, "channel": "card_present"}, 201)
	_, r := st.tapWith(tapOpts{pi: pi["id"].(string), terminal: term["terminal_id"].(string), pan: "4111111111111111", aid: "A0000000031010", app: "credit", atc: 5,
		deviceRisk: map[string]any{"score": 0.88, "model": "gp-device-1", "signals": []string{"hooking", "root_indicators"}}})
	if r["status"] != "approved" || r["settlement"].(map[string]any)["mode"] != "instant" {
		t.Fatalf("shadow: %v", r)
	}
	var action string
	var enforced bool
	if err := st.pool.QueryRow(t.Context(), `SELECT action, enforced FROM risk_assessments`).Scan(&action, &enforced); err != nil {
		t.Fatal(err)
	}
	if action != "step_up_hold" || enforced {
		t.Errorf("recorded %s enforced=%v", action, enforced)
	}
}
