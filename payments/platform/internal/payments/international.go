package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/assets"
	"github.com/monolito123/Gooners/payments/platform/internal/exchange"
	"github.com/monolito123/Gooners/payments/platform/internal/fx"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
)

// International defaults (Config overrides them). IOF follows Decreto 6.306/2007 as amended
// by Decreto 12.499/2025: 3,5% on reais leaving for an account abroad, 0,38% on currency
// coming in; confirm the rates for each operation's nature with tax counsel (docs/09 §3).
const (
	defaultFXFeeBps    = 50
	defaultFXSpreadBps = 30
	defaultIOFOutBps   = 350
	defaultIOFInBps    = 38
)

// fxPayoutFees are what a payment abroad costs the merchant, in the currency's units.
var fxPayoutFees = map[string]int64{"USD": 5_00, "EUR": 4_00, "GBP": 4_00}

// ErrFXDisabled is an international call without a configured provider.
var ErrFXDisabled = fmt.Errorf("%w: no FX provider is configured", ErrDisabled)

func bps(v, def int) int64 {
	if v > 0 {
		return int64(v)
	}
	return int64(def)
}

func fxCurrency(code string) (assets.Asset, error) {
	a, err := assets.Get(code)
	if err != nil || !slices.Contains(fx.Currencies, a.Code) {
		return assets.Asset{}, invalid("currency must be one of USD, EUR, GBP")
	}
	return a, nil
}

func (s *Service) quoteFX(ctx context.Context, tenantID, merchantID, side string, a assets.Asset, brlUnits, assetUnits int64) (*Conversion, error) {
	if s.fx == nil {
		return nil, ErrFXDisabled
	}
	if _, err := fxCurrency(a.Code); err != nil {
		return nil, err
	}
	mid, err := s.fx.Rate(ctx, a.Code, assets.Base)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	spread := int(bps(s.cfg.FXSpreadBps, defaultFXSpreadBps))
	if side == exchange.Sell {
		spread = -spread
	}
	price, _ := assets.ApplyBps(mid, spread)
	brl, _ := assets.Get(assets.Base)
	if assetUnits > 0 {
		if brlUnits, err = assets.Convert(assetUnits, a, brl, price); err != nil {
			return nil, err
		}
	} else if assetUnits, err = assets.Convert(brlUnits, brl, a, new(big.Rat).Inv(rat(price)).FloatString(24)); err != nil {
		return nil, err
	}
	if assetUnits <= 0 || brlUnits <= 0 {
		return nil, invalid("the amount is too small to convert")
	}
	fee := brlUnits * bps(s.cfg.FXFeeBps, defaultFXFeeBps) / 10000
	iof := brlUnits * bps(s.cfg.IOFOutBps, defaultIOFOutBps) / 10000
	if side == exchange.Sell {
		iof = brlUnits * bps(s.cfg.IOFInBps, defaultIOFInBps) / 10000
	}
	return s.storeQuote(ctx, tenantID, merchantID, "fx", s.fx.Name(), side, a.Code, assetUnits, brlUnits, fee, iof, price)
}

