package e2e

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/registrar"
)

// flakyRegistrar is a registrar that can be taken down.
type flakyRegistrar struct {
	*registrar.Memory
	down atomic.Bool
}

var errDown = errors.New("registrar unreachable")

func (f *flakyRegistrar) Register(ctx context.Context, u []registrar.Unit) error {
	if f.down.Load() {
		return errDown
	}
	return f.Memory.Register(ctx, u)
}

func (f *flakyRegistrar) Availability(ctx context.Context, k []registrar.UnitKey) (map[registrar.UnitKey]registrar.Availability, error) {
	if f.down.Load() {
		return nil, errDown
	}
	return f.Memory.Availability(ctx, k)
}

func (f *flakyRegistrar) CancelEffect(ctx context.Context, id string) error {
	if f.down.Load() {
		return errDown
	}
	return f.Memory.CancelEffect(ctx, id)
}

func (f *flakyRegistrar) RegisterEffect(ctx context.Context, e registrar.Effect) error {
	if f.down.Load() {
		return errDown
	}
	return f.Memory.RegisterEffect(ctx, e)
}

// cnpj completes twelve digits with valid check digits.
func cnpj(base string) string {
	digit := func(s string, w []int) string {
		sum := 0
		for i, c := range s {
			sum += int(c-'0') * w[i]
		}
		if r := sum % 11; r >= 2 {
			return strconv.Itoa(11 - r)
		}
		return "0"
	}
	s := base + digit(base, []int{5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2})
	return s + digit(s, []int{6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2})
}

