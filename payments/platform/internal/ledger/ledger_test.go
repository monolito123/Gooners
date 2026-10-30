package ledger_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/testpg"
)

func TestMain(m *testing.M) { testpg.Main(m) }

const tenant = "00000000-0000-4000-8000-000000000001"
const merchant = "mer_01JB8Z2K5D6F7G8H9J0K1M2N3P"

func setup(t *testing.T) *ledger.Ledger {
	t.Helper()
	l := ledger.New(testpg.Pool(t), nil)
	ctx := context.Background()
	if err := l.BootstrapTenant(ctx, tenant, "BRL"); err != nil {
		t.Fatal(err)
	}
	if err := l.OpenMerchant(ctx, tenant, merchant, "BRL"); err != nil {
		t.Fatal(err)
	}
	return l
}

var n atomic.Int64

func post(t *testing.T, l *ledger.Ledger, typ string, ps []ledger.Posting) ledger.Result {
	t.Helper()
	id := fmt.Sprintf("jr_%s_%d", typ, n.Add(1))
	res, err := l.Post(context.Background(), ledger.NewJournal(tenant, id, id, typ, "", ps))
	if err != nil {
		t.Fatalf("%s: %v", typ, err)
	}
	return res
}

func balance(t *testing.T, l *ledger.Ledger, acct string) int64 {
	t.Helper()
	b, err := l.Balance(context.Background(), tenant, acct)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func assertInvariants(t *testing.T, l *ledger.Ledger) {
	t.Helper()
	v, err := l.Verify(context.Background(), ledger.DefaultVerifyOptions)
	if err != nil {
		t.Fatal(err)
	}
	if len(v) > 0 {
		t.Fatalf("invariant violations: %+v", v)
	}
}

// The posting catalogue of docs/04-serverless-backend.md §3.4 for the R$ 129,90 tap.
func TestSpecCatalogue(t *testing.T) {
	l := setup(t)
	post(t, l, "opening_capital", []ledger.Posting{{ledger.AccSettlementBank, ledger.Debit, 10_000_000}, {ledger.AccEquityCapital, ledger.Credit, 10_000_000}})
	post(t, l, "safeguard_topup", ledger.SafeguardTopup(100_000))
	post(t, l, "card_capture", ledger.CardCapture("visa", merchant, ledger.CardCaptureAmounts{Gross: 12990, MDR: 414, Interchange: 208, SchemeFees: 16}))
	post(t, l, "instant_release", ledger.InstantRelease(merchant, 12576, 161))
	post(t, l, "safeguard_topup", ledger.SafeguardTopup(12415))
	post(t, l, "pix_prefund", ledger.PixPrefund(50_000))
	post(t, l, "payout_send", ledger.PayoutSend(merchant, 12415, 0))
	post(t, l, "payout_confirm", ledger.PayoutConfirm(12415))
	post(t, l, "safeguard_release", ledger.SafeguardRelease(12415))
	post(t, l, "scheme_settlement", ledger.SchemeSettlement("visa", 12766))

	for acct, want := range map[string]int64{
		ledger.SchemeReceivable("visa"):  0,
		ledger.MerchantWallet(merchant):  0,
		ledger.MerchantPayable(merchant): 0,
		ledger.AccPixInTransit:           0,
		ledger.AccRevenueMDR:             414,
		ledger.AccRevenueAdvanceFees:     161,
		ledger.AccSafeguardingReserve:    100_000,
	} {
		if got := balance(t, l, acct); got != want {
			t.Errorf("%s = %d, want %d", acct, got, want)
		}
	}
	assertInvariants(t, l)
}

func TestIdempotency(t *testing.T) {
	l := setup(t)
	ctx := context.Background()
	j := ledger.NewJournal(tenant, "jr_a", "key-1", "card_capture", "pi_1", ledger.CardCapture("visa", merchant, ledger.CardCaptureAmounts{Gross: 1000, MDR: 30}))
	first, err := l.Post(ctx, j)
	if err != nil || first.Replayed {
		t.Fatal(first, err)
	}
	j.ID = "jr_b"
	again, err := l.Post(ctx, j)
	if err != nil || !again.Replayed || again.JournalID != "jr_a" {
		t.Fatalf("replay: %+v %v", again, err)
	}
	j.Postings = ledger.CardCapture("visa", merchant, ledger.CardCaptureAmounts{Gross: 2000, MDR: 30})
	if _, err := l.Post(ctx, j); !errors.Is(err, ledger.ErrIdempotencyConflict) {
		t.Fatalf("want idempotency conflict, got %v", err)
	}
	if got := balance(t, l, ledger.MerchantPayable(merchant)); got != 970 {
		t.Fatalf("payable %d: replay posted twice?", got)
	}
}

func TestRejections(t *testing.T) {
	l := setup(t)
	ctx := context.Background()
	cases := map[string]struct {
		ps   []ledger.Posting
		want error
	}{
		"unbalanced":      {[]ledger.Posting{{ledger.AccSettlementBank, ledger.Debit, 10}, {ledger.AccEquityCapital, ledger.Credit, 9}}, ledger.ErrUnbalanced},
		"single posting":  {[]ledger.Posting{{ledger.AccSettlementBank, ledger.Debit, 10}}, ledger.ErrInvalidPosting},
		"zero amount":     {[]ledger.Posting{{ledger.AccSettlementBank, ledger.Debit, 0}, {ledger.AccEquityCapital, ledger.Credit, 0}}, ledger.ErrInvalidPosting},
		"unknown account": {[]ledger.Posting{{"asset.nope", ledger.Debit, 10}, {ledger.AccEquityCapital, ledger.Credit, 10}}, ledger.ErrUnknownAccount},
	}
	for name, c := range cases {
		_, err := l.Post(ctx, ledger.NewJournal(tenant, "jr_"+name, "k_"+name, "test", "", c.ps))
		if !errors.Is(err, c.want) {
			t.Errorf("%s: got %v, want %v", name, err, c.want)
		}
	}
	_, err := l.Post(ctx, ledger.NewJournal(tenant, "jr_overdraw", "k_overdraw", "payout_send", "", ledger.PayoutSend(merchant, 1, 0)))
	var ife *ledger.InsufficientFundsError
	if !errors.As(err, &ife) || ife.Account != ledger.MerchantWallet(merchant) {
		t.Fatalf("want insufficient funds on the wallet, got %v", err)
	}
	assertInvariants(t, l)
}

// Concurrent payouts against one wallet must never overdraw it, even under contention.
func TestConcurrentDebitsNeverOverdraw(t *testing.T) {
	l := setup(t)
	post(t, l, "opening_capital", []ledger.Posting{{ledger.AccSettlementBank, ledger.Debit, 1_000_000}, {ledger.AccEquityCapital, ledger.Credit, 1_000_000}})
	post(t, l, "safeguard_topup", ledger.SafeguardTopup(100_000))
	post(t, l, "card_capture", ledger.CardCapture("visa", merchant, ledger.CardCaptureAmounts{Gross: 10_000}))
	post(t, l, "release", ledger.ScheduledRelease(merchant, 10_000))

	var ok, insufficient atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprintf("jr_payout_%d", i)
			_, err := l.Post(context.Background(), ledger.NewJournal(tenant, id, id, "payout_send", "", ledger.PayoutSend(merchant, 1_000, 0)))
			var ife *ledger.InsufficientFundsError
			switch {
			case err == nil:
				ok.Add(1)
			case errors.As(err, &ife):
				insufficient.Add(1)
			default:
				t.Errorf("payout %d: %v", i, err)
			}
		}(i)
	}
	wg.Wait()
	if ok.Load() != 10 || insufficient.Load() != 30 {
		t.Fatalf("approved %d, refused %d; want exactly 10 approved", ok.Load(), insufficient.Load())
	}
	if b := balance(t, l, ledger.MerchantWallet(merchant)); b != 0 {
		t.Fatalf("wallet %d", b)
	}
	assertInvariants(t, l)
}

