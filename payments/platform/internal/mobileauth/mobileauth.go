// Package mobileauth verifies how the merchant apps authenticate (docs/02 §3.2, docs/03 §4):
// a NIP-98 login event (kind 27235) signed by the device's Nostr key, exchanged for a
// session token bound to a P-256 key held in the phone's secure hardware, which then signs
// a DPoP proof (RFC 9449) for every request. A stolen session token is useless without
// that key, and the key never leaves the Keystore / Secure Enclave.
package mobileauth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// KindHTTPAuth is NIP-98's event kind.
const KindHTTPAuth = 27235

// MaxSkew is how far a login event's created_at or a DPoP proof's iat may be from now.
const MaxSkew = 60 * time.Second

// ErrUnauthorized wraps every verification failure; the detail says which check failed.
var ErrUnauthorized = errors.New("unauthorized")

func fail(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrUnauthorized, fmt.Sprintf(format, a...))
}

// VerifyNIP98 checks an "Authorization: Nostr <base64 event>" header for a request, in the
// order of docs/02 §3.2: signature, kind, created_at within ±60 s, the u and method tags,
// and the payload tag against the SHA-256 of the exact body. Replay (the event ID) and the
// device binding are the caller's checks.
func VerifyNIP98(header, method, url string, body []byte, now time.Time) (*nostr.Event, error) {
	raw, ok := strings.CutPrefix(header, "Nostr ")
	if !ok {
		return nil, fail("expected Authorization: Nostr <event>")
	}
	js, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fail("the event is not base64")
	}
	var ev nostr.Event
	if err := json.Unmarshal(js, &ev); err != nil {
		return nil, fail("the event is not JSON")
	}
	if err := ev.Verify(); err != nil {
		return nil, fail("%v", err)
	}
	if ev.Kind != KindHTTPAuth {
		return nil, fail("kind %d, want %d", ev.Kind, KindHTTPAuth)
	}
	if d := now.Sub(time.Unix(ev.CreatedAt, 0)); d > MaxSkew || d < -MaxSkew {
		return nil, fail("created_at is %s from now", d.Round(time.Second))
	}
	if t := ev.Tag("u"); len(t) < 2 || t[1] != url {
		return nil, fail("u tag does not match %s", url)
	}
	if t := ev.Tag("method"); len(t) < 2 || !strings.EqualFold(t[1], method) {
		return nil, fail("method tag does not match %s", method)
	}
	sum := sha256.Sum256(body)
	if t := ev.Tag("payload"); len(t) < 2 || t[1] != hex.EncodeToString(sum[:]) {
		return nil, fail("payload tag is not the SHA-256 of the body")
	}
	return &ev, nil
}

// JWK is a P-256 public key in JSON Web Key form.
type JWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

// PublicKey checks the key is a point on P-256 and returns it.
func (k JWK) PublicKey() (*ecdsa.PublicKey, error) {
	if k.Kty != "EC" || k.Crv != "P-256" {
		return nil, fail("the key must be an EC P-256 JWK")
	}
	x, err1 := base64.RawURLEncoding.DecodeString(k.X)
	y, err2 := base64.RawURLEncoding.DecodeString(k.Y)
	if err1 != nil || err2 != nil || len(x) != 32 || len(y) != 32 {
		return nil, fail("x and y must be 32-byte base64url values")
	}
	pub, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), append(append([]byte{4}, x...), y...))
	if err != nil {
		return nil, fail("the key is not a point on P-256")
	}
	return pub, nil
}

