package authswitch_test

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync/atomic"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/dialects"
	"github.com/monolito123/Gooners/payments/platform/internal/authswitch"
	"github.com/monolito123/Gooners/payments/platform/internal/scheme"
	"github.com/monolito123/Gooners/payments/platform/internal/schemesim"
	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
)

type pans map[string]string

func (p pans) RevealPAN(_ context.Context, ref string) (string, error) {
	if v, ok := p[ref]; ok {
		return v, nil
	}
	return "", errors.New("unknown ref")
}

type env struct {
	sim   *schemesim.Sim
	store *authswitch.MemStore
	sw    *authswitch.Switch
	route *authswitch.Route
}

func newEnv(t *testing.T) *env {
	t.Helper()
	codec := iso8583.NewCodec(dialects.MustLoad(dialects.Generic))
	sim := schemesim.New(codec)
	sim.LateDelay = 300 * time.Millisecond
	addr, err := sim.Listen("127.0.0.1:0", nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel(); sim.Close() })
	sess := scheme.NewSession(scheme.Config{Name: "sponsor-a", Addr: addr, Codec: codec, SignOn: true, AcquirerID: "12345678"})
	pool := scheme.NewPool("sponsor", sess)
	go pool.Run(ctx)
	wctx, wc := context.WithTimeout(ctx, 3*time.Second)
	defer wc()
	if err := pool.WaitReady(wctx); err != nil {
		t.Fatal(err)
	}
	route := &authswitch.Route{Name: "sponsor", Pool: pool, Codec: codec, AcquirerID: "12345678", ApprovalPrior: 0.9}
	store := authswitch.NewMemStore()
	sw := authswitch.New([]*authswitch.Route{route}, store, pans{"vault:1": "4111111111111111"},
		authswitch.Config{CardPresentTimeout: 400 * time.Millisecond, ReversalTimeout: 400 * time.Millisecond})
	return &env{sim, store, sw, route}
}

var seq atomic.Int64

func request(amount int64) authswitch.Request {
	n := seq.Add(1)
	return authswitch.Request{
		AuthID: fmt.Sprintf("auth_%d", n), TenantID: "ten_1", Kind: authswitch.Purchase, Amount: amount,
		CurrencyNumeric: "986", Channel: "card_present", TerminalID: "TP000418", TerminalSTAN: fmt.Sprintf("%06d", n),
		TerminalLocal: time.Date(2026, 10, 29, 14, 42, 8, 0, time.FixedZone("BRT", -3*3600)),
		Card: authswitch.Card{PAN: "4111111111111111", PANRef: "vault:1", Expiry: "2911", EntryMode: "071", Funding: "credit", Brand: "visa",
			EMVHex: "9F2608A1B2C3D4E5F607089F2701809F3704C0FFEE119F360200429A032610299C0100"},
		Merchant: authswitch.Merchant{SchemeMID: "000000004127731", MCC: "5812", Name: "Café Aurora", City: "São Paulo", Country: "BR"},
	}
}

func TestApprovedAuthorization(t *testing.T) {
	e := newEnv(t)
	res, err := e.sw.Authorize(context.Background(), request(12990))
	if err != nil {
		t.Fatal(err)
	}
	if !res.Approved || res.Status != authswitch.StatusApproved || len(res.AuthCode) != 6 || len(res.RRN) != 12 {
		t.Fatalf("unexpected result %+v", res)
	}
	sent := e.sim.ReceivedMTI("0100")
	m := sent[len(sent)-1]
	checks := map[int]string{3: "003000", 4: "000000012990", 18: "5812", 19: "076", 22: "071", 25: "00", 32: "12345678", 41: "TP000418", 49: "986",
		43: "CAFE AURORA              SAO PAULO    BR"}
	for n, want := range checks {
		if m.Get(n) != want {
			t.Errorf("DE%d = %q, want %q", n, m.Get(n), want)
		}
	}
	if m.Get(12) != "144208" || m.Get(13) != "1029" {
		t.Errorf("local time/date %s %s", m.Get(12), m.Get(13))
	}
	if res.IssuerEMVHex == "" || res.NetworkTxnID == "" {
		t.Error("issuer EMV data and network transaction ID expected on approval")
	}
}

func TestDeclinesAreClassified(t *testing.T) {
	e := newEnv(t)
	for cents, want := range map[int64]string{51: "insufficient_funds", 5: "do_not_honor", 54: "expired_card", 91: "issuer_unavailable", 65: "authentication_required"} {
		res, err := e.sw.Authorize(context.Background(), request(12900+cents))
		if err != nil {
			t.Fatal(err)
		}
		if res.Approved || res.Decline.Code != want {
			t.Errorf("cents %02d: %+v", cents, res.Decline)
		}
	}
}

