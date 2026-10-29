// Package scheme keeps persistent ISO 8583 sessions to a scheme or sponsor host:
// connect, sign on, echo when idle, correlate responses to requests, reconnect with backoff.
package scheme

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
)

// State of a session.
type State int32

const (
	Disconnected State = iota
	Connected
	SignedOn
	Draining
)

func (s State) String() string {
	return [...]string{"DISCONNECTED", "CONNECTED", "SIGNED_ON", "DRAINING"}[s]
}

// Errors returned by Exchange. The distinction matters for cascading: a request that was
// never written can be retried on another route; one whose outcome is unknown must be reversed.
var (
	ErrNotSent        = errors.New("scheme: request not sent")
	ErrTimeout        = errors.New("scheme: response timeout")
	ErrUnknownOutcome = errors.New("scheme: connection lost after the request was written")
)

// Network management codes (DE 70).
const (
	NMSignOn  = "001"
	NMSignOff = "002"
	NMEcho    = "301"
)

// Config of one session.
type Config struct {
	Name         string
	Addr         string
	TLS          *tls.Config // nil means plain TCP; refuse in production at the config layer
	Codec        *iso8583.Codec
	AcquirerID   string // DE 32 on network management messages
	SignOn       bool
	EchoInterval time.Duration // idle time before an echo test (default 30 s)
	EchoMisses   int           // consecutive failed echoes before the session is dropped (default 3)
	NMTimeout    time.Duration // timeout for network management exchanges (default 5 s)
	DialTimeout  time.Duration
	STAN         *STANSource
	Logger       *slog.Logger
	// OnRequest handles requests initiated by the host (advices, host echo tests are answered automatically).
	// It returns the response to send, or nil to send nothing.
	OnRequest func(*iso8583.Message) *iso8583.Message
	// OnLate receives responses that arrived after their request timed out.
	OnLate func(*iso8583.Message)
	Now    func() time.Time
}

// Session is one TCP/TLS connection, re-established automatically by Run.
type Session struct {
	cfg     Config
	state   atomic.Int32
	mu      sync.Mutex // guards conn and pending
	writeMu sync.Mutex
	conn    net.Conn
	pending map[string]chan *iso8583.Message
	lastRx  atomic.Int64
	gen     atomic.Uint64 // connection generation, to detect drops while waiting
}

