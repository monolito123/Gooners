// Package tsa dates the platform's daily transparency roots independently of the platform
// (integration point 20): an RFC 3161 time-stamping authority signs that a root existed at a
// time, so the platform cannot later produce a different history for a day already published.
// An ICP-Brasil time-stamping authority (Autoridade de Carimbo do Tempo) gives the stamp legal
// weight in Brazil (MP 2.200-2/2001); public ones (DigiCert, Sectigo, FreeTSA) add independent
// witnesses. Requests and tokens are DER, built and checked with the standard library:
// TimeStampReq/Resp (RFC 3161) and the token's CMS SignedData (RFC 5652).
package tsa

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/rsa"
	_ "crypto/sha256" // the hashes a token may use
	_ "crypto/sha512"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"slices"
	"time"
)

var (
	oidSHA256         = asn1.ObjectIdentifier{2, 16, 840, 1, 101, 3, 4, 2, 1}
	oidSHA384         = asn1.ObjectIdentifier{2, 16, 840, 1, 101, 3, 4, 2, 2}
	oidSHA512         = asn1.ObjectIdentifier{2, 16, 840, 1, 101, 3, 4, 2, 3}
	oidSignedData     = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 7, 2}
	oidTSTInfo        = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 9, 16, 1, 4}
	oidContentType    = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 9, 3}
	oidMessageDigest  = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 9, 4}
	oidRSASSAPSS      = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 1, 10}
	errNotTimestamped = errors.New("tsa: the token does not stamp this digest")
)

func hashOf(oid asn1.ObjectIdentifier) (crypto.Hash, bool) {
	switch {
	case oid.Equal(oidSHA256):
		return crypto.SHA256, true
	case oid.Equal(oidSHA384):
		return crypto.SHA384, true
	case oid.Equal(oidSHA512):
		return crypto.SHA512, true
	}
	return 0, false
}

type messageImprint struct {
	HashAlgorithm pkix.AlgorithmIdentifier
	HashedMessage []byte
}

type timeStampReq struct {
	Version        int
	MessageImprint messageImprint
	Nonce          *big.Int `asn1:"optional"`
	CertReq        bool     `asn1:"optional"`
}

type accuracy struct {
	Seconds int `asn1:"optional"`
	Millis  int `asn1:"optional,tag:0"`
	Micros  int `asn1:"optional,tag:1"`
}

type tstInfo struct {
	Version        int
	Policy         asn1.ObjectIdentifier
	MessageImprint messageImprint
	SerialNumber   *big.Int
	GenTime        time.Time     `asn1:"generalized"`
	Accuracy       accuracy      `asn1:"optional"`
	Ordering       bool          `asn1:"optional"`
	Nonce          *big.Int      `asn1:"optional"`
	TSA            asn1.RawValue `asn1:"optional,explicit,tag:0"`
	Extensions     asn1.RawValue `asn1:"optional,tag:1"`
}

type contentInfo struct {
	ContentType asn1.ObjectIdentifier
	Content     asn1.RawValue `asn1:"explicit,tag:0"`
}

type encapContentInfo struct {
	EContentType asn1.ObjectIdentifier
	EContent     asn1.RawValue `asn1:"explicit,optional,tag:0"`
}

type signerInfo struct {
	Version            int
	SID                asn1.RawValue
	DigestAlgorithm    pkix.AlgorithmIdentifier
	SignedAttrs        asn1.RawValue `asn1:"optional,tag:0"`
	SignatureAlgorithm pkix.AlgorithmIdentifier
	Signature          []byte
	UnsignedAttrs      asn1.RawValue `asn1:"optional,tag:1"`
}

type signedData struct {
	Version          int
	DigestAlgorithms asn1.RawValue
	EncapContentInfo encapContentInfo
	Certificates     asn1.RawValue `asn1:"optional,tag:0"`
	CRLs             asn1.RawValue `asn1:"optional,tag:1"`
	SignerInfos      []signerInfo  `asn1:"set"`
}

type attribute struct {
	Type   asn1.ObjectIdentifier
	Values asn1.RawValue `asn1:"set"`
}

type issuerAndSerial struct {
	Issuer asn1.RawValue
	Serial *big.Int
}

// Token is a verified time-stamp token.
type Token struct {
	DER     []byte    // the TimeStampToken (CMS ContentInfo), as the authority returned it
	Time    time.Time // genTime: when the authority says the digest existed
	Serial  *big.Int
	Policy  string
	Signer  *x509.Certificate
	Trusted bool // the signer chains to the configured roots
}

