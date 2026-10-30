package api

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// limiter is a token bucket per key. It protects one replica; the edge (WAF / API gateway)
// enforces the global limits of docs/02 §1.
type limiter struct {
	mu      sync.Mutex
	rate    float64 // tokens per second
	burst   float64
	buckets map[string]*bucket
	calls   int
	now     func() time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newLimiter(perSecond, burst float64) *limiter {
	return &limiter{rate: perSecond, burst: burst, buckets: map[string]*bucket{}, now: time.Now}
}

func (l *limiter) refill(key string) *bucket {
	now := l.now()
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens = min(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.rate)
	b.last = now
	l.calls++
	if l.calls%4096 == 0 { // evict idle buckets so the map cannot grow without bound
		for k, x := range l.buckets {
			if now.Sub(x.last) > 10*time.Minute {
				delete(l.buckets, k)
			}
		}
	}
	return b
}

// take consumes a token; when none is left it reports how long until one is.
func (l *limiter) take(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.refill(key)
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	return false, time.Duration((1 - b.tokens) / l.rate * float64(time.Second))
}

// clientIP is the peer address, or the address the trusted proxy appended to
// X-Forwarded-For (its rightmost entry) when the server runs behind one.
func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// retryAfter formats a Retry-After header value: whole seconds, rounded up.
func retryAfter(d time.Duration) string { return strconv.Itoa(int(d.Seconds()) + 1) }