// NewSession validates cfg and returns an idle session.
func NewSession(cfg Config) *Session {
	if cfg.EchoInterval == 0 {
		cfg.EchoInterval = 30 * time.Second
	}
	if cfg.EchoMisses == 0 {
		cfg.EchoMisses = 3
	}
	if cfg.NMTimeout == 0 {
		cfg.NMTimeout = 5 * time.Second
	}
	if cfg.DialTimeout == 0 {
		cfg.DialTimeout = 5 * time.Second
	}
	if cfg.STAN == nil {
		cfg.STAN = NewSTANSource()
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	cfg.Logger = cfg.Logger.With("session", cfg.Name)
	return &Session{cfg: cfg, pending: map[string]chan *iso8583.Message{}}
}

// State returns the current state.
func (s *Session) State() State { return State(s.state.Load()) }

// Name returns the session name.
func (s *Session) Name() string { return s.cfg.Name }

// Run connects and serves until ctx is cancelled, reconnecting with jittered backoff.
func (s *Session) Run(ctx context.Context) {
	backoff := 500 * time.Millisecond
	for ctx.Err() == nil {
		err := s.connectAndServe(ctx)
		s.state.Store(int32(Disconnected))
		if ctx.Err() != nil {
			return
		}
		s.cfg.Logger.Warn("session down", "err", err, "retry_in", backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff + time.Duration(rand.Int64N(int64(backoff/2)+1))):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (s *Session) connectAndServe(ctx context.Context) error {
	d := net.Dialer{Timeout: s.cfg.DialTimeout, KeepAlive: 30 * time.Second}
	var conn net.Conn
	var err error
	if s.cfg.TLS != nil {
		conn, err = (&tls.Dialer{NetDialer: &d, Config: s.cfg.TLS}).DialContext(ctx, "tcp", s.cfg.Addr)
	} else {
		conn, err = d.DialContext(ctx, "tcp", s.cfg.Addr)
	}
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.conn = conn
	s.mu.Unlock()
	gen := s.gen.Add(1)
	s.state.Store(int32(Connected))
	s.lastRx.Store(s.cfg.Now().UnixNano())

	readErr := make(chan error, 1)
	go func() { readErr <- s.readLoop(conn) }()

	defer func() {
		conn.Close()
		s.failPending(gen)
	}()

	if s.cfg.SignOn {
		if err := s.networkManagement(ctx, NMSignOn); err != nil {
			return fmt.Errorf("sign-on: %w", err)
		}
	}
	s.state.Store(int32(SignedOn))
	s.cfg.Logger.Info("signed on", "addr", s.cfg.Addr)

	tick := time.NewTicker(s.cfg.EchoInterval / 2)
	defer tick.Stop()
	misses := 0
	for {
		select {
		case <-ctx.Done():
			s.state.Store(int32(Draining))
			if s.cfg.SignOn {
				_ = s.networkManagement(context.Background(), NMSignOff)
			}
			return ctx.Err()
		case err := <-readErr:
			return err
		case <-tick.C:
			idle := s.cfg.Now().Sub(time.Unix(0, s.lastRx.Load()))
			if idle < s.cfg.EchoInterval {
				continue
			}
			if err := s.networkManagement(ctx, NMEcho); err != nil {
				misses++
				s.cfg.Logger.Warn("echo failed", "misses", misses, "err", err)
				if misses >= s.cfg.EchoMisses {
					return fmt.Errorf("echo: %d consecutive misses", misses)
				}
				continue
			}
			misses = 0
		}
	}
}

func (s *Session) networkManagement(ctx context.Context, code string) error {
	now := s.cfg.Now().UTC()
	req := iso8583.NewMessage("0800").
		Set(7, now.Format("0102150405")).
		Set(11, s.cfg.STAN.Next()).
		Set(70, code)
	if s.cfg.AcquirerID != "" && s.cfg.Codec.Spec().Field(32) != nil {
		req.Set(32, s.cfg.AcquirerID)
	}
	resp, err := s.exchange(ctx, req, s.cfg.NMTimeout, true)
	if err != nil {
		return err
	}
	if rc := resp.Get(39); rc != "00" {
		return fmt.Errorf("network management %s refused: DE39=%s", code, rc)
	}
	return nil
}

// Exchange sends req and waits for the matching response.
func (s *Session) Exchange(ctx context.Context, req *iso8583.Message, timeout time.Duration) (*iso8583.Message, error) {
	if s.State() != SignedOn {
		return nil, fmt.Errorf("%w: session %s is %s", ErrNotSent, s.cfg.Name, s.State())
	}
	return s.exchange(ctx, req, timeout, false)
}

func correlationKey(mti string, m *iso8583.Message) string {
	return mti + "|" + m.Get(11) + "|" + m.Get(7) + "|" + m.Get(41)
}

func (s *Session) exchange(ctx context.Context, req *iso8583.Message, timeout time.Duration, nm bool) (*iso8583.Message, error) {
	respMTI, err := iso8583.ResponseMTI(req.MTI)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNotSent, err)
	}
	payload, err := s.cfg.Codec.Pack(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNotSent, err)
	}
	key := correlationKey(respMTI, req)
	ch := make(chan *iso8583.Message, 1)

	s.mu.Lock()
	conn := s.conn
	if conn == nil {
		s.mu.Unlock()
		return nil, fmt.Errorf("%w: not connected", ErrNotSent)
	}
	if _, dup := s.pending[key]; dup {
		s.mu.Unlock()
		return nil, fmt.Errorf("%w: duplicate in-flight key %s", ErrNotSent, key)
	}
	s.pending[key] = ch
	gen := s.gen.Load()
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		if s.pending[key] == ch {
			delete(s.pending, key)
		}
		s.mu.Unlock()
	}()

	s.writeMu.Lock()
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	werr := s.cfg.Codec.WriteFrame(conn, payload)
	s.writeMu.Unlock()
	if werr != nil {
		conn.Close()
		return nil, fmt.Errorf("%w: write: %v", ErrUnknownOutcome, werr)
	}
	if !nm {
		s.cfg.Logger.Debug("sent", "msg", req.Dump(s.cfg.Codec.Spec()))
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case resp, ok := <-ch:
		if !ok || resp == nil {
			return nil, ErrUnknownOutcome
		}
		return resp, nil
	case <-timer.C:
		if s.gen.Load() != gen {
			return nil, ErrUnknownOutcome
		}
		return nil, ErrTimeout
	case <-ctx.Done():
		return nil, fmt.Errorf("%w: %v", ErrUnknownOutcome, ctx.Err())
	}
}

