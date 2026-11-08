package signer

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/receipts"
	"github.com/monolito123/Gooners/payments/platform/internal/testpki"
	"github.com/monolito123/Gooners/payments/platform/internal/vault"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

type stack struct {
	srv      *httptest.Server
	client   *tls.Config
	stranger *tls.Config
	keys     map[string]nostr.Keys
}

func newStack(t *testing.T, allowOnlyPlatform bool) *stack {
	t.Helper()
	ca, _ := testpki.NewCA("signer CA")
	server, _ := ca.Server("signer", "127.0.0.1")
	platform, _ := ca.Client("platform")
	other, _ := ca.Client("console")
	receiptsKeys, _ := nostr.KeysFromHex(strings.Repeat("11", 32))
	transparencyKeys, _ := nostr.KeysFromHex(strings.Repeat("22", 32))
	kinds, err := ParseKinds(DefaultKinds)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{Keys: map[string]nostr.Keys{"receipts": receiptsKeys, "transparency": transparencyKeys}, Kinds: kinds}
	if allowOnlyPlatform {
		sum := sha256.Sum256(platform.TLS.Certificate[0])
		s.AllowedClients = []string{hex.EncodeToString(sum[:])}
	}
	srv := httptest.NewUnstartedServer(s.Handler())
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{server.TLS}, ClientCAs: ca.Pool(), ClientAuth: tls.RequireAndVerifyClientCert, MinVersion: tls.VersionTLS13}
	srv.StartTLS()
	t.Cleanup(srv.Close)
	cfg := func(l *testpki.Leaf) *tls.Config {
		return &tls.Config{Certificates: []tls.Certificate{l.TLS}, RootCAs: ca.Pool(), MinVersion: tls.VersionTLS13}
	}
	return &stack{srv: srv, client: cfg(platform), stranger: cfg(other), keys: s.Keys}
}

// The platform signs receipts and gift-wraps them without ever holding the key, and the
// result is exactly what the key itself produces.
func TestRemoteSignerSignsWhatTheKeyWould(t *testing.T) {
	st := newStack(t, false)
	ctx := context.Background()
	remote, err := Dial(ctx, st.srv.URL, "receipts", st.client, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if remote.Public() != st.keys["receipts"].PubHex {
		t.Fatal("wrong public key")
	}
	issuer := &receipts.Issuer{Author: remote, ClaimBase: "https://r.goonerspay.com.br/c"}
	merchant, _ := nostr.KeysFromHex(strings.Repeat("33", 32))
	issued, err := issuer.Issue(receipts.Receipt{PaymentIntentID: "pi_1", MerchantID: "mer_1", MerchantName: "Café", MerchantRootPub: merchant.PubHex,
		Amount: 1290, Currency: "BRL", Method: map[string]any{"type": "card"}, CreatedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if err := issued.Receipt.Verify(); err != nil || issued.Receipt.PubKey != remote.Public() {
		t.Fatalf("receipt: %v", err)
	}
	// The merchant opens its copy with its own key: the seal was encrypted with the
	// conversation key the signer derived.
	inner, _, err := nostr.Unwrap(issued.MerchantWrap, merchant)
	if err != nil || inner.ID != issued.Receipt.ID {
		t.Fatalf("unwrap: %v", err)
	}

	// The transparency key signs roots only, and nothing signs far in the past.
	tr, _ := Dial(ctx, st.srv.URL, "transparency", st.client, time.Second)
	if err := tr.SignEvent(&nostr.Event{Kind: 7711, CreatedAt: time.Now().Unix(), Content: "{}"}, nil); err == nil || !strings.Contains(err.Error(), "does not sign kind 7711") {
		t.Fatalf("transparency key signed a receipt: %v", err)
	}
	if err := tr.SignEvent(&nostr.Event{Kind: 7715, CreatedAt: time.Now().Add(-5 * 24 * time.Hour).Unix(), Content: "{}"}, nil); err == nil {
		t.Fatal("signed an event dated five days ago")
	}
	root := &nostr.Event{Kind: 7715, CreatedAt: time.Now().Unix(), Tags: [][]string{{"d", "2026-11-08"}}, Content: "{}"}
	if err := tr.SignEvent(root, nil); err != nil || root.Verify() != nil {
		t.Fatalf("root: %v", err)
	}
	if _, err := Dial(ctx, st.srv.URL, "audit", st.client, 0); err == nil {
		t.Fatal("dialled a key the service does not hold")
	}
}

// Only clients with a certificate from the CA reach it, and with an allow-list only the
// platform's; a signer that answers with another event is caught.
func TestSignerAccess(t *testing.T) {
	st := newStack(t, true)
	ctx := context.Background()
	if _, err := Dial(ctx, st.srv.URL, "receipts", &tls.Config{RootCAs: st.client.RootCAs, MinVersion: tls.VersionTLS13}, 0); err == nil {
		t.Fatal("reached the signer without a client certificate")
	}
	if _, err := Dial(ctx, st.srv.URL, "receipts", st.stranger, 0); err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("another client of the same CA: %v", err)
	}
	if _, err := Dial(ctx, st.srv.URL, "receipts", st.client, 0); err != nil {
		t.Fatal(err)
	}

	// A forged service: it signs, but a different content.
	k := st.keys["receipts"]
	forged := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			reply(w, 200, map[string]any{"keys": map[string]string{"receipts": k.PubHex}})
			return
		}
		ev := &nostr.Event{Kind: 7711, CreatedAt: time.Now().Unix(), Tags: [][]string{}, Content: `{"amount":1}`}
		ev.Sign(k, nil)
		reply(w, 200, ev)
	}))
	defer forged.Close()
	r, _ := Dial(ctx, forged.URL, "receipts", nil, 0)
	if err := r.SignEvent(&nostr.Event{Kind: 7711, CreatedAt: time.Now().Unix(), Content: `{"amount":2}`}, nil); err == nil || !strings.Contains(err.Error(), "signed something else") {
		t.Fatalf("accepted another event's signature: %v", err)
	}
}

// The key file is sealed under the KEK and opens only under that KEK.
func TestKeyFile(t *testing.T) {
	ctx := context.Background()
	key := make([]byte, 32)
	rand.Read(key)
	kek, _ := vault.NewLocalKEK("local-dev", key)
	secret := make([]byte, 32)
	rand.Read(secret)
	f, err := Seal(ctx, kek, map[string][]byte{"receipts": secret})
	if err != nil {
		t.Fatal(err)
	}
	keys, err := Open(ctx, kek, f)
	want, _ := nostr.KeysFromSecret(secret)
	if err != nil || keys["receipts"].PubHex != want.PubHex {
		t.Fatalf("open: %v", err)
	}
	rand.Read(key)
	other, _ := vault.NewLocalKEK("local-dev", key)
	if _, err := Open(ctx, other, f); err == nil {
		t.Fatal("opened under another key")
	}
	f.KEK = "aws-kms:alias/x"
	if _, err := Open(ctx, kek, f); err == nil {
		t.Fatal("opened a file sealed under another KEK")
	}
	if _, err := ParseKinds("receipts"); err == nil {
		t.Fatal("malformed kinds accepted")
	}
}
