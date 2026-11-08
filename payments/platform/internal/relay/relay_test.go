package relay

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/monolito123/Gooners/payments/platform/internal/receipts"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

type client struct {
	t  *testing.T
	ws *websocket.Conn
}

func dial(t *testing.T, url string) (*client, string) {
	t.Helper()
	ws, _, err := websocket.Dial(context.Background(), url, nil)
	if err != nil {
		t.Fatal(err)
	}
	c := &client{t: t, ws: ws}
	f := c.next()
	if f[0] != "AUTH" {
		t.Fatalf("no challenge: %v", f)
	}
	return c, f[1].(string)
}

func (c *client) send(v ...any) {
	b, _ := json.Marshal(v)
	if err := c.ws.Write(context.Background(), websocket.MessageText, b); err != nil {
		c.t.Fatal(err)
	}
}

func (c *client) next() []any {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, b, err := c.ws.Read(ctx)
	if err != nil {
		c.t.Fatal(err)
	}
	var f []any
	json.Unmarshal(b, &f)
	return f
}

// The receipt flow: the platform publishes the claim wrap without authenticating; the
// customer's page can read it only as the claim key, and the relay records the claim.
func TestGiftWrapsAreReadOnlyByTheirRecipient(t *testing.T) {
	r := &Relay{}
	srv := httptest.NewServer(r)
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	signerKey, _ := nostr.KeysFromHex(strings.Repeat("11", 32))
	merchant, _ := nostr.KeysFromHex(strings.Repeat("33", 32))
	issued, err := (&receipts.Issuer{Author: signerKey, ClaimBase: "https://r.goonerspay.com.br/c"}).Issue(receipts.Receipt{PaymentIntentID: "pi_1", MerchantID: "mer_1",
		MerchantName: "Café", MerchantRootPub: merchant.PubHex, Amount: 1290, Currency: "BRL", Method: map[string]any{"type": "card"}, CreatedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (&receipts.Publisher{Relays: []string{url}}).Publish(context.Background(), issued.ClaimWrap, issued.MerchantWrap); err != nil {
		t.Fatalf("publish: %v", err)
	}
	claimHex := strings.SplitN(issued.ClaimURL, "#k=", 2)[1]
	claim, _ := nostr.KeysFromHex(claimHex)

	c, challenge := dial(t, url)
	filter := map[string]any{"kinds": []int{1059}, "#p": []string{claim.PubHex}}
	c.send("REQ", "r1", filter)
	if f := c.next(); f[0] != "CLOSED" || !strings.HasPrefix(f[2].(string), "auth-required:") {
		t.Fatalf("read without authentication: %v", f)
	}
	// Another key's AUTH does not open the claim wrap; a wrong challenge is refused.
	bad := &nostr.Event{Kind: 22242, CreatedAt: time.Now().Unix(), Tags: [][]string{{"relay", url}, {"challenge", "nope"}}}
	bad.Sign(claim, nil)
	c.send("AUTH", bad)
	if f := c.next(); f[0] != "OK" || f[2] != false {
		t.Fatalf("wrong challenge accepted: %v", f)
	}
	auth := &nostr.Event{Kind: 22242, CreatedAt: time.Now().Unix(), Tags: [][]string{{"relay", url}, {"challenge", challenge}}}
	auth.Sign(claim, nil)
	c.send("AUTH", auth)
	if f := c.next(); f[0] != "OK" || f[2] != true {
		t.Fatalf("auth: %v", f)
	}
	if !r.Claimed(issued.ClaimWrap.ID).IsZero() {
		t.Fatal("claimed before it was read")
	}
	c.send("REQ", "r2", filter)
	f := c.next()
	if f[0] != "EVENT" {
		t.Fatalf("no wrap: %v", f)
	}
	raw, _ := json.Marshal(f[2])
	var wrap nostr.Event
	json.Unmarshal(raw, &wrap)
	inner, _, err := nostr.Unwrap(&wrap, claim)
	if err != nil || inner.ID != issued.Receipt.ID {
		t.Fatalf("unwrap: %v", err)
	}
	if f := c.next(); f[0] != "EOSE" {
		t.Fatalf("%v", f)
	}
	if r.Claimed(issued.ClaimWrap.ID).IsZero() {
		t.Fatal("the claim was not recorded")
	}
	// The merchant's copy is not the claim key's to read.
	c.send("REQ", "r3", map[string]any{"kinds": []int{1059}, "#p": []string{merchant.PubHex}})
	if f := c.next(); f[0] != "CLOSED" {
		t.Fatalf("the claim key read the merchant's copy: %v", f)
	}
}

// A reader waiting before the receipt is published gets it live; expired events are refused.
func TestLiveDeliveryAndExpiration(t *testing.T) {
	r := &Relay{}
	srv := httptest.NewServer(r)
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	k, _ := nostr.KeysFromHex(strings.Repeat("44", 32))

	reader, _ := dial(t, url)
	reader.send("REQ", "live", map[string]any{"kinds": []int{1}, "authors": []string{k.PubHex}})
	if f := reader.next(); f[0] != "EOSE" {
		t.Fatalf("%v", f)
	}
	writer, _ := dial(t, url)
	note := &nostr.Event{Kind: 1, CreatedAt: time.Now().Unix(), Tags: [][]string{}, Content: "olá"}
	note.Sign(k, nil)
	writer.send("EVENT", note)
	if f := writer.next(); f[0] != "OK" || f[2] != true {
		t.Fatalf("publish: %v", f)
	}
	if f := reader.next(); f[0] != "EVENT" || f[1] != "live" {
		t.Fatalf("not delivered live: %v", f)
	}
	old := &nostr.Event{Kind: 1, CreatedAt: time.Now().Unix(), Tags: [][]string{{"expiration", strconv.FormatInt(time.Now().Add(-time.Minute).Unix(), 10)}}, Content: "x"}
	old.Sign(k, nil)
	writer.send("EVENT", old)
	if f := writer.next(); f[0] != "OK" || f[2] != false {
		t.Fatalf("an expired event stored: %v", f)
	}
	forged := *note
	forged.Content = "changed"
	writer.send("EVENT", &forged)
	if f := writer.next(); f[0] != "OK" || f[2] != false {
		t.Fatalf("a forged event stored: %v", f)
	}
}
