package attest

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"encoding/binary"
	"errors"
	"fmt"
	"time"
)

// oidAppAttestNonce is the credential certificate extension that holds the nonce.
var oidAppAttestNonce = asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 8, 2}

// AppAttestConfig is what an App Attest attestation is checked against.
type AppAttestConfig struct {
	// Roots holds the Apple App Attestation Root CA
	// (https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem).
	Roots *x509.CertPool
	// AppID is the team ID and bundle ID, "ABCDE12345.br.com.gooners.pay".
	AppID string
	// Production expects the production AAGUID; development builds use "appattestdevelop".
	Production bool
	Now        func() time.Time
}

// AppAttestResult is a verified attestation.
type AppAttestResult struct {
	KeyID       []byte // SHA-256 of the attested public key
	PublicKey   []byte // uncompressed P-256 point, for later assertions
	Receipt     []byte // for fraud metrics with Apple's server
	Environment string
}

var (
	aaguidDevelopment = []byte("appattestdevelop")
	aaguidProduction  = append([]byte("appattest"), make([]byte, 7)...)
)

// VerifyAppAttest follows Apple's "Validating apps that connect to your server": the
// certificate chain, the nonce over the authenticator data and the client data hash, the key
// identifier, the App ID hash, a zero counter and the environment's AAGUID.
func VerifyAppAttest(cfg AppAttestConfig, keyID, attestation, clientData []byte) (*AppAttestResult, error) {
	if cfg.Roots == nil || cfg.AppID == "" {
		return nil, errors.New("app attest: no roots or App ID configured")
	}
	obj, err := cborDecode(attestation)
	if err != nil {
		return nil, fmt.Errorf("app attest: %w", err)
	}
	m, ok := obj.(map[string]any)
	if !ok || m["fmt"] != "apple-appattest" {
		return nil, errors.New("app attest: not an apple-appattest object")
	}
	stmt, _ := m["attStmt"].(map[string]any)
	authData, _ := m["authData"].([]byte)
	x5c, _ := stmt["x5c"].([]any)
	if len(x5c) < 2 || len(authData) < 37 {
		return nil, errors.New("app attest: missing certificates or authenticator data")
	}
	certs := make([]*x509.Certificate, len(x5c))
	for i, c := range x5c {
		der, ok := c.([]byte)
		if !ok {
			return nil, errors.New("app attest: certificate is not bytes")
		}
		if certs[i], err = x509.ParseCertificate(der); err != nil {
			return nil, fmt.Errorf("app attest: certificate %d: %w", i, err)
		}
	}
	now := time.Now
	if cfg.Now != nil {
		now = cfg.Now
	}
	inter := x509.NewCertPool()
	for _, c := range certs[1:] {
		inter.AddCert(c)
	}
	if _, err := certs[0].Verify(x509.VerifyOptions{Roots: cfg.Roots, Intermediates: inter, CurrentTime: now(), KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageAny}}); err != nil {
		return nil, fmt.Errorf("app attest: certificate chain: %w", err)
	}

	cdh := sha256.Sum256(clientData)
	nonce := sha256.Sum256(append(append([]byte(nil), authData...), cdh[:]...))
	var got []byte
	for _, ext := range certs[0].Extensions {
		if ext.Id.Equal(oidAppAttestNonce) {
			var seq struct {
				Nonce []byte `asn1:"tag:1,explicit"`
			}
			if _, err := asn1.Unmarshal(ext.Value, &seq); err != nil {
				return nil, fmt.Errorf("app attest: nonce extension: %w", err)
			}
			got = seq.Nonce
		}
	}
	if !bytes.Equal(got, nonce[:]) {
		return nil, errors.New("app attest: the nonce does not cover this client data")
	}
	pub, ok := certs[0].PublicKey.(*ecdsa.PublicKey)
	if !ok || pub.Curve != elliptic.P256() {
		return nil, errors.New("app attest: the credential key is not P-256")
	}
	point, err := pub.ECDH()
	if err != nil {
		return nil, fmt.Errorf("app attest: %w", err)
	}
	raw := point.Bytes() // uncompressed 0x04 ‖ X ‖ Y
	kid := sha256.Sum256(raw)
	if !bytes.Equal(kid[:], keyID) {
		return nil, errors.New("app attest: the key identifier is not the attested key's")
	}

	rp := sha256.Sum256([]byte(cfg.AppID))
	if !bytes.Equal(authData[:32], rp[:]) {
		return nil, errors.New("app attest: attested for another App ID")
	}
	if binary.BigEndian.Uint32(authData[33:37]) != 0 {
		return nil, errors.New("app attest: the counter of a new key must be 0")
	}
	if len(authData) < 55 {
		return nil, errors.New("app attest: no attested credential data")
	}
	want, env := aaguidDevelopment, "development"
	if cfg.Production {
		want, env = aaguidProduction, "production"
	}
	if !bytes.Equal(authData[37:53], want) {
		return nil, fmt.Errorf("app attest: not a %s attestation", env)
	}
	n := int(binary.BigEndian.Uint16(authData[53:55]))
	if len(authData) < 55+n || !bytes.Equal(authData[55:55+n], keyID) {
		return nil, errors.New("app attest: the credential ID is not the key identifier")
	}
	receipt, _ := stmt["receipt"].([]byte)
	return &AppAttestResult{KeyID: kid[:], PublicKey: raw, Receipt: receipt, Environment: env}, nil
}
