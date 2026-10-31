package e2e

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/api"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/transparency"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// A day of sales becomes a signed statement and a public root, and every receipt proves its
// way to the root with nothing but the API's answers (docs/03 §6.5).
func TestStatementsAndTransparencyLog(t *testing.T) {
	st := newStack(t)
	ctx := context.Background()
	merchant, account := st.merchant(st.key)
	code, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant, "type": "mpoc_cots"}, 201)
	terminal, _ := term["terminal_id"].(string)
	if terminal == "" {
		t.Fatalf("terminal: %d %v", code, term)
	}

	// The day: two card sales, a Pix payment, and a refund of part of the Pix.
	var intents []string
	intents = append(intents, st.sale(merchant, terminal, 12990), st.sale(merchant, terminal, 4500))
	_, pix := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 2390, "payment_method_types": []string{"pix"}}, 201)
	_, conf := st.call("POST", "/v1/payment-intents/"+pix["id"].(string)+"/confirm", map[string]any{"payment_method_type": "pix"}, 200)
	st.pspControl("/sim/pagar/" + conf["next_action"].(map[string]any)["txid"].(string))
	intents = append(intents, pix["id"].(string))
	_, pixDone := st.call("GET", "/v1/payment-intents/"+pix["id"].(string), nil, 200)
	_, ref := st.call("POST", "/v1/refunds", map[string]any{"payment_intent_id": pix["id"].(string), "amount": 1000}, 201)
	e2e := pixDone["latest_attempt"].(map[string]any)["end_to_end_id"].(string)
	st.pspControl("/sim/devolucao/" + e2e + "/" + strings.ToLower(ref["id"].(string)[3:]) + "/liquidar")

	var receiptIDs []string
	for _, id := range intents {
		_, pi := st.call("GET", "/v1/payment-intents/"+id, nil, 200)
		receiptIDs = append(receiptIDs, pi["receipt"].(map[string]any)["nostr_event_id"].(string))
	}

	// Close the day (the serve process does it after 01:00 in Brasília).
	root, err := st.svc.CloseDay(ctx, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if again, err := st.svc.CloseDay(ctx, time.Now()); err != nil || again.Event.ID != root.Event.ID {
		t.Fatalf("closing a day twice: %v %v", err, again)
	}

	// The public root, without credentials.
	resp, err := http.Get(st.api + "/v1/transparency/" + root.Date)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("public root: %v %v", err, resp)
	}
	var pub payments.TransparencyRoot
	_ = json.NewDecoder(resp.Body).Decode(&pub)
	resp.Body.Close()
	if err := pub.Event.Verify(); err != nil || pub.Event.PubKey != st.transparencyKey.PubHex || pub.Event.Kind != transparency.KindRoot {
		t.Fatalf("root event: %v %+v", err, pub.Event)
	}
	if pub.TreeSize%8 != 0 || !strings.Contains(pub.Event.Content, `"root":"`+pub.Root+`"`) {
		t.Fatalf("root content %s, tree %d", pub.Event.Content, pub.TreeSize)
	}

	// The merchant's statement: totals, lines in capture order, signature.
	_, list := st.call("GET", "/v1/settlements?merchant_id="+merchant, nil, 200)
	data := list["data"].([]any)
	if len(data) != 1 {
		t.Fatalf("settlements: %v", list)
	}
	set := data[0].(map[string]any)
	sid := set["id"].(string)
	if num(set["gross"]) != 12990+4500+2390 || num(set["refunds"]) != 1000 || num(set["transaction_count"]) != 3 ||
		num(set["net"]) != num(set["gross"])-num(set["fees"])-1000 || num(set["fees"]) <= 0 {
		t.Fatalf("settlement totals: %v", set)
	}
	_, raw := st.call("GET", "/v1/settlements/"+sid+"/statement", nil, 200)
	b, _ := json.Marshal(raw)
	var stmt nostr.Event
	_ = json.Unmarshal(b, &stmt)
	if err := stmt.Verify(); err != nil || stmt.PubKey != st.receiptsKey.PubHex || stmt.Kind != transparency.KindStatement || stmt.Tag("e")[1] != pub.Event.ID {
		t.Fatalf("statement event: %v %+v", err, stmt)
	}
	var content struct {
		Lines        []transparency.Line `json:"lines"`
		Totals       transparency.Totals `json:"totals"`
		ReceiptsRoot string              `json:"receipts_root"`
		Commitment   string              `json:"statement_commitment"`
		Transparency struct {
			Salt string `json:"leaf_salt"`
		} `json:"transparency"`
	}
	_ = json.Unmarshal([]byte(stmt.Content), &content)
	for i, l := range content.Lines {
		if l.ReceiptEventID != receiptIDs[i] {
			t.Fatalf("line %d is receipt %s, want %s", i, l.ReceiptEventID, receiptIDs[i])
		}
	}
	if content.Lines[2].Settles != "instant" || content.Lines[2].Fee != 0 {
		t.Fatalf("pix line: %+v", content.Lines[2])
	}
	// The commitment is recomputed from the body the merchant received.
	body, _ := (transparency.Statement{MerchantID: merchant, Date: root.Date, Currency: "BRL", Lines: content.Lines, Refunds: content.Totals.Refunds, Chargebacks: content.Totals.Chargebacks}).Body()
	if c, _ := transparency.Commitment(body); c != content.Commitment {
		t.Fatalf("commitment %s, statement says %s", c, content.Commitment)
	}

	// Every receipt: in the statement, and the statement in the public log.
	leaf, _ := transparency.LeafData(content.Transparency.Salt, content.Commitment)
	logRoot, _ := hex.DecodeString(pub.Root)
	for _, rid := range receiptIDs {
		_, p := st.call("GET", "/v1/settlements/"+sid+"/proofs/"+rid, nil, 200)
		si, ti := p["statement_inclusion"].(map[string]any), p["transparency_inclusion"].(map[string]any)
		if si["root"] != content.ReceiptsRoot || ti["root"] != pub.Root {
			t.Fatalf("proof roots: %v", p)
		}
		rb, _ := hex.DecodeString(rid)
		sroot, _ := hex.DecodeString(content.ReceiptsRoot)
		if !transparency.VerifyInclusion(rb, int(num(si["leaf_index"])), int(num(si["tree_size"])), path(t, si), sroot) {
			t.Fatalf("receipt %s is not proven in the statement", rid)
		}
		if !transparency.VerifyInclusion(leaf, int(num(ti["leaf_index"])), int(num(ti["tree_size"])), path(t, ti), logRoot) {
			t.Fatal("the statement is not proven in the public log")
		}
	}
	if c, _ := st.call("GET", "/v1/settlements/"+sid+"/proofs/"+strings.Repeat("ab", 32), nil, 0); c != http.StatusNotFound {
		t.Fatalf("a receipt that is not in the statement: %d", c)
	}

	// The next day chains to this one, even with no sales.
	next, err := st.svc.CloseDay(ctx, time.Now().AddDate(0, 0, 1))
	if err != nil || next.Previous != root.Event.ID || next.Event.Tag("e")[1] != root.Event.ID {
		t.Fatalf("next day's root: %v %+v", err, next)
	}

	// Days close in order: closing today again after tomorrow is a no-op, and a day before
	// the last root is refused rather than forking the chain.
	if _, err := st.svc.CloseDay(ctx, time.Now().AddDate(0, 0, -3)); !errors.Is(err, payments.ErrConflict) {
		t.Fatalf("closing a day before the last root: %v", err)
	}

	// Another tenant sees nothing.
	if err := st.svc.BootstrapTenant(ctx, tenantB, 0); err != nil {
		t.Fatal(err)
	}
	keyB, _ := api.NewAPIKey(ctx, st.pool, tenantB, "tenant-b", []string{"*"}, false)
	if c, _ := st.callAs(keyB, "GET", "/v1/settlements/"+sid, nil, 0); c != http.StatusNotFound {
		t.Fatalf("another tenant read the settlement: %d", c)
	}
	_ = account
}

