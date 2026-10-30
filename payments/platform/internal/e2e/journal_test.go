package e2e

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/carddata"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// enrolledPhone enrolls one phone as the merchant's first device and logs it in.
func enrolledPhone(t *testing.T, st *stack) (*phone, nostr.Keys) {
	t.Helper()
	merchant, _ := st.merchant(st.key)
	_, ec := st.call("POST", "/v1/merchants/"+merchant+"/enrollment-codes", nil, 201)
	p := newPhone(st)
	root, _ := nostr.GenerateKeys()
	npub, _ := nostr.EncodeNpub(p.device.PubHex)
	reg, _ := json.Marshal(map[string]any{"device_npub": npub, "platform": "android", "authorization_event": deviceList(t, root, merchant, time.Now(), p)})
	if c, out := p.raw("POST", "/v1/enrollment", "Enrollment "+ec["code"].(string), reg, ""); c != 201 {
		t.Fatalf("enrollment: %d %v", c, out)
	}
	if c, out := p.login(t); c != 200 {
		t.Fatalf("login: %d %v", c, out)
	}
	return p, root
}

// journal builds the device's next kind 7714 entry.
func journalEntry(t *testing.T, signer nostr.Keys, rootPub string, seq int64, prev *string, typ string, extra map[string]any) nostr.Event {
	t.Helper()
	c := map[string]any{"v": 1, "seq": seq, "prev": prev, "type": typ, "local_time": time.Now().Format(time.RFC3339), "app": map[string]any{"version": "0.1.0"}}
	for k, v := range extra {
		c[k] = v
	}
	content, err := nostr.CanonicalJSON(c)
	if err != nil {
		t.Fatal(err)
	}
	ev := nostr.Event{CreatedAt: time.Now().Unix(), Kind: 7714, Tags: [][]string{{"merchant", rootPub}}, Content: content}
	if err := ev.Sign(signer, nil); err != nil {
		t.Fatal(err)
	}
	return ev
}

