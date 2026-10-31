package e2e

// The merchant app protocol end to end, played by a Go client exactly as the Android and iOS
// apps do it: enrollment code → device list signed by the root key → NIP-98 login → DPoP
// requests. Then the attacks: replays, stolen tokens, other merchants, removed devices.

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/carddata"
	"github.com/monolito123/Gooners/payments/platform/internal/mobileauth"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// phone is a merchant app: its Nostr device key, its hardware DPoP key and its session.
type phone struct {
	st       *stack
	device   nostr.Keys
	dpop     *ecdsa.PrivateKey
	token    string
	merchant string
	account  string
	terminal string
	deviceID string
}

func newPhone(st *stack) *phone {
	dk, _ := nostr.GenerateKeys()
	pk, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	return &phone{st: st, device: dk, dpop: pk}
}

// deviceList signs a kind 17710 with root listing the given phones.
func deviceList(t *testing.T, root nostr.Keys, merchant string, at time.Time, phones ...*phone) nostr.Event {
	t.Helper()
	tags := [][]string{{"v", "1"}, {"merchant", merchant}}
	for i, p := range phones {
		tags = append(tags, []string{"device", p.device.PubHex, "android", fmt.Sprintf("Caixa %d", i+1), strconv.FormatInt(at.Unix(), 10)})
	}
	ev := nostr.Event{CreatedAt: at.Unix(), Kind: mobileauth.KindDeviceAuthorization, Tags: tags, Content: ""}
	if err := ev.Sign(root, nil); err != nil {
		t.Fatal(err)
	}
	return ev
}

