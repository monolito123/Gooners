package e2e

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/attest"
	"github.com/monolito123/Gooners/payments/platform/internal/attest/attesttest"
	"github.com/monolito123/Gooners/payments/platform/internal/carddata"
	"github.com/monolito123/Gooners/payments/platform/internal/mobileauth"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// An iPhone attested with App Attest signs every card authorization with its Secure Enclave
// key: no sale without a fresh assertion over the exact body, none replayed, none from a
// copied device key on another phone.
func TestAppAttestAssertions(t *testing.T) {
	const appID = "ABCDE12345.br.com.gooners.pay"
	dk, _ := nostr.GenerateKeys()
	dpop, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	enclave, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	att, kid, roots, err := attesttest.AppAttestObject(attesttest.AppAttest{AppID: appID, ClientData: []byte(dk.PubHex), Key: enclave})
	if err != nil {
		t.Fatal(err)
	}
	st := newStack(t, func(d *payments.Deps) {
		d.Attestor = payments.VerifyingAttestor{AppAttest: &attest.AppAttestConfig{Roots: roots, AppID: appID}}
	})
	iphone := &phone{st: st, device: dk, dpop: dpop}

	merchant, _ := st.merchant(st.key)
	_, ec := st.call("POST", "/v1/merchants/"+merchant+"/enrollment-codes", nil, 201)
	root, _ := nostr.GenerateKeys()
	now := time.Now()
	list := nostr.Event{CreatedAt: now.Unix(), Kind: mobileauth.KindDeviceAuthorization,
		Tags: [][]string{{"v", "1"}, {"merchant", merchant}, {"device", dk.PubHex, "ios", "Caixa", strconv.FormatInt(now.Unix(), 10)}}}
	if err := list.Sign(root, nil); err != nil {
		t.Fatal(err)
	}
	npub, _ := nostr.EncodeNpub(dk.PubHex)
	reg, _ := json.Marshal(map[string]any{"device_npub": npub, "platform": "ios", "model": "iPhone",
		"attestation":         map[string]any{"type": "app_attest", "key_id": base64.StdEncoding.EncodeToString(kid), "attestation": base64.StdEncoding.EncodeToString(att), "client_data": dk.PubHex},
		"authorization_event": list})
	if c, dev := iphone.raw("POST", "/v1/enrollment", "Enrollment "+ec["code"].(string), reg, ""); c != 201 {
		t.Fatalf("enrollment: %d %v", c, dev)
	}
	if c, out := iphone.login(t); c != 200 {
		t.Fatalf("login: %d %v", c, out)
	}

	stan := 0
	sale := func(counter uint32, key *ecdsa.PrivateKey, mutate func([]byte) []byte) (int, map[string]any) {
		t.Helper()
		_, pi := iphone.do("POST", "/v1/payment-intents", map[string]any{"amount": 2500, "channel": "card_present"})
		stan++
		ksn := fmt.Sprintf("FFFF9876543210E%05d", 900+stan)
		blob, _ := carddata.DevEncrypt(st.devKey, ksn, carddata.Card{PAN: "4111111111111111", Expiry: "2911", AID: visaAID, EMVHex: "9F2608A1B2C3D4E5F607089F2701809F3704C0FFEE11"})
		body, _ := json.Marshal(map[string]any{"payment_intent_id": pi["id"], "terminal_id": iphone.terminal, "stan": fmt.Sprintf("%06d", stan), "emv_application": "credit",
			"local_time": time.Now().Format(time.RFC3339), "sred": map[string]any{"format": carddata.DevFormat, "ksn": ksn, "ciphertext": base64.StdEncoding.EncodeToString(blob)}})
		headers := map[string]string{"Authorization": "DPoP " + iphone.token, "DPoP": iphone.proof("POST", "/v1/terminal/authorizations")}
		if key != nil {
			a, err := attesttest.AppAttestAssertion(key, appID, counter, body)
			if err != nil {
				t.Fatal(err)
			}
			headers["App-Attest-Assertion"] = base64.StdEncoding.EncodeToString(a)
		}
		if mutate != nil {
			body = mutate(body) // what reaches the platform differs from what was signed
		}
		req, _ := http.NewRequest("POST", st.api+"/v1/terminal/authorizations", bytes.NewReader(body))
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}

	if c, r := sale(0, nil, nil); c != http.StatusForbidden || r["type"] == nil {
		t.Fatalf("a sale without an assertion: %d %v", c, r)
	}
	if c, r := sale(1, enclave, nil); c != 200 || r["status"] != "approved" {
		t.Fatalf("a signed sale: %d %v", c, r)
	}
	if c, _ := sale(1, enclave, nil); c != http.StatusForbidden {
		t.Fatalf("a counter used again: HTTP %d", c)
	}
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if c, _ := sale(5, other, nil); c != http.StatusForbidden {
		t.Fatalf("another phone's key (a copied device key): HTTP %d", c)
	}
	if c, _ := sale(6, enclave, func(b []byte) []byte { return append(b, ' ') }); c != http.StatusForbidden {
		t.Fatalf("a body other than the signed one: HTTP %d", c)
	}
	if c, r := sale(7, enclave, nil); c != 200 || r["status"] != "approved" {
		t.Fatalf("the next counter: %d %v", c, r)
	}
}
