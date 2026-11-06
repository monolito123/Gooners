package ledger

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Platform-wide accounts (docs/04-serverless-backend.md §3.1).
const (
	AccSettlementBank      = "asset.settlement_bank"
	AccSafeguardingReserve = "asset.safeguarding_reserve"
	AccPixSettlement       = "asset.pix_settlement"
	AccPixInTransit        = "liability.pix_in_transit"
	AccFundingCreditLine   = "liability.funding.credit_line"
	AccRevenueMDR          = "revenue.mdr"
	AccRevenueAdvanceFees  = "revenue.advance_fees"
	AccRevenuePayoutFees   = "revenue.payout_fees"
	AccExpenseInterchange  = "expense.interchange"
	AccExpenseSchemeFees   = "expense.scheme_fees"
	AccExpenseFraudLoss    = "expense.fraud_loss"
	AccEquityCapital       = "equity.capital"
	// AccReconSuspense holds settlement cash that reconciliation could not match, until an
	// operator allocates it. It may swing either way and should be zero after resolution.
	AccReconSuspense = "liability.recon_suspense"
)

// SchemeReceivable is owed by a scheme (brand) for cleared transactions.
func SchemeReceivable(brand string) string { return "asset.scheme_receivable." + brand }

// SchemePayable is owed to a scheme for refunds and chargebacks.
func SchemePayable(brand string) string { return "liability.scheme_payable." + brand }

// MerchantPayable is earned by the merchant but not yet available.
func MerchantPayable(m string) string { return "liability.merchant_payable." + m }

// MerchantWallet is the merchant's available e-money balance.
func MerchantWallet(m string) string { return "liability.merchant_wallet." + m }

// MerchantReserve is the rolling reserve held against risk.
func MerchantReserve(m string) string { return "liability.merchant_reserve." + m }

// MerchantRecoverable is owed by the merchant (for example a chargeback larger than its balance).
func MerchantRecoverable(m string) string { return "asset.merchant_recoverable." + m }

// Custody is the platform's holding of an asset at a venue (an exchange, an FX provider),
// in that asset's currency.
func Custody(venue, asset string) string {
	return "asset.custody." + venue + "." + strings.ToLower(asset)
}

// MerchantHolding is a merchant's balance in an asset other than reais, held in custody.
// It is not e-money in reais, so it stays out of the safeguarding reserve (L5); L6 holds the
// holdings to the custody balances, asset by asset.
func MerchantHolding(m, asset string) string {
	return "liability.merchant_holding." + m + "." + strings.ToLower(asset)
}

// VenueFees are fees a venue charged in an asset other than reais.
func VenueFees(asset string) string { return "expense.venue_fees." + strings.ToLower(asset) }

// BrokerSettlement is owed to a broker for purchases until they settle at B3 (D+2).
func BrokerSettlement(broker string) string { return "liability.broker_settlement." + broker }

// AssetClearing carries an asset between its arrival and its sale (a crypto payment).
func AssetClearing(asset string) string { return "liability.asset_clearing." + strings.ToLower(asset) }

// ComplianceHold holds a crypto deposit compliance has not cleared: its sender is on a
// sanctions list or could not be screened. A block keeps it here, frozen.
func ComplianceHold(asset string) string {
	return "liability.compliance_hold." + strings.ToLower(asset)
}

// Accounts of conversions between reais and other assets.
const (
	AccRevenueConversionFees = "revenue.conversion_fees"
	// AccConversionResult is the difference between the price promised and the price the
	// venue gave: positive when the platform did better than quoted.
	AccConversionResult = "revenue.conversion_result"
	// AccIOFPayable is IOF withheld on foreign exchange, owed to the Receita Federal.
	AccIOFPayable = "liability.iof_payable"
)

// Brands with scheme accounts.
var Brands = []string{"visa", "mastercard", "elo"}

