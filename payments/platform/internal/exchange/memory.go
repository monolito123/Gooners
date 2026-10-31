package exchange

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"sync"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/assets"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
)

// Memory is an exchange in memory: mid prices set by the operator, a spread around them, a
// taker fee, deposit addresses per asset and network, and deposits the sandbox simulates.
// It refuses to run in production (the platform wires it only in the sandbox).
type Memory struct {
	ExchangeName string
	SpreadBps    int // half on each side of the mid
	FeeBps       int // taker fee, charged in the quote asset

	mu       sync.Mutex
	mids     map[string]string // "BTC/BRL" → decimal
	fills    map[string]Fill   // by client ID
	deposits []Deposit
	sent     map[string]string // withdrawals by client ID
	balances map[string]int64  // what the platform holds here, as a real account would show
}

// NewMemory returns an exchange with the sandbox's reference prices.
func NewMemory(name string) *Memory {
	return &Memory{ExchangeName: name, SpreadBps: 40, FeeBps: 10, fills: map[string]Fill{}, sent: map[string]string{}, balances: map[string]int64{}, mids: map[string]string{
		"BTC/BRL": "350000", "ETH/BRL": "12000", "USDT/BRL": "5.40", "USDC/BRL": "5.40",
		"BTC/USD": "65000", "ETH/USD": "2200", "USDT/USD": "1", "USDC/USD": "1",
		"BTC/EUR": "60000", "ETH/EUR": "2030",
	}}
}

// SetMid sets a pair's mid price.
func (m *Memory) SetMid(base, quote, mid string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.mids[base+"/"+quote] = mid
}

// Name implements Exchange.
func (m *Memory) Name() string { return m.ExchangeName }

// Book implements Exchange.
func (m *Memory) Book(_ context.Context, base, quote string) (Book, error) {
	m.mu.Lock()
	mid, ok := m.mids[base+"/"+quote]
	m.mu.Unlock()
	if !ok {
		return Book{}, fmt.Errorf("%w: %s/%s", ErrUnsupported, base, quote)
	}
	bid, _ := assets.ApplyBps(mid, -m.SpreadBps/2)
	ask, _ := assets.ApplyBps(mid, m.SpreadBps/2)
	return Book{Exchange: m.ExchangeName, Base: base, Quote: quote, Bid: bid, Ask: ask, At: time.Now()}, nil
}

// Market implements Exchange.
func (m *Memory) Market(ctx context.Context, o Order) (Fill, error) {
	if err := o.validate(); err != nil {
		return Fill{}, err
	}
	m.mu.Lock()
	if f, ok := m.fills[o.ClientID]; ok {
		m.mu.Unlock()
		return f, nil // idempotent, like a real venue's client order ID
	}
	m.mu.Unlock()
	b, err := m.Book(ctx, o.Base, o.Quote)
	if err != nil {
		return Fill{}, err
	}
	price := b.Ask
	if o.Side == Sell {
		price = b.Bid
	}
	base, quote := asset(o.Base), asset(o.Quote)
	f := Fill{Exchange: m.ExchangeName, OrderID: ids.New("mem"), ClientID: o.ClientID, FeeAsset: o.Quote}
	if o.BaseUnits > 0 {
		f.BaseUnits = o.BaseUnits
		if f.QuoteUnits, err = assets.Convert(o.BaseUnits, base, quote, price); err != nil {
			return Fill{}, err
		}
	} else {
		f.QuoteUnits = o.QuoteUnits
		// base = quote / price, exactly, then down to whole base units.
		v := new(big.Rat).SetFrac(big.NewInt(o.QuoteUnits), quote.Scale())
		v.Quo(v, rat(price))
		v.Mul(v, new(big.Rat).SetInt(base.Scale()))
		f.BaseUnits = new(big.Int).Quo(v.Num(), v.Denom()).Int64()
	}
	f.FeeUnits = f.QuoteUnits * int64(m.FeeBps) / 10000
	m.mu.Lock()
	defer m.mu.Unlock()
	if prev, ok := m.fills[o.ClientID]; ok {
		return prev, nil
	}
	m.fills[o.ClientID] = f
	if o.Side == Buy {
		m.balances[o.Base] += f.BaseUnits
		m.balances[o.Quote] -= f.QuoteUnits + f.FeeUnits
	} else {
		m.balances[o.Base] -= f.BaseUnits
		m.balances[o.Quote] += f.QuoteUnits - f.FeeUnits
	}
	return f, nil
}

func rat(s string) *big.Rat { r, _ := new(big.Rat).SetString(s); return r }

// DepositAddress implements Exchange: one address per asset and network, derived from the
// venue's name so it is stable across restarts.
func (m *Memory) DepositAddress(_ context.Context, code, network string) (string, string, error) {
	a, err := assets.Get(code)
	if err != nil || !a.OnNetwork(network) {
		return "", "", fmt.Errorf("%w: %s on %s", ErrUnsupported, code, network)
	}
	h := sha256.Sum256([]byte(m.ExchangeName + "/" + code + "/" + network))
	switch network {
	case "bitcoin":
		return "bc1q" + hex.EncodeToString(h[:19]), "", nil
	case "tron":
		return "T" + base58(h[:])[:33], "", nil
	case "solana":
		return base58(h[:32]), "", nil
	default: // ethereum, polygon
		return "0x" + hex.EncodeToString(h[:20]), "", nil
	}
}

// SimulateDeposit records an incoming, confirmed transfer (the sandbox's "the customer paid").
func (m *Memory) SimulateDeposit(code, network, address, memo string, units int64) Deposit {
	tx := make([]byte, 32)
	_, _ = rand.Read(tx)
	d := Deposit{ID: ids.New("dep"), Asset: code, Network: network, Address: address, Memo: memo, Units: units,
		TxID: hex.EncodeToString(tx), Confirmed: true, At: time.Now()}
	m.mu.Lock()
	m.deposits = append(m.deposits, d)
	m.balances[code] += units
	m.mu.Unlock()
	return d
}

// Fund adds to the platform's balance here, as a treasury transfer to the venue would.
func (m *Memory) Fund(code string, units int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.balances[code] += units
}

// Balances implements Exchange.
func (m *Memory) Balances(context.Context) (map[string]int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]int64, len(m.balances))
	for k, v := range m.balances {
		if v != 0 {
			out[k] = v
		}
	}
	return out, nil
}

// Deposits implements Exchange.
func (m *Memory) Deposits(_ context.Context, code string, since time.Time) ([]Deposit, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Deposit
	for _, d := range m.deposits {
		if d.Asset == code && !d.At.Before(since) {
			out = append(out, d)
		}
	}
	return out, nil
}

// Withdraw implements Exchange.
func (m *Memory) Withdraw(_ context.Context, w Withdrawal) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id, ok := m.sent[w.ClientID]; ok {
		return id, nil
	}
	id := ids.New("wd")
	m.sent[w.ClientID] = id
	m.balances[w.Asset] -= w.Units + w.FeeUnits
	return id, nil
}

const b58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

func base58(b []byte) string {
	n := new(big.Int).SetBytes(b)
	var out []byte
	mod := new(big.Int)
	for n.Sign() > 0 {
		n.DivMod(n, big.NewInt(58), mod)
		out = append([]byte{b58[mod.Int64()]}, out...)
	}
	return string(out)
}
