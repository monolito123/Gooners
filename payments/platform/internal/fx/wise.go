package fx

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/assets"
)

// Wise speaks the Wise Platform API (https://docs.wise.com/api-docs) for a business profile:
// rates, balance conversions (a quote, then a balance movement), the profile's account
// details, balance statements for incoming credits, and transfers (recipient, quote,
// transfer, funding from the balance). Every mutating call carries an idempotency key derived
// from the platform's own ID, so a retry never moves money twice.
type Wise struct {
	BaseURL   string // https://api.wise.com (sandbox: https://api.sandbox.transferwise.tech)
	Token     string
	ProfileID string
	Client    *http.Client
}

// Name implements Provider.
func (w *Wise) Name() string { return "wise" }

func (w *Wise) base() string {
	if w.BaseURL != "" {
		return strings.TrimRight(w.BaseURL, "/")
	}
	return "https://api.wise.com"
}

// uuidFor turns a platform ID into the UUID Wise expects for idempotency.
func uuidFor(id string) string {
	h := sha256.Sum256([]byte("goonerspay/v1/wise:" + id))
	h[6] = h[6]&0x0f | 0x50 // version 5 layout
	h[8] = h[8]&0x3f | 0x80
	x := hex.EncodeToString(h[:16])
	return x[:8] + "-" + x[8:12] + "-" + x[12:16] + "-" + x[16:20] + "-" + x[20:32]
}

