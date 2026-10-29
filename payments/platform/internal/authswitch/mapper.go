package authswitch

import (
	"fmt"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/pkg/emv"
	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
)

// ProcessingCode returns DE 3 for a request: positions 1–2 transaction type, 3–4 from-account.
func ProcessingCode(r Request) string {
	switch r.Kind {
	case Refund:
		return "200000"
	case Verification:
		return "000000"
	}
	switch r.Card.Funding {
	case "credit":
		return "003000"
	case "debit":
		return "002000"
	}
	return "000000"
}

// RRN builds a retrieval reference number: Y DDD hh + the 6-digit network STAN (12 characters).
func RRN(t time.Time, stan string) string {
	t = t.UTC()
	return fmt.Sprintf("%d%03d%02d%s", t.Year()%10, t.YearDay(), t.Hour(), stan)
}

// DE43 lays out merchant name (25), city (13) and country (2) in 40 characters.
func DE43(m Merchant) string {
	pad := func(s string, n int) string {
		s = iso8583.ToSchemeText(s)
		if len(s) > n {
			return s[:n]
		}
		return s + strings.Repeat(" ", n-len(s))
	}
	return pad(m.Name, 25) + pad(m.City, 13) + pad(m.Country, 2)
}

func setIf(m *iso8583.Message, spec *iso8583.Spec, n int, v string) {
	if v != "" && spec.Field(n) != nil {
		m.Set(n, v)
	}
}

// BuildAuthorization maps a canonical request to a 0100.
func BuildAuthorization(spec *iso8583.Spec, r Request, stan, rrn string, transmission time.Time) (*iso8583.Message, error) {
	if r.Card.PAN == "" && r.Card.Track2 == "" {
		return nil, fmt.Errorf("authswitch: no PAN or track 2")
	}
	m := iso8583.NewMessage("0100")
	setIf(m, spec, 2, r.Card.PAN)
	m.Set(3, ProcessingCode(r))
	m.Set(4, fmt.Sprintf("%012d", r.Amount))
	m.Set(7, transmission.UTC().Format("0102150405"))
	m.Set(11, stan)
	local := r.TerminalLocal
	if local.IsZero() {
		local = transmission
	}
	setIf(m, spec, 12, local.Format("150405"))
	setIf(m, spec, 13, local.Format("0102"))
	setIf(m, spec, 14, r.Card.Expiry)
	setIf(m, spec, 18, r.Merchant.MCC)
	setIf(m, spec, 19, "076")
	entry := r.Card.EntryMode
	if entry == "" {
		entry = "071"
	}
	setIf(m, spec, 22, entry)
	if r.Card.PANSequence != "" {
		setIf(m, spec, 23, fmt.Sprintf("%03s", r.Card.PANSequence))
	}
	cond := "00"
	if r.Channel == "ecommerce" {
		cond = "59"
	}
	setIf(m, spec, 25, cond)
	setIf(m, spec, 32, r.AcquirerID)
	setIf(m, spec, 35, r.Card.Track2)
	m.Set(37, rrn)
	m.Set(41, r.TerminalID)
	m.Set(42, fmt.Sprintf("%-15s", r.Merchant.SchemeMID))
	setIf(m, spec, 43, DE43(r.Merchant))
	m.Set(49, r.CurrencyNumeric)
	setIf(m, spec, 52, r.Card.PINBlockHex)
	if r.Card.EMVHex != "" {
		objs, err := emv.ParseHex(r.Card.EMVHex)
		if err != nil {
			return nil, fmt.Errorf("authswitch: DE 55: %w", err)
		}
		kept, _ := emv.FilterForDE55(objs)
		h, err := emv.EncodeHex(kept)
		if err != nil {
			return nil, err
		}
		setIf(m, spec, 55, h)
	}
	return m, nil
}

// DE90 builds original data elements: MTI(4) STAN(6) DE7(10) acquirer ID(11) forwarding ID(11).
func DE90(rec *Record) string {
	return "0100" + rec.NetworkSTAN + rec.TransmissionDT + fmt.Sprintf("%011s", rec.AcquirerID) + strings.Repeat("0", 11)
}

// DE95 builds replacement amounts for a partial reversal: actual amount, settlement amount, two fee fields.
func DE95(remaining int64) string {
	return fmt.Sprintf("%012d%012d", remaining, remaining) + "C00000000" + "C00000000"
}

// BuildReversal builds a 0400 (or a 0420 advice) for a stored authorization.
func BuildReversal(spec *iso8583.Spec, rec *Record, pan string, mti, stan, de7 string, remaining int64) *iso8583.Message {
	m := iso8583.NewMessage(mti)
	setIf(m, spec, 2, pan)
	m.Set(3, rec.ProcessingCode)
	m.Set(4, fmt.Sprintf("%012d", rec.Amount))
	m.Set(7, de7)
	m.Set(11, stan)
	setIf(m, spec, 14, rec.Expiry)
	setIf(m, spec, 18, rec.MCC)
	setIf(m, spec, 19, "076")
	setIf(m, spec, 22, rec.EntryMode)
	setIf(m, spec, 32, rec.AcquirerID)
	m.Set(37, rec.RRN)
	setIf(m, spec, 38, rec.AuthCode)
	m.Set(41, rec.TerminalID)
	m.Set(42, fmt.Sprintf("%-15s", rec.MerchantMID))
	m.Set(49, rec.CurrencyNumeric)
	setIf(m, spec, 90, DE90(rec))
	if remaining > 0 && remaining < rec.Amount {
		setIf(m, spec, 95, DE95(remaining))
	}
	return m
}
