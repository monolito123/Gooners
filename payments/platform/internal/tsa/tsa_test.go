package tsa

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/asn1"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/tsa/tsatest"
)

// Tokens three public authorities issued on 2026-11-08 over SHA-256("goonerspay root"):
// RSA with SHA-256 (DigiCert), and the others' algorithms and certificate layouts.
func TestRealTokens(t *testing.T) {
	digest := sha256.Sum256([]byte("goonerspay root"))
	for _, name := range []string{"digicert", "sectigo", "freetsa"} {
		body, err := os.ReadFile("testdata/" + name + ".tsr")
		if err != nil {
			t.Fatal(err)
		}
		der, err := ParseResponse(body)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		tok, err := Verify(der, digest[:], nil)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if tok.Time.Year() != 2026 || tok.Signer == nil || tok.Serial == nil || tok.Trusted {
			t.Fatalf("%s: %+v", name, tok)
		}
		t.Logf("%s: %s by %s", name, tok.Time.Format(time.RFC3339), tok.Signer.Subject.CommonName)
		// Another digest, or a flipped byte anywhere, and the token says nothing.
		other := sha256.Sum256([]byte("another root"))
		if _, err := Verify(der, other[:], nil); err == nil {
			t.Errorf("%s: verified for another digest", name)
		}
		// A flipped byte in what the authority signed: the stamp (TSTInfo), the signed
		// attributes, the signature. (The certificate bag is not signed by the token; the
		// chain to the roots vouches for it.)
		var ci contentInfo
		_, _ = asn1.Unmarshal(der, &ci)
		var sd signedData
		_, _ = asn1.Unmarshal(ci.Content.Bytes, &sd)
		var content []byte
		_, _ = asn1.Unmarshal(sd.EncapContentInfo.EContent.Bytes, &content)
		si := sd.SignerInfos[0]
		for part, at := range map[string]int{
			"the stamp":             bytes.Index(der, content) + len(content)/2,
			"the signed attributes": bytes.Index(der, si.SignedAttrs.FullBytes) + len(si.SignedAttrs.FullBytes) - 3,
			"the signature":         bytes.Index(der, si.Signature) + len(si.Signature)/2,
		} {
			bad := append([]byte{}, der...)
			bad[at] ^= 0x01
			if _, err := Verify(bad, digest[:], nil); err == nil {
				t.Errorf("%s: a token with %s changed verified", name, part)
			}
		}
	}
	if _, err := ParseResponse([]byte("<html>")); err == nil || !strings.Contains(err.Error(), "TimeStampResp") {
		t.Fatalf("garbage: %v", err)
	}
}

// A round trip with an authority: the request's digest and nonce come back signed; with the
// authority's root the token is trusted, with another root it is refused.
func TestStamp(t *testing.T) {
	a := tsatest.New()
	defer a.Close()
	digest := sha256.Sum256([]byte("a daily root"))
	tok, err := (&Client{URL: a.URL, Roots: a.Roots()}).Stamp(context.Background(), digest[:])
	if err != nil {
		t.Fatal(err)
	}
	if !tok.Trusted || time.Since(tok.Time) > time.Minute || tok.Signer.Subject.CommonName != "Test Time Stamping Authority" {
		t.Fatalf("%+v", tok)
	}
	if _, err := Verify(tok.DER, digest[:], a.Roots()); err != nil {
		t.Fatal(err)
	}
	other := tsatest.New()
	defer other.Close()
	if _, err := Verify(tok.DER, digest[:], other.Roots()); err == nil || !strings.Contains(err.Error(), "trusted roots") {
		t.Fatalf("another authority's root: %v", err)
	}
	if _, err := (&Client{URL: a.URL}).Stamp(context.Background(), digest[:5]); err == nil {
		t.Fatal("a digest that is not a SHA-256")
	}
	a.Down.Store(true)
	if _, err := (&Client{URL: a.URL}).Stamp(context.Background(), digest[:]); err == nil || !strings.Contains(err.Error(), "503") {
		t.Fatalf("an authority down: %v", err)
	}
}
