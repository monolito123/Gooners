package e2e

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
)

// Pre-dispute alerts: an issuer's notice through Ethoca or Verifi that a cardholder disputes a
// sale is answered by refunding it before it becomes a chargeback.
func TestDisputeAlerts(t *testing.T) {
	st := newStack(t)
	ctx := context.Background()
	merchant, _ := st.merchant(st.key)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant, "type": "mpoc_cots"}, 201)
	terminal := term["terminal_id"].(string)
	post := func(body map[string]any, secret string) (int, map[string]any) {
		t.Helper()
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", st.api+"/v1/dispute-alerts/inbound", bytes.NewReader(b))
		id, ts := "msg_"+ids.ULID(), time.Now().Unix()
		sig, _ := webhooks.Sign(secret, id, ts, b)
		req.Header.Set("webhook-id", id)
		req.Header.Set("webhook-timestamp", strconv.FormatInt(ts, 10))
		req.Header.Set("webhook-signature", sig)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)
		var out map[string]any
		_ = json.Unmarshal(raw, &out)
		return resp.StatusCode, out
	}
	alert := func(rrn, code string, amount int64) map[string]any {
		return map[string]any{"alert_id": "ETH-" + ids.ULID(), "provider": "ethoca", "type": "fraud", "amount": amount, "currency": "BRL",
			"rrn": rrn, "auth_code": code, "reason_code": "4837"}
	}

	// A merchant with a day's takings: refunds come out of its available balance.
	st.sale(merchant, terminal, 90000)
	pi := st.sale(merchant, terminal, 7990)
	rrn, code := st.authOf(pi)
	a := alert(rrn, code, 7990)
	c, out := post(a, st.alertsSecret)
	if c != 200 || out["outcome"] != payments.AlertRefunded || out["refund_id"] == nil || out["payment_intent_id"] != pi {
		t.Fatalf("an alert on a sale: %d %v", c, out)
	}
	_, intent := st.call("GET", "/v1/payment-intents/"+pi, nil, 200)
	if intent["status"] != "refunded" || intent["amount_refunded"].(float64) != 7990 {
		t.Fatalf("the sale after the alert: %v", intent)
	}
	// Delivered again: the same answer, no second refund.
	if c, again := post(a, st.alertsSecret); c != 200 || again["id"] != out["id"] || again["refund_id"] != out["refund_id"] {
		t.Fatalf("a repeated alert: %d %v", c, again)
	}
	// Another alert for the same sale: nothing is left to refund.
	if _, out := post(alert(rrn, code, 7990), st.alertsSecret); out["outcome"] != payments.AlertAlreadyRefunded {
		t.Fatalf("an alert on a refunded sale: %v", out)
	}
	// An alert for less than the sale refunds that much.
	pi2 := st.sale(merchant, terminal, 12000)
	rrn2, code2 := st.authOf(pi2)
	if _, out := post(alert(rrn2, code2, 5000), st.alertsSecret); out["outcome"] != payments.AlertRefunded {
		t.Fatalf("a partial alert: %v", out)
	}
	if _, intent := st.call("GET", "/v1/payment-intents/"+pi2, nil, 200); intent["amount_refunded"].(float64) != 5000 {
		t.Fatalf("a partial alert refunded %v", intent["amount_refunded"])
	}
	// A chargeback came first: the alert is too late.
	pi3 := st.sale(merchant, terminal, 3300)
	rrn3, code3 := st.authOf(pi3)
	if _, err := st.svc.ApplyDisputeNotice(ctx, tenant, payments.DisputeNotice{Event: payments.NoticeOpened, Scheme: "visa", NetworkCaseID: "CB-" + ids.ULID(),
		ReasonCode: "10.4", Category: "fraud", Amount: 3300, RRN: rrn3, AuthCode: code3, EvidenceDueAt: time.Now().Add(240 * time.Hour), Source: "test"}); err != nil {
		t.Fatal(err)
	}
	if _, out := post(alert(rrn3, code3, 3300), st.alertsSecret); out["outcome"] != payments.AlertInDispute {
		t.Fatalf("an alert after the chargeback: %v", out)
	}
	// A merchant whose balance cannot cover the refund: the alert says so, and the chargeback
	// will follow its course.
	poor, _ := st.merchant(st.key)
	_, pterm := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": poor, "type": "mpoc_cots"}, 201)
	pi4 := st.sale(poor, pterm["terminal_id"].(string), 5000)
	rrn4, code4 := st.authOf(pi4)
	if _, out := post(alert(rrn4, code4, 5000), st.alertsSecret); out["outcome"] != payments.AlertRefundFailed {
		t.Fatalf("a refund the balance cannot cover: %v", out)
	}
	// No such sale; a forged delivery; a malformed alert.
	if _, out := post(alert("999999999999", "ZZZZZZ", 100), st.alertsSecret); out["outcome"] != payments.AlertNotFound {
		t.Fatalf("an unknown sale: %v", out)
	}
	if c, _ := post(alert(rrn2, code2, 100), webhooks.NewSecret()); c != http.StatusUnauthorized {
		t.Fatalf("a forged alert: %d", c)
	}
	bad := alert(rrn2, code2, 100)
	bad["provider"] = "someone"
	if c, _ := post(bad, st.alertsSecret); c != http.StatusUnprocessableEntity {
		t.Fatalf("an unknown provider: %d", c)
	}

	// The tenant sees its alerts, and was told of each.
	_, list := st.call("GET", "/v1/dispute-alerts", nil, 200)
	if n := len(list["data"].([]any)); n != 5 {
		t.Fatalf("the tenant's alerts: %d", n)
	}
	var notified int
	_ = st.pool.QueryRow(ctx, `SELECT count(*) FROM webhook_deliveries WHERE type = 'dispute.alert'`).Scan(&notified)
	if notified != 5 {
		t.Fatalf("dispute.alert events %d", notified)
	}
}
