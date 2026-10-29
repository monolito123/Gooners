package pricing

import (
	"testing"
	"time"
)

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 12, 0, 0, 0, brt) }

// Fees from docs/07-enhancements.md §1.3 (and 02 §7.1, 04 §3.4).
func TestAdvanceFeeMatchesSpec(t *testing.T) {
	c := DefaultCosts
	rA, _ := c.AnnualRate("A")
	rB, _ := c.AnnualRate("B")
	cases := []struct {
		amount int64
		r      float64
		du     int
		fee    int64
	}{{12576, rA, 21, 161}, {61200, rB, 1, 40}, {154580, rB, 21, 2147}, {100000, rA, 1, 61}}
	for _, k := range cases {
		if got := AdvanceFee(k.amount, k.r, k.du); got != k.fee {
			t.Errorf("AdvanceFee(%d, %.3f, %d) = %d, want %d", k.amount, k.r, k.du, got, k.fee)
		}
	}
	if _, ok := c.AnnualRate("D"); ok {
		t.Fatal("tier D must not be eligible")
	}
}

func TestMDRMatchesSpec(t *testing.T) {
	p := DefaultPlan
	if MDR(p, 12990, "credit", 1) != 414 || MDR(p, 4500, "debit", 1) != 62 || MDR(p, 31000, "credit", 3) != 1547 {
		t.Fatal("MDR differs from the spec examples")
	}
	if DefaultCosts.Interchange(12990, "credit") != 208 || DefaultCosts.SchemeFees(12990) != 16 {
		t.Fatal("cost estimates differ from the capture journal example")
	}
}

func TestCalendar2026(t *testing.T) {
	for _, h := range []time.Time{day(2026, 2, 16), day(2026, 2, 17), day(2026, 4, 3), day(2026, 6, 4), day(2026, 11, 20), day(2026, 11, 2)} {
		if IsBusinessDay(h) {
			t.Errorf("%s should be a holiday", h.Format("2006-01-02"))
		}
	}
	if !IsBusinessDay(day(2026, 10, 29)) {
		t.Error("2026-10-29 is a Thursday business day")
	}
	// Saturday 2026-10-31 → Monday 2026-11-02 is Finados → Tuesday 2026-11-03.
	if got := NextBusinessDay(day(2026, 10, 31)); !got.Equal(Date(day(2026, 11, 3))) {
		t.Errorf("next business day after 2026-10-31 = %s", got.Format("2006-01-02"))
	}
	if du := BusinessDaysBetween(day(2026, 10, 29), day(2026, 11, 30)); du != 20 {
		t.Errorf("DU 2026-10-29 → 2026-11-30 = %d", du)
	}
}

func TestSettlementDates(t *testing.T) {
	d := SettlementDates(day(2026, 10, 29), "credit", 3)
	if len(d) != 3 || d[0].Format("2006-01-02") != "2026-11-30" || d[1].Format("2006-01-02") != "2026-12-28" {
		t.Fatalf("credit installments %v", d)
	}
	if got := SettlementDates(day(2026, 10, 29), "debit", 1)[0]; got.Format("2006-01-02") != "2026-10-30" {
		t.Fatalf("debit %s", got)
	}
	if s := Split(31000, 3); s[0]+s[1]+s[2] != 31000 || s[0] != 10334 {
		t.Fatalf("split %v", s)
	}
}
