// Package terminalpki issues terminals' mutual-TLS client certificates from their own CSRs
// (docs/05 §2.4): the terminal generates its key in its secure hardware and sends only the
// request; the platform decides the identity (the terminal ID it registered) and the usage
// (TLS client authentication), so nothing in the CSR but its key is trusted. The CA key signs
// from PEM files outside production, and from an AWS KMS asymmetric key in production.
package terminalpki

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"os"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/awsauth"
)

// Validity is how long a terminal certificate works: 30 days (docs/05 §2.4), so a terminal
// key that stops being attested stops working within a month. Terminals renew with a new CSR
// once a third of it is left.
const Validity = 30 * 24 * time.Hour

// CA issues terminal certificates.
type CA struct {
	Cert   *x509.Certificate
	Signer crypto.Signer
	Now    func() time.Time
}

// Issued is a terminal's certificate.
type Issued struct {
	PEM       string
	SHA256    string // hex, the terminal's registered fingerprint
	ExpiresAt time.Time
}

// ErrBadCSR is a request that cannot be signed.
var ErrBadCSR = errors.New("terminalpki: bad CSR")

// ParseCSR reads a PKCS #10 request (PEM, or base64 DER as the API carries it), checks its
// self-signature and requires a P-256 key, which every terminal's secure hardware offers.
func ParseCSR(s string) (*x509.CertificateRequest, error) {
	var der []byte
	if blk, _ := pem.Decode([]byte(s)); blk != nil {
		if blk.Type != "CERTIFICATE REQUEST" && blk.Type != "NEW CERTIFICATE REQUEST" {
			return nil, fmt.Errorf("%w: a PEM %s is not a certificate request", ErrBadCSR, blk.Type)
		}
		der = blk.Bytes
	} else {
		b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(s))
		if err != nil {
			return nil, fmt.Errorf("%w: neither PEM nor base64 DER", ErrBadCSR)
		}
		der = b
	}
	csr, err := x509.ParseCertificateRequest(der)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBadCSR, err)
	}
	if err := csr.CheckSignature(); err != nil {
		return nil, fmt.Errorf("%w: its signature does not verify", ErrBadCSR)
	}
	k, ok := csr.PublicKey.(*ecdsa.PublicKey)
	if !ok || k.Curve != elliptic.P256() {
		return nil, fmt.Errorf("%w: the key must be ECDSA P-256", ErrBadCSR)
	}
	return csr, nil
}

// Issue signs a certificate for terminalID with the CSR's key: TLS client authentication only,
// the terminal ID as common name and the merchant as organizational unit.
func (ca *CA) Issue(csr *x509.CertificateRequest, terminalID, merchantID string) (*Issued, error) {
	now := time.Now
	if ca.Now != nil {
		now = ca.Now
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 127))
	if err != nil {
		return nil, err
	}
	t := now()
	tpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: terminalID, OrganizationalUnit: []string{merchantID}, Organization: []string{"goonersPAY terminal"}},
		NotBefore:             t.Add(-5 * time.Minute),
		NotAfter:              t.Add(Validity),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, ca.Cert, csr.PublicKey, ca.Signer)
	if err != nil {
		return nil, fmt.Errorf("terminalpki: sign: %w", err)
	}
	sum := sha256.Sum256(der)
	return &Issued{PEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})), SHA256: hex.EncodeToString(sum[:]), ExpiresAt: tpl.NotAfter}, nil
}

// New checks that cert is a CA certificate for signer's key.
func New(cert *x509.Certificate, signer crypto.Signer) (*CA, error) {
	if !cert.IsCA || cert.KeyUsage&x509.KeyUsageCertSign == 0 {
		return nil, errors.New("terminalpki: the terminal CA certificate is not a CA certificate allowed to sign certificates")
	}
	pub, ok := signer.Public().(interface{ Equal(crypto.PublicKey) bool })
	if !ok || !pub.Equal(cert.PublicKey) {
		return nil, errors.New("terminalpki: the terminal CA's key is not its certificate's key")
	}
	return &CA{Cert: cert, Signer: signer}, nil
}

