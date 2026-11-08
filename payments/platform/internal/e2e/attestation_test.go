package e2e

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/attest"
	"github.com/monolito123/Gooners/payments/platform/internal/attest/attesttest"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// With strict attestation, a phone proves it is the genuine app on a locked phone with its
// DPoP key in secure hardware, and its sessions are pinned to that key (docs/05 §2.4).
func TestStrictDeviceAttestation(t *testing.T) {
	ca, err := attesttest.NewCA()
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("goonersPAY release signing certificate"))
	const pkg = "br.com.gooners.pay"
	st := newStack(t, func(d *payments.Deps) {
		d.Attestor = payments.VerifyingAttestor{KeyAttestation: &attest.KeyAttestationConfig{Roots: ca.Roots, PackageName: pkg, SigningDigests: [][]byte{digest[:]}}}
	})
	evidence := func(p *phone, a attesttest.Android) map[string]any {
		chain, err := ca.AndroidChain(p.dpop, a)
		if err != nil {
			t.Fatal(err)
		}
		var b64 []any
		for _, c := range chain {
			b64 = append(b64, base64.StdEncoding.EncodeToString(c))
		}
		return map[string]any{"type": "android_key_attestation", "certificate_chain": b64}
	}
	genuine := func(p *phone) attesttest.Android {
		return attesttest.Genuine(attest.Challenge(p.device.PubHex), pkg, digest[:])
	}

	merchant, _ := st.merchant(st.key)
	_, ec := st.call("POST", "/v1/merchants/"+merchant+"/enrollment-codes", nil, 201)
	owner := newPhone(st)
	root, _ := nostr.GenerateKeys()
	npub, _ := nostr.EncodeNpub(owner.device.PubHex)
	enroll := func(att map[string]any) (int, map[string]any) {
		body, _ := json.Marshal(map[string]any{"device_npub": npub, "platform": "android", "attestation": att,
			"authorization_event": deviceList(t, root, merchant, time.Now(), owner)})
		return owner.raw("POST", "/v1/enrollment", "Enrollment "+ec["code"].(string), body, "")
	}

	// A rooted phone, a cloned app or a software key is refused at enrollment; the code survives.
	unlocked := genuine(owner)
	unlocked.Locked = false
	if c, out := enroll(evidence(owner, unlocked)); c != http.StatusUnprocessableEntity || !strings.Contains(out["detail"].(string), "bootloader") {
		t.Fatalf("an unlocked bootloader: %d %v", c, out)
	}
	clone := genuine(owner)
	clone.Package = "com.example.clone"
	if c, _ := enroll(evidence(owner, clone)); c != http.StatusUnprocessableEntity {
		t.Fatalf("a cloned app: %d", c)
	}
	if c, dev := enroll(evidence(owner, genuine(owner))); c != 201 {
		t.Fatalf("a genuine phone: %d %v", c, dev)
	}
	var integrity map[string]any
	var raw []byte
	_ = st.pool.QueryRow(context.Background(), `SELECT integrity FROM devices WHERE pubkey = $1`, owner.device.PubHex).Scan(&raw)
	_ = json.Unmarshal(raw, &integrity)
	if v := integrity["verdict"].(map[string]any); v["verdict"] != "verified" || v["security_level"] != "strongbox" || v["dpop_jkt"] == "" {
		t.Fatalf("the stored verdict: %v", integrity)
	}

	// Sessions use the attested key only: a copied device key on another phone gets nothing.
	if c, out := owner.login(t); c != 200 {
		t.Fatalf("login with the attested key: %d %v", c, out)
	}
	thief := &phone{st: st, device: owner.device}
	thief.dpop, _ = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if c, out := thief.login(t); c != http.StatusUnauthorized || !strings.Contains(out["detail"].(string), "attested hardware key") {
		t.Fatalf("the device key with another DPoP key: %d %v", c, out)
	}

	// A phone the owner adds by npub attests at its first login.
	cashier := newPhone(st)
	cashierNpub, _ := nostr.EncodeNpub(cashier.device.PubHex)
	both := deviceList(t, root, merchant, time.Now().Add(time.Second), owner, cashier)
	if c, out := owner.do("POST", "/v1/merchants/"+merchant+"/devices", map[string]any{"device_npub": cashierNpub, "platform": "android", "authorization_event": both}); c != 201 {
		t.Fatalf("adding a phone without evidence: %d %v", c, out)
	}
	if c, out := cashier.login(t); c != http.StatusUnauthorized || !strings.Contains(out["detail"].(string), "attestation_required") {
		t.Fatalf("its first login without evidence: %d %v", c, out)
	}
	if c, _ := cashier.loginWith(t, evidence(cashier, genuine(owner))); c != http.StatusUnauthorized {
		t.Fatalf("evidence made for another device's key: %d", c)
	}
	if c, out := cashier.loginWith(t, evidence(cashier, genuine(cashier))); c != 200 {
		t.Fatalf("its first login with evidence: %d %v", c, out)
	}
	// The refused login above spent its NIP-98 event (same body, same second): replays never
	// pass, even after a refusal. A later login is a new event.
	time.Sleep(time.Second)
	if c, out := cashier.login(t); c != 200 {
		t.Fatalf("a later login (already attested): %d %v", c, out)
	}
}
