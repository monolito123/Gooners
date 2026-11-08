// Package relay is a small Nostr relay (NIP-01) for the sandbox and the tests, with the
// rules the platform's receipts need from a production relay (docs/03 §3.2, §9):
//
//   - anyone may publish a valid event (the platform publishes without authenticating);
//   - gift wraps (kind 1059) are read only by their recipient, authenticated with NIP-42:
//     a REQ for them is CLOSED with "auth-required:" until the reader proves the key the wrap
//     names, and the relay records that the receipt was claimed;
//   - an event past its NIP-40 expiration is neither stored nor served.
//
// Production uses operated or contracted relays with the same rules (strfry, nostr-rs-relay
// with authentication); this one keeps events in memory.
package relay

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// Relay holds events in memory.
type Relay struct {
	// MaxEvents bounds the store (oldest dropped first); 0 means 50,000.
	MaxEvents int
	Log       *slog.Logger
	Now       func() time.Time

	mu      sync.Mutex
	events  []*nostr.Event
	seen    map[string]bool
	conns   map[*conn]bool
	claimed map[string]time.Time // gift wrap id → when its recipient first read it
}

// Filter is a NIP-01 subscription filter.
type Filter struct {
	IDs     []string `json:"ids,omitempty"`
	Authors []string `json:"authors,omitempty"`
	Kinds   []int    `json:"kinds,omitempty"`
	P       []string `json:"#p,omitempty"`
	E       []string `json:"#e,omitempty"`
	Since   *int64   `json:"since,omitempty"`
	Until   *int64   `json:"until,omitempty"`
	Limit   int      `json:"limit,omitempty"`
}

func (f Filter) match(e *nostr.Event) bool {
	if len(f.IDs) > 0 && !slices.Contains(f.IDs, e.ID) ||
		len(f.Authors) > 0 && !slices.Contains(f.Authors, e.PubKey) ||
		len(f.Kinds) > 0 && !slices.Contains(f.Kinds, e.Kind) ||
		f.Since != nil && e.CreatedAt < *f.Since || f.Until != nil && e.CreatedAt > *f.Until {
		return false
	}
	return tagMatch(e, "p", f.P) && tagMatch(e, "e", f.E)
}

func tagMatch(e *nostr.Event, name string, want []string) bool {
	if len(want) == 0 {
		return true
	}
	for _, t := range e.Tags {
		if len(t) >= 2 && t[0] == name && slices.Contains(want, t[1]) {
			return true
		}
	}
	return false
}

func tag(e *nostr.Event, name string) string {
	for _, t := range e.Tags {
		if len(t) >= 2 && t[0] == name {
			return t[1]
		}
	}
	return ""
}

func (r *Relay) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func (r *Relay) logger() *slog.Logger {
	if r.Log != nil {
		return r.Log
	}
	return slog.Default()
}

func expired(e *nostr.Event, now time.Time) bool {
	exp, err := strconv.ParseInt(tag(e, "expiration"), 10, 64)
	return err == nil && now.Unix() >= exp
}

// Claimed reports when the recipient of a gift wrap first read it (zero if never).
func (r *Relay) Claimed(wrapID string) time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.claimed[wrapID]
}

type conn struct {
	ws        *websocket.Conn
	challenge string
	authed    map[string]bool
	subs      map[string][]Filter
	mu        sync.Mutex
}

func (c *conn) send(ctx context.Context, v ...any) {
	b, _ := json.Marshal(v)
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.ws.Write(ctx, websocket.MessageText, b)
}

// ServeHTTP accepts a WebSocket and speaks NIP-01 and NIP-42 on it.
func (r *Relay) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	ws, err := websocket.Accept(w, req, &websocket.AcceptOptions{InsecureSkipVerify: true}) // the claim page connects from another origin
	if err != nil {
		return
	}
	ws.SetReadLimit(1 << 20)
	ctx := req.Context()
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	c := &conn{ws: ws, challenge: hex.EncodeToString(b), authed: map[string]bool{}, subs: map[string][]Filter{}}
	r.mu.Lock()
	if r.conns == nil {
		r.conns, r.seen, r.claimed = map[*conn]bool{}, map[string]bool{}, map[string]time.Time{}
	}
	r.conns[c] = true
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.conns, c)
		r.mu.Unlock()
		ws.Close(websocket.StatusNormalClosure, "")
	}()
	c.send(ctx, "AUTH", c.challenge)
	for {
		_, data, err := ws.Read(ctx)
		if err != nil {
			return
		}
		var frame []json.RawMessage
		if json.Unmarshal(data, &frame) != nil || len(frame) == 0 {
			c.send(ctx, "NOTICE", "invalid: not a JSON array")
			continue
		}
		var typ string
		_ = json.Unmarshal(frame[0], &typ)
		switch {
		case typ == "EVENT" && len(frame) >= 2:
			r.event(ctx, c, frame[1])
		case typ == "REQ" && len(frame) >= 3:
			r.req(ctx, c, frame[1:])
		case typ == "CLOSE" && len(frame) >= 2:
			var id string
			_ = json.Unmarshal(frame[1], &id)
			c.mu.Lock()
			delete(c.subs, id)
			c.mu.Unlock()
		case typ == "AUTH" && len(frame) >= 2:
			r.auth(ctx, c, frame[1], req)
		default:
			c.send(ctx, "NOTICE", "invalid: unknown message")
		}
	}
}

