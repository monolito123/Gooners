// Package fx moves money across currencies and borders through a regulated partner: rates,
// conversions between the platform's balances, the account details where merchants are paid
// from abroad, the credits that arrive there, and payments to banks abroad (docs/09). Wise
// speaks the Wise Platform API; Memory is a provider in memory for the sandbox and tests.
package fx

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/assets"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
)

// Conversion exchanges FromUnits of From for To at the provider.
type Conversion struct {
	ClientID  string // idempotency: the same ClientID converts once
	From, To  string
	FromUnits int64
}

// Converted is what a conversion produced.
type Converted struct {
	ID      string
	ToUnits int64
	Rate    string
}

// Details are where others pay into the platform's account in a currency; Reference tells
// the merchant's money apart and must go with every payment.
type Details struct {
	Currency      string `json:"currency"`
	Holder        string `json:"holder"`
	Bank          string `json:"bank"`
	IBAN          string `json:"iban,omitempty"`
	BIC           string `json:"bic,omitempty"`
	AccountNumber string `json:"account_number,omitempty"`
	RoutingNumber string `json:"routing_number,omitempty"` // ABA (USD)
	SortCode      string `json:"sort_code,omitempty"`      // GBP
	Reference     string `json:"reference"`
}

// Beneficiary is a bank account abroad.
type Beneficiary struct {
	Name          string `json:"name"`
	Type          string `json:"type"` // private or business
	Country       string `json:"country"`
	IBAN          string `json:"iban,omitempty"`
	BIC           string `json:"bic,omitempty"`
	AccountNumber string `json:"account_number,omitempty"`
	RoutingNumber string `json:"routing_number,omitempty"`
	SortCode      string `json:"sort_code,omitempty"`
}

// Payment sends Units of Currency to a beneficiary.
type Payment struct {
	ClientID    string
	Currency    string
	Units       int64
	Beneficiary Beneficiary
	Reference   string
}

// Credit is money that arrived in the platform's account abroad.
type Credit struct {
	ID, Currency, Reference, Payer string
	Units                          int64
	At                             time.Time
}

// Provider is the FX and international-accounts partner.
type Provider interface {
	Name() string
	// Rate is the mid-market price of one whole from in to, a decimal string.
	Rate(ctx context.Context, from, to string) (string, error)
	Convert(ctx context.Context, c Conversion) (Converted, error)
	AccountDetails(ctx context.Context, currency, reference string) (Details, error)
	Credits(ctx context.Context, currency string, since time.Time) ([]Credit, error)
	Pay(ctx context.Context, p Payment) (id string, err error)
}

// ErrUnsupported is a currency or a beneficiary format the provider does not serve.
var ErrUnsupported = errors.New("fx: not supported")

// Currencies are the foreign currencies merchants can hold.
var Currencies = []string{"USD", "EUR", "GBP"}

// Reference is the payment reference that routes money from abroad to a merchant: short,
// alphanumeric, the same every time.
func Reference(merchantID string) string {
	h := sha256.Sum256([]byte("goonerspay/v1/fx-reference:" + merchantID))
	return "GP" + strings.ToUpper(hex.EncodeToString(h[:5]))
}

// ---------------------------------------------------------------- validation

// ValidIBAN checks an IBAN's length and ISO 13616 mod-97 check digits.
func ValidIBAN(iban string) bool {
	s := strings.ToUpper(strings.ReplaceAll(iban, " ", ""))
	if len(s) < 15 || len(s) > 34 {
		return false
	}
	r := s[4:] + s[:4]
	n := new(big.Int)
	var b strings.Builder
	for _, c := range r {
		switch {
		case c >= '0' && c <= '9':
			b.WriteRune(c)
		case c >= 'A' && c <= 'Z':
			fmt.Fprintf(&b, "%d", c-'A'+10)
		default:
			return false
		}
	}
	n.SetString(b.String(), 10)
	return new(big.Int).Mod(n, big.NewInt(97)).Int64() == 1
}

// ValidABA checks a US routing number's 3-7-1 checksum.
func ValidABA(rtn string) bool {
	if len(rtn) != 9 {
		return false
	}
	w := []int{3, 7, 1, 3, 7, 1, 3, 7, 1}
	sum := 0
	for i, c := range rtn {
		if c < '0' || c > '9' {
			return false
		}
		sum += int(c-'0') * w[i]
	}
	return sum%10 == 0
}

// Validate checks that a beneficiary can be paid in currency: an IBAN (and BIC) for EUR, an
// ABA routing and account number for USD, a sort code and account number or an IBAN for GBP.
func (b Beneficiary) Validate(currency string) error {
	if strings.TrimSpace(b.Name) == "" || len(b.Country) != 2 {
		return errors.New("fx: the beneficiary needs a name and a two-letter country")
	}
	if b.Type != "private" && b.Type != "business" {
		return errors.New("fx: the beneficiary type is private or business")
	}
	switch currency {
	case "EUR":
		if !ValidIBAN(b.IBAN) {
			return errors.New("fx: a valid IBAN is required for euros")
		}
	case "USD":
		if !ValidABA(b.RoutingNumber) || len(b.AccountNumber) < 4 || len(b.AccountNumber) > 17 {
			return errors.New("fx: a valid ABA routing number and account number are required for dollars")
		}
	case "GBP":
		if !ValidIBAN(b.IBAN) && (len(b.SortCode) != 6 || len(b.AccountNumber) != 8) {
			return errors.New("fx: a sort code and 8-digit account number, or an IBAN, are required for pounds")
		}
	default:
		return fmt.Errorf("%w: %s", ErrUnsupported, currency)
	}
	return nil
}

