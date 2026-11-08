package e2e

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/attest"
	"github.com/monolito123/Gooners/payments/platform/internal/attest/attesttest"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/terminalpki"
	"github.com/monolito123/Gooners/payments/platform/internal/testpki"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// terminalHost serves the stack's API over mutual TLS against the terminal CA, as the terminal
// listener (TERMINAL_ADDR) does.
func terminalHost(t *testing.T, st *stack, ca *testpki.CA) string {
	t.Helper()
	leaf, err := ca.Server("terminals", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewUnstartedServer(st.handler)
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{leaf.TLS}, ClientCAs: ca.Pool(), ClientAuth: tls.RequireAndVerifyClientCert, MinVersion: tls.VersionTLS13}
	srv.StartTLS()
	t.Cleanup(srv.Close)
	return srv.URL
}

// terminalClient is a terminal holding key and the certificate the platform issued for it.
func terminalClient(t *testing.T, ca *testpki.CA, certPEM string, key *ecdsa.PrivateKey) *http.Client {
	t.Helper()
	keyDER, _ := x509.MarshalECPrivateKey(key)
	pair, err := tls.X509KeyPair([]byte(certPEM), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}))
	if err != nil {
		t.Fatalf("the issued certificate does not pair with the terminal's key: %v", err)
	}
	return &http.Client{Transport: recording(&http.Transport{TLSClientConfig: &tls.Config{RootCAs: ca.Pool(), Certificates: []tls.Certificate{pair}, MinVersion: tls.VersionTLS13}})}
}

// csrFor is a terminal's CSR, base64 DER, asking for a name the platform will not use.
func csrFor(t *testing.T, key crypto.Signer) string {
	t.Helper()
	der, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: "please make me an operator"}}, key)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(der)
}