func TestTimeoutQueuesReversalAndSAFDeliversIt(t *testing.T) {
	e := newEnv(t)
	res, err := e.sw.Authorize(context.Background(), request(12998))
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != authswitch.StatusTimedOut || res.Approved {
		t.Fatalf("want timed_out, got %+v", res)
	}
	q := e.store.Reversals()
	if len(q) != 1 || q[0].Done {
		t.Fatalf("reversal not queued: %+v", q)
	}
	e.sw.ProcessReversals(context.Background())
	q = e.store.Reversals()
	if !q[0].Done {
		t.Fatalf("reversal not delivered: %+v", q[0])
	}
	revs := e.sim.ReceivedMTI("0400")
	if len(revs) != 1 {
		t.Fatalf("host saw %d reversals", len(revs))
	}
	de90 := revs[0].Get(90)
	if len(de90) != 42 || de90[:4] != "0100" || de90[4:10] != res.NetworkSTAN {
		t.Fatalf("DE90 %q does not reference the original (STAN %s)", de90, res.NetworkSTAN)
	}
	if revs[0].Get(2) != "4111111111111111" {
		t.Fatal("reversal must carry the PAN revealed from the vault")
	}
}

func TestIdempotentReplay(t *testing.T) {
	e := newEnv(t)
	req := request(4500)
	first, err := e.sw.Authorize(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	again := req
	again.AuthID = "auth_retry"
	second, err := e.sw.Authorize(context.Background(), again)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Replayed || second.AuthID != first.AuthID || second.AuthCode != first.AuthCode {
		t.Fatalf("replay mismatch: %+v vs %+v", second, first)
	}
	if n := len(e.sim.ReceivedMTI("0100")); n != 1 {
		t.Fatalf("host received %d authorizations for one terminal STAN", n)
	}
}

func TestPartialAndFullReversal(t *testing.T) {
	e := newEnv(t)
	res, _ := e.sw.Authorize(context.Background(), request(10000))
	part, err := e.sw.Reverse(context.Background(), res.AuthID, 2500, "tip_adjust")
	if err != nil || part.Status != authswitch.StatusPartiallyRev {
		t.Fatalf("partial: %+v %v", part, err)
	}
	revs := e.sim.ReceivedMTI("0400")
	if de95 := revs[0].Get(95); de95[:12] != "000000007500" {
		t.Fatalf("DE95 should carry the remaining amount 75.00: %q", de95)
	}
	full, err := e.sw.Reverse(context.Background(), res.AuthID, 0, "void")
	if err != nil || full.Status != authswitch.StatusReversed {
		t.Fatalf("full: %+v %v", full, err)
	}
	if _, err := e.sw.Reverse(context.Background(), res.AuthID, 0, "again"); err == nil {
		t.Fatal("reversing a reversed authorization must fail")
	}
}

func TestCascadeWhenFirstRouteDown(t *testing.T) {
	e := newEnv(t)
	codec := e.route.Codec
	down := &authswitch.Route{Name: "direct-down", Codec: codec, ApprovalPrior: 0.99,
		Pool: scheme.NewPool("direct-down", scheme.NewSession(scheme.Config{Name: "x", Addr: "127.0.0.1:1", Codec: codec}))}
	sw := authswitch.New([]*authswitch.Route{down, e.route}, authswitch.NewMemStore(), nil, authswitch.Config{})
	res, err := sw.Authorize(context.Background(), request(2000))
	if err != nil || !res.Approved || res.Route != "sponsor" {
		t.Fatalf("expected the sponsor route to approve: %+v %v", res, err)
	}
}

func TestValidation(t *testing.T) {
	e := newEnv(t)
	bad := request(100)
	bad.Merchant.MCC = ""
	if _, err := e.sw.Authorize(context.Background(), bad); err == nil {
		t.Fatal("missing MCC accepted")
	}
}

// The worked example of docs/01-acquiring-engine.md §6.3.
func TestRankMatchesSpecExample(t *testing.T) {
	r := authswitch.Request{Amount: 20000, MDRCents: 638, InterchangeCents: 320, Card: authswitch.Card{Brand: "visa"}}
	routes := []*authswitch.Route{
		{Name: "R2 sponsor PAN", ApprovalPrior: 0.91, Fees: authswitch.Fees{BasisPoints: 35, PerAttemptCents: 5}},
		{Name: "R1b direct PAN", ApprovalPrior: 0.90, Fees: authswitch.Fees{BasisPoints: 10, PerAttemptCents: 3}},
		{Name: "R1a direct token", ApprovalPrior: 0.93, Fees: authswitch.Fees{BasisPoints: 10, PerAttemptCents: 3, TokenFeeCents: 2}},
	}
	got := authswitch.Rank(routes, r)
	want := []struct {
		name string
		e    float64
	}{{"R1a direct token", 272.28}, {"R1b direct PAN", 265.20}, {"R2 sponsor PAN", 220.68}}
	for i, w := range want {
		if got[i].Route.Name != w.name || math.Abs(got[i].ExpectedMargin-w.e) > 1e-9 {
			t.Errorf("rank %d: got %s %.4f, want %s %.2f", i, got[i].Route.Name, got[i].ExpectedMargin, w.name, w.e)
		}
	}
}

func TestMerchantAdvice(t *testing.T) {
	d, _ := authswitch.Classify("51")
	if authswitch.MerchantAdvice(d, "03").Retry != authswitch.RetryNever {
		t.Fatal("MAC 03 must forbid retries")
	}
	if got := authswitch.MerchantAdvice(d, "21"); got.Code != "stop_recurring" {
		t.Fatal("MAC 21 must cancel the mandate")
	}
}

func TestRRNFormat(t *testing.T) {
	if got := authswitch.RRN(time.Date(2026, 10, 29, 17, 0, 0, 0, time.UTC), "004211"); got != "630217004211" {
		t.Fatalf("RRN %s", got)
	}
}
