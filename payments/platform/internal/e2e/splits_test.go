package e2e

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
)

// Split payments (docs/02 §6.4): one capture journal pays every recipient; each recipient's
// share settles under its own plan; refunds and cancellations take the shares back.
func TestSplitPayments(t *testing.T) {
	st := newStack(t)
	ctx := context.Background()
	market, marketAcc := st.merchant(st.key) // the merchant of record: its MID sells
	seller, sellerAcc := st.merchant(st.key)
	courier, courierAcc := st.merchant(st.key)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": market, "type": "mpoc_cots"}, 201)
	terminal := term["terminal_id"].(string)
	receivable := func(merchant, pi string) int64 {
		var n int64
		_ = st.pool.QueryRow(ctx, `SELECT COALESCE(sum(amount), 0) FROM receivables WHERE merchant_id = $1 AND payment_intent_id = $2`, merchant, pi).Scan(&n)
		return n
	}
	available := func(acc string) int64 { return num(st.balance(acc)["available"]) }
	pan := func() string { return luhnPAN(fmt.Sprintf("41%013d", time.Now().UnixNano()%1e13)) }

	// What is refused.
	base := func(splits ...map[string]any) map[string]any {
		var sp []any
		for _, s := range splits {
			sp = append(sp, s)
		}
		return map[string]any{"merchant_id": market, "amount": 10000, "channel": "card_present", "splits": sp}
	}
	for name, tc := range map[string]struct {
		body map[string]any
		want int
		code string
	}{
		"amounts not adding up": {base(map[string]any{"account_id": sellerAcc, "amount": 9000, "bears_fees": true}), 422, "split_mismatch"},
		"two fee bearers": {base(map[string]any{"account_id": sellerAcc, "amount": 5000, "bears_fees": true},
			map[string]any{"account_id": courierAcc, "amount": 5000, "bears_fees": true}), 422, "invalid_request"},
		"no fee bearer":      {base(map[string]any{"account_id": sellerAcc, "amount": 10000}), 422, "invalid_request"},
		"a bearer too small": {base(map[string]any{"account_id": sellerAcc, "amount": 9900}, map[string]any{"account_id": courierAcc, "amount": 100, "bears_fees": true}), 422, "invalid_request"},
		"an account twice":   {base(map[string]any{"account_id": sellerAcc, "amount": 5000, "bears_fees": true}, map[string]any{"account_id": sellerAcc, "amount": 5000}), 422, "invalid_request"},
		"another tenant's":   {base(map[string]any{"account_id": "acc_01JB9SE77ER000000000000001", "amount": 10000, "bears_fees": true}), 422, "invalid_request"},
		"an unknown reversal": {func() map[string]any {
			b := base(map[string]any{"account_id": sellerAcc, "amount": 10000, "bears_fees": true})
			b["split_reversal"] = "lifo"
			return b
		}(), 422, "invalid_request"},
		"crypto": {func() map[string]any {
			b := base(map[string]any{"account_id": sellerAcc, "amount": 10000, "bears_fees": true})
			b["channel"] = "crypto"
			return b
		}(), 422, "invalid_request"},
	} {
		if c, p := st.call("POST", "/v1/payment-intents", tc.body, 0); c != tc.want || p["code"] != tc.code {
			t.Errorf("%s: %d %v", name, c, p)
		}
	}

	// A card sale of R$ 100,00: R$ 80,00 to the seller, who bears the fees, R$ 15,00 to the
	// courier, R$ 5,00 kept by the marketplace.
	before := map[string]int64{market: available(marketAcc), seller: available(sellerAcc), courier: available(courierAcc)}
	_, pi := st.call("POST", "/v1/payment-intents", base(
		map[string]any{"account_id": sellerAcc, "amount": 8000, "bears_fees": true},
		map[string]any{"account_id": courierAcc, "amount": 1500},
		map[string]any{"account_id": marketAcc, "amount": 500}), 201)
	id := pi["id"].(string)
	_, auth2 := st.tapWith(tapOpts{pi: id, terminal: terminal, pan: pan(), aid: visaAID, app: "credit", want: 200})
	settlement := auth2["settlement"].(map[string]any)
	mdr := int64(settlement["merchant_discount"].(float64))
	if auth2["status"] != "approved" || mdr <= 0 || len(settlement["splits"].([]any)) != 2 {
		t.Fatalf("authorization %v", auth2)
	}
	if receivable(seller, id) != 8000-mdr || receivable(courier, id) != 1500 || receivable(market, id) != 500 {
		t.Fatalf("receivables: seller %d (want %d), courier %d, market %d", receivable(seller, id), 8000-mdr, receivable(courier, id), receivable(market, id))
	}
	// Each share settled instantly under its recipient's plan, less its own advance fee.
	var fees = map[string]int64{}
	rows, _ := st.pool.Query(ctx, `SELECT merchant_id, sum(advance_fee) FROM receivables WHERE payment_intent_id = $1 AND status = 'advanced' GROUP BY merchant_id`, id)
	for rows.Next() {
		var m string
		var f int64
		_ = rows.Scan(&m, &f)
		fees[m] = f
	}
	rows.Close()
	if available(sellerAcc)-before[seller] != 8000-mdr-fees[seller] || available(courierAcc)-before[courier] != 1500-fees[courier] ||
		available(marketAcc)-before[market] != 500-fees[market] {
		t.Fatalf("available: seller +%d, courier +%d, market +%d (fees %v)", available(sellerAcc)-before[seller], available(courierAcc)-before[courier],
			available(marketAcc)-before[market], fees)
	}
	// The sale is one capture journal, with the recipients' shares in it.
	var captures int
	_ = st.pool.QueryRow(ctx, `SELECT count(*) FROM journals WHERE reference = $1 AND type = 'card_capture'`, id).Scan(&captures)
	if captures != 1 {
		t.Fatalf("capture journals %d", captures)
	}

	// A refund of R$ 20,00 comes back pro rata: 16,00 + 3,00 + 1,00.
	mid := map[string]int64{market: available(marketAcc), seller: available(sellerAcc), courier: available(courierAcc)}
	st.call("POST", "/v1/refunds", map[string]any{"payment_intent_id": id, "amount": 2000}, 201)
	if mid[seller]-available(sellerAcc) != 1600 || mid[courier]-available(courierAcc) != 300 || mid[market]-available(marketAcc) != 100 {
		t.Fatalf("refund shares: seller %d, courier %d, market %d", mid[seller]-available(sellerAcc), mid[courier]-available(courierAcc), mid[market]-available(marketAcc))
	}

	// Canceling a split sale takes every recipient's instant release back.
	_, pi2 := st.call("POST", "/v1/payment-intents", base(
		map[string]any{"account_id": sellerAcc, "amount": 9000, "bears_fees": true}, map[string]any{"account_id": courierAcc, "amount": 1000}), 201)
	pre := map[string]int64{market: available(marketAcc), seller: available(sellerAcc), courier: available(courierAcc)}
	st.tapWith(tapOpts{pi: pi2["id"].(string), terminal: terminal, pan: pan(), aid: visaAID, app: "credit", want: 200})
	if available(courierAcc) == pre[courier] {
		t.Fatal("the courier's share did not arrive")
	}
	st.call("POST", "/v1/payment-intents/"+pi2["id"].(string)+"/cancel", map[string]any{}, 200)
	if available(sellerAcc) != pre[seller] || available(courierAcc) != pre[courier] || available(marketAcc) != pre[market] {
		t.Fatalf("after the cancellation: seller %d/%d, courier %d/%d, market %d/%d", available(sellerAcc), pre[seller], available(courierAcc), pre[courier],
			available(marketAcc), pre[market])
	}

	// Pix, with refunds charged to the merchant of record alone.
	_, pix := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": market, "amount": 5000, "payment_method_types": []string{"pix"},
		"split_reversal": "primary_only", "splits": []any{map[string]any{"account_id": sellerAcc, "amount": 4000, "bears_fees": true}, map[string]any{"account_id": marketAcc, "amount": 1000}}}, 201)
	prePix := map[string]int64{market: available(marketAcc), seller: available(sellerAcc)}
	_, conf := st.call("POST", "/v1/payment-intents/"+pix["id"].(string)+"/confirm", map[string]any{"payment_method_type": "pix"}, 200)
	st.pspControl("/sim/pagar/" + conf["next_action"].(map[string]any)["txid"].(string))
	var pixFee int64
	_ = st.pool.QueryRow(ctx, `SELECT fee FROM payment_intents WHERE id = $1`, pix["id"]).Scan(&pixFee)
	if available(sellerAcc)-prePix[seller] != 4000-pixFee || available(marketAcc)-prePix[market] != 1000 {
		t.Fatalf("pix shares: seller +%d, market +%d (fee %d)", available(sellerAcc)-prePix[seller], available(marketAcc)-prePix[market], pixFee)
	}
	afterPix := map[string]int64{market: available(marketAcc), seller: available(sellerAcc)}
	st.call("POST", "/v1/refunds", map[string]any{"payment_intent_id": pix["id"], "amount": 1000}, 201)
	if available(sellerAcc) != afterPix[seller] || afterPix[market]-available(marketAcc) != 1000 {
		t.Fatalf("a primary_only refund: seller %d/%d, market %d/%d", available(sellerAcc), afterPix[seller], available(marketAcc), afterPix[market])
	}

	// A restricted recipient takes no new splits.
	if _, err := st.svc.SetMerchantStatus(ctx, tenant, courier, payments.MerchantRestricted, "review", "ops:alice"); err != nil {
		t.Fatal(err)
	}
	if c, p := st.call("POST", "/v1/payment-intents", base(map[string]any{"account_id": sellerAcc, "amount": 9000, "bears_fees": true},
		map[string]any{"account_id": courierAcc, "amount": 1000}), 0); c != 409 || !strings.Contains(p["detail"].(string), courier) {
		t.Fatalf("a restricted recipient: %d %v", c, p)
	}
	if v, err := st.ledger.Verify(ctx, ledger.DefaultVerifyOptions); err != nil || len(v) > 0 {
		t.Fatalf("ledger invariants: %v %v", v, err)
	}
}
