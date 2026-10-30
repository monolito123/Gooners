package mobileauth

import (
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// This file is the client side of the protocol, as the apps implement it. The platform uses
// it in tests and tools; the apps have their own implementations, checked against the same
// rules by these tests.

// PublicJWK returns the JWK of a P-256 key.
func PublicJWK(key *ecdsa.PrivateKey) JWK {
	b, _ := key.PublicKey.Bytes() // 0x04 || X || Y
	return JWK{Kty: "EC", Crv: "P-256", X: base64.RawURLEncoding.EncodeToString(b[1:33]), Y: base64.RawURLEncoding.EncodeToString(b[33:])}
}

// SignDPoP builds a DPoP proof for a request, with ath when accessToken is not empty.
func SignDPoP(key *ecdsa.PrivateKey, method, url, accessToken string, now time.Time) (string, error) {
	hdr, _ := json.Marshal(map[string]any{"typ": "dpop+jwt", "alg": "ES256", "jwk": PublicJWK(key)})
	jti := make([]byte, 16)
	if _, err := rand.Read(jti); err != nil {
		return "", err
	}
	claims := map[string]any{"jti": base64.RawURLEncoding.EncodeToString(jti), "htm": method, "htu": url, "iat": now.Unix()}
	if accessToken != "" {
		h := sha256.Sum256([]byte(accessToken))
		claims["ath"] = base64.RawURLEncoding.EncodeToString(h[:])
	}
	cb, _ := json.Marshal(claims)
	input := base64.RawURLEncoding.EncodeToString(hdr) + "." + base64.RawURLEncoding.EncodeToString(cb)
	d := sha256.Sum256([]byte(input))
	r, s, err := ecdsa.Sign(rand.Reader, key, d[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return input + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// SignNIP98 returns the Authorization header value for a request signed by a device key.
func SignNIP98(keys nostr.Keys, method, url string, body []byte, now time.Time) (string, error) {
	sum := sha256.Sum256(body)
	ev := &nostr.Event{CreatedAt: now.Unix(), Kind: KindHTTPAuth, Content: "",
		Tags: [][]string{{"u", url}, {"method", method}, {"payload", hex.EncodeToString(sum[:])}}}
	if err := ev.Sign(keys, nil); err != nil {
		return "", err
	}
	b, err := json.Marshal(ev)
	if err != nil {
		return "", err
	}
	return "Nostr " + base64.StdEncoding.EncodeToString(b), nil
}