// BootstrapTenant creates the platform accounts of a tenant. Hot accounts get 64 shards (§3.5).
func (l *Ledger) BootstrapTenant(ctx context.Context, tenantID, currency string) error {
	accts := []Account{
		{ID: AccSettlementBank, Code: "asset.settlement_bank", NormalSide: Debit},
		{ID: AccSafeguardingReserve, Code: "asset.safeguarding_reserve", NormalSide: Debit, Shards: 64},
		{ID: AccPixSettlement, Code: "asset.pix_settlement", NormalSide: Debit, Shards: 16},
		{ID: AccPixInTransit, Code: "liability.pix_in_transit", NormalSide: Credit, Shards: 16},
		{ID: AccFundingCreditLine, Code: "liability.funding", NormalSide: Credit},
		{ID: AccRevenueMDR, Code: "revenue.mdr", NormalSide: Credit, Shards: 64},
		{ID: AccRevenueAdvanceFees, Code: "revenue.advance_fees", NormalSide: Credit, Shards: 16},
		{ID: AccRevenuePayoutFees, Code: "revenue.payout_fees", NormalSide: Credit},
		{ID: AccExpenseInterchange, Code: "expense.interchange", NormalSide: Debit, Shards: 64},
		{ID: AccExpenseSchemeFees, Code: "expense.scheme_fees", NormalSide: Debit, Shards: 64},
		{ID: AccExpenseFraudLoss, Code: "expense.fraud_loss", NormalSide: Debit},
		{ID: AccEquityCapital, Code: "equity.capital", NormalSide: Credit},
		{ID: AccReconSuspense, Code: "liability.recon_suspense", NormalSide: Credit, AllowNegative: true},
	}
	for _, b := range Brands {
		accts = append(accts,
			Account{ID: SchemeReceivable(b), Code: "asset.scheme_receivable", NormalSide: Debit, Shards: 64},
			Account{ID: SchemePayable(b), Code: "liability.scheme_payable", NormalSide: Credit, Shards: 16},
		)
	}
	for _, a := range accts {
		a.TenantID, a.Currency = tenantID, currency
		if err := l.EnsureAccount(ctx, a); err != nil {
			return fmt.Errorf("ledger: bootstrap %s: %w", a.ID, err)
		}
	}
	return nil
}

// OpenMerchant creates a merchant's payable, wallet, reserve and recoverable accounts.
func (l *Ledger) OpenMerchant(ctx context.Context, tenantID, merchantID, currency string) error {
	for _, a := range []Account{
		{ID: MerchantPayable(merchantID), Code: "liability.merchant_payable", NormalSide: Credit},
		{ID: MerchantWallet(merchantID), Code: "liability.merchant_wallet", NormalSide: Credit},
		{ID: MerchantReserve(merchantID), Code: "liability.merchant_reserve", NormalSide: Credit},
		{ID: MerchantRecoverable(merchantID), Code: "asset.merchant_recoverable", NormalSide: Debit},
	} {
		a.TenantID, a.Currency = tenantID, currency
		if err := l.EnsureAccount(ctx, a); err != nil {
			return fmt.Errorf("ledger: open merchant %s: %w", merchantID, err)
		}
	}
	return nil
}

// ---- posting catalogue (docs/04-serverless-backend.md §3.4) ----

func dr(a string, n int64) Posting { return Posting{a, Debit, n} }
func cr(a string, n int64) Posting { return Posting{a, Credit, n} }

// CardCaptureAmounts split a captured card sale.
type CardCaptureAmounts struct {
	Gross       int64 // what the cardholder paid
	MDR         int64 // merchant discount
	Interchange int64 // estimated; trued up at settlement
	SchemeFees  int64
}

// CardCapture: the scheme owes gross − interchange − scheme fees; the merchant earns gross − MDR.
func CardCapture(brand, merchant string, a CardCaptureAmounts) []Posting {
	out := []Posting{
		dr(SchemeReceivable(brand), a.Gross-a.Interchange-a.SchemeFees),
		cr(MerchantPayable(merchant), a.Gross-a.MDR),
	}
	if a.Interchange > 0 {
		out = append(out, dr(AccExpenseInterchange, a.Interchange))
	}
	if a.SchemeFees > 0 {
		out = append(out, dr(AccExpenseSchemeFees, a.SchemeFees))
	}
	if a.MDR > 0 {
		out = append(out, cr(AccRevenueMDR, a.MDR))
	}
	return out
}