// Heavier contention than above: lock reads that fail to serialize must be retried, never
// read as a zero balance (they once surfaced only through rows.Err and were refused as
// insufficient funds).
func TestContendedDebitsAreRetriedNotRefused(t *testing.T) {
	l := setup(t)
	post(t, l, "opening_capital", []ledger.Posting{{ledger.AccSettlementBank, ledger.Debit, 1_000_000}, {ledger.AccEquityCapital, ledger.Credit, 1_000_000}})
	post(t, l, "safeguard_topup", ledger.SafeguardTopup(100_000))
	post(t, l, "card_capture", ledger.CardCapture("visa", merchant, ledger.CardCaptureAmounts{Gross: 10_000}))
	post(t, l, "release", ledger.ScheduledRelease(merchant, 10_000))
	var ok, insufficient atomic.Int64
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			id := fmt.Sprintf("jr_small_%d", i)
			_, err := l.Post(context.Background(), ledger.NewJournal(tenant, id, id, "payout_send", "", ledger.PayoutSend(merchant, 100, 0)))
			var ife *ledger.InsufficientFundsError
			switch {
			case err == nil:
				ok.Add(1)
			case errors.As(err, &ife):
				insufficient.Add(1)
			default:
				t.Errorf("debit %d: %v", i, err)
			}
		}(i)
	}
	close(start)
	wg.Wait()
	if ok.Load() != 100 || insufficient.Load() != 100 {
		t.Fatalf("approved %d, refused %d; want exactly 100 and 100", ok.Load(), insufficient.Load())
	}
	if b := balance(t, l, ledger.MerchantWallet(merchant)); b != 0 {
		t.Fatalf("wallet %d", b)
	}
	assertInvariants(t, l)
}

