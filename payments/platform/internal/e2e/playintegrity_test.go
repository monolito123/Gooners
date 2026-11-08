package e2e

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/attest"
	"github.com/monolito123/Gooners/payments/platform/internal/attest/attesttest"
	"github.com/monolito123/Gooners/payments/platform/internal/gcpauth"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// An Android phone's card sale carries a Play Integrity token requested over its exact body;
// the platform has Google decode it and refuses the sale on a bad verdict (docs/05 §2.4).
func TestPlayIntegrityOnSales(t *testing.T) {
	ca, err := attesttest.NewCA()
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("goonersPAY release signing certificate"))
	const pkg = "br.com.gooners.pay"
	// Google's decode API: the "token" names the request hash it was made for and the device
	// verdict.
	google := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Token string `json:"integrity_token"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		var tok struct{ Hash, Device string }
		if json.Unmarshal([]byte(in.Token), &tok) != nil {
			w.WriteHeader(400)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"tokenPayloadExternal": map[string]any{
			"requestDetails":  map[string]any{"requestPackageName": pkg, "requestHash": tok.Hash, "timestampMillis": strconv.FormatInt(time.Now().UnixMilli(), 10)},
			"appIntegrity":    map[string]any{"appRecognitionVerdict": "PLAY_RECOGNIZED", "packageName": pkg, "certificateSha256Digest": []string{base64.RawURLEncoding.EncodeToString(digest[:])}},
			"deviceIntegrity": map[string]any{"deviceRecognitionVerdict": []string{tok.Device}},
			"accountDetails":  map[string]any{"appLicensingVerdict": "LICENSED"}}})
	}))
	defer google.Close()
	st := newStack(t, func(d *payments.Deps) {
		d.Attestor = payments.VerifyingAttestor{KeyAttestation: &attest.KeyAttestationConfig{Roots: ca.Roots, PackageName: pkg, SigningDigests: [][]byte{digest[:]}}}
		d.PlayIntegrity = &attest.PlayIntegrity{PackageName: pkg, SigningDigests: [][]byte{digest[:]}, Tokens: gcpauth.Static("g"), Endpoint: google.URL}
	})
	merchant, _ := st.merchant(st.key)
	_, ec := st.call("POST", "/v1/merchants/"+merchant+"/enrollment-codes", nil, 201)
	phone := newPhone(st)
	root, _ := nostr.GenerateKeys()
	npub, _ := nostr.EncodeNpub(phone.device.PubHex)
	chain, _ := ca.AndroidChain(phone.dpop, attesttest.Genuine(attest.Challenge(phone.device.PubHex), pkg, digest[:]))
	var b64 []string
	for _, c := range chain {
		b64 = append(b64, base64.StdEncoding.EncodeToString(c))
	}
	reg, _ := json.Marshal(map[string]any{"device_npub": npub, "platform": "android", "attestation": map[string]any{"type": "android_key_attestation", "certificate_chain": b64},
		"authorization_event": deviceList(t, root, merchant, time.Now(), phone)})
	if c, dev := phone.raw("POST", "/v1/enrollment", "Enrollment "+ec["code"].(string), reg, ""); c != 201 {
		t.Fatalf("enrollment: %d %v", c, dev)
	}
	if c, out := phone.login(t); c != 200 {
		t.Fatalf("login: %d %v", c, out)
	}
	sale := func(token func(body []byte) string) (int, map[string]any) {
		t.Helper()
		_, pi := phone.do("POST", "/v1/payment-intents", map[string]any{"amount": 2500, "channel": "card_present"})
		body, _ := json.Marshal(st.tapBody(tapOpts{pi: pi["id"].(string), terminal: phone.terminal, pan: luhnPAN(strconv.FormatInt(410000000000000+time.Now().UnixNano()%99999999, 10)),
			aid: visaAID, app: "credit"}))
		req, _ := http.NewRequest("POST", st.api+"/v1/terminal/authorizations", bytes.NewReader(body))
		req.Header.Set("Authorization", "DPoP "+phone.token)
		req.Header.Set("DPoP", phone.proof("POST", "/v1/terminal/authorizations"))
		if token != nil {
			req.Header.Set("Play-Integrity-Token", token(body))
		}
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
	token := func(hash, device string) func([]byte) string {
		return func(body []byte) string {
			if hash == "" {
				hash = attest.RequestHash(body)
			}
			b, _ := json.Marshal(map[string]string{"Hash": hash, "Device": device})
			return string(b)
		}
	}
	if c, out := sale(nil); c != http.StatusForbidden || out["code"] != "integrity_refused" {
		t.Fatalf("a sale without a token: %d %v", c, out)
	}
	if c, out := sale(token("", "MEETS_DEVICE_INTEGRITY")); c != 200 || out["status"] != "approved" {
		t.Fatalf("a sale with a good verdict: %d %v", c, out)
	}
	if c, _ := sale(token(attest.RequestHash([]byte("another sale")), "MEETS_DEVICE_INTEGRITY")); c != http.StatusForbidden {
		t.Fatalf("a token made for another request: %d", c)
	}
	if c, _ := sale(token("", "MEETS_BASIC_INTEGRITY")); c != http.StatusForbidden {
		t.Fatalf("a rooted phone: %d", c)
	}
}