// InstantRelease makes a payable available now, net of the advance fee.
func InstantRelease(merchant string, payable, fee int64) []Posting {
	out := []Posting{dr(MerchantPayable(merchant), payable), cr(MerchantWallet(merchant), payable-fee)}
	if fee > 0 {
		out = append(out, cr(AccRevenueAdvanceFees, fee))
	}
	return out
}

// ScheduledRelease makes a payable available on its settlement date, with no fee.
func ScheduledRelease(merchant string, payable int64) []Posting {
	return []Posting{dr(MerchantPayable(merchant), payable), cr(MerchantWallet(merchant), payable)}
}

// SafeguardTopup moves own cash into the reserve that backs e-money.
func SafeguardTopup(n int64) []Posting {
	return []Posting{dr(AccSafeguardingReserve, n), cr(AccSettlementBank, n)}
}

// SafeguardRelease returns reserve to own cash when client liabilities fall.
func SafeguardRelease(n int64) []Posting {
	return []Posting{dr(AccSettlementBank, n), cr(AccSafeguardingReserve, n)}
}

// PixPrefund pre-positions own funds in the Pix settlement account.
func PixPrefund(n int64) []Posting {
	return []Posting{dr(AccPixSettlement, n), cr(AccSettlementBank, n)}
}

// PayoutSend debits the wallet; the money is in transit until the SPI confirms.
func PayoutSend(merchant string, n, fee int64) []Posting {
	out := []Posting{dr(MerchantWallet(merchant), n+fee), cr(AccPixInTransit, n)}
	if fee > 0 {
		out = append(out, cr(AccRevenuePayoutFees, fee))
	}
	return out
}

// PayoutConfirm settles an outgoing Pix.
func PayoutConfirm(n int64) []Posting {
	return []Posting{dr(AccPixInTransit, n), cr(AccPixSettlement, n)}
}

// PayoutReturned reverses a payout that failed or was returned.
func PayoutReturned(merchant string, n int64) []Posting {
	return []Posting{dr(AccPixInTransit, n), cr(MerchantWallet(merchant), n)}
}

// PixReceived credits a merchant for an incoming Pix (fee may be zero).
func PixReceived(merchant string, n, fee int64) []Posting {
	out := []Posting{dr(AccPixSettlement, n), cr(MerchantWallet(merchant), n-fee)}
	if fee > 0 {
		out = append(out, cr(AccRevenueMDR, fee))
	}
	return out
}

// SchemeSettlement records cash received from a scheme for a settlement date.
func SchemeSettlement(brand string, n int64) []Posting {
	return []Posting{dr(AccSettlementBank, n), cr(SchemeReceivable(brand), n)}
}

// CardRefund debits the merchant and owes the amount to the scheme (credit clearing record).
func CardRefund(brand, merchant string, n int64) []Posting {
	return []Posting{dr(MerchantWallet(merchant), n), cr(SchemePayable(brand), n)}
}

// PixRefundSend debits the merchant for a Pix devolução in processing.
func PixRefundSend(merchant string, n int64) []Posting {
	return []Posting{dr(MerchantWallet(merchant), n), cr(AccPixInTransit, n)}
}

// Reverse mirrors postings (a correcting journal; journals are never edited).
func Reverse(ps []Posting) []Posting {
	out := make([]Posting, len(ps))
	for i, p := range ps {
		d := Debit
		if p.Direction == Debit {
			d = Credit
		}
		out[i] = Posting{p.Account, d, p.Amount}
	}
	return out
}

// NewJournal is a convenience constructor.
func NewJournal(tenantID, id, key, typ, ref string, postings []Posting) Journal {
	return Journal{TenantID: tenantID, ID: id, IdempotencyKey: key, Type: typ, Reference: ref, EffectiveDate: time.Now(), Postings: postings}
}
