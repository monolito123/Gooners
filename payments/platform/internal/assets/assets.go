// Package assets names the currencies and crypto-assets the platform holds, with the
// integer unit each is counted in: every amount in the ledger and the APIs is an integer
// number of the asset's smallest unit (centavos, cents, satoshis), never a float.
package assets

import (
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strings"
)

// Asset is a currency or a crypto-asset.
type Asset struct {
	Code     string // ledger currency code, at most 8 characters
	Name     string
	Decimals int    // units per whole = 10^Decimals
	Kind     string // fiat or crypto
	// Networks a crypto-asset is moved on, in this platform's names (bitcoin, ethereum, tron,
	// polygon, solana). Empty for fiat.
	Networks []string
}

// The base currency of the platform's books.
const Base = "BRL"

var registry = map[string]Asset{
	"BRL":  {Code: "BRL", Name: "Real", Decimals: 2, Kind: "fiat"},
	"USD":  {Code: "USD", Name: "US dollar", Decimals: 2, Kind: "fiat"},
	"EUR":  {Code: "EUR", Name: "Euro", Decimals: 2, Kind: "fiat"},
	"GBP":  {Code: "GBP", Name: "Pound sterling", Decimals: 2, Kind: "fiat"},
	"BTC":  {Code: "BTC", Name: "Bitcoin", Decimals: 8, Kind: "crypto", Networks: []string{"bitcoin"}},
	"ETH":  {Code: "ETH", Name: "Ether", Decimals: 9, Kind: "crypto", Networks: []string{"ethereum"}}, // gwei: wei overflows int64 above 9 ETH
	"USDT": {Code: "USDT", Name: "Tether USD", Decimals: 6, Kind: "crypto", Networks: []string{"ethereum", "tron", "polygon", "solana"}},
	"USDC": {Code: "USDC", Name: "USD Coin", Decimals: 6, Kind: "crypto", Networks: []string{"ethereum", "polygon", "solana"}},
}

// ErrUnknown is an asset the platform does not hold.
var ErrUnknown = errors.New("assets: unknown asset")

// Get returns an asset by code (case-insensitive).
func Get(code string) (Asset, error) {
	a, ok := registry[strings.ToUpper(code)]
	if !ok {
		return Asset{}, fmt.Errorf("%w %q", ErrUnknown, code)
	}
	return a, nil
}

// All lists the assets, fiat first, in code order.
func All() []Asset {
	out := make([]Asset, 0, len(registry))
	for _, a := range registry {
		out = append(out, a)
	}
	slices.SortFunc(out, func(a, b Asset) int {
		if a.Kind != b.Kind {
			return strings.Compare(b.Kind, a.Kind) // fiat before crypto
		}
		return strings.Compare(a.Code, b.Code)
	})
	return out
}

// OnNetwork reports whether the asset moves on network.
func (a Asset) OnNetwork(network string) bool { return slices.Contains(a.Networks, network) }

// Scale is 10^Decimals.
func (a Asset) Scale() *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(a.Decimals)), nil)
}

// Format writes units as a decimal string with all the asset's decimals ("129.90", "0.00150000").
func (a Asset) Format(units int64) string {
	r := new(big.Rat).SetFrac(big.NewInt(units), a.Scale())
	return r.FloatString(a.Decimals)
}

// Parse reads a decimal string ("129.9", "0.0015") into units. More decimals than the asset
// has are refused rather than rounded: a rounded amount is a different amount.
func (a Asset) Parse(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" || strings.ContainsAny(s, "eE+") {
		return 0, fmt.Errorf("assets: %q is not a decimal amount", s)
	}
	if i := strings.IndexByte(s, '.'); i >= 0 && len(s)-i-1 > a.Decimals {
		return 0, fmt.Errorf("assets: %s has at most %d decimals", a.Code, a.Decimals)
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return 0, fmt.Errorf("assets: %q is not a decimal amount", s)
	}
	r.Mul(r, new(big.Rat).SetInt(a.Scale()))
	if !r.IsInt() || !r.Num().IsInt64() {
		return 0, fmt.Errorf("assets: %q is out of range for %s", s, a.Code)
	}
	return r.Num().Int64(), nil
}

// Convert turns units of from into units of to at price (to per one whole from, a decimal
// string), rounding down: the platform never gives away a fraction of a unit.
func Convert(units int64, from, to Asset, price string) (int64, error) {
	p, ok := new(big.Rat).SetString(price)
	if !ok || p.Sign() <= 0 {
		return 0, fmt.Errorf("assets: bad price %q", price)
	}
	v := new(big.Rat).SetFrac(big.NewInt(units), from.Scale())
	v.Mul(v, p)
	v.Mul(v, new(big.Rat).SetInt(to.Scale()))
	q := new(big.Int).Quo(v.Num(), v.Denom())
	if !q.IsInt64() {
		return 0, errors.New("assets: conversion out of range")
	}
	return q.Int64(), nil
}

// Price is the price of one whole from in to, given both amounts, as a decimal string with
// precision decimals.
func Price(fromUnits int64, from Asset, toUnits int64, to Asset, precision int) string {
	if fromUnits == 0 {
		return "0"
	}
	r := new(big.Rat).SetFrac(big.NewInt(toUnits), to.Scale())
	r.Quo(r, new(big.Rat).SetFrac(big.NewInt(fromUnits), from.Scale()))
	return r.FloatString(precision)
}

// ApplyBps adjusts a decimal price by basis points (positive raises it), for spreads.
func ApplyBps(price string, bps int) (string, error) {
	p, ok := new(big.Rat).SetString(price)
	if !ok {
		return "", fmt.Errorf("assets: bad price %q", price)
	}
	p.Mul(p, big.NewRat(int64(10000+bps), 10000))
	return p.FloatString(10), nil
}