// ---------------------------------------------------------------- memory provider

// Memory is a provider in memory: mid rates set by the operator, conversions at mid, fixed
// account details, credits the sandbox simulates, payments recorded.
type Memory struct {
	mu        sync.Mutex
	rates     map[string]string // "USD/BRL"
	converted map[string]Converted
	credits   []Credit
	paid      map[string]string
}

// NewMemory returns a provider with the sandbox's reference rates.
func NewMemory() *Memory {
	return &Memory{converted: map[string]Converted{}, paid: map[string]string{},
		rates: map[string]string{"USD/BRL": "5.40", "EUR/BRL": "5.85", "GBP/BRL": "6.85"}}
}

// SetRate sets a currency's mid rate in reais.
func (m *Memory) SetRate(currency, brl string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rates[currency+"/BRL"] = brl
}

// Name implements Provider.
func (m *Memory) Name() string { return "memfx" }

// Rate implements Provider, crossing through reais when neither side is BRL.
func (m *Memory) Rate(_ context.Context, from, to string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	inBRL := func(c string) (*big.Rat, bool) {
		if c == "BRL" {
			return big.NewRat(1, 1), true
		}
		r, ok := new(big.Rat).SetString(m.rates[c+"/BRL"])
		return r, ok && m.rates[c+"/BRL"] != ""
	}
	f, ok1 := inBRL(from)
	t, ok2 := inBRL(to)
	if !ok1 || !ok2 {
		return "", fmt.Errorf("%w: %s/%s", ErrUnsupported, from, to)
	}
	return new(big.Rat).Quo(f, t).FloatString(10), nil
}

// Convert implements Provider, at mid.
func (m *Memory) Convert(ctx context.Context, c Conversion) (Converted, error) {
	m.mu.Lock()
	if v, ok := m.converted[c.ClientID]; ok {
		m.mu.Unlock()
		return v, nil
	}
	m.mu.Unlock()
	rate, err := m.Rate(ctx, c.From, c.To)
	if err != nil {
		return Converted{}, err
	}
	from, err1 := assets.Get(c.From)
	to, err2 := assets.Get(c.To)
	if err1 != nil || err2 != nil {
		return Converted{}, fmt.Errorf("%w: %s/%s", ErrUnsupported, c.From, c.To)
	}
	n, err := assets.Convert(c.FromUnits, from, to, rate)
	if err != nil {
		return Converted{}, err
	}
	v := Converted{ID: ids.New("fxc"), ToUnits: n, Rate: rate}
	m.mu.Lock()
	m.converted[c.ClientID] = v
	m.mu.Unlock()
	return v, nil
}

// AccountDetails implements Provider.
func (m *Memory) AccountDetails(_ context.Context, currency, reference string) (Details, error) {
	d := Details{Currency: currency, Holder: "goonerspay (sandbox)", Reference: reference}
	switch currency {
	case "USD":
		d.Bank, d.RoutingNumber, d.AccountNumber = "Sandbox Bank NA", "026009593", "8310004421"
	case "EUR":
		d.Bank, d.IBAN, d.BIC = "Sandbox Bank SA", "BE68539007547034", "SANDBEBB"
	case "GBP":
		d.Bank, d.SortCode, d.AccountNumber = "Sandbox Bank Ltd", "040075", "31926819"
	default:
		return Details{}, fmt.Errorf("%w: %s", ErrUnsupported, currency)
	}
	return d, nil
}

// SimulateCredit records money arriving from abroad (the sandbox's "a client paid you").
func (m *Memory) SimulateCredit(currency, reference, payer string, units int64) Credit {
	c := Credit{ID: ids.New("fxin"), Currency: currency, Reference: reference, Payer: payer, Units: units, At: time.Now()}
	m.mu.Lock()
	m.credits = append(m.credits, c)
	m.mu.Unlock()
	return c
}

// Credits implements Provider.
func (m *Memory) Credits(_ context.Context, currency string, since time.Time) ([]Credit, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Credit
	for _, c := range m.credits {
		if c.Currency == currency && !c.At.Before(since) {
			out = append(out, c)
		}
	}
	return out, nil
}

// Pay implements Provider.
func (m *Memory) Pay(_ context.Context, p Payment) (string, error) {
	if err := p.Beneficiary.Validate(p.Currency); err != nil {
		return "", err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if id, ok := m.paid[p.ClientID]; ok {
		return id, nil
	}
	id := ids.New("fxout")
	m.paid[p.ClientID] = id
	return id, nil
}
