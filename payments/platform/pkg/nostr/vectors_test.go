package nostr

import (
	"crypto/sha256"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The JavaScript generator (payments/tools/gen-nostr-examples.mjs, nostr-tools + @noble/curves)
// derives test keys and nonces from labels. Reproducing its output byte for byte proves the
// Go implementation interoperates: same IDs, same BIP-340 signatures, same NIP-44 ciphertext.
const examples = "../../../nostr/examples"

func det(label string) []byte {
	h := sha256.Sum256([]byte("ipplus-spec/det/" + label))
	return h[:]
}

func det32(label string) *[32]byte {
	var a [32]byte
	copy(a[:], det(label))
	return &a
}

func testKey(t *testing.T, role string) Keys {
	t.Helper()
	h := sha256.Sum256([]byte("ipplus-spec/test-key/" + role))
	k, err := KeysFromSecret(h[:])
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func load(t *testing.T, name string, v any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(examples, name))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

func TestVerifiesEveryExampleEvent(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join(examples, "*.json"))
	if len(files) < 10 {
		t.Fatalf("expected the example events, found %d files", len(files))
	}
	count := 0
	for _, f := range files {
		var raw any
		b, _ := os.ReadFile(f)
		_ = json.Unmarshal(b, &raw)
		var walk func(any)
		walk = func(v any) {
			switch x := v.(type) {
			case map[string]any:
				if _, ok := x["sig"]; ok {
					if _, ok := x["kind"]; ok {
						eb, _ := json.Marshal(x)
						var e Event
						_ = json.Unmarshal(eb, &e)
						if err := e.Verify(); err != nil {
							t.Errorf("%s: %s: %v", filepath.Base(f), e.ID, err)
						}
						count++
						return
					}
				}
				for _, y := range x {
					walk(y)
				}
			case []any:
				for _, y := range x {
					walk(y)
				}
			}
		}
		walk(raw)
	}
	if count < 20 {
		t.Fatalf("verified only %d events", count)
	}
}

func TestReproducesReceiptSignatureExactly(t *testing.T) {
	var want Event
	load(t, "7711-receipt.json", &want)
	got := Event{CreatedAt: want.CreatedAt, Kind: want.Kind, Tags: want.Tags, Content: want.Content}
	if err := got.Sign(testKey(t, "platform-receipts"), det32("aux/receipt-0")); err != nil {
		t.Fatal(err)
	}
	if got.ID != want.ID || got.Sig != want.Sig {
		t.Fatalf("Go signing differs from JS:\n id  %s\n     %s\n sig %s\n     %s", got.ID, want.ID, got.Sig, want.Sig)
	}
}

func TestReproducesGiftWrapExactly(t *testing.T) {
	var file struct {
		Seal Event `json:"seal"`
		Wrap Event `json:"wrap"`
	}
	load(t, "1059-receipt-giftwrap.json", &file)
	var inner Event
	load(t, "7711-receipt.json", &inner)

	label := "receipt-0-claim"
	eph, _ := KeysFromSecret(det("wrap-ephemeral/" + label))
	claim := testKey(t, "customer-claim-1")
	seal, wrap, err := Wrap(&inner, testKey(t, "platform-receipts"), claim.PubHex, WrapOptions{
		SealAt: file.Seal.CreatedAt, WrapAt: file.Wrap.CreatedAt, WrapTags: file.Wrap.Tags[1:],
		SealNonce: det("seal-nonce/" + label), WrapNonce: det("wrap-nonce/" + label),
		SealAux: det32("aux/seal/" + label), WrapAux: det32("aux/wrap/" + label), OneTimeKey: &eph,
	})
	if err != nil {
		t.Fatal(err)
	}
	if seal.Content != file.Seal.Content || seal.Sig != file.Seal.Sig {
		t.Fatal("seal differs from the JavaScript vector (NIP-44 or signing mismatch)")
	}
	if wrap.ID != file.Wrap.ID || wrap.Content != file.Wrap.Content || wrap.Sig != file.Wrap.Sig {
		t.Fatal("gift wrap differs from the JavaScript vector")
	}

	got, _, err := Unwrap(&file.Wrap, claim)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != inner.ID {
		t.Fatal("unwrapped a different event")
	}
	if _, _, err := Unwrap(&file.Wrap, testKey(t, "merchant-root")); err == nil {
		t.Fatal("a different key must not unwrap")
	}
}

func TestNpubsMatchPublishedKeys(t *testing.T) {
	var keys struct {
		Keys []struct{ Role, Pubkey, Npub string } `json:"keys"`
	}
	load(t, "keys.json", &keys)
	for _, k := range keys.Keys {
		if testKey(t, k.Role).PubHex != k.Pubkey {
			t.Errorf("%s: derived pubkey differs", k.Role)
		}
		n, err := EncodeNpub(k.Pubkey)
		if err != nil || n != k.Npub {
			t.Errorf("%s: npub %s, want %s", k.Role, n, k.Npub)
		}
		back, err := DecodeNpub(k.Npub)
		if err != nil || back != k.Pubkey {
			t.Errorf("%s: decode %v", k.Role, err)
		}
	}
	n := keys.Keys[0].Npub
	last := n[len(n)-1]
	swap := byte('q')
	if last == 'q' {
		swap = 'p'
	}
	if _, err := DecodeNpub(n[:len(n)-1] + string(swap)); err == nil {
		t.Error("corrupted npub accepted")
	}
}

func TestNIP44RoundTripAndTamper(t *testing.T) {
	a, _ := GenerateKeys()
	b, _ := GenerateKeys()
	k1, _ := ConversationKey(a.Secret, b.PubHex)
	k2, _ := ConversationKey(b.Secret, a.PubHex)
	if string(k1) != string(k2) {
		t.Fatal("conversation keys differ")
	}
	for _, n := range []int{1, 31, 32, 33, 300, 65535} {
		msg := strings.Repeat("x", n)
		ct, err := Encrypt(msg, k1, nil)
		if err != nil {
			t.Fatal(err)
		}
		pt, err := Decrypt(ct, k2)
		if err != nil || pt != msg {
			t.Fatalf("len %d: %v", n, err)
		}
	}
	ct, _ := Encrypt("hello", k1, nil)
	tampered := []byte(ct)
	tampered[40] ^= 1
	if _, err := Decrypt(string(tampered), k2); err == nil {
		t.Fatal("tampered ciphertext accepted")
	}
}

func TestSerializeEscapesLikeJavaScript(t *testing.T) {
	e := Event{PubKey: "ab", CreatedAt: 1, Kind: 1, Tags: [][]string{{"t", "a\"b"}}, Content: "line\nbreak\b\f\u0001<&>é "}
	b, _ := e.Serialize()
	want := `[0,"ab",1,1,[["t","a\"b"]],"line\nbreak\b\f\u0001<&>é` + " " + `"]`
	if string(b) != want {
		t.Fatalf("got  %s\nwant %s", b, want)
	}
}

func TestCanonicalJSON(t *testing.T) {
	got, err := CanonicalJSON(map[string]any{"b": 1, "a": map[string]any{"z": "ã", "y": []any{2, "<"}}})
	if err != nil || got != `{"a":{"y":[2,"<"],"z":"ã"},"b":1}` {
		t.Fatalf("%s %v", got, err)
	}
	if _, err := CanonicalJSON(map[string]any{"x": 1.5}); err == nil {
		t.Fatal("float accepted")
	}
}