// Verify checks that der is a time-stamp token over digest (SHA-256): the authority's
// signature over the signed attributes, the attributes' digest of the TSTInfo, the TSTInfo's
// imprint, and a signer certificate for time stamping. With roots, the signer must chain to
// them as of the stamp's time (Token.Trusted); nil roots check the token alone.
func Verify(der, digest []byte, roots *x509.CertPool) (*Token, error) {
	var ci contentInfo
	if rest, err := asn1.Unmarshal(der, &ci); err != nil || len(rest) > 0 || !ci.ContentType.Equal(oidSignedData) {
		return nil, errors.New("tsa: not a CMS SignedData token")
	}
	var sd signedData
	if _, err := asn1.Unmarshal(ci.Content.Bytes, &sd); err != nil {
		return nil, fmt.Errorf("tsa: signed data: %w", err)
	}
	if !sd.EncapContentInfo.EContentType.Equal(oidTSTInfo) || len(sd.SignerInfos) != 1 {
		return nil, errors.New("tsa: not a time-stamp token")
	}
	var content []byte
	if _, err := asn1.Unmarshal(sd.EncapContentInfo.EContent.Bytes, &content); err != nil {
		return nil, errors.New("tsa: the token's content is not an OCTET STRING")
	}
	var info tstInfo
	if _, err := asn1.Unmarshal(content, &info); err != nil {
		return nil, fmt.Errorf("tsa: TSTInfo: %w", err)
	}
	if h, ok := hashOf(info.MessageImprint.HashAlgorithm.Algorithm); !ok || h != crypto.SHA256 || !bytes.Equal(info.MessageImprint.HashedMessage, digest) {
		return nil, errNotTimestamped
	}
	si := sd.SignerInfos[0]
	h, ok := hashOf(si.DigestAlgorithm.Algorithm)
	if !ok {
		return nil, fmt.Errorf("tsa: digest algorithm %v is not accepted (SHA-256, SHA-384 or SHA-512)", si.DigestAlgorithm.Algorithm)
	}
	if len(si.SignedAttrs.FullBytes) == 0 {
		return nil, errors.New("tsa: the token has no signed attributes")
	}
	// The signature covers the attributes encoded as a SET, not as the [0] they travel in.
	attrsDER := append([]byte{0x31}, si.SignedAttrs.FullBytes[1:]...)
	var attrs []attribute
	if _, err := asn1.UnmarshalWithParams(attrsDER, &attrs, "set"); err != nil {
		return nil, fmt.Errorf("tsa: signed attributes: %w", err)
	}
	var contentType asn1.ObjectIdentifier
	var messageDigest []byte
	for _, a := range attrs {
		switch {
		case a.Type.Equal(oidContentType):
			_, _ = asn1.Unmarshal(a.Values.Bytes, &contentType)
		case a.Type.Equal(oidMessageDigest):
			_, _ = asn1.Unmarshal(a.Values.Bytes, &messageDigest)
		}
	}
	hc := h.New()
	hc.Write(content)
	if !contentType.Equal(oidTSTInfo) || !bytes.Equal(messageDigest, hc.Sum(nil)) {
		return nil, errors.New("tsa: the signed attributes do not match the TSTInfo")
	}
	ha := h.New()
	ha.Write(attrsDER)
	signed := ha.Sum(nil)
	certs, err := x509.ParseCertificates(sd.Certificates.Bytes)
	if err != nil || len(certs) == 0 {
		return nil, errors.New("tsa: the token carries no certificates (the request asks for them)")
	}
	var signer *x509.Certificate
	for _, c := range certs {
		if identifies(si.SID, c) && verifySignature(c, h, signed, si) == nil {
			signer = c
			break
		}
	}
	if signer == nil {
		return nil, errors.New("tsa: the signature does not verify with the signer's certificate")
	}
	if !slices.Contains(signer.ExtKeyUsage, x509.ExtKeyUsageTimeStamping) {
		return nil, errors.New("tsa: the signer's certificate is not for time stamping")
	}
	t := &Token{DER: der, Time: info.GenTime, Serial: info.SerialNumber, Policy: info.Policy.String(), Signer: signer}
	if roots != nil {
		inter := x509.NewCertPool()
		for _, c := range certs {
			inter.AddCert(c)
		}
		if _, err := signer.Verify(x509.VerifyOptions{Roots: roots, Intermediates: inter, CurrentTime: info.GenTime,
			KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageTimeStamping}}); err != nil {
			return nil, fmt.Errorf("tsa: the authority's certificate does not chain to the trusted roots: %w", err)
		}
		t.Trusted = true
	}
	return t, nil
}