// Every receivable unit is registered, and nothing is advanced, at capture or in a payout,
// without first registering the platform's assignment on it (docs/07 §1.6).
func TestReceivablesRegistrar(t *testing.T) {
	reg := &flakyRegistrar{Memory: registrar.NewMemory()}
	st := newStack(t, func(d *payments.Deps) { d.Registrar = reg })
	ctx := context.Background()
	newMerchant := func(doc string, instant bool) (string, string) {
		_, m := st.call("POST", "/v1/merchants", map[string]any{
			"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": doc}, "legal_name": "Loja " + doc, "trade_name": "Loja", "mcc": "5812", "city": "Recife"},
			"plan":  map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": instant},
		}, 201)
		_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": m["id"], "type": "mpoc_cots"}, 201)
		return m["id"].(string), term["terminal_id"].(string)
	}
	sale := func(merchant, terminal string, amount int64) (string, map[string]any) {
		_, pi := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": amount, "channel": "card_present"}, 201)
		r := st.tap(pi["id"].(string), terminal, "4111111111111111", visaAID, "credit")
		if r["status"] != "approved" {
			t.Fatalf("sale of %d: %v", amount, r)
		}
		return pi["id"].(string), r["settlement"].(map[string]any)
	}
	unit := func(pi, doc string) (registrar.UnitKey, int64) {
		var day time.Time
		var amount int64
		var arr string
		if err := st.pool.QueryRow(ctx, `SELECT settles_on, amount, arrangement FROM receivables WHERE payment_intent_id = $1`, pi).Scan(&day, &amount, &arr); err != nil {
			t.Fatal(err)
		}
		return registrar.UnitKey{Document: doc, Arrangement: arr, SettlesOn: day.Format("2006-01-02")}, amount
	}
	free := func(k registrar.UnitKey) registrar.Availability {
		av, _ := reg.Memory.Availability(ctx, []registrar.UnitKey{k})
		return av[k]
	}

	// An instant merchant: the sale's unit and the platform's assignment are registered.
	docA := cnpj("112223330001")
	ma, ta := newMerchant(docA, true)
	pi1, set1 := sale(ma, ta, 12990)
	k, p1 := unit(pi1, docA)
	if set1["mode"] != "instant" || k.Arrangement != "VCC" || free(k) != (registrar.Availability{Total: p1, Committed: p1, Free: 0}) {
		t.Fatalf("instant sale: %v, unit %v %+v", set1, k, free(k))
	}
	// Another institution takes a lien on the same unit: the next sale cannot be advanced
	// and settles on schedule instead.
	reg.Pledge(k, 5_000)
	pi2, set2 := sale(ma, ta, 9_990)
	if set2["mode"] != "standard" {
		t.Fatalf("a sale whose unit is pledged elsewhere was advanced: %v", set2)
	}
	var status string
	_ = st.pool.QueryRow(ctx, `SELECT status FROM receivables WHERE payment_intent_id = $1`, pi2).Scan(&status)
	if status != "pending" {
		t.Fatalf("its receivable is %s", status)
	}

	// A standard merchant pays out early: the advance is registered with the payout.
	docB := cnpj("445556660001")
	mb, tb := newMerchant(docB, false)
	_, accB := "", ""
	_ = st.pool.QueryRow(ctx, `SELECT account_id FROM merchants WHERE id = $1`, mb).Scan(&accB)
	pi3, _ := sale(mb, tb, 20_000)
	k3, p3 := unit(pi3, docB)
	if n, err := st.svc.SyncReceivableUnits(ctx, time.Now()); err != nil || n == 0 || reg.Totals()[k3] != p3 {
		t.Fatalf("nightly registration: %d %v, total %d", n, err, reg.Totals()[k3])
	}
	dest := map[string]any{"type": "pix", "key_type": "cnpj", "key": docB}
	_, q := st.call("POST", "/v1/payouts/quotes", map[string]any{"account_id": accB, "amount": p3, "destination": dest}, 201)
	if c, po := st.call("POST", "/v1/payouts", map[string]any{"quote_id": q["id"]}, 0); c != 201 {
		t.Fatalf("payout with an advance: %d %v", c, po)
	}
	if a := free(k3); a.Committed != p3 {
		t.Fatalf("the payout's assignment: %+v", a)
	}

	// A unit pledged elsewhere is left out of a quote.
	pi4, _ := sale(mb, tb, 10_000)
	k4, p4 := unit(pi4, docB)
	reg.Pledge(k4, p4)
	if c, _ := st.call("POST", "/v1/payouts/quotes", map[string]any{"account_id": accB, "amount": p4, "destination": dest}, 0); c != http.StatusUnprocessableEntity {
		t.Fatalf("a quote over a pledged unit: %d", c)
	}

	// A lien registered between the quote and the payout: the payout is refused and the quote
	// given back.
	pi5, _ := sale(mb, tb, 8_000)
	_, p5 := unit(pi5, docB)
	_, q5 := st.call("POST", "/v1/payouts/quotes", map[string]any{"account_id": accB, "amount": p5, "destination": dest}, 201)
	reg.Pledge(k4, 1)
	if c, _ := st.call("POST", "/v1/payouts", map[string]any{"quote_id": q5["id"]}, 0); c != http.StatusConflict {
		t.Fatalf("a payout whose unit was pledged after the quote: %d", c)
	}
	var used bool
	_ = st.pool.QueryRow(ctx, `SELECT used FROM payout_quotes WHERE id = $1`, q5["id"]).Scan(&used)
	if used {
		t.Fatal("the refused payout spent its quote")
	}

	// A cancelled sale lowers its unit's total at the next registration.
	st.call("POST", "/v1/payment-intents/"+pi1+"/cancel", nil, 200)
	if _, err := st.svc.SyncReceivableUnits(ctx, time.Now()); err != nil || reg.Totals()[k] != unitTotal(t, st, pi2) {
		t.Fatalf("after the cancel: %v, total %d", err, reg.Totals()[k])
	}
	if a := free(k); a.Committed != 5_000 { // only the other institution's lien is left
		t.Fatalf("the cancelled sale's assignment is still registered: %+v", a)
	}

	// The registrar down: sales settle on schedule, payouts that need advances wait.
	reg.down.Store(true)
	if _, set := sale(ma, ta, 1_990); set["mode"] != "standard" {
		t.Fatalf("an instant sale with the registrar down: %v", set)
	}
	if c, _ := st.call("POST", "/v1/payouts/quotes", map[string]any{"account_id": accB, "amount": 1_000_000, "destination": dest}, 0); c != http.StatusServiceUnavailable {
		t.Fatalf("a quote needing advances with the registrar down: %d", c)
	}
}

func unitTotal(t *testing.T, st *stack, pi string) int64 {
	t.Helper()
	var n int64
	_ = st.pool.QueryRow(context.Background(), `SELECT amount FROM receivables WHERE payment_intent_id = $1`, pi).Scan(&n)
	return n
}
