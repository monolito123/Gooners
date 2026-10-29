package scheme

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
)

// Pool spreads traffic over the signed-on sessions of one route (for example the two
// colocation sites of a scheme connection) and tracks route health for the router.
type Pool struct {
	Name     string
	sessions []*Session
	rr       atomic.Uint64
	health   *breaker
}

// NewPool groups sessions under a route name.
func NewPool(name string, sessions ...*Session) *Pool {
	return &Pool{Name: name, sessions: sessions, health: newBreaker(60*time.Second, 50, 0.02, 1500*time.Millisecond)}
}

// Run starts every session; it returns when ctx is cancelled.
func (p *Pool) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for _, s := range p.sessions {
		wg.Add(1)
		go func(s *Session) { defer wg.Done(); s.Run(ctx) }(s)
	}
	wg.Wait()
}

// Ready reports whether at least one session is signed on.
func (p *Pool) Ready() bool {
	for _, s := range p.sessions {
		if s.State() == SignedOn {
			return true
		}
	}
	return false
}

// Healthy is Ready plus a closed circuit breaker.
func (p *Pool) Healthy() bool { return p.Ready() && p.health.closed() }

// WaitReady blocks until a session is signed on or ctx ends.
func (p *Pool) WaitReady(ctx context.Context) error {
	t := time.NewTicker(20 * time.Millisecond)
	defer t.Stop()
	for !p.Ready() {
		select {
		case <-ctx.Done():
			return fmt.Errorf("pool %s: %w", p.Name, ctx.Err())
		case <-t.C:
		}
	}
	return nil
}

// Exchange sends req on the next signed-on session, round robin.
func (p *Pool) Exchange(ctx context.Context, req *iso8583.Message, timeout time.Duration) (*iso8583.Message, error) {
	n := len(p.sessions)
	start := int(p.rr.Add(1))
	for i := 0; i < n; i++ {
		s := p.sessions[(start+i)%n]
		if s.State() != SignedOn {
			continue
		}
		t0 := time.Now()
		resp, err := s.Exchange(ctx, req, timeout)
		if errors.Is(err, ErrNotSent) {
			continue // try the other site; nothing reached the network
		}
		p.health.record(err == nil, time.Since(t0))
		return resp, err
	}
	return nil, fmt.Errorf("%w: no signed-on session on route %s", ErrNotSent, p.Name)
}

// breaker opens when the error rate or p99 latency over a window exceeds its limits.
type breaker struct {
	mu        sync.Mutex
	window    time.Duration
	minN      int
	maxErr    float64
	maxP99    time.Duration
	samples   []sample
	openUntil time.Time
	lastEval  time.Time
}

type sample struct {
	at  time.Time
	ok  bool
	lat time.Duration
}

func newBreaker(window time.Duration, minN int, maxErr float64, maxP99 time.Duration) *breaker {
	return &breaker{window: window, minN: minN, maxErr: maxErr, maxP99: maxP99}
}

func (b *breaker) record(ok bool, lat time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	b.samples = append(b.samples, sample{now, ok, lat})
	cut := 0
	for cut < len(b.samples) && now.Sub(b.samples[cut].at) > b.window {
		cut++
	}
	b.samples = b.samples[cut:]
	if len(b.samples) < b.minN || now.Sub(b.lastEval) < time.Second && ok {
		return // evaluate at most once a second, but always right after an error
	}
	b.lastEval = now
	errs := 0
	lats := make([]time.Duration, 0, len(b.samples))
	for _, s := range b.samples {
		if !s.ok {
			errs++
		}
		lats = append(lats, s.lat)
	}
	p99 := percentile(lats, 0.99)
	if float64(errs)/float64(len(b.samples)) > b.maxErr || p99 > b.maxP99 {
		b.openUntil = now.Add(30 * time.Second)
	}
}

func (b *breaker) closed() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return time.Now().After(b.openUntil)
}

func percentile(d []time.Duration, p float64) time.Duration {
	if len(d) == 0 {
		return 0
	}
	sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
	idx := int(float64(len(d)-1) * p)
	return d[idx]
}
