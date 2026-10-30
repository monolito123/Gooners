// Command conformance writes the vectors the Android and iOS apps test against
// (payments/mobile/conformance/vectors.json): everything both apps must compute exactly as
// the platform does. CI regenerates the file and fails if it changed without being committed.
//
//	go run ./cmd/conformance -out ../mobile/conformance/vectors.json
package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/btcsuite/btcd/btcec/v2/schnorr"

	"github.com/monolito123/Gooners/payments/platform/internal/attest"
	"github.com/monolito123/Gooners/payments/platform/internal/carddata"
	"github.com/monolito123/Gooners/payments/platform/internal/mobileauth"
	"github.com/monolito123/Gooners/payments/platform/pkg/brcode"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

func det(label string) []byte {
	h := sha256.Sum256([]byte("goonerspay-spec/det/" + label))
	return h[:]
}

func testKey(role string) nostr.Keys {
	h := sha256.Sum256([]byte("goonerspay-spec/test-key/" + role))
	k, err := nostr.KeysFromSecret(h[:])
	must(err)
	return k
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "conformance:", err)
		os.Exit(1)
	}
}

func main() {
	out := flag.String("out", "../mobile/conformance/vectors.json", "output file")
	flag.Parse()
	v := map[string]any{
		"warning":      "PUBLIC TEST VECTORS. Every secret here is derived from a public label. Never use any of them for anything real.",
		"generated_by": "payments/platform/cmd/conformance",
	}

	// BIP-340: signatures with explicit auxiliary randomness.
	var sigs []map[string]string
	for _, label := range []string{"bip340/0", "bip340/1", "bip340/2"} {
		k := testKey(label)
		msg, aux := det(label+"/message"), det(label+"/aux")
		var a [32]byte
		copy(a[:], aux)
		sig, err := schnorr.Sign(k.Secret, msg, schnorr.CustomNonce(a))
		must(err)
		sigs = append(sigs, map[string]string{"secret": k.SecretHex(), "pubkey": k.PubHex, "aux": hex.EncodeToString(aux),
			"message": hex.EncodeToString(msg), "signature": hex.EncodeToString(sig.Serialize())})
	}
	v["bip340"] = sigs

	// Test keys: secret = SHA-256("goonerspay-spec/test-key/" + role), with npub and nsec.
	var keys []map[string]string
	for _, role := range []string{"merchant-root", "merchant-device-android", "merchant-device-ios"} {
		k := testKey(role)
		npub, _ := nostr.EncodeNpub(k.PubHex)
		nsec, _ := nostr.EncodeNsec(k.Secret.Serialize())
		keys = append(keys, map[string]string{"role": role, "secret": k.SecretHex(), "pubkey": k.PubHex, "npub": npub, "nsec": nsec})
	}
	v["test_keys"] = keys

	// NIP-01 serialization, including every escaping edge case.
	device := testKey("merchant-device-android")
	var events []map[string]any
	for _, c := range []struct{ name, content string }{
		{"plain", "Pagamento aprovado"},
		{"escapes", "quote \" backslash \\ newline \n return \r tab \t backspace \b formfeed \f bell \x07 unit \x1f"},
		{"unicode", "Café • R$ 129,90 • 😀 • line separator   • paragraph   • ﷽"},
		{"empty", ""},
	} {
		ev := &nostr.Event{CreatedAt: 1793275930, Kind: 7714, Tags: [][]string{{"merchant", "mer_01JB8Z2K5D6F7G8H9J0K1M2N3P"}, {"t", c.name}}, Content: c.content}
		var a [32]byte
		copy(a[:], det("event/"+c.name))
		must(ev.Sign(device, &a))
		ser, _ := ev.Serialize()
		events = append(events, map[string]any{"name": c.name, "aux": hex.EncodeToString(a[:]), "event": ev, "serialization": string(ser)})
	}
	v["events"] = events

	// NIP-98: a login event for an exact URL, method and body.
	body := `{"dpop_jwk":{"kty":"EC","crv":"P-256","x":"f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU","y":"x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"}}`
	sum := sha256.Sum256([]byte(body))
	login := &nostr.Event{CreatedAt: 1793295130, Kind: mobileauth.KindHTTPAuth, Content: "",
		Tags: [][]string{{"u", "https://api.goonerspay.example/v1/auth/nostr"}, {"method", "POST"}, {"payload", hex.EncodeToString(sum[:])}}}
	var la [32]byte
	copy(la[:], det("nip98/login"))
	must(login.Sign(device, &la))
	lb, _ := json.Marshal(login)
	v["nip98"] = map[string]any{"url": "https://api.goonerspay.example/v1/auth/nostr", "method": "POST", "body": body, "aux": hex.EncodeToString(la[:]),
		"event": login, "authorization_header": "Nostr " + base64.StdEncoding.EncodeToString(lb)}

	// JWK thumbprint (RFC 7638).
	jwk := mobileauth.JWK{Kty: "EC", Crv: "P-256", X: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU", Y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"}
	v["jwk_thumbprint"] = map[string]any{"jwk": jwk, "thumbprint": jwk.Thumbprint()}

	// Device list (kind 17710) signed by the test root key.
	root := testKey("merchant-root")
	ios := testKey("merchant-device-ios")
	list := &nostr.Event{CreatedAt: 1793275930, Kind: mobileauth.KindDeviceAuthorization, Content: "", Tags: [][]string{
		{"v", "1"}, {"merchant", "mer_01JB8Z2K5D6F7G8H9J0K1M2N3P"},
		{"device", device.PubHex, "android", "Caixa 1", "1793275930"}, {"device", ios.PubHex, "ios", "iPad balcão", "1793275930"}}}
	var da [32]byte
	copy(da[:], det("17710/list"))
	must(list.Sign(root, &da))
	v["device_list"] = map[string]any{"aux": hex.EncodeToString(da[:]), "event": list}

	// Canonical JSON (docs/03 §2.2): sorted keys, no whitespace, integers only, the escaping
	// of NIP-01. Values arrive in any key order; the canonical string is the same.
	var canon []map[string]any
	for _, raw := range []string{
		`{"v":1,"b":[3,1,2],"a":{"z":null,"y":true,"x":false}}`,
		`{"seq":-7,"text":"aspas \" barra \\ nova\nlinha \t tab \u0001 ctl","ação":"São Paulo – R$ 1.299,90"}`,
		`{"nested":{"k2":{"b":2,"a":1},"k1":[{"d":4,"c":3}]},"empty_obj":{},"empty_arr":[]}`,
	} {
		var val any
		must(json.Unmarshal([]byte(raw), &val))
		c, err := nostr.CanonicalJSON(val)
		must(err)
		canon = append(canon, map[string]any{"json": raw, "canonical": c})
	}
	v["canonical_json"] = canon

	// A terminal journal (kind 7714): two hash-chained entries signed by the device key.
	var chain []map[string]any
	prev := any(nil)
	for i, f := range []map[string]any{
		{"v": 1, "seq": 1, "type": "session_start", "local_time": "2026-10-29T14:30:00-03:00", "app": map[string]any{"version": "0.1.0"}},
		{"v": 1, "seq": 2, "type": "tap_started", "payment_intent_id": "pi_01JBK3Z9Y8X7W6V5T4S3R2Q1P0", "terminal_id": "TP000418",
			"amount": map[string]any{"value": 12990, "currency": "BRL", "exponent": 2}, "local_time": "2026-10-29T14:42:09-03:00", "app": map[string]any{"version": "0.1.0"}},
	} {
		f["prev"] = prev
		content, err := nostr.CanonicalJSON(f)
		must(err)
		ev := &nostr.Event{CreatedAt: int64(1793295000 + 60*i), Kind: 7714, Tags: [][]string{{"merchant", root.PubHex}}, Content: content}
		var a [32]byte
		copy(a[:], det(fmt.Sprintf("journal/%d", i+1)))
		must(ev.Sign(device, &a))
		chain = append(chain, map[string]any{"fields": f, "aux": hex.EncodeToString(a[:]), "event": ev})
		prev = ev.ID
	}
	// The challenge an Android app passes to setAttestationChallenge for its DPoP key.
	v["key_attestation_challenge"] = map[string]any{"device_pubkey": device.PubHex, "challenge": hex.EncodeToString(attest.Challenge(device.PubHex))}

	v["journal"] = map[string]any{"device_role": "merchant-device-android", "root_role": "merchant-root", "entries": chain}

	// The sandbox card format (carddata.DevFormat) with a fixed nonce.
	key, nonce := det("dev-card/key"), det("dev-card/nonce")[:12]
	card := carddata.Card{PAN: "4111111111111111", Expiry: "2911", AID: "A0000000031010", EMVHex: "9F2608A1B2C3D4E5F607089F2701809F3704C0FFEE11"}
	pt, _ := json.Marshal(card)
	blk, _ := aes.NewCipher(key)
	g, _ := cipher.NewGCM(blk)
	ksn := "FFFF9876543210E00001"
	blob := g.Seal(append([]byte{}, nonce...), nonce, pt, []byte(ksn))
	v["dev_card"] = map[string]any{"format": carddata.DevFormat, "key": hex.EncodeToString(key), "ksn": ksn, "nonce": hex.EncodeToString(nonce),
		"plaintext": string(pt), "ciphertext_base64": base64.StdEncoding.EncodeToString(blob)}

	// BR Codes (Pix): the apps decode and check what the platform returns.
	var codes []map[string]any
	for _, p := range []brcode.Payload{
		{Dynamic: true, URL: "pix.goonerspay.example/qr/v2/9d36b84fc70b478fb95c12729b90ca25", Amount: "129.90", MerchantName: "CAFE AURORA", MerchantCity: "SAO PAULO"},
		{Key: "12345678000195", Amount: "23.90", MerchantName: "CAFE AURORA", MerchantCity: "SAO PAULO", TxID: "MESA4"},
	} {
		c, err := brcode.Encode(p)
		must(err)
		codes = append(codes, map[string]any{"code": c, "dynamic": p.Dynamic, "url": p.URL, "key": p.Key, "amount": p.Amount,
			"merchant_name": p.MerchantName, "merchant_city": p.MerchantCity})
	}
	v["brcode"] = codes

	// Money: centavos to the display form both apps use (no locale data: NBSP after R$,
	// "." for thousands, "," for cents, a minus sign before R$).
	var money []map[string]any
	for _, c := range []int64{0, 5, 99, 100, 12990, 100000, 184220, 123456789, -12990, 999999999999} {
		money = append(money, map[string]any{"centavos": c, "display": formatBRL(c)})
	}
	v["money"] = money

	b, err := json.MarshalIndent(v, "", "  ")
	must(err)
	must(os.WriteFile(*out, append(b, '\n'), 0o644)) // #nosec G306 -- public test vectors
}

// formatBRL is the reference display format for amounts.
func formatBRL(c int64) string {
	neg := c < 0
	if neg {
		c = -c
	}
	reais := fmt.Sprint(c / 100)
	var grouped []byte
	for i, d := range []byte(reais) {
		if i > 0 && (len(reais)-i)%3 == 0 {
			grouped = append(grouped, '.')
		}
		grouped = append(grouped, d)
	}
	s := fmt.Sprintf("R$ %s,%02d", grouped, c%100)
	if neg {
		s = "-" + s
	}
	return s
}
