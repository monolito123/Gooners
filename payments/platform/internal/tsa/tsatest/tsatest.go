// Package tsatest is a time-stamping authority for tests: it answers RFC 3161 requests with
// tokens signed by a certificate for time stamping, issued by its own CA.
package tsatest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"time"
)

var (
	oidSHA256       = asn1.ObjectIdentifier{2, 16, 840, 1, 101, 3, 4, 2, 1}
	oidSignedData   = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 7, 2}
	oidTSTInfo      = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 9, 16, 1, 4}
	oidContentType  = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 9, 3}
	oidMessageDiges = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 9, 4}
	oidECDSASHA256  = asn1.ObjectIdentifier{1, 2, 840, 10045, 4, 3, 2}
)

type imprint struct {
	HashAlgorithm pkix.AlgorithmIdentifier
	HashedMessage []byte
}

type request struct {
	Version        int
	MessageImprint imprint
	Nonce          *big.Int `asn1:"optional"`
	CertReq        bool     `asn1:"optional"`
}

type tstInfo struct {
	Version        int
	Policy         asn1.ObjectIdentifier
	MessageImprint imprint
	SerialNumber   *big.Int
	GenTime        time.Time `asn1:"generalized"`
	Nonce          *big.Int  `asn1:"optional"`
}

type attribute struct {
	Type   asn1.ObjectIdentifier
	Values asn1.RawValue
}

type issuerAndSerial struct {
	Issuer asn1.RawValue
	Serial *big.Int
}

type signerInfo struct {
	Version            int
	SID                issuerAndSerial
	DigestAlgorithm    pkix.AlgorithmIdentifier
	SignedAttrs        asn1.RawValue
	SignatureAlgorithm pkix.AlgorithmIdentifier
	Signature          []byte
}

type signedData struct {
	Version          int
	DigestAlgorithms asn1.RawValue
	EncapContentInfo struct {
		EContentType asn1.ObjectIdentifier
		EContent     asn1.RawValue
	}
	Certificates asn1.RawValue
	SignerInfos  []signerInfo `asn1:"set"`
}

type contentInfo struct {
	ContentType asn1.ObjectIdentifier
	Content     asn1.RawValue
}

// Authority is a running time-stamping authority.
type Authority struct {
	URL      string
	Root     *x509.Certificate
	Requests atomic.Int32
	Down     atomic.Bool // answer HTTP 503
	srv      *httptest.Server
	key      *ecdsa.PrivateKey
	cert     *x509.Certificate
}

// New starts an authority; Close stops it.
func New() *Authority {
	rootKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	now := time.Now()
	rootTpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Test TSA Root"}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	rootDER, _ := x509.CreateCertificate(rand.Reader, rootTpl, rootTpl, &rootKey.PublicKey, rootKey)
	root, _ := x509.ParseCertificate(rootDER)
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "Test Time Stamping Authority"}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageTimeStamping}}
	der, _ := x509.CreateCertificate(rand.Reader, tpl, root, &key.PublicKey, rootKey)
	cert, _ := x509.ParseCertificate(der)
	a := &Authority{Root: root, key: key, cert: cert}
	a.srv = httptest.NewServer(http.HandlerFunc(a.serve))
	a.URL = a.srv.URL
	return a
}

// Close stops the authority.
func (a *Authority) Close() { a.srv.Close() }

// Roots is a pool holding the authority's root.
func (a *Authority) Roots() *x509.CertPool {
	p := x509.NewCertPool()
	p.AddCert(a.Root)
	return p
}

func (a *Authority) serve(w http.ResponseWriter, r *http.Request) {
	a.Requests.Add(1)
	if a.Down.Load() || r.Header.Get("Content-Type") != "application/timestamp-query" {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	body, _ := io.ReadAll(r.Body)
	var req request
	if _, err := asn1.Unmarshal(body, &req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	resp, err := a.token(req)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/timestamp-reply")
	_, _ = w.Write(resp)
}

func (a *Authority) token(req request) ([]byte, error) {
	serial, _ := rand.Int(rand.Reader, big.NewInt(1<<62))
	tst, err := asn1.Marshal(tstInfo{Version: 1, Policy: asn1.ObjectIdentifier{1, 2, 3, 4, 1}, MessageImprint: req.MessageImprint, SerialNumber: serial,
		GenTime: time.Now().UTC().Truncate(time.Second), Nonce: req.Nonce})
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(tst)
	octets := func(b []byte) []byte { d, _ := asn1.Marshal(b); return d }
	set := func(inner []byte) asn1.RawValue {
		return asn1.RawValue{Class: asn1.ClassUniversal, Tag: asn1.TagSet, IsCompound: true, Bytes: inner}
	}
	ctOID, _ := asn1.Marshal(oidTSTInfo)
	attrsSet, err := asn1.MarshalWithParams([]attribute{{Type: oidContentType, Values: set(ctOID)}, {Type: oidMessageDiges, Values: set(octets(digest[:]))}}, "set")
	if err != nil {
		return nil, err
	}
	signedDigest := sha256.Sum256(attrsSet)
	sig, err := ecdsa.SignASN1(rand.Reader, a.key, signedDigest[:])
	if err != nil {
		return nil, err
	}
	sha256Alg := pkix.AlgorithmIdentifier{Algorithm: oidSHA256, Parameters: asn1.NullRawValue}
	algSet, _ := asn1.MarshalWithParams([]pkix.AlgorithmIdentifier{sha256Alg}, "set")
	var sd signedData
	sd.Version = 3
	sd.DigestAlgorithms = asn1.RawValue{FullBytes: algSet}
	sd.EncapContentInfo.EContentType = oidTSTInfo
	sd.EncapContentInfo.EContent = asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 0, IsCompound: true, Bytes: octets(tst)}
	sd.Certificates = asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 0, IsCompound: true, Bytes: a.cert.Raw}
	sd.SignerInfos = []signerInfo{{Version: 1, SID: issuerAndSerial{Issuer: asn1.RawValue{FullBytes: a.cert.RawIssuer}, Serial: a.cert.SerialNumber},
		DigestAlgorithm: sha256Alg, SignedAttrs: asn1.RawValue{FullBytes: append([]byte{0xA0}, attrsSet[1:]...)},
		SignatureAlgorithm: pkix.AlgorithmIdentifier{Algorithm: oidECDSASHA256}, Signature: sig}}
	sdDER, err := asn1.Marshal(sd)
	if err != nil {
		return nil, err
	}
	ci, err := asn1.Marshal(contentInfo{ContentType: oidSignedData, Content: asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 0, IsCompound: true, Bytes: sdDER}})
	if err != nil {
		return nil, err
	}
	status, _ := asn1.Marshal(struct{ Status int }{0})
	return asn1.Marshal(struct {
		Status asn1.RawValue
		Token  asn1.RawValue
	}{asn1.RawValue{FullBytes: status}, asn1.RawValue{FullBytes: ci}})
}