func (w *Wise) do(ctx context.Context, method, path string, body any, idem string, out any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, w.base()+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+w.Token)
	req.Header.Set("Content-Type", "application/json")
	if idem != "" {
		req.Header.Set("X-idempotence-uuid", idem)
	}
	c := w.Client
	if c == nil {
		c = &http.Client{Timeout: 20 * time.Second}
	}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		var e struct {
			Errors []struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"errors"`
		}
		if json.Unmarshal(raw, &e) == nil && len(e.Errors) > 0 {
			return fmt.Errorf("wise: %s %s", e.Errors[0].Code, e.Errors[0].Message)
		}
		return fmt.Errorf("wise: %s %s: HTTP %d", method, path, resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber() // amounts and rates stay exact
	return d.Decode(out)
}

func units(n json.Number, currency string) (int64, error) {
	a, err := assets.Get(currency)
	if err != nil {
		return 0, err
	}
	s := n.String()
	if i := strings.IndexByte(s, '.'); i >= 0 && len(s)-i-1 > a.Decimals {
		s = s[:i+1+a.Decimals]
	}
	return a.Parse(s)
}

func amount(n int64, currency string) json.Number {
	a, _ := assets.Get(currency)
	return json.Number(a.Format(n))
}

// Rate implements Provider (GET /v1/rates).
func (w *Wise) Rate(ctx context.Context, from, to string) (string, error) {
	var rs []struct {
		Rate json.Number `json:"rate"`
	}
	if err := w.do(ctx, http.MethodGet, "/v1/rates?"+url.Values{"source": {from}, "target": {to}}.Encode(), nil, "", &rs); err != nil {
		return "", err
	}
	if len(rs) == 0 {
		return "", fmt.Errorf("%w: %s/%s", ErrUnsupported, from, to)
	}
	return rs[0].Rate.String(), nil
}

type wiseQuote struct {
	ID   string      `json:"id"`
	Rate json.Number `json:"rate"`
}

func (w *Wise) quote(ctx context.Context, body map[string]any) (wiseQuote, error) {
	var q wiseQuote
	err := w.do(ctx, http.MethodPost, "/v3/profiles/"+w.ProfileID+"/quotes", body, "", &q)
	return q, err
}

// Convert implements Provider: a quote, then a balance movement between the profile's
// balances (POST /v2/profiles/{id}/balance-movements).
func (w *Wise) Convert(ctx context.Context, c Conversion) (Converted, error) {
	q, err := w.quote(ctx, map[string]any{"sourceCurrency": c.From, "targetCurrency": c.To, "sourceAmount": amount(c.FromUnits, c.From), "payOut": "BALANCE"})
	if err != nil {
		return Converted{}, err
	}
	var mv struct {
		ID           json.Number `json:"id"`
		State        string      `json:"state"`
		TargetAmount struct {
			Value    json.Number `json:"value"`
			Currency string      `json:"currency"`
		} `json:"targetAmount"`
	}
	if err := w.do(ctx, http.MethodPost, "/v2/profiles/"+w.ProfileID+"/balance-movements", map[string]any{"quoteId": q.ID}, uuidFor(c.ClientID), &mv); err != nil {
		return Converted{}, err
	}
	if mv.State != "" && mv.State != "COMPLETED" {
		return Converted{}, fmt.Errorf("wise: conversion %s is %s", mv.ID, mv.State)
	}
	n, err := units(mv.TargetAmount.Value, c.To)
	if err != nil {
		return Converted{}, err
	}
	return Converted{ID: mv.ID.String(), ToUnits: n, Rate: q.Rate.String()}, nil
}

// AccountDetails implements Provider (GET /v1/profiles/{id}/account-details): the local
// receiving details of the profile's balance in currency.
func (w *Wise) AccountDetails(ctx context.Context, currency, reference string) (Details, error) {
	var rs []struct {
		Currency struct {
			Code string `json:"code"`
		} `json:"currency"`
		ReceiveOptions []struct {
			Type    string `json:"type"`
			Details []struct {
				Type string `json:"type"`
				Body string `json:"body"`
			} `json:"details"`
		} `json:"receiveOptions"`
	}
	if err := w.do(ctx, http.MethodGet, "/v1/profiles/"+w.ProfileID+"/account-details", nil, "", &rs); err != nil {
		return Details{}, err
	}
	for _, r := range rs {
		if r.Currency.Code != currency {
			continue
		}
		d := Details{Currency: currency, Reference: reference}
		for _, o := range r.ReceiveOptions {
			for _, f := range o.Details {
				switch f.Type {
				case "ACCOUNT_HOLDER":
					d.Holder = f.Body
				case "BANK_NAME_AND_ADDRESS", "BANK_NAME":
					d.Bank = f.Body
				case "IBAN":
					d.IBAN = f.Body
				case "SWIFT_CODE", "BIC":
					d.BIC = f.Body
				case "ACCOUNT_NUMBER":
					d.AccountNumber = f.Body
				case "ROUTING_NUMBER", "ACH_ROUTING_NUMBER":
					d.RoutingNumber = f.Body
				case "SORT_CODE":
					d.SortCode = f.Body
				}
			}
		}
		return d, nil
	}
	return Details{}, fmt.Errorf("%w: no %s account details on the profile", ErrUnsupported, currency)
}

// Credits implements Provider: the incoming lines of the currency's balance statement.
func (w *Wise) Credits(ctx context.Context, currency string, since time.Time) ([]Credit, error) {
	var bs []struct {
		ID       json.Number `json:"id"`
		Currency string      `json:"currency"`
	}
	if err := w.do(ctx, http.MethodGet, "/v4/profiles/"+w.ProfileID+"/balances?types=STANDARD", nil, "", &bs); err != nil {
		return nil, err
	}
	var balance string
	for _, b := range bs {
		if b.Currency == currency {
			balance = b.ID.String()
		}
	}
	if balance == "" {
		return nil, fmt.Errorf("%w: no %s balance", ErrUnsupported, currency)
	}
	q := url.Values{"currency": {currency}, "intervalStart": {since.UTC().Format(time.RFC3339)}, "intervalEnd": {time.Now().UTC().Format(time.RFC3339)}, "type": {"COMPACT"}}
	var st struct {
		Transactions []struct {
			Type            string `json:"type"`
			Date            string `json:"date"`
			ReferenceNumber string `json:"referenceNumber"`
			Amount          struct {
				Value json.Number `json:"value"`
			} `json:"amount"`
			Details struct {
				SenderName       string `json:"senderName"`
				PaymentReference string `json:"paymentReference"`
			} `json:"details"`
		} `json:"transactions"`
	}
	if err := w.do(ctx, http.MethodGet, "/v1/profiles/"+w.ProfileID+"/balance-statements/"+balance+"/statement.json?"+q.Encode(), nil, "", &st); err != nil {
		return nil, err
	}
	var out []Credit
	for _, t := range st.Transactions {
		if t.Type != "CREDIT" {
			continue
		}
		n, err := units(t.Amount.Value, currency)
		if err != nil {
			return nil, err
		}
		at, _ := time.Parse(time.RFC3339, t.Date)
		out = append(out, Credit{ID: t.ReferenceNumber, Currency: currency, Reference: t.Details.PaymentReference, Payer: t.Details.SenderName, Units: n, At: at})
	}
	return out, nil
}

// Pay implements Provider: the recipient, a quote for it, the transfer, then funding from the
// profile's balance.
func (w *Wise) Pay(ctx context.Context, p Payment) (string, error) {
	if err := p.Beneficiary.Validate(p.Currency); err != nil {
		return "", err
	}
	b := p.Beneficiary
	details := map[string]any{"legalType": strings.ToUpper(b.Type)}
	typ := "iban"
	switch {
	case p.Currency == "USD":
		typ = "aba"
		details["abartn"], details["accountNumber"], details["accountType"] = b.RoutingNumber, b.AccountNumber, "CHECKING"
	case p.Currency == "GBP" && b.IBAN == "":
		typ = "sort_code"
		details["sortCode"], details["accountNumber"] = b.SortCode, b.AccountNumber
	default:
		details["IBAN"] = strings.ReplaceAll(b.IBAN, " ", "")
		if b.BIC != "" {
			details["BIC"] = b.BIC
		}
	}
	var rcp struct {
		ID json.Number `json:"id"`
	}
	if err := w.do(ctx, http.MethodPost, "/v1/accounts", map[string]any{"currency": p.Currency, "type": typ, "profile": w.ProfileID,
		"accountHolderName": b.Name, "details": details}, "", &rcp); err != nil {
		return "", err
	}
	q, err := w.quote(ctx, map[string]any{"sourceCurrency": p.Currency, "targetCurrency": p.Currency, "targetAmount": amount(p.Units, p.Currency),
		"targetAccount": rcp.ID, "payOut": "BANK_TRANSFER"})
	if err != nil {
		return "", err
	}
	var tr struct {
		ID json.Number `json:"id"`
	}
	if err := w.do(ctx, http.MethodPost, "/v1/transfers", map[string]any{"targetAccount": rcp.ID, "quoteUuid": q.ID, "customerTransactionId": uuidFor(p.ClientID),
		"details": map[string]any{"reference": p.Reference}}, "", &tr); err != nil {
		return "", err
	}
	var fund struct {
		Status string `json:"status"`
	}
	if err := w.do(ctx, http.MethodPost, "/v3/profiles/"+w.ProfileID+"/transfers/"+tr.ID.String()+"/payments", map[string]any{"type": "BALANCE"}, "", &fund); err != nil {
		return "", err
	}
	if fund.Status != "COMPLETED" {
		return "", errors.New("wise: funding the transfer from the balance was refused: " + fund.Status)
	}
	return tr.ID.String(), nil
}