// Terminal certificates (docs/05 §2.4): the platform's terminal CA signs a terminal's client
// certificate from its CSR, the terminal sells over mutual TLS with it, renews it over the same
// connection without ever being locked out, and a phone whose device attested with Android key
// attestation gets one only for a key its secure hardware attests.
func TestTerminalCertificates(t *testing.T) {
	ca, _ := testpki.NewCA("goonersPAY terminal CA")
	ak, err := attesttest.NewCA()
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("goonersPAY release signing certificate"))
	const pkg = "br.com.gooners.pay"
	st := newStack(t, func(d *payments.Deps) {
		d.TerminalCA = &terminalpki.CA{Cert: ca.Cert, Signer: ca.Key}
		d.Attestor = payments.VerifyingAttestor{KeyAttestation: &attest.KeyAttestationConfig{Roots: ak.Roots, PackageName: pkg, SigningDigests: [][]byte{digest[:]}}}
	})
	ctx := context.Background()
	merchant, _ := st.merchant(st.key)

	host := terminalHost(t, st, ca)
	newKey := func() *ecdsa.PrivateKey { k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader); return k }
	// terminal is a terminal holding its key and the certificate the platform issued for it.
	type terminal struct {
		id     string
		client *http.Client
	}
	holder := func(out map[string]any, key *ecdsa.PrivateKey) terminal {
		t.Helper()
		return terminal{id: out["terminal_id"].(string), client: terminalClient(t, ca, out["certificate"].(string), key)}
	}
	over := func(term terminal, method, path string, body any) (int, map[string]any) {
		t.Helper()
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(method, host+path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", ids.ULID())
		resp, err := term.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)
		var out map[string]any
		_ = json.Unmarshal(raw, &out)
		return resp.StatusCode, out
	}
	sale := func(term terminal, amount int) (int, map[string]any) {
		t.Helper()
		_, pi := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": amount, "channel": "card_present"}, 201)
		return over(term, "POST", "/v1/terminal/authorizations", st.tapBody(tapOpts{pi: pi["id"].(string), terminal: term.id, pan: luhnPAN(fmt.Sprintf("41%013d", time.Now().UnixNano()%1e13)), aid: "A0000000031010", app: "credit"}))
	}

	// A smart POS: its merchant's backend registers it with its CSR and gets its certificate.
	k1 := newKey()
	_, out := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant, "type": "smart_pos", "csr": csrFor(t, k1)}, 201)
	blk, _ := pem.Decode([]byte(out["certificate"].(string)))
	cert, err := x509.ParseCertificate(blk.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(cert.Raw)
	expires, _ := time.Parse(time.RFC3339, out["certificate_expires_at"].(string))
	if cert.Subject.CommonName != out["terminal_id"] || cert.Subject.OrganizationalUnit[0] != merchant || out["certificate_sha256"] != hex.EncodeToString(sum[:]) ||
		time.Until(expires) < 29*24*time.Hour || time.Until(expires) > terminalpki.Validity {
		t.Fatalf("the issued certificate: %v %v", cert.Subject, out)
	}
	if _, err := cert.Verify(x509.VerifyOptions{Roots: ca.Pool(), KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}); err != nil {
		t.Fatal(err)
	}
	pos := holder(out, k1)

	// What cannot be signed, or registered twice.
	rk, _ := rsa.GenerateKey(rand.Reader, 2048)
	if c, p := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant, "csr": csrFor(t, rk)}, 0); c != 422 || p["code"] != "invalid_csr" {
		t.Errorf("an RSA key: %d %v", c, p)
	}
	if c, _ := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant, "csr": csrFor(t, newKey()), "certificate_sha256": strings.Repeat("ab", 32)}, 0); c != 422 {
		t.Errorf("a CSR and a fingerprint: %d", c)
	}
	if c, p := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant, "certificate_sha256": out["certificate_sha256"]}, 0); c != 409 {
		t.Errorf("another terminal claiming the issued certificate: %d %v", c, p)
	}

	// It sells over mutual TLS with that certificate.
	if c, auth := sale(pos, 2590); c != 200 || auth["status"] != "approved" {
		t.Fatalf("a sale with the issued certificate: %d %v", c, auth)
	}

	// Renewal over its own connection. The first response never reaches the terminal, so it
	// renews again with the certificate it holds: that one keeps working until the terminal
	// presents the new one, and then stops; the certificate it never received never works.
	k2 := newKey()
	c, lost := over(pos, "POST", "/v1/terminals/"+pos.id+"/certificate", map[string]any{"csr": csrFor(t, k2)})
	if c != 201 || lost["terminal_id"] != pos.id || lost["certificate_sha256"] == out["certificate_sha256"] {
		t.Fatalf("renewal: %d %v", c, lost)
	}
	k3 := newKey()
	c, renewed := over(pos, "POST", "/v1/terminals/"+pos.id+"/certificate", map[string]any{"csr": csrFor(t, k3)})
	if c != 201 || renewed["certificate_sha256"] == lost["certificate_sha256"] {
		t.Fatalf("renewing again with the certificate it holds: %d %v", c, renewed)
	}
	if c, auth := sale(pos, 1000); c != 200 || auth["status"] != "approved" {
		t.Fatalf("the old certificate before the new one is used: %d %v", c, auth)
	}
	pos2 := holder(renewed, k3)
	if c, auth := sale(pos2, 1100); c != 200 || auth["status"] != "approved" {
		t.Fatalf("the renewed certificate: %d %v", c, auth)
	}
	if c, p := sale(pos, 1200); c != 401 || p["code"] != "unknown_terminal" {
		t.Errorf("the replaced certificate once the new one was used: %d %v", c, p)
	}
	if c, _ := sale(holder(lost, k2), 1250); c != 401 {
		t.Errorf("the certificate whose response was lost: %d", c)
	}

	// Another terminal cannot renew this one, nor can an API key.
	k4 := newKey()
	_, other := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant, "type": "smart_pos", "csr": csrFor(t, k4)}, 201)
	if c, _ := over(holder(other, k4), "POST", "/v1/terminals/"+pos.id+"/certificate", map[string]any{"csr": csrFor(t, newKey())}); c != 403 {
		t.Errorf("a terminal renewing another's certificate: %d", c)
	}
	if c, _ := st.call("POST", "/v1/terminals/"+pos.id+"/certificate", map[string]any{"csr": csrFor(t, newKey())}, 0); c != 403 {
		t.Errorf("an API key asking for a terminal's certificate: %d", c)
	}

	// A revoked terminal's certificate stops working.
	st.call("POST", "/v1/terminals/"+pos.id+"/revoke", map[string]any{"reason": "device lost"}, 200)
	if c, _ := sale(pos2, 1300); c != 401 {
		t.Errorf("a revoked terminal's certificate: %d", c)
	}

	// A phone: its device attested with Android key attestation at enrollment, so its terminal
	// key must be attested too, with its terminal's challenge.
	_, ec := st.call("POST", "/v1/merchants/"+merchant+"/enrollment-codes", nil, 201)
	owner := newPhone(st)
	root, _ := nostr.GenerateKeys()
	npub, _ := nostr.EncodeNpub(owner.device.PubHex)
	chainOf := func(key *ecdsa.PrivateKey, a attesttest.Android) []string {
		chain, err := ak.AndroidChain(key, a)
		if err != nil {
			t.Fatal(err)
		}
		var b64 []string
		for _, c := range chain {
			b64 = append(b64, base64.StdEncoding.EncodeToString(c))
		}
		return b64
	}
	body, _ := json.Marshal(map[string]any{"device_npub": npub, "platform": "android",
		"attestation":         map[string]any{"type": "android_key_attestation", "certificate_chain": chainOf(owner.dpop, attesttest.Genuine(attest.Challenge(owner.device.PubHex), pkg, digest[:]))},
		"authorization_event": deviceList(t, root, merchant, time.Now(), owner)})
	if c, dev := owner.raw("POST", "/v1/enrollment", "Enrollment "+ec["code"].(string), body, ""); c != 201 {
		t.Fatalf("enrollment: %d %v", c, dev)
	}
	if c, s := owner.login(t); c != 200 || owner.terminal == "" {
		t.Fatalf("login: %d %v", c, s)
	}
	tk := newKey()
	path := "/v1/terminals/" + owner.terminal + "/certificate"
	if c, p := owner.do("POST", path, map[string]any{"csr": csrFor(t, tk)}); c != 422 || !strings.Contains(p["detail"].(string), "key_attestation is required") {
		t.Errorf("a phone's CSR without its key attestation: %d %v", c, p)
	}
	if c, p := owner.do("POST", path, map[string]any{"csr": csrFor(t, tk),
		"key_attestation": chainOf(tk, attesttest.Genuine(attest.TerminalChallenge(other["terminal_id"].(string)), pkg, digest[:]))}); c != 422 {
		t.Errorf("an attestation made for another terminal: %d %v", c, p)
	}
	if c, p := owner.do("POST", path, map[string]any{"csr": csrFor(t, tk),
		"key_attestation": chainOf(newKey(), attesttest.Genuine(attest.TerminalChallenge(owner.terminal), pkg, digest[:]))}); c != 422 || !strings.Contains(p["detail"].(string), "not the CSR's key") {
		t.Errorf("an attestation of another key: %d %v", c, p)
	}
	tee := attesttest.Genuine(attest.TerminalChallenge(owner.terminal), pkg, digest[:])
	tee.SecurityLevel = 1
	c, issued := owner.do("POST", path, map[string]any{"csr": csrFor(t, tk), "key_attestation": chainOf(tk, tee)})
	if c != 201 || issued["terminal_id"] != owner.terminal || issued["key_security_level"] != "trusted_environment" {
		t.Fatalf("a phone's attested terminal key: %d %v", c, issued)
	}
	if c, _ := owner.do("POST", "/v1/terminals/"+other["terminal_id"].(string)+"/certificate", map[string]any{"csr": csrFor(t, newKey())}); c != 403 {
		t.Errorf("a phone asking for another terminal's certificate: %d", c)
	}
	if c, auth := sale(holder(issued, tk), 4590); c != 200 || auth["status"] != "approved" {
		t.Fatalf("the phone selling over mutual TLS: %d %v", c, auth)
	}

	var level string
	var notified int
	_ = st.pool.QueryRow(ctx, `SELECT key_security_level FROM terminals WHERE id = $1`, owner.terminal).Scan(&level)
	_ = st.pool.QueryRow(ctx, `SELECT count(*) FROM webhook_deliveries WHERE type = 'terminal.certificate_issued'`).Scan(&notified)
	if level != "trusted_environment" || notified != 5 {
		t.Errorf("stored key level %q, certificate_issued events %d (want 5: the POS, its two renewals, the other POS and the phone)", level, notified)
	}
}
