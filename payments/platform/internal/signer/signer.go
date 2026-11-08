// Package signer keeps the platform's Nostr keys (the receipts key and the transparency key)
// out of the platform process. The signer service holds them, decrypted only in its own
// memory from a file sealed under the KMS key, and signs over mutual TLS. It signs only the
// event kinds each key is for, at plausible times, and logs every signature. The platform
// talks to it through Remote, which implements nostr.Author and checks every signature it
// gets back.
//
// Run the service in an isolated environment (a Nitro Enclave or a confidential VM) whose
// identity alone may use the KMS key: then a compromised platform host can ask for
// signatures of the allowed kinds, but can never take the keys.
package signer

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/vault"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// DefaultKinds is what each key signs: receipts (7711), their seals (13) and daily statements
// (7713) for the receipts key; the daily public root (7715) for the transparency key.
const DefaultKinds = "receipts=7711,13,7713;transparency=7715"

// ParseKinds reads "name=kind,kind;name=kind".
func ParseKinds(s string) (map[string]map[int]bool, error) {
	out := map[string]map[int]bool{}
	for _, part := range strings.Split(s, ";") {
		name, list, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok || name == "" {
			return nil, fmt.Errorf("signer: kinds %q: want name=kind,kind", part)
		}
		out[name] = map[int]bool{}
		for _, k := range strings.Split(list, ",") {
			n, err := strconv.Atoi(strings.TrimSpace(k))
			if err != nil {
				return nil, fmt.Errorf("signer: kind %q: %w", k, err)
			}
			out[name][n] = true
		}
	}
	return out, nil
}

// Server signs with the keys it holds.
type Server struct {
	Keys  map[string]nostr.Keys
	Kinds map[string]map[int]bool
	// AllowedClients, when set, are the SHA-256 fingerprints (hex) of the client certificates
	// that may call; mutual TLS already requires one signed by the configured CA.
	AllowedClients []string
	Log            *slog.Logger
	Now            func() time.Time
}

// A seal's time is tweaked up to two days into the past (NIP-59); nothing signs further back,
// and nothing is signed for the future.
const (
	maxPast   = 72 * time.Hour
	maxFuture = 10 * time.Minute
)

// Handler serves GET /v1/keys, POST /v1/keys/{name}/sign and
// POST /v1/keys/{name}/conversation-key.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /v1/keys", s.guard(func(w http.ResponseWriter, r *http.Request, _ string) {
		keys := map[string]string{}
		for name, k := range s.Keys {
			keys[name] = k.PubHex
		}
		reply(w, http.StatusOK, map[string]any{"keys": keys})
	}))
	mux.HandleFunc("POST /v1/keys/{name}/sign", s.guard(s.sign))
	mux.HandleFunc("POST /v1/keys/{name}/conversation-key", s.guard(s.conversationKey))
	return mux
}

func (s *Server) guard(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		client := ""
		if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
			c := r.TLS.PeerCertificates[0]
			sum := sha256.Sum256(c.Raw)
			client = hex.EncodeToString(sum[:])
			if len(s.AllowedClients) > 0 && !slices.Contains(s.AllowedClients, client) {
				s.logger().Warn("signer: client certificate not allowed", "subject", c.Subject.String(), "fingerprint", client)
				reply(w, http.StatusForbidden, map[string]string{"error": "client not allowed"})
				return
			}
			client = c.Subject.CommonName
		} else if len(s.AllowedClients) > 0 {
			reply(w, http.StatusForbidden, map[string]string{"error": "client certificate required"})
			return
		}
		next(w, r, client)
	}
}

func (s *Server) key(w http.ResponseWriter, r *http.Request) (string, nostr.Keys, bool) {
	name := r.PathValue("name")
	k, ok := s.Keys[name]
	if !ok {
		reply(w, http.StatusNotFound, map[string]string{"error": "no such key"})
	}
	return name, k, ok
}

func (s *Server) sign(w http.ResponseWriter, r *http.Request, client string) {
	name, k, ok := s.key(w, r)
	if !ok {
		return
	}
	var ev nostr.Event
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&ev); err != nil {
		reply(w, http.StatusBadRequest, map[string]string{"error": "not an event"})
		return
	}
	now := time.Now
	if s.Now != nil {
		now = s.Now
	}
	at := time.Unix(ev.CreatedAt, 0)
	switch {
	case !s.Kinds[name][ev.Kind]:
		s.logger().Warn("signer: kind refused", "key", name, "kind", ev.Kind, "client", client)
		reply(w, http.StatusForbidden, map[string]string{"error": fmt.Sprintf("the %s key does not sign kind %d", name, ev.Kind)})
		return
	case ev.PubKey != "" && ev.PubKey != k.PubHex:
		reply(w, http.StatusBadRequest, map[string]string{"error": "pubkey is not this key's"})
		return
	case at.Before(now().Add(-maxPast)) || at.After(now().Add(maxFuture)):
		reply(w, http.StatusBadRequest, map[string]string{"error": "created_at is out of range"})
		return
	}
	if ev.Tags == nil {
		ev.Tags = [][]string{}
	}
	if err := ev.Sign(k, nil); err != nil {
		reply(w, http.StatusInternalServerError, map[string]string{"error": "signing failed"})
		return
	}
	s.logger().Info("signer: signed", "key", name, "kind", ev.Kind, "id", ev.ID, "created_at", ev.CreatedAt, "client", client)
	reply(w, http.StatusOK, ev)
}

