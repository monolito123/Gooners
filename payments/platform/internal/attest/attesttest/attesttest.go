// Package attesttest builds attestation evidence signed by a throwaway PKI, for tests of the
// verifiers and of the platform with strict attestation. Nothing here is valid against
// Apple's or Google's real roots.
package attesttest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/binary"
	"math/big"
	"time"
)

// PKI is a root and the chain (leaf first) it issued.
type PKI struct {
	Roots *x509.CertPool
	Chain [][]byte
}

// CA is a throwaway root and intermediate that issue attested leaves.
type CA struct {
	Roots    *x509.CertPool
	inter    *x509.Certificate
	interKey *ecdsa.PrivateKey
}

// NewCA makes a root and an intermediate valid for a day.
func NewCA() (*CA, error) {
	now := time.Now()
	ca := func(serial int64, name string) *x509.Certificate {
		return &x509.Certificate{SerialNumber: big.NewInt(serial), Subject: pkix.Name{CommonName: name}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour),
			IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	}
	rootKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	rootT := ca(1, "Test Attestation Root")
	rootDER, err := x509.CreateCertificate(rand.Reader, rootT, rootT, &rootKey.PublicKey, rootKey)
	if err != nil {
		return nil, err
	}
	root, _ := x509.ParseCertificate(rootDER)
	interKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	interDER, err := x509.CreateCertificate(rand.Reader, ca(2, "Test Attestation CA"), root, &interKey.PublicKey, rootKey)
	if err != nil {
		return nil, err
	}
	inter, _ := x509.ParseCertificate(interDER)
	pool := x509.NewCertPool()
	pool.AddCert(root)
	return &CA{Roots: pool, inter: inter, interKey: interKey}, nil
}

// issue returns the chain (leaf first) of a leaf holding leafKey and ext.
func (ca *CA) issue(leafKey *ecdsa.PrivateKey, ext pkix.Extension) ([][]byte, error) {
	now := time.Now()
	serial, _ := rand.Int(rand.Reader, big.NewInt(1<<62))
	leafT := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "attested key"}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour),
		ExtraExtensions: []pkix.Extension{ext}}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafT, ca.inter, &leafKey.PublicKey, ca.interKey)
	if err != nil {
		return nil, err
	}
	return [][]byte{leafDER, ca.inter.Raw}, nil
}

func issue(leafKey *ecdsa.PrivateKey, ext pkix.Extension) (PKI, error) {
	ca, err := NewCA()
	if err != nil {
		return PKI{}, err
	}
	chain, err := ca.issue(leafKey, ext)
	return PKI{Roots: ca.Roots, Chain: chain}, err
}

// ---------------------------------------------------------------- Android key attestation

// Android describes a key attestation. The zero values of Locked and BootState are a locked,
// verified device only when set explicitly; use Genuine for the normal case.
type Android struct {
	Challenge     []byte
	SecurityLevel int // 0 software, 1 TEE, 2 StrongBox
	Locked        bool
	BootState     int // 0 verified
	Package       string
	SigningDigest []byte
}

// Genuine is a StrongBox key on a locked, verified phone, for pkg signed with digest.
func Genuine(challenge []byte, pkg string, digest []byte) Android {
	return Android{Challenge: challenge, SecurityLevel: 2, Locked: true, Package: pkg, SigningDigest: digest}
}

type rootOfTrust struct {
	VerifiedBootKey   []byte
	DeviceLocked      bool
	VerifiedBootState asn1.Enumerated
	VerifiedBootHash  []byte
}

type packageInfo struct {
	Name    []byte
	Version int64
}

type applicationID struct {
	Packages         []packageInfo `asn1:"set"`
	SignatureDigests [][]byte      `asn1:"set"`
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

func tagged(tag int, v any) (asn1.RawValue, error) {
	b, err := asn1.Marshal(v)
	return asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: tag, IsCompound: true, Bytes: b}, err
}

func authList(items ...asn1.RawValue) asn1.RawValue {
	var b []byte
	for _, it := range items {
		e, _ := asn1.Marshal(it)
		b = append(b, e...)
	}
	return asn1.RawValue{Class: asn1.ClassUniversal, Tag: asn1.TagSequence, IsCompound: true, Bytes: b}
}

// AndroidChain attests leafKey as the Android Keystore would, under a fresh CA.
func AndroidChain(leafKey *ecdsa.PrivateKey, a Android) (PKI, error) {
	ext, err := keyDescriptionExt(a)
	if err != nil {
		return PKI{}, err
	}
	return issue(leafKey, ext)
}

// AndroidChain attests leafKey under this CA.
func (ca *CA) AndroidChain(leafKey *ecdsa.PrivateKey, a Android) ([][]byte, error) {
	ext, err := keyDescriptionExt(a)
	if err != nil {
		return nil, err
	}
	return ca.issue(leafKey, ext)
}