func TestTerminalJournal(t *testing.T) {
	st := newStack(t)
	p, root := enrolledPhone(t, st)
	upload := func(entries ...nostr.Event) (int, map[string]any) {
		return p.do("POST", "/v1/terminal/journal", map[string]any{"entries": entries})
	}
	idOf := func(e nostr.Event) *string { id := e.ID; return &id }

	// A session and a sale: session_start, tap_started (linked from the receipt), auth_result.
	e1 := journalEntry(t, p.device, root.PubHex, 1, nil, "session_start", nil)
	_, pi := p.do("POST", "/v1/payment-intents", map[string]any{"amount": 4590, "channel": "card_present"})
	amount := map[string]any{"value": 4590, "currency": "BRL", "exponent": 2}
	e2 := journalEntry(t, p.device, root.PubHex, 2, idOf(e1), "tap_started", map[string]any{"payment_intent_id": pi["id"], "amount": amount, "terminal_id": p.terminal})
	if c, out := upload(e1, e2); c != 200 || out["status"] != "consistent" || num(out["accepted"]) != 2 || num(out["head"].(map[string]any)["seq"]) != 2 {
		t.Fatalf("first upload: %d %v", c, out)
	}
	ksn := "FFFF9876543210E00901"
	blob, _ := carddata.DevEncrypt(st.devKey, ksn, carddata.Card{PAN: "4111111111111111", Expiry: "2911", AID: visaAID, EMVHex: "9F2608A1B2C3D4E5F607089F2701809F3704C0FFEE11"})
	if c, r := p.do("POST", "/v1/terminal/authorizations", map[string]any{"payment_intent_id": pi["id"], "terminal_id": p.terminal, "stan": "000201",
		"emv_application": "credit", "local_time": time.Now().Format(time.RFC3339), "journal_event_id": e2.ID,
		"sred": map[string]any{"format": carddata.DevFormat, "ksn": ksn, "ciphertext": base64.StdEncoding.EncodeToString(blob)}}); c != 200 || r["status"] != "approved" {
		t.Fatalf("tap: %d %v", c, r)
	}
	e3 := journalEntry(t, p.device, root.PubHex, 3, idOf(e2), "auth_result", map[string]any{"payment_intent_id": pi["id"], "amount": amount, "result": "approved", "stan": "000201"})
	if c, out := upload(e2, e3); c != 200 || num(out["accepted"]) != 1 || num(out["duplicates"]) != 1 {
		t.Fatalf("re-sent entry: %d %v", c, out)
	}

	// Offline: entry 5 arrives before 4. The platform asks for the gap.
	e4 := journalEntry(t, p.device, root.PubHex, 4, idOf(e3), "receipt_shown", map[string]any{"payment_intent_id": pi["id"]})
	e5 := journalEntry(t, p.device, root.PubHex, 5, idOf(e4), "cash_sale", map[string]any{"amount": map[string]any{"value": 1000, "currency": "BRL", "exponent": 2}})
	c, out := upload(e5)
	if c != 200 || out["status"] != "platform_behind" {
		t.Fatalf("gap: %d %v", c, out)
	}
	if m := out["missing"].([]any); len(m) != 1 || num(m[0].([]any)[0]) != 4 || num(m[0].([]any)[1]) != 4 {
		t.Fatalf("missing ranges: %v", out["missing"])
	}
	if c, out := upload(e4); c != 200 || out["status"] != "consistent" {
		t.Fatalf("gap filled: %d %v", c, out)
	}
	if c, out := p.do("GET", "/v1/terminal/journal", nil); c != 200 || out["status"] != "consistent" || num(out["head"].(map[string]any)["seq"]) != 5 {
		t.Fatalf("journal state: %d %v", c, out)
	}

	// The partner reads the device's own signed view of the sale (dispute evidence).
	_, ev := st.call("GET", "/v1/payment-intents/"+pi["id"].(string)+"/journal", nil, 200)
	if got := ev["data"].([]any); len(got) != 3 {
		t.Fatalf("journal entries about the payment: %d", len(got))
	}
	if c, _ := st.call("GET", "/v1/payment-intents/pi_01JBK3Z9Y8X7W6V5T4S3R2Q1P0/journal", nil, 0); c != http.StatusNotFound {
		t.Errorf("the journal of an unknown payment: HTTP %d", c)
	}

	// What is refused.
	stranger, _ := nostr.GenerateKeys()
	for name, bad := range map[string]nostr.Event{
		"another key":         journalEntry(t, stranger, root.PubHex, 6, idOf(e5), "session_end", nil),
		"another merchant":    journalEntry(t, p.device, stranger.PubHex, 6, idOf(e5), "session_end", nil),
		"no prev after seq 1": journalEntry(t, p.device, root.PubHex, 6, nil, "session_end", nil),
		"unknown type":        journalEntry(t, p.device, root.PubHex, 6, idOf(e5), "teleport", nil),
	} {
		if c, _ := upload(bad); c != http.StatusUnprocessableEntity {
			t.Errorf("%s: HTTP %d", name, c)
		}
	}
	tampered := e5
	tampered.Content = tampered.Content[:len(tampered.Content)-1] + " }"
	if c, _ := upload(tampered); c != http.StatusUnprocessableEntity {
		t.Errorf("tampered content: HTTP %d", c)
	}
	if c, _ := st.call("POST", "/v1/terminal/journal", map[string]any{"entries": []nostr.Event{e1}}, 0); c != http.StatusForbidden {
		t.Errorf("a partner key posting a journal: HTTP %d", c)
	}

	// A fork: another signed entry 3. The terminal is frozen.
	fork := journalEntry(t, p.device, root.PubHex, 3, idOf(e2), "auth_result", map[string]any{"payment_intent_id": pi["id"], "amount": amount, "result": "declined", "stan": "000201"})
	if c, out := upload(fork); c != 200 || out["status"] != "fork_detected" || num(out["forks"]) != 1 {
		t.Fatalf("fork: %d %v", c, out)
	}
	var status string
	_ = st.pool.QueryRow(t.Context(), `SELECT status FROM terminals WHERE id = $1`, p.terminal).Scan(&status)
	if status != "revoked" {
		t.Fatalf("a forked device's terminal is %s", status)
	}
}
