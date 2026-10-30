package mobileauth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

func example(t *testing.T, name string, v any) {
	t.Helper()
	b, err := os.ReadFile("../../../nostr/examples/" + name)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

// The signed login of docs/02 §3.2 passes, at its own time, for its own URL and body.
func TestSpecLoginExample(t *testing.T) {
	var ex struct {
		Event               nostr.Event `json:"event"`
		RequestBody         string      `json:"request_body"`
		AuthorizationHeader string      `json:"authorization_header"`
	}
	example(t, "27235-nip98-login.json", &ex)
	at := time.Unix(ex.Event.CreatedAt, 0)
	url := "https://api.goonerspay.example/v1/auth/nostr"
	ev, err := VerifyNIP98(ex.AuthorizationHeader, "POST", url, []byte(ex.RequestBody), at.Add(30*time.Second))
	if err != nil || ev.ID != ex.Event.ID {
		t.Fatalf("spec example: %v", err)
	}
	var body struct {
		DPoPJWK JWK `json:"dpop_jwk"`
	}
	_ = json.Unmarshal([]byte(ex.RequestBody), &body)
	if _, err := body.DPoPJWK.PublicKey(); err != nil {
		t.Fatalf("the example's DPoP key: %v", err)
	}
	for name, check := range map[string]func() error{
		"too old": func() error {
			_, err := VerifyNIP98(ex.AuthorizationHeader, "POST", url, []byte(ex.RequestBody), at.Add(2*time.Minute))
			return err
		},
		"other URL": func() error {
			_, err := VerifyNIP98(ex.AuthorizationHeader, "POST", url+"x", []byte(ex.RequestBody), at)
			return err
		},
		"other method": func() error {
			_, err := VerifyNIP98(ex.AuthorizationHeader, "PUT", url, []byte(ex.RequestBody), at)
			return err
		},
		"other body": func() error {
			_, err := VerifyNIP98(ex.AuthorizationHeader, "POST", url, []byte(ex.RequestBody+" "), at)
			return err
		},
		"not Nostr": func() error { _, err := VerifyNIP98("Bearer x", "POST", url, nil, at); return err },
		"tampered": func() error {
			var e nostr.Event
			raw, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(ex.AuthorizationHeader, "Nostr "))
			_ = json.Unmarshal(raw, &e)
			e.CreatedAt++
			b, _ := json.Marshal(e)
			_, err := VerifyNIP98("Nostr "+base64.StdEncoding.EncodeToString(b), "POST", url, []byte(ex.RequestBody), at)
			return err
		},
	} {
		if err := check(); !errors.Is(err, ErrUnauthorized) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestSpecDeviceList(t *testing.T) {
	var ev nostr.Event
	example(t, "17710-device-authorization.json", &ev)
	devs, err := VerifyDeviceList(&ev, ev.PubKey, "mer_01JB8Z2K5D6F7G8H9J0K1M2N3P", time.Unix(ev.CreatedAt, 0))
	if err != nil || len(devs) != 2 || devs[0].Platform != "android" || devs[1].Label != "iPad balcão" {
		t.Fatalf("%+v %v", devs, err)
	}
	if _, err := VerifyDeviceList(&ev, ev.PubKey, "mer_other", time.Unix(ev.CreatedAt, 0)); err == nil {
		t.Error("accepted for another merchant")
	}
	if _, err := VerifyDeviceList(&ev, strings.Repeat("0", 64), "mer_01JB8Z2K5D6F7G8H9J0K1M2N3P", time.Unix(ev.CreatedAt, 0)); err == nil {
		t.Error("accepted from a key that is not the root")
	}
	if _, err := VerifyDeviceList(&ev, ev.PubKey, "mer_01JB8Z2K5D6F7G8H9J0K1M2N3P", time.Unix(ev.CreatedAt, 0).Add(-time.Hour)); err == nil {
		t.Error("accepted a list from more than 10 minutes in the future")
	}
}

// RFC 7638 §3.1 example thumbprint, for an RSA key, checks the canonical form; for EC the
// members are crv, kty, x, y in that order.
func TestThumbprint(t *testing.T) {
	k := JWK{Kty: "EC", Crv: "P-256", X: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU", Y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"}
	h := sha256.Sum256([]byte(`{"crv":"P-256","kty":"EC","x":"f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU","y":"x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"}`))
	if k.Thumbprint() != base64.RawURLEncoding.EncodeToString(h[:]) {
		t.Fatal("thumbprint")
	}
	if _, err := (JWK{Kty: "EC", Crv: "P-256", X: k.X, Y: k.X}).PublicKey(); err == nil {
		t.Fatal("a point off the curve was accepted")
	}
}

// SignDPoP builds a proof the way the apps do (tests and tools only).
func signDPoP(t *testing.T, key *ecdsa.PrivateKey, method, url, token, jti string, iat time.Time, typ string) string {
	t.Helper()
	pub, _ := key.PublicKey.Bytes()
	jwk := JWK{Kty: "EC", Crv: "P-256", X: base64.RawURLEncoding.EncodeToString(pub[1:33]), Y: base64.RawURLEncoding.EncodeToString(pub[33:])}
	hdr, _ := json.Marshal(map[string]any{"typ": typ, "alg": "ES256", "jwk": jwk})
	ath := sha256.Sum256([]byte(token))
	claims, _ := json.Marshal(map[string]any{"jti": jti, "htm": method, "htu": url, "iat": iat.Unix(), "ath": base64.RawURLEncoding.EncodeToString(ath[:])})
	input := base64.RawURLEncoding.EncodeToString(hdr) + "." + base64.RawURLEncoding.EncodeToString(claims)
	d := sha256.Sum256([]byte(input))
	r, s, err := ecdsa.Sign(rand.Reader, key, d[:])
	if err != nil {
		t.Fatal(err)
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return input + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func TestDPoP(t *testing.T) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	now := time.Now()
	url := "https://api.goonerspay.example/v1/payment-intents"
	p, err := VerifyDPoP(signDPoP(t, key, "POST", url, "sess_x", "j1", now, "dpop+jwt"), "POST", url, "sess_x", now)
	if err != nil || p.JTI != "j1" {
		t.Fatalf("valid proof: %v", err)
	}
	good := signDPoP(t, key, "POST", url, "sess_x", "j2", now, "dpop+jwt")
	forged := strings.Join(append(strings.Split(good, ".")[:2], strings.Split(signDPoP(t, other, "POST", url, "sess_x", "j2", now, "dpop+jwt"), ".")[2]), ".")
	for name, c := range map[string][2]string{
		"wrong method": {signDPoP(t, key, "GET", url, "sess_x", "j", now, "dpop+jwt"), "POST"},
		"wrong URL":    {signDPoP(t, key, "POST", url+"/x", "sess_x", "j", now, "dpop+jwt"), "POST"},
		"other token":  {signDPoP(t, key, "POST", url, "sess_y", "j", now, "dpop+jwt"), "POST"},
		"stale":        {signDPoP(t, key, "POST", url, "sess_x", "j", now.Add(-2*time.Minute), "dpop+jwt"), "POST"},
		"wrong typ":    {signDPoP(t, key, "POST", url, "sess_x", "j", now, "JWT"), "POST"},
		"forged":       {forged, "POST"},
		"no jti":       {signDPoP(t, key, "POST", url, "sess_x", "", now, "dpop+jwt"), "POST"},
		"not a JWS":    {"a.b", "POST"},
	} {
		if _, err := VerifyDPoP(c[0], c[1], url, "sess_x", now); !errors.Is(err, ErrUnauthorized) {
			t.Errorf("%s: %v", name, err)
		}
	}
}