func keyDescriptionExt(a Android) (pkix.Extension, error) {
	rot, err := tagged(704, rootOfTrust{VerifiedBootKey: make([]byte, 32), DeviceLocked: a.Locked, VerifiedBootState: asn1.Enumerated(a.BootState), VerifiedBootHash: make([]byte, 32)})
	if err != nil {
		return pkix.Extension{}, err
	}
	inner, err := asn1.Marshal(applicationID{Packages: []packageInfo{{Name: []byte(a.Package), Version: 1}}, SignatureDigests: [][]byte{a.SigningDigest}})
	if err != nil {
		return pkix.Extension{}, err
	}
	app, err := tagged(709, inner)
	if err != nil {
		return pkix.Extension{}, err
	}
	kd, err := asn1.Marshal(keyDescription{AttestationVersion: 200, AttestationSecurityLevel: asn1.Enumerated(a.SecurityLevel), KeymasterVersion: 200,
		KeymasterSecurityLevel: asn1.Enumerated(a.SecurityLevel), AttestationChallenge: a.Challenge, UniqueID: []byte{},
		SoftwareEnforced: authList(app), HardwareEnforced: authList(rot)})
	return pkix.Extension{Id: asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 11129, 2, 1, 17}, Value: kd}, err
}

// ---------------------------------------------------------------- App Attest

// AppAttest describes an App Attest attestation of a new key.
type AppAttest struct {
	AppID      string
	ClientData []byte
	Production bool
	Counter    uint32
	// CredentialID overrides the credential ID in the authenticator data (nil: the key ID).
	CredentialID []byte
	// Key is the attested key (nil: a fresh one); keep it to sign assertions.
	Key *ecdsa.PrivateKey
}

func cborHead(major byte, n int) []byte {
	switch {
	case n < 24:
		return []byte{major<<5 | byte(n)}
	case n < 256:
		return []byte{major<<5 | 24, byte(n)}
	default:
		return []byte{major<<5 | 25, byte(n >> 8), byte(n)}
	}
}

func cborBytes(b []byte) []byte { return append(cborHead(2, len(b)), b...) }
func cborText(s string) []byte  { return append(cborHead(3, len(s)), s...) }

// AppAttestObject returns an attestation object, its key ID and the root that issued it.
func AppAttestObject(a AppAttest) (attestation, keyID []byte, roots *x509.CertPool, err error) {
	key := a.Key
	if key == nil {
		if key, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader); err != nil {
			return nil, nil, nil, err
		}
	}
	point, _ := key.PublicKey.ECDH()
	kid := sha256.Sum256(point.Bytes())
	cred := a.CredentialID
	if cred == nil {
		cred = kid[:]
	}
	aaguid := []byte("appattestdevelop")
	if a.Production {
		aaguid = append([]byte("appattest"), make([]byte, 7)...)
	}
	rp := sha256.Sum256([]byte(a.AppID))
	auth := append(append([]byte{}, rp[:]...), 0x40)
	auth = binary.BigEndian.AppendUint32(auth, a.Counter)
	auth = append(auth, aaguid...)
	auth = binary.BigEndian.AppendUint16(auth, uint16(len(cred))) // #nosec G115 -- a 32-byte test credential
	auth = append(auth, cred...)
	cdh := sha256.Sum256(a.ClientData)
	nonce := sha256.Sum256(append(append([]byte{}, auth...), cdh[:]...))
	ext, err := asn1.Marshal(struct {
		Nonce []byte `asn1:"tag:1,explicit"`
	}{nonce[:]})
	if err != nil {
		return nil, nil, nil, err
	}
	p, err := issue(key, pkix.Extension{Id: asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 8, 2}, Value: ext})
	if err != nil {
		return nil, nil, nil, err
	}
	obj := append(cborHead(5, 3), cborText("fmt")...)
	obj = append(obj, cborText("apple-appattest")...)
	obj = append(obj, cborText("attStmt")...)
	obj = append(obj, cborHead(5, 2)...)
	obj = append(obj, cborText("x5c")...)
	obj = append(obj, cborHead(4, 2)...)
	obj = append(obj, cborBytes(p.Chain[0])...)
	obj = append(obj, cborBytes(p.Chain[1])...)
	obj = append(obj, cborText("receipt")...)
	obj = append(obj, cborBytes([]byte("receipt"))...)
	obj = append(obj, cborText("authData")...)
	obj = append(obj, cborBytes(auth)...)
	return obj, kid[:], p.Roots, nil
}

// AppAttestAssertion is what DCAppAttestService.generateAssertion returns: the attested key's
// signature over SHA-256(authenticator data ‖ SHA-256(client data)), counter included.
func AppAttestAssertion(key *ecdsa.PrivateKey, appID string, counter uint32, clientData []byte) ([]byte, error) {
	rp := sha256.Sum256([]byte(appID))
	auth := append(append([]byte{}, rp[:]...), 0x40)
	auth = binary.BigEndian.AppendUint32(auth, counter)
	cdh := sha256.Sum256(clientData)
	nonce := sha256.Sum256(append(append([]byte{}, auth...), cdh[:]...))
	digest := sha256.Sum256(nonce[:])
	sig, err := ecdsa.SignASN1(rand.Reader, key, digest[:])
	if err != nil {
		return nil, err
	}
	obj := append(cborHead(5, 2), cborText("signature")...)
	obj = append(obj, cborBytes(sig)...)
	obj = append(obj, cborText("authenticatorData")...)
	return append(obj, cborBytes(auth)...), nil
}