func (p *phone) raw(method, path, auth string, body []byte, dpop string) (int, map[string]any) {
	p.st.t.Helper()
	req, _ := http.NewRequest(method, p.st.api+path, bytes.NewReader(body))
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	if dpop != "" {
		req.Header.Set("DPoP", dpop)
	}
	if method == "POST" {
		req.Header.Set("Idempotency-Key", fmt.Sprintf("k%d", time.Now().UnixNano()))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		p.st.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(b, &out)
	return resp.StatusCode, out
}

func (p *phone) proof(method, path string) string {
	p.st.t.Helper()
	pr, err := mobileauth.SignDPoP(p.dpop, method, p.st.api+path, p.token, time.Now())
	if err != nil {
		p.st.t.Fatal(err)
	}
	return pr
}

// do calls the API with the session and a fresh DPoP proof.
func (p *phone) do(method, path string, body any) (int, map[string]any) {
	p.st.t.Helper()
	var b []byte
	if body != nil {
		b, _ = json.Marshal(body)
	}
	pathOnly := path
	if i := bytes.IndexByte([]byte(path), '?'); i >= 0 {
		pathOnly = path[:i]
	}
	return p.raw(method, path, "DPoP "+p.token, b, p.proof(method, pathOnly))
}

func (p *phone) login(t *testing.T) (int, map[string]any) {
	t.Helper()
	return p.loginWith(t, nil)
}

// loginWith logs in, sending attestation evidence with the login when given.
func (p *phone) loginWith(t *testing.T, attestation map[string]any) (int, map[string]any) {
	t.Helper()
	req := map[string]any{"dpop_jwk": mobileauth.PublicJWK(p.dpop)}
	if attestation != nil {
		req["attestation"] = attestation
	}
	body, _ := json.Marshal(req)
	auth, err := mobileauth.SignNIP98(p.device, "POST", p.st.api+"/v1/auth/nostr", body, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	code, out := p.raw("POST", "/v1/auth/nostr", auth, body, "")
	if code == 200 {
		p.token, p.merchant, p.account, p.terminal, p.deviceID = out["session_token"].(string), out["merchant_id"].(string), out["account_id"].(string), str(out["terminal_id"]), out["device_id"].(string)
	}
	return code, out
}

func str(v any) string { s, _ := v.(string); return s }

func TestMerchantAppProtocol(t *testing.T) {
	st := newStack(t)
	// The partner creates the merchant without a root key and an enrollment code for it.
	merchant, _ := st.merchant(st.key)
	_, ec := st.call("POST", "/v1/merchants/"+merchant+"/enrollment-codes", nil, 201)
	code := ec["code"].(string)

	owner := newPhone(st)
	root, _ := nostr.GenerateKeys() // created on the owner's phone, backed up by the owner
	if c, _ := owner.raw("GET", "/v1/enrollment", "Enrollment WRONG-CODE-0000", nil, ""); c != http.StatusUnauthorized {
		t.Fatalf("a wrong enrollment code: HTTP %d", c)
	}
	c, info := owner.raw("GET", "/v1/enrollment", "Enrollment "+code, nil, "")
	if c != 200 || info["merchant_id"] != merchant || info["root_npub"] != nil {
		t.Fatalf("enrollment lookup: %d %v", c, info)
	}
	npub, _ := nostr.EncodeNpub(owner.device.PubHex)
	list := deviceList(t, root, merchant, time.Now(), owner)
	reg, _ := json.Marshal(map[string]any{"device_npub": npub, "platform": "android", "model": "Pixel 9",
		"attestation": map[string]any{"type": "android_key_attestation", "certificate_chain": []string{"MIIB…"}}, "authorization_event": list})
	c, dev := owner.raw("POST", "/v1/enrollment", "Enrollment "+code, reg, "")
	if c != 201 || dev["status"] != "active" || dev["terminal_id"] == nil {
		t.Fatalf("enrollment: %d %v", c, dev)
	}
	if c, _ := owner.raw("POST", "/v1/enrollment", "Enrollment "+code, reg, ""); c != http.StatusUnauthorized {
		t.Fatalf("an enrollment code used twice: HTTP %d", c)
	}
	_, m := st.call("GET", "/v1/merchants/"+merchant, nil, 200)
	rootNpub, _ := nostr.EncodeNpub(root.PubHex)
	if m["root_npub"] != rootNpub {
		t.Fatalf("the first enrollment did not set the root key: %v", m["root_npub"])
	}

	// Login, then the app's daily work with DPoP.
	if c, out := owner.login(t); c != 200 || out["token_type"] != "DPoP" || owner.terminal == "" {
		t.Fatalf("login: %d %v", c, out)
	}
	if c, me := owner.do("GET", "/v1/merchants/"+merchant, nil); c != 200 || me["id"] != merchant {
		t.Fatalf("own merchant: %d", c)
	}
	c, pi := owner.do("POST", "/v1/payment-intents", map[string]any{"amount": 12990, "channel": "card_present"})
	if c != 201 || pi["merchant_id"] != merchant {
		t.Fatalf("intent without merchant_id: %d %v", c, pi)
	}
	ksn := "FFFF9876543210E00777"
	blob, _ := carddata.DevEncrypt(st.devKey, ksn, carddata.Card{PAN: "4111111111111111", Expiry: "2911", AID: visaAID, EMVHex: "9F2608A1B2C3D4E5F607089F2701809F3704C0FFEE11"})
	tapBody := map[string]any{"payment_intent_id": pi["id"], "terminal_id": owner.terminal, "stan": "000101", "emv_application": "credit",
		"local_time": time.Now().Format(time.RFC3339), "sred": map[string]any{"format": carddata.DevFormat, "ksn": ksn, "ciphertext": base64.StdEncoding.EncodeToString(blob)}}
	if c, r := owner.do("POST", "/v1/terminal/authorizations", tapBody); c != 200 || r["status"] != "approved" {
		t.Fatalf("tap from the app: %d %v", c, r)
	}
	if c, b := owner.do("GET", "/v1/accounts/"+owner.account+"/balance", nil); c != 200 || num(b["available"]) <= 0 {
		t.Fatalf("balance: %d %v", c, b)
	}
	c, q := owner.do("POST", "/v1/payouts/quotes", map[string]any{"account_id": owner.account, "amount": 1000, "destination": map[string]any{"type": "pix", "key_type": "CNPJ", "key": "12345678000195"}})
	if c != 201 {
		t.Fatalf("quote: %d %v", c, q)
	}
	if c, po := owner.do("POST", "/v1/payouts", map[string]any{"quote_id": q["id"]}); c != 201 || po["status"] != "paid" {
		t.Fatalf("payout: %d %v", c, po)
	}

	// ---- attacks ----
	// The same proof twice, a proof for another URL or method, a token without its key.
	path := "/v1/payment-intents/" + pi["id"].(string)
	pr := owner.proof("GET", path)
	if c, _ := owner.raw("GET", path, "DPoP "+owner.token, nil, pr); c != 200 {
		t.Fatalf("first use of a proof: %d", c)
	}
	if c, _ := owner.raw("GET", path, "DPoP "+owner.token, nil, pr); c != http.StatusUnauthorized {
		t.Fatalf("a replayed DPoP proof: %d", c)
	}
	if c, _ := owner.raw("GET", path, "DPoP "+owner.token, nil, owner.proof("GET", "/v1/merchants/"+merchant)); c != http.StatusUnauthorized {
		t.Fatalf("a proof for another URL: %d", c)
	}
	thief := newPhone(st)
	thief.token = owner.token // a stolen session token, but not the hardware key
	if c, _ := thief.do("GET", path, nil); c != http.StatusUnauthorized {
		t.Fatalf("a stolen token with another DPoP key: %d", c)
	}
	if c, _ := owner.raw("GET", path, "Bearer "+owner.token, nil, ""); c != http.StatusUnauthorized {
		t.Fatalf("the session token as a bearer token: %d", c)
	}
	// The NIP-98 login event cannot be replayed, and only registered devices log in.
	// (A fresh DPoP key: an identical event within the same second would be a replay too.)
	rotated, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	body, _ := json.Marshal(map[string]any{"dpop_jwk": mobileauth.PublicJWK(rotated)})
	auth, _ := mobileauth.SignNIP98(owner.device, "POST", st.api+"/v1/auth/nostr", body, time.Now())
	if c, _ := owner.raw("POST", "/v1/auth/nostr", auth, body, ""); c != 200 {
		t.Fatalf("login: %d", c)
	}
	if c, _ := owner.raw("POST", "/v1/auth/nostr", auth, body, ""); c != http.StatusUnauthorized {
		t.Fatalf("a replayed login event: %d", c)
	}
	if c, _ := thief.login(t); c != http.StatusUnauthorized {
		t.Fatalf("an unregistered key logged in: %d", c)
	}
	// A session is held to its merchant, its terminal and the app routes.
	other, otherAccount := st.merchant(st.key)
	_, otherPI := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": other, "amount": 500}, 201)
	for _, c := range []struct {
		method, path string
		body         any
		want         int
	}{
		{"GET", "/v1/merchants/" + other, nil, 404},
		{"GET", "/v1/payment-intents/" + otherPI["id"].(string), nil, 404},
		{"POST", "/v1/payment-intents/" + otherPI["id"].(string) + "/cancel", nil, 404},
		{"POST", "/v1/payment-intents", map[string]any{"merchant_id": other, "amount": 100}, 404},
		{"GET", "/v1/accounts/" + otherAccount + "/balance", nil, 404},
		{"POST", "/v1/payouts/quotes", map[string]any{"account_id": otherAccount, "amount": 100, "destination": map[string]any{"type": "pix", "key_type": "CNPJ", "key": "1"}}, 404},
		{"POST", "/v1/merchants/" + other + "/enrollment-codes", nil, 404},
		{"POST", "/v1/refunds", map[string]any{"payment_intent_id": otherPI["id"], "amount": 100}, 404},
		{"GET", "/v1/disputes", nil, 403},
		{"POST", "/v1/merchants", map[string]any{}, 403},
		{"POST", "/v1/webhook-endpoints", map[string]any{"url": "http://x"}, 403},
		{"POST", "/v1/terminals", map[string]any{"merchant_id": merchant}, 403},
	} {
		if code, out := owner.do(c.method, c.path, c.body); code != c.want {
			t.Errorf("session %s %s: HTTP %d (want %d) %v", c.method, c.path, code, c.want, out)
		}
	}
	// A refund goes back to the payer only; the app may undo its own sales (docs/06 §5).
	if c, out := owner.do("POST", "/v1/refunds", map[string]any{"payment_intent_id": pi["id"], "amount": 100}); c != 201 {
		t.Fatalf("a session refunding its own sale: %d %v", c, out)
	}
	_, pi2 := owner.do("POST", "/v1/payment-intents", map[string]any{"amount": 700})
	tapBody["payment_intent_id"], tapBody["terminal_id"], tapBody["stan"] = pi2["id"], "T0THER00", "000102"
	if c, _ := owner.do("POST", "/v1/terminal/authorizations", tapBody); c != http.StatusForbidden {
		t.Fatalf("a device using another terminal ID: %d", c)
	}

	// A second phone is added by the root key through the owner's session; then the root
	// key drops the first phone, whose session dies at once.
	cashier := newPhone(st)
	cashierNpub, _ := nostr.EncodeNpub(cashier.device.PubHex)
	both := deviceList(t, root, merchant, time.Now().Add(time.Second), owner, cashier)
	if c, out := owner.do("POST", "/v1/merchants/"+merchant+"/devices", map[string]any{"device_npub": cashierNpub, "platform": "android", "authorization_event": both}); c != 201 {
		t.Fatalf("adding a device: %d %v", c, out)
	}
	if c, _ := cashier.login(t); c != 200 || cashier.terminal == "" || cashier.terminal == owner.terminal {
		t.Fatalf("the new device's login: %d, terminal %q", c, cashier.terminal)
	}
	forged := deviceList(t, cashier.device, merchant, time.Now().Add(2*time.Second), cashier) // not the root
	if c, _ := cashier.do("POST", "/v1/merchants/"+merchant+"/devices", map[string]any{"device_npub": cashierNpub, "platform": "android", "authorization_event": forged}); c != http.StatusUnprocessableEntity {
		t.Fatalf("a device list not signed by the root key: %d", c)
	}
	if c, _ := owner.do("POST", "/v1/merchants/"+merchant+"/devices", map[string]any{"device_npub": npub, "platform": "android", "authorization_event": list}); c != http.StatusConflict {
		t.Fatalf("an older device list replayed: %d", c)
	}
	onlyCashier := deviceList(t, root, merchant, time.Now().Add(3*time.Second), cashier)
	if c, _ := cashier.do("POST", "/v1/merchants/"+merchant+"/devices", map[string]any{"device_npub": cashierNpub, "platform": "android", "authorization_event": onlyCashier}); c != 201 {
		t.Fatalf("dropping the owner's phone: %d", c)
	}
	if c, _ := owner.do("GET", "/v1/merchants/"+merchant, nil); c != http.StatusUnauthorized {
		t.Fatalf("a removed device's session still works: %d", c)
	}
	if c, _ := owner.login(t); c != http.StatusUnauthorized {
		t.Fatalf("a removed device logged in again: %d", c)
	}
	var terminalStatus string
	_ = st.pool.QueryRow(context.Background(), `SELECT status FROM terminals WHERE id = $1`, owner.terminal).Scan(&terminalStatus)
	if terminalStatus != "revoked" {
		t.Fatalf("a removed device's terminal is %s", terminalStatus)
	}

	// Removing and re-adding a phone revives the terminal that the removal revoked, never one
	// revoked or frozen for another reason (a lost phone, a forked journal, a risk review).
	st.call("POST", "/v1/terminals/"+cashier.terminal+"/revoke", map[string]any{"reason": "device lost"}, 200)
	ownerBack := deviceList(t, root, merchant, time.Now().Add(4*time.Second), owner)
	st.call("POST", "/v1/merchants/"+merchant+"/devices", map[string]any{"device_npub": npub, "platform": "android", "authorization_event": ownerBack}, 201)
	both = deviceList(t, root, merchant, time.Now().Add(5*time.Second), owner, cashier)
	st.call("POST", "/v1/merchants/"+merchant+"/devices", map[string]any{"device_npub": cashierNpub, "platform": "android", "authorization_event": both}, 201)
	for id, want := range map[string]string{owner.terminal: "active|", cashier.terminal: "revoked|device lost"} {
		var status, reason string
		_ = st.pool.QueryRow(context.Background(), `SELECT status, COALESCE(revoked_reason, '') FROM terminals WHERE id = $1`, id).Scan(&status, &reason)
		if status+"|"+reason != want {
			t.Errorf("terminal %s after remove and re-add: %s|%s, want %s", id, status, reason, want)
		}
	}
}
