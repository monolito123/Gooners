package terminalpki

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"context"

	"github.com/monolito123/Gooners/payments/platform/internal/awsauth"
	"github.com/monolito123/Gooners/payments/platform/internal/testpki"
)

func csrFor(t *testing.T, key crypto.Signer, cn string) string {
	t.Helper()
	der, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: cn}}, key)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(der)
}

// A terminal's CSR becomes a client certificate the terminal CA vouches for, naming the
// terminal the platform registered, whatever the CSR asked for.
func TestIssueFromCSR(t *testing.T) {
	ca, _ := testpki.NewCA("terminal CA")
	issuer := &CA{Cert: ca.Cert, Signer: ca.Key}
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	csr, err := ParseCSR(csrFor(t, key, "ADMIN please"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := issuer.Issue(csr, "TA1B2C3D", "mer_1")
	if err != nil {
		t.Fatal(err)
	}
	blk, _ := pem.Decode([]byte(got.PEM))
	cert, _ := x509.ParseCertificate(blk.Bytes)
	if cert.Subject.CommonName != "TA1B2C3D" || cert.Subject.OrganizationalUnit[0] != "mer_1" || len(cert.ExtKeyUsage) != 1 || cert.ExtKeyUsage[0] != x509.ExtKeyUsageClientAuth || cert.IsCA {
		t.Fatalf("certificate: %+v", cert.Subject)
	}
	if _, err := cert.Verify(x509.VerifyOptions{Roots: ca.Pool(), KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}); err != nil {
		t.Fatal(err)
	}
	if !cert.PublicKey.(*ecdsa.PublicKey).Equal(&key.PublicKey) {
		t.Fatal("not the CSR's key")
	}
	// PEM works too; RSA, a forged signature and garbage do not.
	pemCSR := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: func() []byte { b, _ := base64.StdEncoding.DecodeString(csrFor(t, key, "x")); return b }()}))
	if _, err := ParseCSR(pemCSR); err != nil {
		t.Fatal(err)
	}
	rk, _ := rsa.GenerateKey(rand.Reader, 2048)
	if _, err := ParseCSR(csrFor(t, rk, "x")); err == nil || !strings.Contains(err.Error(), "P-256") {
		t.Fatalf("an RSA key: %v", err)
	}
	der, _ := base64.StdEncoding.DecodeString(csrFor(t, key, "x"))
	der[len(der)-3] ^= 1
	if _, err := ParseCSR(base64.StdEncoding.EncodeToString(der)); err == nil {
		t.Fatal("a CSR with a broken signature accepted")
	}
	if _, err := ParseCSR("not a csr"); err == nil {
		t.Fatal("garbage accepted")
	}
}

// The CA key in KMS: GetPublicKey, then Sign over the certificate's digest.
func TestKMSSigner(t *testing.T) {
	caKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	spki, _ := x509.MarshalPKIXPublicKey(&caKey.PublicKey)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Authorization"), "/sa-east-1/kms/aws4_request") {
			w.WriteHeader(403)
			return
		}
		var in struct {
			KeyID            string `json:"KeyId"`
			Message          []byte
			MessageType      string
			SigningAlgorithm string
		}
		json.NewDecoder(r.Body).Decode(&in)
		switch r.Header.Get("X-Amz-Target") {
		case "TrentService.GetPublicKey":
			json.NewEncoder(w).Encode(map[string]any{"KeyId": in.KeyID, "PublicKey": spki, "KeySpec": "ECC_NIST_P256"})
		case "TrentService.Sign":
			if in.MessageType != "DIGEST" || in.SigningAlgorithm != "ECDSA_SHA_256" || len(in.Message) != 32 {
				w.WriteHeader(400)
				return
			}
			sig, _ := ecdsa.SignASN1(rand.Reader, caKey, in.Message)
			json.NewEncoder(w).Encode(map[string]any{"Signature": sig})
		}
	}))
	defer srv.Close()
	signer, err := NewKMSSigner(context.Background(), "alias/terminal-ca", &awsauth.Client{Service: "kms", Region: "sa-east-1", Endpoint: srv.URL, Credentials: awsauth.Static{AccessKeyID: "AK", SecretAccessKey: "s"}})
	if err != nil {
		t.Fatal(err)
	}
	// A self-signed CA certificate made through the KMS signer, then a terminal certificate.
	caDER, err := x509.CreateCertificate(rand.Reader, &x509.Certificate{SerialNumber: bigOne(), Subject: pkix.Name{CommonName: "KMS terminal CA"}, IsCA: true,
		BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign, NotBefore: nowMinus(), NotAfter: nowPlus()}, &x509.Certificate{Subject: pkix.Name{CommonName: "KMS terminal CA"}}, signer.Public(), signer)
	if err != nil {
		t.Fatal(err)
	}
	caCert, _ := x509.ParseCertificate(caDER)
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	csr, _ := ParseCSR(csrFor(t, key, "t"))
	got, err := (&CA{Cert: caCert, Signer: signer}).Issue(csr, "TKMS0001", "mer_1")
	if err != nil {
		t.Fatal(err)
	}
	blk, _ := pem.Decode([]byte(got.PEM))
	cert, _ := x509.ParseCertificate(blk.Bytes)
	pool := x509.NewCertPool()
	pool.AddCert(caCert)
	if _, err := cert.Verify(x509.VerifyOptions{Roots: pool, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}); err != nil {
		t.Fatalf("a certificate signed through KMS does not verify: %v", err)
	}
}

func bigOne() *big.Int    { return big.NewInt(1) }
func nowMinus() time.Time { return time.Now().Add(-time.Hour) }
func nowPlus() time.Time  { return time.Now().Add(24 * time.Hour) }

// The CA's key must be its certificate's, the certificate a CA's, and the terminal listener's
// CA bundle must hold it.
func TestCAChecks(t *testing.T) {
	ca, _ := testpki.NewCA("terminal CA")
	other, _ := testpki.NewCA("another CA")
	if _, err := New(ca.Cert, ca.Key); err != nil {
		t.Fatal(err)
	}
	if _, err := New(ca.Cert, other.Key); err == nil {
		t.Fatal("another key accepted")
	}
	leaf, _ := ca.Client("not a CA")
	if _, err := New(leaf.TLS.Leaf, leaf.TLS.PrivateKey.(crypto.Signer)); err == nil {
		t.Fatal("a leaf certificate accepted as the CA")
	}
	dir := t.TempDir()
	bundle, alone := filepath.Join(dir, "bundle.pem"), filepath.Join(dir, "other.pem")
	_ = os.WriteFile(bundle, append(append([]byte{}, other.PEM...), ca.PEM...), 0o600)
	_ = os.WriteFile(alone, other.PEM, 0o600)
	issuer := &CA{Cert: ca.Cert, Signer: ca.Key}
	if err := issuer.TrustedBy(bundle); err != nil {
		t.Fatal(err)
	}
	if err := issuer.TrustedBy(alone); err == nil {
		t.Fatal("a bundle without the CA accepted")
	}
}
