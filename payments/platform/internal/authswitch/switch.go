package authswitch

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/scheme"
	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
)

// Config of the switch.
type Config struct {
	CardPresentTimeout time.Duration // T_resp for card-present (default 10 s)
	CNPTimeout         time.Duration // T_resp for card-not-present (default 15 s)
	ReversalTimeout    time.Duration // wait for a 0410 (default 10 s)
	MaxReversalAge     time.Duration // after this, retries become 0420 advices (default 24 h)
	Now                func() time.Time
	Logger             *slog.Logger
}

// Switch is the authorization switch.
type Switch struct {
	routes []*Route
	byName map[string]*Route
	store  Store
	pans   PANResolver
	cfg    Config
}

// New returns a switch over routes.
func New(routes []*Route, store Store, pans PANResolver, cfg Config) *Switch {
	if cfg.CardPresentTimeout == 0 {
		cfg.CardPresentTimeout = 10 * time.Second
	}
	if cfg.CNPTimeout == 0 {
		cfg.CNPTimeout = 15 * time.Second
	}
	if cfg.ReversalTimeout == 0 {
		cfg.ReversalTimeout = 10 * time.Second
	}
	if cfg.MaxReversalAge == 0 {
		cfg.MaxReversalAge = 24 * time.Hour
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	by := map[string]*Route{}
	for _, r := range routes {
		if r.STAN == nil {
			r.STAN = scheme.NewSTANSource()
		}
		by[r.Name] = r
	}
	return &Switch{routes: routes, byName: by, store: store, pans: pans, cfg: cfg}
}

func validate(r Request) error {
	switch {
	case r.AuthID == "" || r.TenantID == "":
		return errors.New("auth_id and tenant_id are required")
	case r.Amount < 0, r.Amount == 0 && r.Kind != Verification:
		return errors.New("amount must be positive")
	case len(r.CurrencyNumeric) != 3:
		return errors.New("currency must be ISO 4217 numeric")
	case r.TerminalID == "" || len(r.TerminalSTAN) != 6:
		return errors.New("terminal_id and a 6-digit terminal STAN are required")
	case r.Merchant.SchemeMID == "" || len(r.Merchant.MCC) != 4:
		return errors.New("merchant scheme MID and MCC are required")
	}
	return nil
}

// Authorize sends one authorization and returns its outcome. A timeout or a lost
// connection after sending returns StatusTimedOut and queues a reversal; the caller
// must treat the payment as declined.
func (s *Switch) Authorize(ctx context.Context, r Request) (Result, error) {
	if err := validate(r); err != nil {
		return Result{}, fmt.Errorf("authswitch: %w", err)
	}
	local := r.TerminalLocal
	if local.IsZero() {
		local = s.cfg.Now()
	}
	rec := &Record{
		AuthID: r.AuthID, TenantID: r.TenantID, PaymentIntentID: r.PaymentIntentID, Kind: r.Kind,
		TerminalID: r.TerminalID, TerminalSTAN: r.TerminalSTAN, LocalDate: local.Format("20060102"),
		Amount: r.Amount, CurrencyNumeric: r.CurrencyNumeric, ProcessingCode: ProcessingCode(r),
		EntryMode: r.Card.EntryMode, PANRef: r.Card.PANRef, Expiry: r.Card.Expiry,
		MerchantMID: r.Merchant.SchemeMID, MCC: r.Merchant.MCC, MerchantName: r.Merchant.Name, MerchantCity: r.Merchant.City,
		AcquirerID: r.AcquirerID, Status: StatusReceived,
	}
	existing, err := s.store.Begin(ctx, rec)
	if err != nil {
		return Result{}, err
	}
	if existing != nil {
		// A retry of the same request gets the stored outcome. Anything else under the same
		// STAN would otherwise inherit an approval no issuer gave for it.
		if !sameRequest(existing, rec) {
			return Result{}, ErrSTANReused
		}
		return s.replay(existing)
	}

	timeout := s.cfg.CardPresentTimeout
	if r.Channel == "ecommerce" {
		timeout = s.cfg.CNPTimeout
	}
	ranked := Rank(s.routes, r)
	if len(ranked) == 0 {
		_ = s.store.Complete(ctx, r.AuthID, StatusError, "", "", "")
		return s.errorResult(r.AuthID, "no healthy route"), nil
	}

	for _, rk := range ranked {
		rt := rk.Route
		stan := rt.STAN.Next()
		now := s.cfg.Now()
		rrn := RRN(now, stan)
		if rt.AcquirerID != "" && r.AcquirerID == "" {
			r.AcquirerID = rt.AcquirerID
		}
		msg, err := BuildAuthorization(rt.Codec.Spec(), r, stan, rrn, now)
		if err != nil {
			_ = s.store.Complete(ctx, r.AuthID, StatusError, "", "", "")
			return Result{}, err
		}
		if err := s.store.MarkSent(ctx, r.AuthID, rt.Name, stan, rrn, msg.Get(7)); err != nil {
			return Result{}, err
		}
		sentAt := s.cfg.Now()
		resp, err := rt.Pool.Exchange(ctx, msg, timeout)
		switch {
		case errors.Is(err, scheme.ErrNotSent):
			// Nothing reached the network: cascading is safe even for card-present (01 §6.5).
			s.cfg.Logger.Warn("route not available, cascading", "route", rt.Name, "err", err)
			continue
		case errors.Is(err, scheme.ErrTimeout), errors.Is(err, scheme.ErrUnknownOutcome):
			return s.timedOut(ctx, r.AuthID, rt, stan, rrn, sentAt)
		case err != nil:
			return Result{}, err
		}
		return s.completeFromResponse(ctx, r.AuthID, rt.Name, resp, sentAt)
	}
	_ = s.store.Complete(ctx, r.AuthID, StatusError, "", "", "")
	return s.errorResult(r.AuthID, "no route could send the request"), nil
}

func (s *Switch) errorResult(authID, why string) Result {
	s.cfg.Logger.Error("authorization not sent", "auth_id", authID, "why", why)
	return Result{AuthID: authID, Status: StatusError, Decline: Decline{Code: "processing_error", Retry: RetryCascade, CustomerMessage: "Falha no processamento. Tente de novo."}, CompletedAt: s.cfg.Now()}
}

func (s *Switch) completeFromResponse(ctx context.Context, authID, route string, resp *iso8583.Message, sentAt time.Time) (Result, error) {
	rc := resp.Get(39)
	d, ok := Classify(rc)
	if mac := merchantAdviceCode(resp.Get(48)); mac != "" && !ok {
		d = MerchantAdvice(d, mac)
	}
	st := StatusDeclined
	if ok {
		st = StatusApproved
	}
	if err := s.store.Complete(ctx, authID, st, rc, resp.Get(38), resp.Get(62)); err != nil {
		return Result{}, err
	}
	return Result{
		AuthID: authID, Status: st, Approved: ok, ResponseCode: rc, AuthCode: resp.Get(38), RRN: resp.Get(37),
		NetworkSTAN: resp.Get(11), NetworkTxnID: resp.Get(62), IssuerEMVHex: resp.Get(55), Route: route,
		Decline: d, SentAt: sentAt, CompletedAt: s.cfg.Now(),
	}, nil
}

// merchantAdviceCode extracts sub-element 84 from a DE 48 laid out as tag(2) length(2) value.
func merchantAdviceCode(de48 string) string {
	for i := 0; i+4 <= len(de48); {
		tag, l := de48[i:i+2], de48[i+2:i+4]
		n := 0
		if _, err := fmt.Sscanf(l, "%02d", &n); err != nil || i+4+n > len(de48) {
			return ""
		}
		if tag == "84" {
			return de48[i+4 : i+4+n]
		}
		i += 4 + n
	}
	return ""
}

func (s *Switch) timedOut(ctx context.Context, authID string, rt *Route, stan, rrn string, sentAt time.Time) (Result, error) {
	if err := s.store.Complete(ctx, authID, StatusTimedOut, "", "", ""); err != nil {
		return Result{}, err
	}
	now := s.cfg.Now()
	if err := s.store.EnqueueReversal(ctx, Reversal{
		AuthID: authID, Route: rt.Name, Reason: "timeout", NetworkSTAN: rt.STAN.Next(),
		DE7: now.UTC().Format("0102150405"), NextAt: now, CreatedAt: now,
	}); err != nil {
		return Result{}, err
	}
	s.cfg.Logger.Warn("authorization timed out; reversal queued", "auth_id", authID, "route", rt.Name, "rrn", rrn)
	return Result{
		AuthID: authID, Status: StatusTimedOut, RRN: rrn, NetworkSTAN: stan, Route: rt.Name,
		Decline: Decline{Code: "processing_error", Retry: RetryCascade, CustomerMessage: "Tempo esgotado. Aproxime o cartão de novo."},
		SentAt:  sentAt, CompletedAt: now,
	}, nil
}

// sameRequest reports whether a request repeats the stored one: same payment, kind, amount,
// card, processing code and merchant.
func sameRequest(stored, r *Record) bool {
	return stored.PaymentIntentID == r.PaymentIntentID && stored.Kind == r.Kind && stored.Amount == r.Amount &&
		stored.PANRef == r.PANRef && stored.ProcessingCode == r.ProcessingCode && stored.MerchantMID == r.MerchantMID &&
		stored.CurrencyNumeric == r.CurrencyNumeric
}

func (s *Switch) replay(rec *Record) (Result, error) {
	switch rec.Status {
	case StatusReceived, StatusSent:
		return Result{}, ErrInFlight
	}
	d, ok := Classify(rec.ResponseCode)
	if rec.Status == StatusTimedOut || rec.Status == StatusError {
		d, ok = Decline{Code: "processing_error", Retry: RetryCascade, CustomerMessage: "Tempo esgotado. Aproxime o cartão de novo."}, false
	}
	return Result{
		AuthID: rec.AuthID, Status: rec.Status, Approved: ok && rec.Status == StatusApproved, ResponseCode: rec.ResponseCode,
		AuthCode: rec.AuthCode, RRN: rec.RRN, NetworkSTAN: rec.NetworkSTAN, NetworkTxnID: rec.NetworkTxnID,
		Route: rec.Route, Decline: d, Replayed: true, CompletedAt: rec.UpdatedAt,
	}, nil
}

// Reverse voids an approved authorization before clearing. amount 0 reverses it fully;
// a smaller amount is a partial reversal that leaves amount−reversed authorized.
// If the host does not answer, the reversal is queued and the status is reversal_pending.
func (s *Switch) Reverse(ctx context.Context, authID string, amount int64, reason string) (Result, error) {
	rec, err := s.store.Get(ctx, authID)
	if err != nil {
		return Result{}, err
	}
	if rec.Status != StatusApproved && rec.Status != StatusPartiallyRev {
		return Result{}, fmt.Errorf("authswitch: cannot reverse an authorization in status %s", rec.Status)
	}
	if amount <= 0 || amount > rec.Amount-rec.ReversedAmount {
		amount = rec.Amount - rec.ReversedAmount
	}
	rt, ok := s.byName[rec.Route]
	if !ok {
		return Result{}, fmt.Errorf("authswitch: route %s no longer configured", rec.Route)
	}
	now := s.cfg.Now()
	rv := Reversal{AuthID: authID, Route: rt.Name, Amount: amount, Reason: reason, NetworkSTAN: rt.STAN.Next(), DE7: now.UTC().Format("0102150405"), CreatedAt: now}
	done, err := s.sendReversal(ctx, rec, rv, "0400")
	if err != nil || !done {
		rv.NextAt = now.Add(time.Second)
		rv.Attempts = 1
		if qerr := s.store.EnqueueReversal(ctx, rv); qerr != nil {
			return Result{}, qerr
		}
		_ = s.store.AddReversed(ctx, authID, 0, StatusReversalPending)
		return Result{AuthID: authID, Status: StatusReversalPending, RRN: rec.RRN, Route: rt.Name, CompletedAt: now}, nil
	}
	return s.reversed(ctx, rec, amount)
}

func (s *Switch) reversed(ctx context.Context, rec *Record, amount int64) (Result, error) {
	st := StatusReversed
	if rec.ReversedAmount+amount < rec.Amount {
		st = StatusPartiallyRev
	}
	if err := s.store.AddReversed(ctx, rec.AuthID, amount, st); err != nil {
		return Result{}, err
	}
	return Result{AuthID: rec.AuthID, Status: st, RRN: rec.RRN, Route: rec.Route, CompletedAt: s.cfg.Now()}, nil
}

// sendReversal returns done=true when the host acknowledged.
func (s *Switch) sendReversal(ctx context.Context, rec *Record, rv Reversal, mti string) (bool, error) {
	rt, ok := s.byName[rv.Route]
	if !ok {
		return false, fmt.Errorf("authswitch: route %s not configured", rv.Route)
	}
	pan := ""
	if rec.PANRef != "" && s.pans != nil {
		p, err := s.pans.RevealPAN(ctx, rec.PANRef)
		if err != nil {
			return false, fmt.Errorf("authswitch: reveal PAN for reversal: %w", err)
		}
		pan = p
	}
	remaining := int64(0)
	if rv.Amount > 0 && rv.Amount < rec.Amount-rec.ReversedAmount {
		remaining = rec.Amount - rec.ReversedAmount - rv.Amount
	}
	msg := BuildReversal(rt.Codec.Spec(), rec, pan, mti, rv.NetworkSTAN, rv.DE7, remaining)
	resp, err := rt.Pool.Exchange(ctx, msg, s.cfg.ReversalTimeout)
	if err != nil {
		return false, err
	}
	// 00 = reversed; 25 = original not found (nothing to reverse); 94 = duplicate (already reversed).
	switch resp.Get(39) {
	case "00", "25", "94":
		return true, nil
	}
	return false, fmt.Errorf("reversal refused: DE39=%s", resp.Get(39))
}

var backoff = []time.Duration{time.Second, 2 * time.Second, 5 * time.Second, 15 * time.Second, time.Minute, 5 * time.Minute}

// RunReversals delivers queued reversals until ctx ends (store-and-forward, 01 §2.2).
func (s *Switch) RunReversals(ctx context.Context, every time.Duration) {
	if every == 0 {
		every = 500 * time.Millisecond
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.ProcessReversals(ctx)
		}
	}
}

