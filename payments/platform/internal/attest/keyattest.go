package attest

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"encoding/base64"
	"errors"
	"fmt"
	"time"
)

// oidKeyDescription is Android's key attestation extension.
var oidKeyDescription = asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 11129, 2, 1, 17}

// Security levels and boot states of the KeyDescription schema.
const (
	SecuritySoftware  = 0
	SecurityTEE       = 1
	SecurityStrongBox = 2
	bootVerified      = 0
	tagRootOfTrust    = 704
	tagApplicationID  = 709
)

// KeyAttestationConfig is what an Android key attestation is checked against.
type KeyAttestationConfig struct {
	// Roots holds Google's hardware attestation root certificates
	// (https://developer.android.com/privacy-and-security/security-key-attestation#root_certificate).
	Roots *x509.CertPool
	// PackageName is the app's application ID, br.com.gooners.pay.
	PackageName string
	// SigningDigests are the SHA-256 digests of the app's signing certificates (Play App Signing).
	SigningDigests [][]byte
	// Revocations returns the current certificate status list; nil skips the check. An error
	// (no list, a stale list) refuses the attestation: the check fails closed.
	Revocations func() (*RevocationList, error)
	Now         func() time.Time
}

// KeyAttestationResult is a verified attestation of a key held in secure hardware.
type KeyAttestationResult struct {
	SecurityLevel string // trusted_environment or strongbox
	DeviceLocked  bool
	BootState     string
	PackageName   string
	JWKX, JWKY    string // the attested P-256 key, base64url
}

type keyDescription struct {
	AttestationVersion       int
	AttestationSecurityLevel asn1.Enumerated
	KeymasterVersion         int
	KeymasterSecurityLevel   asn1.Enumerated
	AttestationChallenge     []byte
	UniqueID                 []byte
	SoftwareEnforced         asn1.RawValue
	HardwareEnforced         asn1.RawValue
}

type rootOfTrust struct {
	VerifiedBootKey   []byte
	DeviceLocked      bool
	VerifiedBootState asn1.Enumerated
	VerifiedBootHash  []byte `asn1:"optional"`
}

type packageInfo struct {
	Name    []byte
	Version int64
}

type applicationID struct {
	Packages         []packageInfo `asn1:"set"`
	SignatureDigests [][]byte      `asn1:"set"`
}

// authorization finds one explicitly tagged entry of an AuthorizationList.
func authorization(list asn1.RawValue, tag int) ([]byte, bool) {
	rest := list.Bytes
	for len(rest) > 0 {
		var item asn1.RawValue
		var err error
		if rest, err = asn1.Unmarshal(rest, &item); err != nil {
			return nil, false
		}
		if item.Class == asn1.ClassContextSpecific && item.Tag == tag {
			return item.Bytes, true
		}
	}
	return nil, false
}

// VerifyKeyAttestation checks the certificate chain of a key generated in the Android
// Keystore with challenge: a Google root, hardware residence (TEE or StrongBox), a locked
// bootloader with verified boot, and this app's package and signing certificate.
func VerifyKeyAttestation(cfg KeyAttestationConfig, chain [][]byte, challenge []byte) (*KeyAttestationResult, error) {
	if cfg.Roots == nil || cfg.PackageName == "" || len(cfg.SigningDigests) == 0 {
		return nil, errors.New("key attestation: roots, package name and signing digests must be configured")
	}
	if len(chain) < 2 {
		return nil, errors.New("key attestation: the chain needs the leaf and its issuers")
	}
	certs := make([]*x509.Certificate, len(chain))
	for i, der := range chain {
		c, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, fmt.Errorf("key attestation: certificate %d: %w", i, err)
		}
		certs[i] = c
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
		return nil, fmt.Errorf("key attestation: certificate chain: %w", err)
	}
	if cfg.Revocations != nil {
		l, err := cfg.Revocations()
		if err != nil {
			return nil, fmt.Errorf("key attestation: certificate status unknown: %w", err)
		}
		if err := l.Check(certs); err != nil {
			return nil, fmt.Errorf("key attestation: %w", err)
		}
	}

	var ext []byte
	for _, e := range certs[0].Extensions {
		if e.Id.Equal(oidKeyDescription) {
			ext = e.Value
		}
	}
	if ext == nil {
		return nil, errors.New("key attestation: the leaf has no key description")
	}
	var kd keyDescription
	if _, err := asn1.Unmarshal(ext, &kd); err != nil {
		return nil, fmt.Errorf("key attestation: key description: %w", err)
	}
	if !bytes.Equal(kd.AttestationChallenge, challenge) {
		return nil, errors.New("key attestation: the challenge is not this device's")
	}
	res := &KeyAttestationResult{}
	switch kd.KeymasterSecurityLevel {
	case SecurityTEE:
		res.SecurityLevel = "trusted_environment"
	case SecurityStrongBox:
		res.SecurityLevel = "strongbox"
	default:
		return nil, errors.New("key attestation: the key is not in secure hardware")
	}
	if kd.AttestationSecurityLevel == SecuritySoftware {
		return nil, errors.New("key attestation: the attestation itself is software")
	}

	raw, ok := authorization(kd.HardwareEnforced, tagRootOfTrust)
	if !ok {
		return nil, errors.New("key attestation: no hardware root of trust")
	}
	var rot rootOfTrust
	if _, err := asn1.Unmarshal(raw, &rot); err != nil {
		return nil, fmt.Errorf("key attestation: root of trust: %w", err)
	}
	if rot.VerifiedBootState != bootVerified || !rot.DeviceLocked {
		return nil, errors.New("key attestation: the bootloader is unlocked or boot is not verified")
	}
	res.DeviceLocked, res.BootState = true, "verified"

	raw, ok = authorization(kd.SoftwareEnforced, tagApplicationID)
	if !ok {
		return nil, errors.New("key attestation: no application ID")
	}
	var appRaw []byte
	if _, err := asn1.Unmarshal(raw, &appRaw); err != nil {
		return nil, fmt.Errorf("key attestation: application ID: %w", err)
	}
	var app applicationID
	if _, err := asn1.Unmarshal(appRaw, &app); err != nil {
		return nil, fmt.Errorf("key attestation: application ID: %w", err)
	}
	for _, p := range app.Packages {
		if string(p.Name) == cfg.PackageName {
			res.PackageName = cfg.PackageName
		}
	}
	if res.PackageName == "" {
		return nil, errors.New("key attestation: the key belongs to another app")
	}
	signed := false
	for _, d := range app.SignatureDigests {
		for _, want := range cfg.SigningDigests {
			signed = signed || bytes.Equal(d, want)
		}
	}
	if !signed {
		return nil, errors.New("key attestation: the app is not signed with the configured certificate")
	}

	pub, ok := certs[0].PublicKey.(*ecdsa.PublicKey)
	if !ok || pub.Curve != elliptic.P256() {
		return nil, errors.New("key attestation: the attested key is not P-256")
	}
	point, err := pub.ECDH()
	if err != nil {
		return nil, err
	}
	b := point.Bytes()
	res.JWKX, res.JWKY = base64.RawURLEncoding.EncodeToString(b[1:33]), base64.RawURLEncoding.EncodeToString(b[33:])
	return res, nil
}

// Challenge is what the app passes to setAttestationChallenge: it binds the attested key to
// the device's Nostr key.
func Challenge(devicePubHex string) []byte {
	h := sha256.Sum256([]byte("goonerspay/v1/key-attestation:" + devicePubHex))
	return h[:]
}
