package attest_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"strings"
	"testing"

	"github.com/monolito123/Gooners/payments/platform/internal/attest"
	"github.com/monolito123/Gooners/payments/platform/internal/attest/attesttest"
)

const app = "ABCDE12345.br.com.gooners.pay"

func TestAppAttest(t *testing.T) {
	client := []byte("e0c2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2")
	att, kid, roots, err := attesttest.AppAttestObject(attesttest.AppAttest{AppID: app, ClientData: client})
	if err != nil {
		t.Fatal(err)
	}
	res, err := attest.VerifyAppAttest(attest.AppAttestConfig{Roots: roots, AppID: app}, kid, att, client)
	if err != nil || res.Environment != "development" || string(res.Receipt) != "receipt" || len(res.PublicKey) != 65 {
		t.Fatalf("a good attestation: %v %+v", err, res)
	}
	flip := func(k []byte) []byte { k = append([]byte{}, k...); k[0] ^= 1; return k }
	for name, tc := range map[string]struct {
		a      attesttest.AppAttest
		cfg    func(*attest.AppAttestConfig)
		client []byte
		kid    func([]byte) []byte
		want   string
	}{
		"another app":           {a: attesttest.AppAttest{AppID: "ZZZZZ99999.evil.app", ClientData: client}, want: "App ID"},
		"used key (counter 1)":  {a: attesttest.AppAttest{AppID: app, ClientData: client, Counter: 1}, want: "counter"},
		"development in prod":   {a: attesttest.AppAttest{AppID: app, ClientData: client}, cfg: func(c *attest.AppAttestConfig) { c.Production = true }, want: "production"},
		"other client data":     {a: attesttest.AppAttest{AppID: app, ClientData: client}, client: []byte("another device key"), want: "nonce"},
		"another key id":        {a: attesttest.AppAttest{AppID: app, ClientData: client}, kid: flip, want: "key identifier"},
		"credential id differs": {a: attesttest.AppAttest{AppID: app, ClientData: client, CredentialID: make([]byte, 32)}, want: "credential ID"},
		"untrusted root":        {a: attesttest.AppAttest{AppID: app, ClientData: client}, cfg: func(c *attest.AppAttestConfig) { c.Roots = x509.NewCertPool() }, want: "chain"},
	} {
		a, k, r, err := attesttest.AppAttestObject(tc.a)
		if err != nil {
			t.Fatal(err)
		}
		cfg := attest.AppAttestConfig{Roots: r, AppID: app}
		if tc.cfg != nil {
			tc.cfg(&cfg)
		}
		cd := client
		if tc.client != nil {
			cd = tc.client
		}
		if tc.kid != nil {
			k = tc.kid(k)
		}
		if _, err := attest.VerifyAppAttest(cfg, k, a, cd); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v (want an error about %q)", name, err, tc.want)
		}
	}
	if _, err := attest.VerifyAppAttest(attest.AppAttestConfig{Roots: roots, AppID: app}, kid, att[:len(att)-5], client); err == nil {
		t.Error("a truncated attestation object was accepted")
	}
}

func TestKeyAttestation(t *testing.T) {
	digest := sha256.Sum256([]byte("play app signing certificate"))
	other := sha256.Sum256([]byte("someone else's certificate"))
	challenge := attest.Challenge("e0c2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2")
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	cfgFor := func(p attesttest.PKI) attest.KeyAttestationConfig {
		return attest.KeyAttestationConfig{Roots: p.Roots, PackageName: "br.com.gooners.pay", SigningDigests: [][]byte{digest[:]}}
	}
	p, err := attesttest.AndroidChain(key, attesttest.Genuine(challenge, "br.com.gooners.pay", digest[:]))
	if err != nil {
		t.Fatal(err)
	}
	res, err := attest.VerifyKeyAttestation(cfgFor(p), p.Chain, challenge)
	if err != nil || res.SecurityLevel != "strongbox" || !res.DeviceLocked || res.JWKX == "" {
		t.Fatalf("a good attestation: %v %+v", err, res)
	}
	mod := func(f func(*attesttest.Android)) attesttest.Android {
		a := attesttest.Genuine(challenge, "br.com.gooners.pay", digest[:])
		f(&a)
		return a
	}
	for name, tc := range map[string]struct {
		a    attesttest.Android
		want string
	}{
		"software key":        {mod(func(a *attesttest.Android) { a.SecurityLevel = attest.SecuritySoftware }), "secure hardware"},
		"unlocked bootloader": {mod(func(a *attesttest.Android) { a.Locked = false }), "bootloader"},
		"unverified boot":     {mod(func(a *attesttest.Android) { a.BootState = 2 }), "bootloader"},
		"another app":         {mod(func(a *attesttest.Android) { a.Package = "com.evil.clone" }), "another app"},
		"re-signed app":       {mod(func(a *attesttest.Android) { a.SigningDigest = other[:] }), "signed"},
		"another device":      {mod(func(a *attesttest.Android) { a.Challenge = attest.Challenge("another device") }), "challenge"},
	} {
		q, err := attesttest.AndroidChain(key, tc.a)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := attest.VerifyKeyAttestation(cfgFor(q), q.Chain, challenge); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v (want an error about %q)", name, err, tc.want)
		}
	}
	if _, err := attest.VerifyKeyAttestation(attest.KeyAttestationConfig{Roots: x509.NewCertPool(), PackageName: "br.com.gooners.pay", SigningDigests: [][]byte{digest[:]}}, p.Chain, challenge); err == nil {
		t.Error("an untrusted root was accepted")
	}
	if _, err := attest.VerifyKeyAttestation(cfgFor(p), p.Chain[:1], challenge); err == nil {
		t.Error("a chain without its issuer was accepted")
	}
}
