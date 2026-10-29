package receipts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// fakeRelay accepts EVENT frames, verifies signatures and answers OK (NIP-01).
type fakeRelay struct {
	mu     sync.Mutex
	stored map[string]*nostr.Event
}

func (f *fakeRelay) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close(websocket.StatusNormalClosure, "")
	for {
		_, data, err := c.Read(r.Context())
		if err != nil {
			return
		}
		var frame []json.RawMessage
		if json.Unmarshal(data, &frame) != nil || len(frame) != 2 {
			continue
		}
		var ev nostr.Event
		_ = json.Unmarshal(frame[1], &ev)
		ok, msg := true, ""
		if err := ev.Verify(); err != nil {
			ok, msg = false, "invalid: "+err.Error()
		} else {
			f.mu.Lock()
			f.stored[ev.ID] = &ev
			f.mu.Unlock()
		}
		resp, _ := json.Marshal([]any{"OK", ev.ID, ok, msg})
		_ = c.Write(r.Context(), websocket.MessageText, resp)
	}
}

func receipt(root string) Receipt {
	return Receipt{
		PaymentIntentID: "pi_01JBK3Z9Y8X7W6V5T4S3R2Q1P0", MerchantID: "mer_01JB8Z2K5D6F7G8H9J0K1M2N3P", MerchantName: "Café Aurora",
		MerchantCNPJ: "12.345.678/0001-95", MerchantRootPub: root, Amount: 12990, Currency: "BRL",
		Method:         map[string]any{"type": "card", "brand": "visa", "funding": "credit", "last4": "0119", "entry_mode": "contactless", "cvm": "no_cvm"},
		Authorization:  map[string]any{"code": "B7K2Q9", "rrn": "630217004211", "approved_at": "2026-10-29T17:42:10Z"},
		SettlementDate: "2026-10-29",
	}
}

func TestIssueClaimAndMerchantCopies(t *testing.T) {
	signer, _ := nostr.GenerateKeys()
	root, _ := nostr.GenerateKeys()
	is := &Issuer{Author: signer, ClaimBase: "https://r.ipplus.example/c"}
	out, err := is.Issue(receipt(root.PubHex))
	if err != nil {
		t.Fatal(err)
	}
	if err := out.Receipt.Verify(); err != nil || out.Receipt.Kind != KindReceipt {
		t.Fatal(err)
	}
	if strings.Contains(out.Receipt.Content, "4111") {
		t.Fatal("receipt content looks like it carries card data")
	}
	secret := out.ClaimURL[strings.Index(out.ClaimURL, "#k=")+3:]
	claim, err := nostr.KeysFromHex(secret)
	if err != nil {
		t.Fatal(err)
	}
	got, _, err := nostr.Unwrap(out.ClaimWrap, claim)
	if err != nil || got.ID != out.Receipt.ID {
		t.Fatalf("claim unwrap: %v", err)
	}
	if out.ClaimWrap.Tag("expiration") == nil {
		t.Fatal("claim wrap needs a NIP-40 expiration")
	}
	if _, _, err := nostr.Unwrap(out.MerchantWrap, root); err != nil {
		t.Fatalf("merchant unwrap: %v", err)
	}
}

func TestRefusesCardData(t *testing.T) {
	r := receipt("")
	r.Method["pan"] = "4111111111111111"
	if _, err := Build(r); err == nil {
		t.Fatal("PAN accepted on a receipt")
	}
}

func TestPublishNeedsTwoRelays(t *testing.T) {
	a, b := &fakeRelay{stored: map[string]*nostr.Event{}}, &fakeRelay{stored: map[string]*nostr.Event{}}
	sa, sb := httptest.NewServer(a), httptest.NewServer(b)
	defer sa.Close()
	defer sb.Close()
	ws := func(u string) string { return "ws" + strings.TrimPrefix(u, "http") }
	signer, _ := nostr.GenerateKeys()
	out, _ := (&Issuer{Author: signer, ClaimBase: "https://r/c"}).Issue(receipt(""))

	p := &Publisher{Relays: []string{ws(sa.URL), ws(sb.URL)}, Timeout: 2 * time.Second}
	n, err := p.Publish(context.Background(), out.ClaimWrap)
	if err != nil || n != 2 || a.stored[out.ClaimWrap.ID] == nil || b.stored[out.ClaimWrap.ID] == nil {
		t.Fatalf("publish: %d %v", n, err)
	}
	p.Relays = []string{ws(sa.URL), "ws://127.0.0.1:1"}
	if _, err := p.Publish(context.Background(), out.ClaimWrap); err == nil {
		t.Fatal("one relay down must fail the two-relay requirement")
	}
	bad := *out.ClaimWrap
	bad.Content += "x"
	p.Relays = []string{ws(sa.URL)}
	p.MinAcks = 1
	if _, err := p.Publish(context.Background(), &bad); err == nil {
		t.Fatal("a relay rejection must surface")
	}
}
