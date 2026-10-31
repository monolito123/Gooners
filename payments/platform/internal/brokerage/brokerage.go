// Package brokerage invests merchants' reais in instruments listed at B3, the Brazilian
// exchange: shares, units, ETFs, real-estate funds (FIIs) and BDRs (docs/09). Orders reach B3
// only through a broker authorized by the CVM; this package holds B3's own rules (tickers,
// lots, the fractional market, trading hours, D+2 settlement), a quote source (brapi.dev),
// a JSON contract a broker adapter speaks, and a broker in memory for the sandbox and tests.
package brokerage

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/pricing"
)

// Quote is an instrument's last price in reais.
type Quote struct {
	Ticker string    `json:"ticker"`
	Name   string    `json:"name"`
	Last   string    `json:"last"`             // reais, decimal
	Change string    `json:"change,omitempty"` // percent over the previous close
	At     time.Time `json:"at"`
}

// Order is a market order for one ticker as B3 lists it (a fractional leg ends in F).
type Order struct {
	ClientID string `json:"client_id"`
	Account  string `json:"account"` // the merchant's account at the broker
	Ticker   string `json:"ticker"`
	Side     string `json:"side"` // buy or sell
	Quantity int64  `json:"quantity"`
}

// Execution is what an order did.
type Execution struct {
	OrderID    string `json:"order_id"`
	ClientID   string `json:"client_id"`
	Ticker     string `json:"ticker"`
	Side       string `json:"side"`
	Quantity   int64  `json:"quantity"`
	Price      string `json:"price"` // average, reais
	GrossCents int64  `json:"gross"` // quantity × price, centavos
	FeesCents  int64  `json:"fees"`  // brokerage, B3 trading and settlement fees
}

// Broker is a CVM-authorized intermediary that routes orders to B3.
type Broker interface {
	Name() string
	Quote(ctx context.Context, ticker string) (Quote, error)
	Place(ctx context.Context, o Order) (Execution, error)
}

// ErrMarketClosed is an order outside the trading session.
var ErrMarketClosed = errors.New("brokerage: B3 is closed")

// ---------------------------------------------------------------- B3 rules

var tickerRE = regexp.MustCompile(`^([A-Z]{4})(3|4|5|6|7|8|11|31|32|33|34|35|39)$`)

// Instrument is what a ticker is.
type Instrument struct {
	Ticker string `json:"ticker"`
	Kind   string `json:"kind"` // share, unit (ETFs, FIIs, units) or bdr
	Lot    int64  `json:"lot"`  // the standard lot; a share's smaller quantities trade as TICKERF
}

// Parse validates a B3 ticker: four letters and the class code (3 ordinary, 4–8 preferred,
// 11 units, ETFs and FIIs, 31–35 and 39 BDRs).
func Parse(ticker string) (Instrument, error) {
	t := strings.ToUpper(strings.TrimSuffix(strings.TrimSpace(ticker), "F"))
	m := tickerRE.FindStringSubmatch(t)
	if m == nil {
		return Instrument{}, fmt.Errorf("brokerage: %q is not a B3 ticker", ticker)
	}
	switch m[2] {
	case "11":
		return Instrument{Ticker: t, Kind: "unit", Lot: 1}, nil
	case "31", "32", "33", "34", "35", "39":
		return Instrument{Ticker: t, Kind: "bdr", Lot: 1}, nil
	}
	return Instrument{Ticker: t, Kind: "share", Lot: 100}, nil
}

// Legs splits an order for quantity into what B3 trades: whole lots on the standard market
// and the rest (1 to 99 shares) on the fractional market, as TICKERF.
func (in Instrument) Legs(quantity int64) []Order {
	if quantity <= 0 {
		return nil
	}
	if in.Lot == 1 {
		return []Order{{Ticker: in.Ticker, Quantity: quantity}}
	}
	var out []Order
	if whole := quantity / in.Lot * in.Lot; whole > 0 {
		out = append(out, Order{Ticker: in.Ticker, Quantity: whole})
	}
	if frac := quantity % in.Lot; frac > 0 {
		out = append(out, Order{Ticker: in.Ticker + "F", Quantity: frac})
	}
	return out
}

// Session is B3's regular equities session, in Brasília time. B3 moves the close when the
// United States changes clocks: 17:55 while New York keeps standard time (November to March),
// 16:55 while it keeps daylight time (2026: 16:55 from 9 March, 17:55 from 3 November).
type Session struct {
	Open, Close time.Duration // since midnight
	// CloseUSDaylight is the close while the United States keeps daylight time; zero keeps Close.
	CloseUSDaylight time.Duration
}

// DefaultSession is the regular session's published hours.
var DefaultSession = Session{Open: 10 * time.Hour, Close: 17*time.Hour + 55*time.Minute, CloseUSDaylight: 16*time.Hour + 55*time.Minute}

// usDaylight reports whether the United States keeps daylight time on a Brasília calendar day:
// from the second Sunday of March to the day before the first Sunday of November.
func usDaylight(d time.Time) bool {
	sunday := func(month time.Month, nth int) time.Time {
		first := time.Date(d.Year(), month, 1, 0, 0, 0, 0, brt)
		return first.AddDate(0, 0, (7-int(first.Weekday()))%7+7*(nth-1))
	}
	day := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, brt)
	return !day.Before(sunday(time.March, 2)) && day.Before(sunday(time.November, 1))
}

