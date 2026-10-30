// Package pricing computes merchant discounts, cost estimates, settlement dates on the
// Brazilian business-day calendar, and risk-priced advance fees (docs/07-enhancements.md §1.3).
package pricing

import (
	"math"
	"time"
)

// Plan is a merchant's pricing.
type Plan struct {
	CreditBps      int64 // single-payment credit MDR, basis points
	DebitBps       int64
	InstallmentBps int64 // merchant installments (parcelado lojista)
	PixBps         int64
	Tier           string // A, B, C; D = not eligible for instant settlement
	Instant        bool   // instant settlement requested by the merchant
}

// DefaultPlan is used when a merchant has none.
var DefaultPlan = Plan{CreditBps: 319, DebitBps: 137, InstallmentBps: 499, PixBps: 0, Tier: "B", Instant: true}

// Costs are the platform's cost estimates (interchange is trued up at settlement).
type Costs struct {
	InterchangeCreditBps int64
	InterchangeDebitBps  int64 // capped at 50 bps by Res. BCB 246/2022
	SchemeFeeBps         int64
	SchemeFeeFixedCents  int64
	FundingCostAnnual    float64 // r_f, e.g. 0.15
	TierSpread           map[string]float64
}

// DefaultCosts are illustrative; production values come from the scheme fee tables and treasury.
var DefaultCosts = Costs{
	InterchangeCreditBps: 160, InterchangeDebitBps: 50, SchemeFeeBps: 10, SchemeFeeFixedCents: 3,
	FundingCostAnnual: 0.15, TierSpread: map[string]float64{"A": 0.015, "B": 0.03, "C": 0.06},
}

// bps applies basis points with round half up.
func bps(amount, b int64) int64 { return (amount*b + 5000) / 10000 }

// MDR is the merchant discount for a card sale.
func MDR(p Plan, amount int64, funding string, installments int) int64 {
	switch {
	case funding == "debit" || funding == "prepaid":
		return bps(amount, p.DebitBps)
	case installments > 1:
		return bps(amount, p.InstallmentBps)
	default:
		return bps(amount, p.CreditBps)
	}
}

// PixFee is the merchant fee for a received Pix.
func PixFee(p Plan, amount int64) int64 { return bps(amount, p.PixBps) }

// Interchange estimates interchange for routing and the capture journal.
func (c Costs) Interchange(amount int64, funding string) int64 {
	if funding == "debit" || funding == "prepaid" {
		return bps(amount, c.InterchangeDebitBps)
	}
	return bps(amount, c.InterchangeCreditBps)
}

// SchemeFees estimates scheme fees.
func (c Costs) SchemeFees(amount int64) int64 {
	return bps(amount, c.SchemeFeeBps) + c.SchemeFeeFixedCents
}

// AnnualRate is r_f + s_tier, or false when the tier is not eligible.
func (c Costs) AnnualRate(tier string) (float64, bool) {
	s, ok := c.TierSpread[tier]
	if !ok {
		return 0, false
	}
	return c.FundingCostAnnual + s, true
}

// AdvanceFee = round_half_up(A × ((1 + r)^(du/252) − 1)).
func AdvanceFee(amount int64, annual float64, businessDays int) int64 {
	if businessDays <= 0 || amount <= 0 {
		return 0
	}
	f := float64(amount) * (math.Pow(1+annual, float64(businessDays)/252) - 1)
	return int64(math.Floor(f + 0.5))
}

// ---- calendar ----

var brt = time.FixedZone("BRT", -3*3600)

// Date truncates t to a calendar day in Brasília time.
func Date(t time.Time) time.Time {
	t = t.In(brt)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, brt)
}

func easter(year int) time.Time {
	a := year % 19
	b, c := year/100, year%100
	d, e := b/4, b%4
	f := (b + 8) / 25
	g := (b - f + 1) / 3
	h := (19*a + b - d - g + 15) % 30
	i, k := c/4, c%4
	l := (32 + 2*e + 2*i - h - k) % 7
	m := (a + 11*h + 22*l) / 451
	month := (h + l - 7*m + 114) / 31
	day := (h+l-7*m+114)%31 + 1
	return time.Date(year, time.Month(month), day, 0, 0, 0, 0, brt)
}

// Holidays returns the national banking holidays of a year (the ANBIMA calendar's national dates).
func Holidays(year int) map[time.Time]string {
	e := easter(year)
	d := func(m time.Month, day int) time.Time { return time.Date(year, m, day, 0, 0, 0, 0, brt) }
	return map[time.Time]string{
		d(time.January, 1):   "Confraternização Universal",
		e.AddDate(0, 0, -48): "Carnaval (segunda)",
		e.AddDate(0, 0, -47): "Carnaval (terça)",
		e.AddDate(0, 0, -2):  "Sexta-feira da Paixão",
		d(time.April, 21):    "Tiradentes",
		d(time.May, 1):       "Dia do Trabalho",
		e.AddDate(0, 0, 60):  "Corpus Christi",
		d(time.September, 7): "Independência",
		d(time.October, 12):  "Nossa Senhora Aparecida",
		d(time.November, 2):  "Finados",
		d(time.November, 15): "Proclamação da República",
		d(time.November, 20): "Dia Nacional de Zumbi e da Consciência Negra",
		d(time.December, 25): "Natal",
	}
}

// IsBusinessDay reports whether day is a weekday that is not a national holiday.
func IsBusinessDay(day time.Time) bool {
	day = Date(day)
	if wd := day.Weekday(); wd == time.Saturday || wd == time.Sunday {
		return false
	}
	_, holiday := Holidays(day.Year())[day]
	return !holiday
}

// NextBusinessDay returns day if it is a business day, otherwise the next one.
func NextBusinessDay(day time.Time) time.Time {
	day = Date(day)
	for !IsBusinessDay(day) {
		day = day.AddDate(0, 0, 1)
	}
	return day
}

// BusinessDaysBetween counts business days in (from, to]: the DU of the CDI convention.
func BusinessDaysBetween(from, to time.Time) int {
	from, to = Date(from), Date(to)
	n := 0
	for d := from.AddDate(0, 0, 1); !d.After(to); d = d.AddDate(0, 0, 1) {
		if IsBusinessDay(d) {
			n++
		}
	}
	return n
}

// SettlementDates returns when the scheme pays each part of a sale captured on day:
// debit and prepaid next business day; credit D+30 per installment (docs/01 §8.2).
func SettlementDates(day time.Time, funding string, installments int) []time.Time {
	day = Date(day)
	if funding == "debit" || funding == "prepaid" {
		return []time.Time{NextBusinessDay(day.AddDate(0, 0, 1))}
	}
	if installments < 1 {
		installments = 1
	}
	out := make([]time.Time, installments)
	for i := range out {
		out[i] = NextBusinessDay(day.AddDate(0, 0, 30*(i+1)))
	}
	return out
}

// Split divides amount into n parts that add up exactly (remainder on the first part).
func Split(amount int64, n int) []int64 {
	if n < 1 {
		n = 1
	}
	out := make([]int64, n)
	base := amount / int64(n)
	for i := range out {
		out[i] = base
	}
	out[0] += amount - base*int64(n)
	return out
}
