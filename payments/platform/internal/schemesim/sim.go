// Package schemesim is an ISO 8583 host simulator: it plays the scheme network and the
// issuer (or a sponsor acquirer's host) so the switch can be tested end to end, the same
// way scheme test environments are used before certification.
//
// Outcomes are driven by the cents of the amount (DE 4), like scheme test card scripts:
//
//	..05 → 05 do not honor          ..51 → 51 insufficient funds   ..54 → 54 expired card
//	..55 → 55 incorrect PIN         ..57 → 57 not permitted         ..59 → 59 suspected fraud
//	..61 → 61 exceeds limit         ..65 → 65 PIN required (soft)   ..91 → 91 issuer unavailable
//	..96 → 96 system malfunction    ..98 → no response (timeout)    ..99 → late response (LateDelay)
//	anything else → 00 approved with a 6-character authorization code
package schemesim

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
)

// Sim is a running simulator.
type Sim struct {
	Codec *iso8583.Codec
	// LateDelay is how long a "..99" authorization waits before answering (default 3 s).
	LateDelay time.Duration
	// RequireSignOn makes the host refuse financial messages before a 0800/001 on the connection.
	RequireSignOn bool
	Logger        *slog.Logger

	mu       sync.Mutex
	received []*iso8583.Message
	ln       net.Listener
	conns    map[net.Conn]struct{}
	approved map[string]string // RRN → auth code, for reversal checks
}

// New returns a simulator for a dialect.
func New(codec *iso8583.Codec) *Sim {
	return &Sim{Codec: codec, LateDelay: 3 * time.Second, Logger: slog.Default(), conns: map[net.Conn]struct{}{}, approved: map[string]string{}}
}

// Listen starts serving on addr ("127.0.0.1:0" for an ephemeral port). tlsCfg may be nil.
func (s *Sim) Listen(addr string, tlsCfg *tls.Config) (string, error) {
	var ln net.Listener
	var err error
	if tlsCfg != nil {
		ln, err = tls.Listen("tcp", addr, tlsCfg)
	} else {
		ln, err = net.Listen("tcp", addr)
	}
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	s.ln = ln
	s.mu.Unlock()
	go s.accept(ln)
	return ln.Addr().String(), nil
}

// Close stops the listener and drops every connection.
func (s *Sim) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ln != nil {
		s.ln.Close()
	}
	for c := range s.conns {
		c.Close()
	}
}

// DropConnections closes live connections but keeps listening (for reconnect tests).
func (s *Sim) DropConnections() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for c := range s.conns {
		c.Close()
		delete(s.conns, c)
	}
}

// Received returns a copy of every message received, in order.
func (s *Sim) Received() []*iso8583.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*iso8583.Message, len(s.received))
	for i, m := range s.received {
		out[i] = m.Clone()
	}
	return out
}

// ReceivedMTI counts received messages of one MTI.
func (s *Sim) ReceivedMTI(mti string) []*iso8583.Message {
	var out []*iso8583.Message
	for _, m := range s.Received() {
		if m.MTI == mti {
			out = append(out, m)
		}
	}
	return out
}

func (s *Sim) accept(ln net.Listener) {
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		s.mu.Lock()
		s.conns[c] = struct{}{}
		s.mu.Unlock()
		go s.serve(c)
	}
}

func (s *Sim) serve(c net.Conn) {
	defer func() {
		c.Close()
		s.mu.Lock()
		delete(s.conns, c)
		s.mu.Unlock()
	}()
	var wmu sync.Mutex
	signedOn := false
	var signMu sync.Mutex
	write := func(m *iso8583.Message) {
		b, err := s.Codec.Pack(m)
		if err != nil {
			s.Logger.Error("schemesim pack", "err", err)
			return
		}
		wmu.Lock()
		defer wmu.Unlock()
		_ = s.Codec.WriteFrame(c, b)
	}
	for {
		frame, err := s.Codec.ReadFrame(c)
		if err != nil {
			return
		}
		m, err := s.Codec.Unpack(frame)
		if err != nil {
			s.Logger.Error("schemesim unpack", "err", err)
			continue
		}
		s.mu.Lock()
		s.received = append(s.received, m.Clone())
		s.mu.Unlock()
		if iso8583.IsResponse(m.MTI) {
			continue // answers to our own echo tests
		}
		if m.MTI == "0800" {
			if m.Get(70) == "001" {
				signMu.Lock()
				signedOn = true
				signMu.Unlock()
			}
			write(echoResponse(m, "00", 7, 11, 32, 70))
			continue
		}
		signMu.Lock()
		ok := signedOn || !s.RequireSignOn
		signMu.Unlock()
		if !ok {
			write(echoResponse(m, "91", 2, 3, 4, 7, 11, 37, 41, 42, 49))
			continue
		}
		go s.handle(m, write)
	}
}