// TrustedBy reports an error unless the PEM bundle at path (the terminal listener's
// TERMINAL_TLS_CA) holds the CA certificate: otherwise no certificate it signs would connect.
func (ca *CA) TrustedBy(path string) error {
	b, err := os.ReadFile(path) // #nosec G304 G703 -- set by the operator
	if err != nil {
		return err
	}
	for blk, rest := pem.Decode(b); blk != nil; blk, rest = pem.Decode(rest) {
		if blk.Type == "CERTIFICATE" && bytes.Equal(blk.Bytes, ca.Cert.Raw) {
			return nil
		}
	}
	return fmt.Errorf("terminalpki: %s does not hold the terminal CA certificate: the terminal listener would refuse every certificate the CA signs", path)
}

// LoadCert reads the CA certificate (PEM).
func LoadCert(path string) (*x509.Certificate, error) {
	b, err := os.ReadFile(path) // #nosec G304 G703 -- set by the operator
	if err != nil {
		return nil, err
	}
	blk, _ := pem.Decode(b)
	if blk == nil || blk.Type != "CERTIFICATE" {
		return nil, errors.New("terminalpki: no PEM certificate in " + path)
	}
	return x509.ParseCertificate(blk.Bytes)
}

// LoadKey reads a PEM private key (sandbox and certification only).
func LoadKey(path string) (crypto.Signer, error) {
	b, err := os.ReadFile(path) // #nosec G304 G703 -- set by the operator
	if err != nil {
		return nil, err
	}
	blk, _ := pem.Decode(b)
	if blk == nil {
		return nil, errors.New("terminalpki: no PEM key in " + path)
	}
	if k, err := x509.ParsePKCS8PrivateKey(blk.Bytes); err == nil {
		if s, ok := k.(crypto.Signer); ok {
			return s, nil
		}
	}
	if k, err := x509.ParseECPrivateKey(blk.Bytes); err == nil {
		return k, nil
	}
	return nil, errors.New("terminalpki: unsupported key in " + path)
}

// KMSSigner is a crypto.Signer whose key lives in AWS KMS (an ECC_NIST_P256 key for
// SIGN_VERIFY): the CA key never leaves the KMS's HSMs, and every certificate it signs is in
// CloudTrail.
type KMSSigner struct {
	KeyID  string
	Client *awsauth.Client
	pub    crypto.PublicKey
}

// NewKMSSigner fetches the key's public half (GetPublicKey).
func NewKMSSigner(ctx context.Context, keyID string, client *awsauth.Client) (*KMSSigner, error) {
	var out struct {
		PublicKey []byte `json:"PublicKey"`
		KeySpec   string `json:"KeySpec"`
	}
	if err := client.Do(ctx, "POST", "/", map[string]string{"X-Amz-Target": "TrentService.GetPublicKey", "Content-Type": "application/x-amz-json-1.1"},
		map[string]any{"KeyId": keyID}, &out); err != nil {
		return nil, fmt.Errorf("terminalpki: kms public key: %w", err)
	}
	if out.KeySpec != "ECC_NIST_P256" {
		return nil, fmt.Errorf("terminalpki: the CA key is %s; use an ECC_NIST_P256 signing key", out.KeySpec)
	}
	pub, err := x509.ParsePKIXPublicKey(out.PublicKey)
	if err != nil {
		return nil, err
	}
	return &KMSSigner{KeyID: keyID, Client: client, pub: pub}, nil
}

// NewAWSKMSSigner uses the environment's credentials in region.
func NewAWSKMSSigner(ctx context.Context, keyID, region string) (*KMSSigner, error) {
	return NewKMSSigner(ctx, keyID, &awsauth.Client{Service: "kms", Region: region, Endpoint: "https://kms." + region + ".amazonaws.com", Credentials: awsauth.FromEnvironment()})
}

// Public implements crypto.Signer.
func (k *KMSSigner) Public() crypto.PublicKey { return k.pub }

// Sign implements crypto.Signer: digest is the SHA-256 of what is signed; KMS returns the
// ASN.1 DER ECDSA signature x509 expects.
func (k *KMSSigner) Sign(_ io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
	if opts.HashFunc() != crypto.SHA256 {
		return nil, errors.New("terminalpki: the KMS key signs SHA-256 digests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var out struct {
		Signature []byte `json:"Signature"`
	}
	err := k.Client.Do(ctx, "POST", "/", map[string]string{"X-Amz-Target": "TrentService.Sign", "Content-Type": "application/x-amz-json-1.1"},
		map[string]any{"KeyId": k.KeyID, "Message": digest, "MessageType": "DIGEST", "SigningAlgorithm": "ECDSA_SHA_256"}, &out)
	if err != nil {
		return nil, fmt.Errorf("terminalpki: kms sign: %w", err)
	}
	return out.Signature, nil
}