func path(t *testing.T, m map[string]any) [][]byte {
	t.Helper()
	var hexes []string
	for _, x := range m["audit_path"].([]any) {
		hexes = append(hexes, x.(string))
	}
	p, err := transparency.ParsePath(hexes)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// The nightly job closes each missed day once, in order, and never the current day.
func TestCloseDueDaysCatchesUpInOrder(t *testing.T) {
	st := newStack(t)
	ctx := context.Background()
	merchant, _ := st.merchant(st.key)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant, "type": "mpoc_cots"}, 201)
	st.sale(merchant, term["terminal_id"].(string), 1990)

	now := time.Now().In(payments.BRT)
	today := now.Format("2006-01-02")
	if _, err := st.svc.CloseDueDays(ctx, now); err != nil {
		t.Fatal(err)
	}
	if _, err := st.svc.GetTransparencyRoot(ctx, today); err == nil {
		t.Fatal("the job closed a day that is not over")
	}
	tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, payments.StatementHour, 5, 0, 0, payments.BRT)
	if n, err := st.svc.CloseDueDays(ctx, tomorrow); err != nil || n != 1 {
		t.Fatalf("closing today the next morning: %d %v", n, err)
	}
	if n, _ := st.svc.CloseDueDays(ctx, tomorrow); n != 0 {
		t.Fatalf("a closed day was closed again: %d", n)
	}
	r, err := st.svc.GetTransparencyRoot(ctx, today)
	if err != nil {
		t.Fatal(err)
	}
	prev, err := st.svc.GetTransparencyRoot(ctx, now.AddDate(0, 0, -1).Format("2006-01-02"))
	if err != nil || r.Previous != prev.Event.ID {
		t.Fatalf("today's root does not chain to yesterday's: %v", err)
	}
	if _, list := st.call("GET", "/v1/settlements?merchant_id="+merchant, nil, 200); len(list["data"].([]any)) != 1 {
		t.Fatalf("settlements: %v", list)
	}
}
