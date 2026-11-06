// Package exchange trades and moves crypto-assets at exchanges: the books, market orders,
// deposit addresses, deposits and withdrawals the platform needs to accept crypto payments
// and to hold merchants' crypto (docs/09). Adapters speak each exchange's published API
// (Binance, Kraken, Coinbase); Memory is an exchange in memory for the sandbox and tests;
// Router picks the best price among those configured.
package exchange

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/assets"
)

// Order sides.
const (
	Buy  = "buy"
	Sell = "sell"
)

// Book is the top of an order book: the best bid and ask, as decimal strings in the quote
// asset per one whole base asset.
type Book struct {
	Exchange    string
	Base, Quote string
	Bid, Ask    string
	At          time.Time
}

// Order is a market order. Exactly one of BaseUnits and QuoteUnits is set: buy or sell this
// much of the base asset, or spend (buy) or raise (sell) this much of the quote asset.
type Order struct {
	ClientID    string // idempotency at the exchange: the same ClientID never fills twice
	Side        string
	Base, Quote string
	BaseUnits   int64
	QuoteUnits  int64
}

// Fill is what a market order did.
type Fill struct {
	Exchange, OrderID, ClientID string
	BaseUnits, QuoteUnits       int64 // executed
	FeeUnits                    int64 // in FeeAsset
	FeeAsset                    string
}

// Deposit is an incoming transfer the exchange has seen.
type Deposit struct {
	ID, Asset, Network, Address, Memo, TxID string
	Units                                   int64
	Confirmed                               bool
	At                                      time.Time
}

// Withdrawal sends an asset out: Units reach the address.
type Withdrawal struct {
	ClientID, Asset, Network, Address, Memo string
	Units                                   int64
	// FeeUnits is the network fee the platform expects the venue to take on top (the
	// merchant pays it). Real venues charge their own; the nightly custody reconciliation
	// shows any difference.
	FeeUnits int64
}

// Exchange is one venue.
type Exchange interface {
	Name() string
	Book(ctx context.Context, base, quote string) (Book, error)
	Market(ctx context.Context, o Order) (Fill, error)
	DepositAddress(ctx context.Context, asset, network string) (address, memo string, err error)
	Deposits(ctx context.Context, asset string, since time.Time) ([]Deposit, error)
	Withdraw(ctx context.Context, w Withdrawal) (id string, err error)
	// Balances is what the platform's account holds at the venue, available plus held, per
	// asset the registry knows, in the asset's units. Other assets are left out.
	Balances(ctx context.Context) (map[string]int64, error)
}

var (
	// ErrUnsupported is an operation, pair or network this venue does not offer.
	ErrUnsupported = errors.New("exchange: not supported")
	// ErrNoVenue is a pair no configured venue quotes.
	ErrNoVenue = errors.New("exchange: no venue quotes this pair")
)

func (o Order) validate() error {
	if o.Side != Buy && o.Side != Sell {
		return fmt.Errorf("exchange: side must be buy or sell")
	}
	if (o.BaseUnits > 0) == (o.QuoteUnits > 0) {
		return fmt.Errorf("exchange: set exactly one of base or quote amount")
	}
	if o.ClientID == "" {
		return fmt.Errorf("exchange: a client order ID is required")
	}
	return nil
}

func asset(code string) assets.Asset {
	a, err := assets.Get(code)
	if err != nil {
		return assets.Asset{Code: code, Decimals: 8}
	}
	return a
}

// decimal parses an exchange's decimal string into units of code.
func decimal(s, code string) (int64, error) {
	a := asset(code)
	r, ok := new(big.Rat).SetString(strings.TrimSpace(s))
	if !ok {
		return 0, fmt.Errorf("exchange: bad amount %q", s)
	}
	r.Mul(r, new(big.Rat).SetInt(a.Scale()))
	q := new(big.Int).Quo(r.Num(), r.Denom()) // an exchange's extra precision is dust: round down
	if !q.IsInt64() {
		return 0, fmt.Errorf("exchange: amount %q out of range", s)
	}
	return q.Int64(), nil
}

// addBalance adds a venue's amount of code to bs, if the registry knows the asset.
func addBalance(bs map[string]int64, code, amount string) error {
	if _, err := assets.Get(code); err != nil || strings.TrimSpace(amount) == "" {
		return nil
	}
	n, err := decimal(amount, code)
	if err != nil {
		return err
	}
	bs[code] += n
	return nil
}

// trimmed formats units of code without trailing zeros, as exchanges expect quantities.
func trimmed(units int64, code string) string {
	s := asset(code).Format(units)
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return s
}

// ---------------------------------------------------------------- router

// Router sends each trade to the venue with the best price for it.
type Router struct {
	Venues []Exchange
}

// Best returns the venue with the best book for side: the lowest ask to buy, the highest bid
// to sell. Venues that fail or do not list the pair are skipped.
func (r *Router) Best(ctx context.Context, side, base, quote string) (Exchange, Book, error) {
	type res struct {
		ex  Exchange
		b   Book
		err error
	}
	out := make([]res, len(r.Venues))
	var wg sync.WaitGroup
	for i, ex := range r.Venues {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			b, err := ex.Book(c, base, quote)
			out[i] = res{ex, b, err}
		}()
	}
	wg.Wait()
	var best *res
	for i := range out {
		o := &out[i]
		if o.err != nil {
			continue
		}
		p := o.b.Ask
		if side == Sell {
			p = o.b.Bid
		}
		if r, ok := new(big.Rat).SetString(p); !ok || r.Sign() <= 0 {
			continue
		}
		if best == nil || better(side, p, priceOf(side, best.b)) {
			best = o
		}
	}
	if best == nil {
		return nil, Book{}, fmt.Errorf("%w %s/%s", ErrNoVenue, base, quote)
	}
	return best.ex, best.b, nil
}

// Books lists every venue's book for a pair, skipping those without it.
func (r *Router) Books(ctx context.Context, base, quote string) []Book {
	var out []Book
	for _, ex := range r.Venues {
		c, cancel := context.WithTimeout(ctx, 3*time.Second)
		if b, err := ex.Book(c, base, quote); err == nil {
			out = append(out, b)
		}
		cancel()
	}
	return out
}

// Venue returns the venue named name.
func (r *Router) Venue(name string) (Exchange, bool) {
	for _, ex := range r.Venues {
		if ex.Name() == name {
			return ex, true
		}
	}
	return nil, false
}

func priceOf(side string, b Book) string {
	if side == Sell {
		return b.Bid
	}
	return b.Ask
}

func better(side, p, than string) bool {
	a, _ := new(big.Rat).SetString(p)
	b, _ := new(big.Rat).SetString(than)
	if side == Sell {
		return a.Cmp(b) > 0
	}
	return a.Cmp(b) < 0
}