func TestHotAccountShardsSumCorrectly(t *testing.T) {
	l := setup(t)
	for i := 0; i < 50; i++ {
		post(t, l, "card_capture", ledger.CardCapture("visa", merchant, ledger.CardCaptureAmounts{Gross: 1000, MDR: 10}))
	}
	if got := balance(t, l, ledger.AccRevenueMDR); got != 500 {
		t.Fatalf("revenue.mdr = %d, want 500", got)
	}
	var shards int
	if err := l.Pool().QueryRow(context.Background(), `SELECT count(*) FROM balances WHERE account_id = $1`, ledger.AccRevenueMDR).Scan(&shards); err != nil {
		t.Fatal(err)
	}
	if shards < 10 {
		t.Fatalf("expected writes spread across shards, got %d", shards)
	}
	assertInvariants(t, l)
}

func TestOutboxDrain(t *testing.T) {
	l := setup(t)
	ctx := context.Background()
	j := ledger.NewJournal(tenant, "jr_o", "k_o", "card_capture", "pi_9", ledger.CardCapture("visa", merchant, ledger.CardCaptureAmounts{Gross: 500}))
	j.Outbox = []ledger.OutboxEvent{{Topic: "payments.v1", Key: "pi_9", Payload: map[string]any{"type": "payment_intent.captured"}}}
	if _, err := l.Post(ctx, j); err != nil {
		t.Fatal(err)
	}
	if _, err := l.DrainOutbox(ctx, 10, func(context.Context, pgx.Tx, string, string, []byte) error { return errors.New("boom") }); err == nil {
		t.Fatal("a failing handler must abort the drain so the event stays queued")
	}
	var got []string
	n, err := l.DrainOutbox(ctx, 10, func(_ context.Context, _ pgx.Tx, topic, key string, payload []byte) error {
		got = append(got, topic+"/"+key+" "+string(payload))
		return nil
	})
	if err != nil || n != 1 || len(got) != 1 {
		t.Fatalf("drain: n=%d err=%v got=%v", n, err, got)
	}
	n, _ = l.DrainOutbox(ctx, 10, func(context.Context, pgx.Tx, string, string, []byte) error { return nil })
	if n != 0 {
		t.Fatal("event delivered twice")
	}
}
