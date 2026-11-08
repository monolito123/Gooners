package e2e

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// A customer's receipt, end to end: the sale publishes the claim wrap to the relay; the claim
// page's flow (here in Go) learns the signer from the NIP-05 file, authenticates to the relay
// as the claim key, opens the wrap and finds the receipt the platform signed; the relay
// records the claim.
func TestReceiptClaim(t *testing.T) {
	st := newStack(t)
	merchant, _ := st.merchant(st.key)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant}, 201)
	piID := st.sale(merchant, term["terminal_id"].(string), 1990)
	_, pi := st.call("GET", "/v1/payment-intents/"+piID, nil, 200)
	rc := pi["receipt"].(map[string]any)
	claimURL, receiptID := rc["claim_url"].(string), rc["nostr_event_id"].(string)

	// The NIP-05 file names the receipts key and its relays, for any origin.
	_, names := st.call("GET", "/.well-known/nostr.json?name=receipts", nil, 200)
	signer := names["names"].(map[string]any)["receipts"]
	if signer != st.receiptsKey.PubHex || names["names"].(map[string]any)["transparency"] != nil {
		t.Fatalf("names: %v", names)
	}
	if rl := names["relays"].(map[string]any)[st.receiptsKey.PubHex].([]any); len(rl) != 1 || rl[0] != st.relayURL {
		t.Fatalf("relays: %v", names["relays"])
	}
	resp, err := (&http.Client{}).Get(st.api + "/.well-known/nostr.json")
	if err != nil || resp.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("NIP-05 must be readable from any origin: %v %v", err, resp.Header)
	}
	resp.Body.Close()
	if resp, err := (&http.Client{}).Get(st.api + "/c"); err != nil || resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") ||
		!strings.Contains(resp.Header.Get("Content-Security-Policy"), st.relayURL[:strings.LastIndex(st.relayURL, ":")]) {
		t.Fatalf("the claim page: %v %v", err, resp)
	}

	// The page's flow.
	claim, err := nostr.KeysFromHex(strings.SplitN(claimURL, "#k=", 2)[1])
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, st.relayURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close(websocket.StatusNormalClosure, "")
	read := func() []json.RawMessage {
		_, b, err := ws.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var f []json.RawMessage
		json.Unmarshal(b, &f)
		return f
	}
	write := func(v ...any) { b, _ := json.Marshal(v); ws.Write(ctx, websocket.MessageText, b) }
	var challenge string
	json.Unmarshal(read()[1], &challenge)
	auth := &nostr.Event{Kind: 22242, CreatedAt: time.Now().Unix(), Tags: [][]string{{"relay", st.relayURL}, {"challenge", challenge}}}
	auth.Sign(claim, nil)
	write("AUTH", auth)
	if f := read(); string(f[0]) != `"OK"` || string(f[2]) != "true" {
		t.Fatalf("auth: %s", f)
	}
	// Publishing follows the sale by a moment: the subscription stays open for it.
	write("REQ", "claim", map[string]any{"kinds": []int{1059}, "#p": []string{claim.PubHex}})
	var wrap nostr.Event
	for wrap.ID == "" {
		f := read()
		if string(f[0]) == `"EVENT"` {
			json.Unmarshal(f[2], &wrap)
		}
	}
	receipt, seal, err := nostr.Unwrap(&wrap, claim)
	if err != nil || receipt.ID != receiptID || seal.PubKey != st.receiptsKey.PubHex || receipt.Kind != 7711 {
		t.Fatalf("unwrap: %v", err)
	}
	var content struct {
		Amount struct{ Value int64 } `json:"amount"`
	}
	json.Unmarshal([]byte(receipt.Content), &content)
	if content.Amount.Value != 1990 {
		t.Fatalf("receipt amount %d", content.Amount.Value)
	}
	if st.relay.Claimed(wrap.ID).IsZero() {
		t.Fatal("the relay did not record the claim")
	}
}