var brt = time.FixedZone("BRT", -3*3600)

// TradingDay reports whether B3 trades on day: business days, except 24 and 31 December.
func TradingDay(day time.Time) bool {
	d := day.In(brt)
	if d.Month() == time.December && (d.Day() == 24 || d.Day() == 31) {
		return false
	}
	return pricing.IsBusinessDay(d)
}

// IsOpen reports whether the session is open at t.
func (s Session) IsOpen(t time.Time) bool {
	b := t.In(brt)
	since := time.Duration(b.Hour())*time.Hour + time.Duration(b.Minute())*time.Minute
	end := s.Close
	if s.CloseUSDaylight != 0 && usDaylight(b) {
		end = s.CloseUSDaylight
	}
	return TradingDay(t) && since >= s.Open && since < end
}

// Settlement is when a trade on day settles: two trading days later (D+2), as a date.
func Settlement(day time.Time) time.Time {
	d := day.In(brt)
	t := time.Date(d.Year(), d.Month(), d.Day(), 12, 0, 0, 0, brt)
	for n := 0; n < 2; {
		t = t.AddDate(0, 0, 1)
		if TradingDay(t) {
			n++
		}
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// Cost is quantity × price in centavos, rounded half up.
func Cost(quantity int64, price string) (int64, error) {
	p, ok := new(big.Rat).SetString(price)
	if !ok || p.Sign() <= 0 {
		return 0, fmt.Errorf("brokerage: bad price %q", price)
	}
	v := new(big.Rat).Mul(p, new(big.Rat).SetInt64(quantity*100))
	v.Add(v, big.NewRat(1, 2))
	return new(big.Int).Quo(v.Num(), v.Denom()).Int64(), nil
}

// B3Fees are B3's trading and settlement fees on a value, in basis points of a basis point
// (emolumentos plus taxa de liquidação, about 0,03% for individuals' day-to-day trades).
const B3FeeBasisPointsX100 = 300

// Fees are B3's fees on gross centavos, rounded up.
func Fees(gross int64) int64 { return (gross*B3FeeBasisPointsX100 + 999_999) / 1_000_000 }

// ---------------------------------------------------------------- memory broker

// Memory is a broker in memory: last prices the operator sets, fills at them, B3's fees
// and no brokerage fee. The session check is the caller's.
type Memory struct {
	mu     sync.Mutex
	prices map[string]Quote
	fills  map[string]Execution
}

// NewMemory returns a broker with the sandbox's reference prices.
func NewMemory() *Memory {
	m := &Memory{prices: map[string]Quote{}, fills: map[string]Execution{}}
	for t, v := range map[string][2]string{
		"PETR4": {"PETROBRAS PN", "38.50"}, "VALE3": {"VALE ON", "61.20"}, "ITUB4": {"ITAUUNIBANCO PN", "34.10"},
		"BBAS3": {"BRASIL ON", "27.80"}, "WEGE3": {"WEG ON", "52.40"}, "BOVA11": {"ISHARES BOVA CI", "127.50"},
		"IVVB11": {"ISHARES SP500 CI", "340.00"}, "HGLG11": {"CSHG LOGISTICA FII", "160.00"}, "MXRF11": {"MAXI RENDA FII", "9.80"},
		"AAPL34": {"APPLE DRN", "62.30"},
	} {
		m.prices[t] = Quote{Ticker: t, Name: v[0], Last: v[1], Change: "0.00", At: time.Now()}
	}
	return m
}

// SetPrice sets a ticker's last price.
func (m *Memory) SetPrice(ticker, last string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	q := m.prices[ticker]
	q.Ticker, q.Last, q.At = ticker, last, time.Now()
	m.prices[ticker] = q
}

// Name implements Broker.
func (m *Memory) Name() string { return "membroker" }

// Quote implements Broker.
func (m *Memory) Quote(_ context.Context, ticker string) (Quote, error) {
	in, err := Parse(ticker)
	if err != nil {
		return Quote{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	q, ok := m.prices[in.Ticker]
	if !ok {
		return Quote{}, fmt.Errorf("brokerage: no quote for %s", in.Ticker)
	}
	return q, nil
}

// Place implements Broker.
func (m *Memory) Place(ctx context.Context, o Order) (Execution, error) {
	m.mu.Lock()
	if e, ok := m.fills[o.ClientID]; ok {
		m.mu.Unlock()
		return e, nil
	}
	m.mu.Unlock()
	q, err := m.Quote(ctx, o.Ticker)
	if err != nil {
		return Execution{}, err
	}
	gross, err := Cost(o.Quantity, q.Last)
	if err != nil {
		return Execution{}, err
	}
	e := Execution{OrderID: ids.New("brk"), ClientID: o.ClientID, Ticker: o.Ticker, Side: o.Side, Quantity: o.Quantity, Price: q.Last,
		GrossCents: gross, FeesCents: Fees(gross)}
	m.mu.Lock()
	m.fills[o.ClientID] = e
	m.mu.Unlock()
	return e, nil
}