func (s *Server) conversationKey(w http.ResponseWriter, r *http.Request, client string) {
	name, k, ok := s.key(w, r)
	if !ok {
		return
	}
	var in struct {
		PubKey string `json:"pubkey"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&in); err != nil || len(in.PubKey) != 64 {
		reply(w, http.StatusBadRequest, map[string]string{"error": "pubkey is 64 hex digits"})
		return
	}
	ck, err := k.SharedKey(in.PubKey)
	if err != nil {
		reply(w, http.StatusBadRequest, map[string]string{"error": "not a public key"})
		return
	}
	s.logger().Info("signer: conversation key", "key", name, "peer", in.PubKey, "client", client)
	reply(w, http.StatusOK, map[string]string{"conversation_key": hex.EncodeToString(ck)})
}

func (s *Server) logger() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}

func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// Remote is one key of a signer service, as a nostr.Author.
type Remote struct {
	base, name, pub string
	http            *http.Client
}

// Dial connects to the signer at baseURL and learns the public key of name. It retries for
// up to wait, so the platform and the signer can start in any order.
func Dial(ctx context.Context, baseURL, name string, tlsCfg *tls.Config, wait time.Duration) (*Remote, error) {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = tlsCfg
	r := &Remote{base: strings.TrimRight(baseURL, "/"), name: name, http: &http.Client{Transport: tr, Timeout: 10 * time.Second}}
	deadline := time.Now().Add(wait)
	for {
		var out struct {
			Keys map[string]string `json:"keys"`
		}
		err := r.call(ctx, "GET", "/v1/keys", nil, &out)
		if err == nil {
			if r.pub = out.Keys[name]; len(r.pub) != 64 {
				return nil, fmt.Errorf("signer: the service holds no %q key", name)
			}
			return r, nil
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("signer: %w", err)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// Public implements nostr.Author.
func (r *Remote) Public() string { return r.pub }

// SignEvent implements nostr.Author. The signed event must be the one sent, by this key, with
// a valid signature: anything else is refused.
func (r *Remote) SignEvent(e *nostr.Event, _ *[32]byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req := nostr.Event{PubKey: r.pub, CreatedAt: e.CreatedAt, Kind: e.Kind, Tags: e.Tags, Content: e.Content}
	if req.Tags == nil {
		req.Tags = [][]string{}
	}
	var got nostr.Event
	if err := r.call(ctx, "POST", "/v1/keys/"+r.name+"/sign", req, &got); err != nil {
		return err
	}
	sent, _ := json.Marshal([]any{req.Kind, req.CreatedAt, req.Tags, req.Content})
	back, _ := json.Marshal([]any{got.Kind, got.CreatedAt, got.Tags, got.Content})
	if got.PubKey != r.pub || !bytes.Equal(sent, back) {
		return errors.New("signer: the service signed something else")
	}
	if err := got.Verify(); err != nil {
		return fmt.Errorf("signer: bad signature from the service: %w", err)
	}
	e.PubKey, e.ID, e.Sig, e.Tags = got.PubKey, got.ID, got.Sig, req.Tags
	return nil
}

// SharedKey implements nostr.Author (the NIP-44 conversation key with pubHex).
func (r *Remote) SharedKey(pubHex string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var out struct {
		Key string `json:"conversation_key"`
	}
	if err := r.call(ctx, "POST", "/v1/keys/"+r.name+"/conversation-key", map[string]string{"pubkey": pubHex}, &out); err != nil {
		return nil, err
	}
	b, err := hex.DecodeString(out.Key)
	if err != nil || len(b) != 32 {
		return nil, errors.New("signer: malformed conversation key")
	}
	return b, nil
}

func (r *Remote) call(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, r.base+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := r.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("signer: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return json.Unmarshal(b, out)
}

// KeyFile is the signer's keys sealed under a KEK: what the service reads at start.
type KeyFile struct {
	KEK  string            `json:"kek"`
	Keys map[string][]byte `json:"keys"` // name → the 32-byte secret, wrapped
}

// Seal wraps secrets (name → 32 bytes) under kek.
func Seal(ctx context.Context, kek vault.KEK, secrets map[string][]byte) (*KeyFile, error) {
	f := &KeyFile{KEK: kek.ID(), Keys: map[string][]byte{}}
	for name, s := range secrets {
		if len(s) != 32 {
			return nil, fmt.Errorf("signer: the %s secret is not 32 bytes", name)
		}
		w, err := kek.Wrap(ctx, s)
		if err != nil {
			return nil, err
		}
		f.Keys[name] = w
	}
	return f, nil
}

// Open unwraps a key file with kek, which must be the KEK it was sealed under.
func Open(ctx context.Context, kek vault.KEK, f *KeyFile) (map[string]nostr.Keys, error) {
	if f.KEK != kek.ID() {
		return nil, fmt.Errorf("signer: the key file was sealed under %s, not %s", f.KEK, kek.ID())
	}
	out := map[string]nostr.Keys{}
	for name, w := range f.Keys {
		s, err := kek.Unwrap(ctx, w)
		if err != nil {
			return nil, fmt.Errorf("signer: unwrap %s: %w", name, err)
		}
		k, err := nostr.KeysFromSecret(s)
		clear(s)
		if err != nil {
			return nil, err
		}
		out[name] = k
	}
	return out, nil
}