// ProcessReversals makes one pass over due reversals.
func (s *Switch) ProcessReversals(ctx context.Context) {
	due, err := s.store.DueReversals(ctx, s.cfg.Now(), 50)
	if err != nil {
		s.cfg.Logger.Error("load reversals", "err", err)
		return
	}
	for _, rv := range due {
		rec, err := s.store.Get(ctx, rv.AuthID)
		if err != nil {
			s.cfg.Logger.Error("reversal for unknown authorization", "auth_id", rv.AuthID)
			_ = s.store.UpdateReversal(ctx, rv.ID, true, rv.Attempts, rv.NextAt, "unknown authorization")
			continue
		}
		mti := "0400"
		if s.cfg.Now().Sub(rv.CreatedAt) > s.cfg.MaxReversalAge {
			mti = "0420"
		}
		done, err := s.sendReversal(ctx, rec, rv, mti)
		attempts := rv.Attempts + 1
		if done {
			_ = s.store.UpdateReversal(ctx, rv.ID, true, attempts, rv.NextAt, "")
			if rec.Status == StatusTimedOut {
				_ = s.store.AddReversed(ctx, rec.AuthID, 0, StatusTimedOut) // nothing was authorized; record stays timed_out
			} else if _, err := s.reversed(ctx, rec, rv.Amount); err != nil {
				s.cfg.Logger.Error("mark reversed", "err", err)
			}
			s.cfg.Logger.Info("reversal delivered", "auth_id", rv.AuthID, "mti", mti, "attempts", attempts)
			continue
		}
		wait := backoff[min(attempts-1, len(backoff)-1)]
		msg := ""
		if err != nil {
			msg = err.Error()
		}
		_ = s.store.UpdateReversal(ctx, rv.ID, false, attempts, s.cfg.Now().Add(wait), msg)
	}
}