func (s *Service) executeFX(ctx context.Context, tenantID string, c *Conversion) error {
	if s.fx == nil {
		return ErrFXDisabled
	}
	p := s.fx.Name()
	if err := s.conversionAccts(ctx, tenantID); err != nil {
		return err
	}
	resultAcct := ledger.Account{ID: ledger.AccConversionResult + "." + lower(c.Asset), Code: "revenue.conversion_result", Currency: c.Asset, NormalSide: ledger.Credit, AllowNegative: true}
	if err := s.ensure(ctx, tenantID, custodyAcct(p, c.Asset), custodyAcct(p, assets.Base), holdingAcct(c.MerchantID, c.Asset), resultAcct); err != nil {
		return err
	}
	custody, holding, wallet := ledger.Custody(p, c.Asset), ledger.MerchantHolding(c.MerchantID, c.Asset), ledger.MerchantWallet(c.MerchantID)
	brlCustody := ledger.Custody(p, assets.Base)
	if c.Side == exchange.Buy {
		if err := s.ensureFunded(ctx, tenantID, brlCustody, c.BRLUnits); err != nil {
			return err
		}
		got, err := s.fx.Convert(ctx, fx.Conversion{ClientID: c.ID, From: assets.Base, To: c.Asset, FromUnits: c.BRLUnits})
		if err != nil {
			return fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		ps := []ledger.Posting{
			{Account: wallet, Direction: ledger.Debit, Amount: c.Total},
			{Account: brlCustody, Direction: ledger.Credit, Amount: c.BRLUnits},
			{Account: ledger.AccRevenueConversionFees, Direction: ledger.Credit, Amount: c.Fee},
		}
		if c.Tax > 0 {
			ps = append(ps, ledger.Posting{Account: ledger.AccIOFPayable, Direction: ledger.Credit, Amount: c.Tax})
		}
		ps = append(ps, ledger.SafeguardRelease(c.Total)...)
		if err := s.post(ctx, tenantID, "conv_brl:"+c.ID, "conversion", c.ID, ps); err != nil {
			return err
		}
		// The merchant gets the quoted amount; what the provider gave beyond it (the spread)
		// is the platform's, in the currency.
		ps = []ledger.Posting{{Account: custody, Direction: ledger.Debit, Amount: got.ToUnits}, {Account: holding, Direction: ledger.Credit, Amount: c.AssetUnits}}
		if d := got.ToUnits - c.AssetUnits; d > 0 {
			ps = append(ps, ledger.Posting{Account: resultAcct.ID, Direction: ledger.Credit, Amount: d})
		} else if d < 0 {
			ps = append(ps, ledger.Posting{Account: resultAcct.ID, Direction: ledger.Debit, Amount: -d})
		}
		if err := s.post(ctx, tenantID, "conv_asset:"+c.ID, "conversion", c.ID, ps); err != nil {
			return err
		}
		_, err = s.pool.Exec(ctx, `UPDATE conversions SET venue_ref = $2 WHERE id = $1`, c.ID, got.ID)
		return err
	}
	got, err := s.fx.Convert(ctx, fx.Conversion{ClientID: c.ID, From: c.Asset, To: assets.Base, FromUnits: c.AssetUnits})
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if err := s.post(ctx, tenantID, "conv_asset:"+c.ID, "conversion", c.ID, []ledger.Posting{
		{Account: holding, Direction: ledger.Debit, Amount: c.AssetUnits}, {Account: custody, Direction: ledger.Credit, Amount: c.AssetUnits}}); err != nil {
		return err
	}
	ps := []ledger.Posting{
		{Account: brlCustody, Direction: ledger.Debit, Amount: got.ToUnits},
		{Account: wallet, Direction: ledger.Credit, Amount: c.Total},
		{Account: ledger.AccRevenueConversionFees, Direction: ledger.Credit, Amount: c.Fee},
	}
	if c.Tax > 0 {
		ps = append(ps, ledger.Posting{Account: ledger.AccIOFPayable, Direction: ledger.Credit, Amount: c.Tax})
	}
	ps = append(ps, result(got.ToUnits-c.BRLUnits)...)
	ps = append(ps, ledger.SafeguardTopup(c.Total)...)
	if err := s.post(ctx, tenantID, "conv_brl:"+c.ID, "conversion", c.ID, ps); err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `UPDATE conversions SET venue_ref = $2 WHERE id = $1`, c.ID, got.ID)
	return err
}

func lower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

// InternationalAccount is a merchant's account in a foreign currency: its balance, and the
// details others use to pay into it from abroad.
type InternationalAccount struct {
	Currency string     `json:"currency"`
	Units    int64      `json:"units"`
	Amount   string     `json:"amount"`
	Receive  fx.Details `json:"receive"`
}