// identifies reports whether a signer identifier names c: issuer and serial number, or
// ([0]) its subject key identifier.
func identifies(sid asn1.RawValue, c *x509.Certificate) bool {
	if sid.Class == asn1.ClassContextSpecific && sid.Tag == 0 {
		return bytes.Equal(sid.Bytes, c.SubjectKeyId)
	}
	var ias issuerAndSerial
	if _, err := asn1.Unmarshal(sid.FullBytes, &ias); err != nil {
		return false
	}
	return bytes.Equal(ias.Issuer.FullBytes, c.RawIssuer) && ias.Serial.Cmp(c.SerialNumber) == 0
}

func verifySignature(c *x509.Certificate, h crypto.Hash, digest []byte, si signerInfo) error {
	switch k := c.PublicKey.(type) {
	case *rsa.PublicKey:
		if si.SignatureAlgorithm.Algorithm.Equal(oidRSASSAPSS) {
			return rsa.VerifyPSS(k, h, digest, si.Signature, nil)
		}
		return rsa.VerifyPKCS1v15(k, h, digest, si.Signature)
	case *ecdsa.PublicKey:
		if ecdsa.VerifyASN1(k, digest, si.Signature) {
			return nil
		}
		return errors.New("tsa: bad ECDSA signature")
	}
	return errors.New("tsa: unsupported key")
}

// Client asks a time-stamping authority for tokens.
type Client struct {
	URL   string
	Roots *x509.CertPool // the authorities' roots; nil checks the token alone
	HTTP  *http.Client
}

// Stamp asks the authority to time-stamp digest (a SHA-256), and verifies the token it returns:
// the imprint and the nonce must be this request's.
func (c *Client) Stamp(ctx context.Context, digest []byte) (*Token, error) {
	if len(digest) != 32 {
		return nil, errors.New("tsa: the digest must be a SHA-256")
	}
	nonce, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 63))
	if err != nil {
		return nil, err
	}
	req, err := asn1.Marshal(timeStampReq{Version: 1, MessageImprint: messageImprint{HashAlgorithm: pkix.AlgorithmIdentifier{Algorithm: oidSHA256, Parameters: asn1.NullRawValue},
		HashedMessage: digest}, Nonce: nonce, CertReq: true})
	if err != nil {
		return nil, err
	}
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(req))
	if err != nil {
		return nil, err
	}
	hreq.Header.Set("Content-Type", "application/timestamp-query")
	hc := c.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := hc.Do(hreq)
	if err != nil {
		return nil, fmt.Errorf("tsa: %s: %w", c.URL, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tsa: %s answered HTTP %d", c.URL, resp.StatusCode)
	}
	token, err := ParseResponse(body)
	if err != nil {
		return nil, fmt.Errorf("tsa: %s: %w", c.URL, err)
	}
	tok, err := Verify(token, digest, c.Roots)
	if err != nil {
		return nil, err
	}
	if n, err := Nonce(tok.DER); err != nil || n == nil || n.Cmp(nonce) != 0 {
		return nil, errors.New("tsa: the token does not carry this request's nonce")
	}
	return tok, nil
}

// ParseResponse returns the token of a TimeStampResp the authority granted (status granted or
// granted with modifications).
func ParseResponse(body []byte) ([]byte, error) {
	var tsr struct {
		Status asn1.RawValue
		Token  asn1.RawValue `asn1:"optional"`
	}
	if _, err := asn1.Unmarshal(body, &tsr); err != nil {
		return nil, fmt.Errorf("not a TimeStampResp: %w", err)
	}
	var status int
	if _, err := asn1.Unmarshal(tsr.Status.Bytes, &status); err != nil || (status != 0 && status != 1) || len(tsr.Token.FullBytes) == 0 {
		return nil, fmt.Errorf("the authority refused the request (status %d)", status)
	}
	return tsr.Token.FullBytes, nil
}

// Nonce reads a token's nonce (nil when it has none).
func Nonce(der []byte) (*big.Int, error) {
	var ci contentInfo
	if _, err := asn1.Unmarshal(der, &ci); err != nil {
		return nil, err
	}
	var sd signedData
	if _, err := asn1.Unmarshal(ci.Content.Bytes, &sd); err != nil {
		return nil, err
	}
	var content []byte
	if _, err := asn1.Unmarshal(sd.EncapContentInfo.EContent.Bytes, &content); err != nil {
		return nil, err
	}
	var info tstInfo
	if _, err := asn1.Unmarshal(content, &info); err != nil {
		return nil, err
	}
	return info.Nonce, nil
}
