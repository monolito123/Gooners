package payments

import (
	"context"
	"fmt"

	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
)

// Split payments (docs/02 §6.4). A payment intent may divide its amount among accounts of the
// tenant: a marketplace's sale paid to the seller, the delivery partner and the marketplace's
// own commission. The division happens in the capture's own journal: the merchant of record
// (the intent's merchant, whose MID the card network saw) is credited the sale net of fees, as
// its signed statement shows, and in the same journal each other recipient's share moves to
// that recipient. The recipient that bears the fees (exactly one) receives its amount less the
// sale's fee; every other share is its amount. Each recipient's money then follows its own
// plan: its receivables, its instant settlement, its payouts.
//
// Refunds reverse the shares pro rata to the splits' amounts (the fee bearer takes the
// rounding), or charge the merchant of record alone with split_reversal "primary_only".
// Chargebacks and MED returns are charged to the merchant of record, which recovers its
// partners' part by transfer (§6.5) or under its own terms with them.

// MaxSplits is how many recipients a payment may have.
const MaxSplits = 10

// Split is one recipient of a payment.
type Split struct {
	AccountID string `json:"account_id"`
	Amount    int64  `json:"amount"`
	BearsFees bool   `json:"bears_fees"`
}

// ErrSplitMismatch is splits whose amounts do not add up to the payment's.
var ErrSplitMismatch = fmt.Errorf("%w: split_mismatch", ErrInvalid)

// storedSplit is a split as kept with the intent: with the merchant behind its account.
type storedSplit struct {
	AccountID  string `json:"account_id"`
	MerchantID string `json:"merchant_id"`
	Amount     int64  `json:"amount"`
	BearsFees  bool   `json:"bears_fees"`
}

// validateSplits checks a payment's splits against the tenant's accounts: active merchants,
// distinct accounts, amounts adding up to the payment's, and one fee bearer whose amount covers
// the highest fee the merchant of record's plan can charge on the sale.
func (s *Service) validateSplits(ctx context.Context, tenantID string, m *Merchant, in IntentInput) ([]storedSplit, string, error) {
	if len(in.Splits) == 0 {
		if in.SplitReversal != "" {
			return nil, "", invalid("split_reversal needs splits")
		}
		return nil, "", nil
	}
	reversal := in.SplitReversal
	switch reversal {
	case "":
		reversal = "pro_rata"
	case "pro_rata", "primary_only":
	default:
		return nil, "", invalid("split_reversal is pro_rata or primary_only")
	}
	if in.Channel == "crypto" {
		return nil, "", invalid("splits apply to card and Pix payments")
	}
	if len(in.Splits) > MaxSplits {
		return nil, "", invalid("at most %d splits", MaxSplits)
	}
	var sum int64
	var bearer *Split
	seen := map[string]bool{}
	out := make([]storedSplit, 0, len(in.Splits))
	for i := range in.Splits {
		sp := &in.Splits[i]
		if sp.Amount <= 0 {
			return nil, "", invalid("each split's amount must be positive")
		}
		if seen[sp.AccountID] {
			return nil, "", invalid("account %s appears in two splits", sp.AccountID)
		}
		seen[sp.AccountID] = true
		r, err := s.merchantByAccount(ctx, tenantID, sp.AccountID)
		if err != nil {
			return nil, "", invalid("split account %s is not one of the tenant's accounts", sp.AccountID)
		}
		if r.Status != MerchantActive {
			return nil, "", fmt.Errorf("%w: split recipient %s is %s", ErrMerchantInactive, r.ID, r.Status)
		}
		if sp.BearsFees {
			if bearer != nil {
				return nil, "", invalid("exactly one split bears the fees")
			}
			bearer = sp
		}
		sum += sp.Amount
		out = append(out, storedSplit{AccountID: sp.AccountID, MerchantID: r.ID, Amount: sp.Amount, BearsFees: sp.BearsFees})
	}
	if sum != in.Amount {
		return nil, "", fmt.Errorf("%w: the splits add up to %d, the payment is %d", ErrSplitMismatch, sum, in.Amount)
	}
	if bearer == nil {
		return nil, "", invalid("exactly one split bears the fees (bears_fees: true)")
	}
	if worst := worstFee(m, in.Amount); bearer.Amount < worst {
		return nil, "", invalid("the split that bears the fees (%d) must cover the highest fee the sale can carry (%d)", bearer.Amount, worst)
	}
	return out, reversal, nil
}