// InternationalAccounts lists a merchant's foreign-currency accounts.
func (s *Service) InternationalAccounts(ctx context.Context, tenantID, merchantID string) ([]InternationalAccount, error) {
	if s.fx == nil {
		return nil, ErrFXDisabled
	}
	if _, err := s.GetMerchant(ctx, tenantID, merchantID); err != nil {
		return nil, err
	}
	out := []InternationalAccount{}
	for _, code := range fx.Currencies {
		a, _ := assets.Get(code)
		d, err := s.fx.AccountDetails(ctx, code, fx.Reference(merchantID))
		if err != nil {
			continue // the provider does not serve this currency
		}
		var n int64
		if bal, err := s.ledger.Balance(ctx, tenantID, ledger.MerchantHolding(merchantID, code)); err == nil {
			n = bal
		}
		out = append(out, InternationalAccount{Currency: code, Units: n, Amount: a.Format(n), Receive: d})
	}
	return out, nil
}

// PollFXCredits credits money that arrived from abroad to the merchant its reference names.
// A credit without a known reference is recorded for operations.
func (s *Service) PollFXCredits(ctx context.Context, since time.Time) (int, error) {
	if s.fx == nil {
		return 0, nil
	}
	n := 0
	for _, code := range fx.Currencies {
		cs, err := s.fx.Credits(ctx, code, since)
		if err != nil {
			continue
		}
		for _, c := range cs {
			var tenantID, merchantID string
			err := s.pool.QueryRow(ctx, `SELECT tenant_id::text, id FROM merchants WHERE fx_reference = $1`, c.Reference).Scan(&tenantID, &merchantID)
			var match *string
			if err == nil {
				match = &merchantID
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return n, err
			}
			tag, err := s.pool.Exec(ctx, `INSERT INTO fx_credits (provider, credit_id, currency, units, reference, payer, merchant_id) VALUES ($1, $2, $3, $4, $5, $6, $7)
				ON CONFLICT DO NOTHING`, s.fx.Name(), c.ID, code, c.Units, c.Reference, c.Payer, match)
			if err != nil {
				return n, err
			}
			if tag.RowsAffected() == 0 || match == nil {
				continue
			}
			if err := s.ensure(ctx, tenantID, custodyAcct(s.fx.Name(), code), holdingAcct(merchantID, code)); err != nil {
				return n, err
			}
			if err := s.post(ctx, tenantID, "fx_credit:"+s.fx.Name()+":"+c.ID, "fx_credit", c.ID, []ledger.Posting{
				{Account: ledger.Custody(s.fx.Name(), code), Direction: ledger.Debit, Amount: c.Units},
				{Account: ledger.MerchantHolding(merchantID, code), Direction: ledger.Credit, Amount: c.Units}}); err != nil {
				return n, err
			}
			a, _ := assets.Get(code)
			s.notify(ctx, tenantID, "international.credit.received", map[string]any{"merchant_id": merchantID, "currency": code, "amount": a.Format(c.Units), "payer": c.Payer})
			n++
		}
	}
	return n, nil
}

// SimulateFXCredit pays a merchant's foreign account from abroad in the sandbox.
func (s *Service) SimulateFXCredit(ctx context.Context, tenantID, merchantID, currency, amount, payer string) ([]InternationalAccount, error) {
	mem, ok := s.fx.(*fx.Memory)
	if !ok || s.cfg.Env == "production" {
		return nil, fmt.Errorf("%w: the sandbox FX provider is not running", ErrDisabled)
	}
	a, err := fxCurrency(currency)
	if err != nil {
		return nil, err
	}
	units, err := a.Parse(amount)
	if err != nil || units <= 0 {
		return nil, invalid("amount: a positive %s amount", a.Code)
	}
	if _, err := s.GetMerchant(ctx, tenantID, merchantID); err != nil {
		return nil, err
	}
	since := time.Now().Add(-time.Second)
	mem.SimulateCredit(a.Code, fx.Reference(merchantID), payer, units)
	if _, err := s.PollFXCredits(ctx, since); err != nil {
		return nil, err
	}
	return s.InternationalAccounts(ctx, tenantID, merchantID)
}