func echoResponse(req *iso8583.Message, rc string, fields ...int) *iso8583.Message {
	mti, _ := iso8583.ResponseMTI(req.MTI)
	resp := iso8583.NewMessage(mti)
	for _, n := range fields {
		resp.Set(n, req.Get(n))
	}
	return resp.Set(39, rc)
}

var echoed = []int{2, 3, 4, 7, 11, 12, 13, 19, 32, 37, 41, 42, 49}

func (s *Sim) handle(m *iso8583.Message, write func(*iso8583.Message)) {
	switch m.MTI {
	case "0100", "0200":
		cents := ""
		if a := m.Get(4); len(a) >= 2 {
			cents = a[len(a)-2:]
		}
		refund := strings.HasPrefix(m.Get(3), "20")
		rc := "00"
		if !refund {
			switch cents {
			case "05", "51", "54", "55", "57", "59", "61", "65", "91", "96":
				rc = cents
			case "98":
				return // never answers: the switch must time out and reverse
			case "99":
				time.Sleep(s.LateDelay)
			}
		}
		resp := echoResponse(m, rc, echoed...)
		if rc == "00" {
			code := randomCode()
			resp.Set(38, code)
			if s.Codec.Spec().Field(62) != nil {
				resp.Set(62, randomDigits(15)) // network transaction ID, stored for MIT linkage
			}
			s.mu.Lock()
			s.approved[m.Get(37)] = code
			s.mu.Unlock()
		}
		if m.Has(55) && rc == "00" {
			// Issuer authentication data (tag 91) as a stand-in ARPC.
			resp.Set(55, "910A"+randomHex(8)+"3030")
		}
		if rc == "65" && s.Codec.Spec().Field(48) != nil {
			resp.Set(48, "84"+"02"+"02") // Mastercard-style merchant advice code sub-element (illustrative)
		}
		write(resp)
	case "0400", "0420":
		write(echoResponse(m, "00", append(echoed, 90, 95)...))
	case "0120":
		write(echoResponse(m, "00", echoed...))
	default:
		s.Logger.Warn("schemesim: unsupported MTI", "mti", m.MTI)
	}
}

// SendEcho makes the simulator initiate a 0800/301 on every connection (host-initiated echo).
func (s *Sim) SendEcho(ctx context.Context) error {
	s.mu.Lock()
	conns := make([]net.Conn, 0, len(s.conns))
	for c := range s.conns {
		conns = append(conns, c)
	}
	s.mu.Unlock()
	if len(conns) == 0 {
		return errors.New("schemesim: no connections")
	}
	for _, c := range conns {
		m := iso8583.NewMessage("0800").Set(7, time.Now().UTC().Format("0102150405")).Set(11, randomDigits(6)).Set(70, "301")
		b, err := s.Codec.Pack(m)
		if err != nil {
			return err
		}
		if err := s.Codec.WriteFrame(c, b); err != nil {
			return fmt.Errorf("schemesim: echo: %w", err)
		}
	}
	return nil
}

func randomCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"
	var sb strings.Builder
	for i := 0; i < 6; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		sb.WriteByte(alphabet[n.Int64()])
	}
	return sb.String()
}

func randomDigits(n int) string {
	var sb strings.Builder
	for i := 0; i < n; i++ {
		d, _ := rand.Int(rand.Reader, big.NewInt(10))
		sb.WriteByte(byte('0' + d.Int64()))
	}
	return sb.String()
}

func randomHex(nBytes int) string {
	b := make([]byte, nBytes)
	_, _ = rand.Read(b)
	return strings.ToUpper(fmt.Sprintf("%x", b))
}