// worstFee is the highest fee the merchant of record's plan can charge on amount, whatever the
// card or Pix turns out to be.
func worstFee(m *Merchant, amount int64) int64 {
	bps := max(m.Plan.CreditBps, m.Plan.DebitBps, m.Plan.InstallmentBps, m.Plan.PixBps)
	return (amount*bps + 9999) / 10000
}

// share is what one merchant receives.
type share struct {
	merchant string
	amount   int64
}

// splitShares divides a captured sale whose fee is fee: the other recipients' shares, and what
// the merchant of record keeps of the sale's net. Without splits it keeps the whole net.
func splitShares(mor string, splits []storedSplit, gross, fee int64) (others []share, kept int64) {
	kept = gross - fee
	for _, sp := range splits {
		if sp.MerchantID == mor {
			continue
		}
		amt := sp.Amount
		if sp.BearsFees {
			amt -= fee
		}
		if amt > 0 {
			others = append(others, share{sp.MerchantID, amt})
			kept -= amt
		}
	}
	return others, kept
}

// splitPostings move the other recipients' shares from the merchant of record's account to
// theirs (account is the payable for cards, the wallet for Pix).
func splitPostings(account func(string) string, mor string, others []share) []ledger.Posting {
	var ps []ledger.Posting
	for _, o := range others {
		ps = append(ps, ledger.Posting{Account: account(mor), Direction: ledger.Debit, Amount: o.amount},
			ledger.Posting{Account: account(o.merchant), Direction: ledger.Credit, Amount: o.amount})
	}
	return ps
}

// reversalShares divides a refund of amount among the recipients: pro rata to the splits'
// amounts, the fee bearer taking the rounding; or all to the merchant of record.
func reversalShares(mor string, splits []storedSplit, reversal string, gross, amount int64) []share {
	if len(splits) == 0 || reversal == "primary_only" || gross <= 0 {
		return []share{{mor, amount}}
	}
	var out []share
	var given int64
	bearer := -1
	for _, sp := range splits {
		part := amount * sp.Amount / gross
		if sp.BearsFees {
			bearer = len(out)
		}
		out = append(out, share{sp.MerchantID, part})
		given += part
	}
	out[bearer].amount += amount - given
	var nonzero []share
	for _, o := range out {
		if o.amount > 0 {
			nonzero = append(nonzero, o)
		}
	}
	return nonzero
}

// walletDebits debit each share from its merchant's wallet.
func walletDebits(shares []share) []ledger.Posting {
	ps := make([]ledger.Posting, 0, len(shares))
	for _, sh := range shares {
		ps = append(ps, ledger.Posting{Account: ledger.MerchantWallet(sh.merchant), Direction: ledger.Debit, Amount: sh.amount})
	}
	return ps
}

// publicSplits are the splits as the API shows them.
func publicSplits(stored []storedSplit) []Split {
	if len(stored) == 0 {
		return nil
	}
	out := make([]Split, len(stored))
	for i, sp := range stored {
		out[i] = Split{AccountID: sp.AccountID, Amount: sp.Amount, BearsFees: sp.BearsFees}
	}
	return out
}

// splitKeys are the registrar effect keys of a sale's other recipients.
func splitKeys(piID string, others []share) []string {
	out := make([]string, len(others))
	for i, o := range others {
		out[i] = "capture:" + piID + ":" + o.merchant
	}
	return out
}