func (r *Relay) event(ctx context.Context, c *conn, raw json.RawMessage) {
	var e nostr.Event
	if json.Unmarshal(raw, &e) != nil {
		c.send(ctx, "NOTICE", "invalid: not an event")
		return
	}
	if err := e.Verify(); err != nil {
		c.send(ctx, "OK", e.ID, false, "invalid: "+err.Error())
		return
	}
	now := r.now()
	if expired(&e, now) {
		c.send(ctx, "OK", e.ID, false, "invalid: expired")
		return
	}
	r.mu.Lock()
	if r.seen == nil {
		r.seen, r.claimed = map[string]bool{}, map[string]time.Time{}
	}
	dup := r.seen[e.ID]
	if !dup {
		r.seen[e.ID] = true
		r.events = append(r.events, &e)
		max := r.MaxEvents
		if max == 0 {
			max = 50000
		}
		if len(r.events) > max {
			delete(r.seen, r.events[0].ID)
			r.events = r.events[1:]
		}
	}
	listeners := make([]*conn, 0, len(r.conns))
	for l := range r.conns {
		listeners = append(listeners, l)
	}
	r.mu.Unlock()
	c.send(ctx, "OK", e.ID, true, map[bool]string{true: "duplicate:", false: ""}[dup])
	if dup {
		return
	}
	for _, l := range listeners {
		l.mu.Lock()
		subs := make(map[string][]Filter, len(l.subs))
		for id, fs := range l.subs {
			subs[id] = fs
		}
		l.mu.Unlock()
		for id, fs := range subs {
			for _, f := range fs {
				if f.match(&e) && r.readable(l, &e) {
					l.send(ctx, "EVENT", id, &e)
					r.markClaimed(l, &e)
					break
				}
			}
		}
	}
}

// readable: gift wraps only by an authenticated recipient.
func (r *Relay) readable(c *conn, e *nostr.Event) bool {
	if e.Kind != 1059 {
		return true
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.authed[tag(e, "p")]
}

func (r *Relay) markClaimed(c *conn, e *nostr.Event) {
	if e.Kind != 1059 {
		return
	}
	r.mu.Lock()
	first := r.claimed[e.ID].IsZero()
	if first {
		r.claimed[e.ID] = r.now()
	}
	r.mu.Unlock()
	if first {
		r.logger().Info("relay: gift wrap claimed by its recipient", "wrap", e.ID, "recipient", tag(e, "p"))
	}
}

func (r *Relay) req(ctx context.Context, c *conn, args []json.RawMessage) {
	var id string
	_ = json.Unmarshal(args[0], &id)
	var filters []Filter
	for _, raw := range args[1:] {
		var f Filter
		if json.Unmarshal(raw, &f) != nil {
			c.send(ctx, "CLOSED", id, "invalid: bad filter")
			return
		}
		filters = append(filters, f)
	}
	// A filter that can reach gift wraps must name recipients the connection has proven.
	for _, f := range filters {
		if len(f.Kinds) == 0 || slices.Contains(f.Kinds, 1059) {
			c.mu.Lock()
			ok := len(f.P) > 0
			for _, p := range f.P {
				ok = ok && c.authed[p]
			}
			c.mu.Unlock()
			if !ok && (len(f.Kinds) > 0 || len(f.P) > 0) {
				c.send(ctx, "CLOSED", id, "auth-required: gift wraps are read only by their recipient")
				return
			}
		}
	}
	c.mu.Lock()
	c.subs[id] = filters
	c.mu.Unlock()
	now := r.now()
	r.mu.Lock()
	var out []*nostr.Event
	for i := len(r.events) - 1; i >= 0; i-- {
		e := r.events[i]
		if expired(e, now) {
			continue
		}
		for _, f := range filters {
			if f.match(e) && (f.Limit == 0 || countFor(out, f) < f.Limit) {
				out = append(out, e)
				break
			}
		}
	}
	r.mu.Unlock()
	for _, e := range out {
		if r.readable(c, e) {
			c.send(ctx, "EVENT", id, e)
			r.markClaimed(c, e)
		}
	}
	c.send(ctx, "EOSE", id)
}

func countFor(es []*nostr.Event, f Filter) int {
	n := 0
	for _, e := range es {
		if f.match(e) {
			n++
		}
	}
	return n
}

// auth checks a NIP-42 event: kind 22242, this connection's challenge, recent, signed.
func (r *Relay) auth(ctx context.Context, c *conn, raw json.RawMessage, req *http.Request) {
	var e nostr.Event
	if json.Unmarshal(raw, &e) != nil {
		c.send(ctx, "NOTICE", "invalid: not an event")
		return
	}
	now := r.now()
	at := time.Unix(e.CreatedAt, 0)
	switch {
	case e.Kind != 22242:
		c.send(ctx, "OK", e.ID, false, "invalid: not a kind 22242 event")
	case tag(&e, "challenge") != c.challenge:
		c.send(ctx, "OK", e.ID, false, "invalid: wrong challenge")
	case tag(&e, "relay") == "":
		c.send(ctx, "OK", e.ID, false, "invalid: no relay tag")
	case at.Before(now.Add(-10*time.Minute)) || at.After(now.Add(10*time.Minute)):
		c.send(ctx, "OK", e.ID, false, "invalid: created_at too far from now")
	case e.Verify() != nil:
		c.send(ctx, "OK", e.ID, false, "invalid: bad signature")
	default:
		c.mu.Lock()
		c.authed[e.PubKey] = true
		c.mu.Unlock()
		c.send(ctx, "OK", e.ID, true, "")
	}
}