// Thumbprint is the RFC 7638 SHA-256 thumbprint, base64url: what a session is bound to.
func (k JWK) Thumbprint() string {
	canon := `{"crv":"` + k.Crv + `","kty":"` + k.Kty + `","x":"` + k.X + `","y":"` + k.Y + `"}`
	h := sha256.Sum256([]byte(canon))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// Proof is a verified DPoP proof.
type Proof struct {
	JKT string // thumbprint of the proof's key
	JTI string // unique ID, to be refused if seen again
	IAT time.Time
}

// VerifyDPoP checks a DPoP proof JWT (RFC 9449 §4.3) for a request: typ dpop+jwt, alg
// ES256 with the public key in the header, a valid signature, htm and htu matching the
// request (htu without query or fragment), iat within ±60 s, a jti, and, when accessToken is
// not empty, ath = base64url(SHA-256(accessToken)).
func VerifyDPoP(proof, method, url, accessToken string, now time.Time) (*Proof, error) {
	parts := strings.Split(proof, ".")
	if len(parts) != 3 {
		return nil, fail("the DPoP proof is not a compact JWS")
	}
	var hdr struct {
		Typ string `json:"typ"`
		Alg string `json:"alg"`
		JWK JWK    `json:"jwk"`
	}
	var claims struct {
		JTI string `json:"jti"`
		HTM string `json:"htm"`
		HTU string `json:"htu"`
		IAT int64  `json:"iat"`
		ATH string `json:"ath"`
	}
	if err := decodeSegment(parts[0], &hdr); err != nil {
		return nil, err
	}
	if hdr.Typ != "dpop+jwt" || hdr.Alg != "ES256" {
		return nil, fail("the DPoP proof must be typ dpop+jwt with alg ES256")
	}
	pub, err := hdr.JWK.PublicKey()
	if err != nil {
		return nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(sig) != 64 {
		return nil, fail("the DPoP signature must be 64 bytes (r||s)")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(pub, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		return nil, fail("the DPoP signature does not verify")
	}
	if err := decodeSegment(parts[1], &claims); err != nil {
		return nil, err
	}
	if claims.JTI == "" || len(claims.JTI) > 128 {
		return nil, fail("the DPoP proof needs a jti")
	}
	if claims.HTM != method {
		return nil, fail("htm %q does not match %s", claims.HTM, method)
	}
	if claims.HTU != url {
		return nil, fail("htu %q does not match %s", claims.HTU, url)
	}
	iat := time.Unix(claims.IAT, 0)
	if d := now.Sub(iat); d > MaxSkew || d < -MaxSkew {
		return nil, fail("iat is %s from now", d.Round(time.Second))
	}
	if accessToken != "" {
		h := sha256.Sum256([]byte(accessToken))
		if claims.ATH != base64.RawURLEncoding.EncodeToString(h[:]) {
			return nil, fail("ath does not match the access token")
		}
	}
	return &Proof{JKT: hdr.JWK.Thumbprint(), JTI: claims.JTI, IAT: iat}, nil
}

func decodeSegment(seg string, v any) error {
	b, err := base64.RawURLEncoding.DecodeString(seg)
	if err != nil {
		return fail("a DPoP segment is not base64url")
	}
	dec := json.NewDecoder(strings.NewReader(string(b)))
	if err := dec.Decode(v); err != nil {
		return fail("a DPoP segment is not JSON")
	}
	return nil
}

// DeviceTag is one ["device", pubkey, platform, label, since] tag of a kind 17710 event.
type DeviceTag struct {
	PubKey, Platform, Label string
}

// MaxDevices per merchant (docs/03 §4.2).
const MaxDevices = 20

// KindDeviceAuthorization is the merchant root key's device list.
const KindDeviceAuthorization = 17710

// VerifyDeviceList checks a kind 17710 event: signed by rootPub for merchantID, not more than
// 10 minutes in the future, at most 20 devices, well-formed device tags. Ordering against the
// list the platform already holds is the caller's check.
func VerifyDeviceList(ev *nostr.Event, rootPub, merchantID string, now time.Time) ([]DeviceTag, error) {
	if err := ev.Verify(); err != nil {
		return nil, fail("%v", err)
	}
	if ev.Kind != KindDeviceAuthorization {
		return nil, fail("kind %d, want %d", ev.Kind, KindDeviceAuthorization)
	}
	if ev.PubKey != rootPub {
		return nil, fail("the device list must be signed by the merchant's root key")
	}
	if t := ev.Tag("merchant"); len(t) < 2 || t[1] != merchantID {
		return nil, fail("the merchant tag does not name %s", merchantID)
	}
	if time.Unix(ev.CreatedAt, 0).After(now.Add(10 * time.Minute)) {
		return nil, fail("created_at is more than 10 minutes in the future")
	}
	var out []DeviceTag
	seen := map[string]bool{}
	for _, t := range ev.Tags {
		if len(t) == 0 || t[0] != "device" {
			continue
		}
		if len(t) != 5 || len(t[1]) != 64 || seen[t[1]] || len(t[3]) > 40 {
			return nil, fail("malformed device tag")
		}
		if _, err := hex.DecodeString(t[1]); err != nil {
			return nil, fail("malformed device key")
		}
		switch t[2] {
		case "android", "ios", "web":
		default:
			return nil, fail("device platform %q", t[2])
		}
		seen[t[1]] = true
		out = append(out, DeviceTag{PubKey: t[1], Platform: t[2], Label: t[3]})
	}
	if len(out) == 0 || len(out) > MaxDevices {
		return nil, fail("a device list holds 1 to %d devices", MaxDevices)
	}
	return out, nil
}