// InternationalPayout is a payment from a merchant's foreign account to a bank abroad.
type InternationalPayout struct {
	ID          string         `json:"id"`
	Object      string         `json:"object"`
	MerchantID  string         `json:"merchant_id"`
	Currency    string         `json:"currency"`
	Units       int64          `json:"units"`
	Amount      string         `json:"amount"`
	Fee         string         `json:"fee"`
	Beneficiary fx.Beneficiary `json:"beneficiary"`
	Reference   string         `json:"reference"`
	Status      string         `json:"status"`
}

// PayAbroad sends money from the merchant's foreign account to a bank abroad. The fee is in
// the currency; the journal comes first and is reversed if the provider refuses.
func (s *Service) PayAbroad(ctx context.Context, tenantID, merchantID, currency, amount, reference string, b fx.Beneficiary) (*InternationalPayout, error) {
	if s.fx == nil {
		return nil, ErrFXDisabled
	}
	a, err := fxCurrency(currency)
	if err != nil {
		return nil, err
	}
	units, err := a.Parse(amount)
	if err != nil || units <= 0 {
		return nil, invalid("amount: a positive %s amount", a.Code)
	}
	if err := b.Validate(a.Code); err != nil {
		return nil, invalid("%v", err)
	}
	if len(reference) > 35 {
		return nil, invalid("reference is limited to 35 characters")
	}
	fee := fxPayoutFees[a.Code]
	holding := ledger.MerchantHolding(merchantID, a.Code)
	if bal, err := s.ledger.Balance(ctx, tenantID, holding); err != nil || bal < units+fee {
		return nil, fmt.Errorf("%w: the %s account does not cover %s plus the fee %s", ErrFunds, a.Code, a.Format(units), a.Format(fee))
	}
	p := s.fx.Name()
	resultAcct := ledger.AccConversionResult + "." + lower(a.Code)
	if err := s.ensure(ctx, tenantID, custodyAcct(p, a.Code), ledger.Account{ID: resultAcct, Code: "revenue.conversion_result", Currency: a.Code,
		NormalSide: ledger.Credit, AllowNegative: true}); err != nil {
		return nil, err
	}
	out := &InternationalPayout{ID: ids.New("ip"), Object: "international_payout", MerchantID: merchantID, Currency: a.Code, Units: units,
		Amount: a.Format(units), Fee: a.Format(fee), Beneficiary: b, Reference: reference, Status: "sent"}
	ps := []ledger.Posting{{Account: holding, Direction: ledger.Debit, Amount: units + fee}, {Account: ledger.Custody(p, a.Code), Direction: ledger.Credit, Amount: units}}
	if fee > 0 {
		ps = append(ps, ledger.Posting{Account: resultAcct, Direction: ledger.Credit, Amount: fee})
	}
	if err := s.post(ctx, tenantID, "fx_payout:"+out.ID, "international_payout", out.ID, ps); err != nil {
		return nil, err
	}
	ref, payErr := s.fx.Pay(ctx, fx.Payment{ClientID: out.ID, Currency: a.Code, Units: units, Beneficiary: b, Reference: reference})
	if payErr != nil {
		out.Status = "failed"
		back := make([]ledger.Posting, len(ps))
		for i, x := range ps {
			x.Direction = map[ledger.Side]ledger.Side{ledger.Debit: ledger.Credit, ledger.Credit: ledger.Debit}[x.Direction]
			back[i] = x
		}
		_ = s.post(ctx, tenantID, "fx_payout_back:"+out.ID, "international_payout_reversed", out.ID, back)
	}
	dest, _ := json.Marshal(map[string]any{"beneficiary": b, "reference": reference})
	if _, err := s.pool.Exec(ctx, `INSERT INTO asset_transfers (id, tenant_id, merchant_id, kind, venue, asset, units, fee_units, destination, status, venue_ref)
		VALUES ($1, $2, $3, 'fx', $4, $5, $6, $7, $8, $9, NULLIF($10, ''))`, out.ID, tenantID, merchantID, p, a.Code, units, fee, dest, out.Status, ref); err != nil {
		return nil, err
	}
	if payErr != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, payErr)
	}
	s.notify(ctx, tenantID, "international.payout.sent", map[string]any{"id": out.ID, "merchant_id": merchantID, "currency": a.Code, "amount": out.Amount})
	return out, nil
}