func (s *Session) readLoop(conn net.Conn) error {
	for {
		frame, err := s.cfg.Codec.ReadFrame(conn)
		if err != nil {
			return err
		}
		s.lastRx.Store(s.cfg.Now().UnixNano())
		msg, err := s.cfg.Codec.Unpack(frame)
		if err != nil {
			s.cfg.Logger.Error("unparseable message from host", "err", err, "bytes", len(frame))
			continue
		}
		if iso8583.IsResponse(msg.MTI) {
			s.deliver(msg)
			continue
		}
		go s.handleHostRequest(conn, msg)
	}
}

func (s *Session) deliver(msg *iso8583.Message) {
	key := correlationKey(msg.MTI, msg)
	s.mu.Lock()
	ch, ok := s.pending[key]
	if ok {
		delete(s.pending, key)
	}
	s.mu.Unlock()
	if ok {
		ch <- msg
		return
	}
	s.cfg.Logger.Warn("late or unmatched response", "msg", msg.Dump(s.cfg.Codec.Spec()))
	if s.cfg.OnLate != nil {
		s.cfg.OnLate(msg)
	}
}

func (s *Session) handleHostRequest(conn net.Conn, msg *iso8583.Message) {
	var resp *iso8583.Message
	if msg.MTI == "0800" {
		mti, _ := iso8583.ResponseMTI(msg.MTI)
		resp = iso8583.NewMessage(mti)
		for _, n := range []int{7, 11, 32, 70} {
			resp.Set(n, msg.Get(n))
		}
		resp.Set(39, "00")
	} else if s.cfg.OnRequest != nil {
		resp = s.cfg.OnRequest(msg)
	} else {
		s.cfg.Logger.Warn("unhandled host request", "msg", msg.Dump(s.cfg.Codec.Spec()))
		return
	}
	if resp == nil {
		return
	}
	b, err := s.cfg.Codec.Pack(resp)
	if err != nil {
		s.cfg.Logger.Error("pack host response", "err", err)
		return
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if err := s.cfg.Codec.WriteFrame(conn, b); err != nil {
		s.cfg.Logger.Error("write host response", "err", err)
	}
}

func (s *Session) failPending(gen uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.gen.Load() != gen {
		return
	}
	for k, ch := range s.pending {
		close(ch)
		delete(s.pending, k)
	}
	s.conn = nil
}

// STANSource issues system trace audit numbers 000001..999999, wrapping.
type STANSource struct{ n atomic.Uint32 }

// NewSTANSource starts at a random point so restarts do not reuse recent STANs.
func NewSTANSource() *STANSource {
	s := &STANSource{}
	s.n.Store(uint32(rand.IntN(900000)))
	return s
}

// Next returns the next STAN.
func (s *STANSource) Next() string {
	for {
		v := s.n.Add(1)
		if v <= 999999 {
			return fmt.Sprintf("%06d", v)
		}
		s.n.CompareAndSwap(v, 0)
	}
}
