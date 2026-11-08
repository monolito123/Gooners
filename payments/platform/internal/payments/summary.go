package payments

import (
	"context"
	"strconv"
	"time"
)

// DaySummary is a merchant's day at a glance, in Brasília time: what the apps' and the
// console's home screens show first (docs/06 §5). Amounts are centavos.
type DaySummary struct {
	Object     string `json:"object"`
	MerchantID string `json:"merchant_id"`
	Date       string `json:"date"`
	// Sales are the payments captured that day; Gross what they captured, Refunded what went
	// back, Fees what the platform kept, Net what the merchant keeps.
	Sales         int64 `json:"sales"`
	Gross         int64 `json:"gross"`
	Refunded      int64 `json:"refunded"`
	Fees          int64 `json:"fees"`
	Net           int64 `json:"net"`
	AverageTicket int64 `json:"average_ticket"`
	// ByMethod splits the day by how customers paid: credit, debit, card (funding unknown),
	// pix or crypto.
	ByMethod []MethodTotal `json:"by_method"`
	// Hourly is the gross captured in each hour of the day (0 to 23).
	Hourly []int64 `json:"hourly"`
	// LastWeek is the same weekday a week before, up to the same time of day when the date is
	// today, so the comparison is fair.
	LastWeek LastWeek `json:"last_week"`
	// Waiting are charges shown but not yet paid (a Pix QR, a crypto transfer, a payment held
	// for compliance).
	Waiting WaitingTotal `json:"waiting"`
	// Recent are the day's latest payments, newest first, whatever their outcome.
	Recent []RecentPayment `json:"recent"`
}

// MethodTotal is one payment method's part of the day.
type MethodTotal struct {
	Method string `json:"method"`
	Sales  int64  `json:"sales"`
	Gross  int64  `json:"gross"`
}

// LastWeek is the comparison day.
type LastWeek struct {
	Date  string `json:"date"`
	Sales int64  `json:"sales"`
	Gross int64  `json:"gross"`
	// ChangePct is the gross's change against it, in percent; null when last week sold nothing.
	ChangePct *float64 `json:"change_pct"`
	// Hourly is that whole day's gross by hour, for the comparison line in the charts: what
	// the rest of today looked like a week ago.
	Hourly []int64 `json:"hourly"`
}

// WaitingTotal is what is still to be paid.
type WaitingTotal struct {
	Count  int64 `json:"count"`
	Amount int64 `json:"amount"`
}

// RecentPayment is one line of the day's latest payments.
type RecentPayment struct {
	ID        string `json:"id"`
	Amount    int64  `json:"amount"`
	Method    string `json:"method"`
	Status    string `json:"status"`
	Card      string `json:"card,omitempty"` // brand and last four digits
	CreatedAt string `json:"created_at"`
}

// totals sums a merchant's captures in [start, end) by payment method, largest first.
func (s *Service) totals(ctx context.Context, tenantID, merchantID string, start, end time.Time) (byMethod []MethodTotal, sales, gross, refunded, fees int64, err error) {
	byMethod = []MethodTotal{}
	rows, err := s.pool.Query(ctx, `SELECT `+methodSQL+`, count(*), COALESCE(sum(amount_captured), 0), COALESCE(sum(amount_refunded), 0), COALESCE(sum(fee), 0)
		FROM payment_intents WHERE tenant_id = $1 AND merchant_id = $2 AND captured_at >= $3 AND captured_at < $4
		GROUP BY 1 ORDER BY 3 DESC, 1`, tenantID, merchantID, start, end)
	if err != nil {
		return nil, 0, 0, 0, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var m MethodTotal
		var r, f int64
		if err := rows.Scan(&m.Method, &m.Sales, &m.Gross, &r, &f); err != nil {
			return nil, 0, 0, 0, 0, err
		}
		byMethod = append(byMethod, m)
		sales, gross, refunded, fees = sales+m.Sales, gross+m.Gross, refunded+r, fees+f
	}
	return byMethod, sales, gross, refunded, fees, rows.Err()
}

// buckets sums a merchant's captures in [start, end) by Brasília hour of the day ("hour") or
// by Brasília day ("day", keyed by date); fn receives each bucket.
func (s *Service) buckets(ctx context.Context, tenantID, merchantID, unit string, start, end time.Time, fn func(key string, sales, gross int64)) error {
	key := `extract(hour FROM captured_at AT TIME ZONE 'America/Sao_Paulo')::int::text`
	if unit == "day" {
		key = `to_char(captured_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`
	}
	rows, err := s.pool.Query(ctx, `SELECT `+key+`, count(*), COALESCE(sum(amount_captured), 0)
		FROM payment_intents WHERE tenant_id = $1 AND merchant_id = $2 AND captured_at >= $3 AND captured_at < $4 GROUP BY 1`, tenantID, merchantID, start, end)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		var n, v int64
		if err := rows.Scan(&k, &n, &v); err != nil {
			return err
		}
		fn(k, n, v)
	}
	return rows.Err()
}

// hourly is gross by Brasília hour in [start, end).
func (s *Service) hourly(ctx context.Context, tenantID, merchantID string, start, end time.Time) ([]int64, error) {
	out := make([]int64, 24)
	err := s.buckets(ctx, tenantID, merchantID, "hour", start, end, func(k string, _, gross int64) {
		if h, err := strconv.Atoi(k); err == nil && h >= 0 && h < 24 {
			out[h] = gross
		}
	})
	return out, err
}

// changePct is the change from before to now in percent, one decimal, half away from zero;
// nil when before sold nothing.
func changePct(now, before int64) *float64 {
	if before <= 0 {
		return nil
	}
	pct := float64(now-before) * 100 / float64(before)
	pct = float64(int64(pct*10+copysignHalf(pct))) / 10
	return &pct
}

// methodSQL classifies a payment by how it was paid.
const methodSQL = `CASE WHEN channel = 'card_present' THEN COALESCE(NULLIF(card_funding, ''), 'card') ELSE channel END`

// DaySummary sums a merchant's day (date as YYYY-MM-DD in Brasília; empty is today).
func (s *Service) DaySummary(ctx context.Context, tenantID, merchantID, date string) (*DaySummary, error) {
	now := s.cfg.Now().In(brt)
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, brt)
	if date != "" {
		d, err := time.ParseInLocation("2006-01-02", date, brt)
		if err != nil {
			return nil, invalid("date is YYYY-MM-DD")
		}
		if d.After(day) {
			return nil, invalid("date is in the future")
		}
		day = d
	}
	if _, err := s.GetMerchant(ctx, tenantID, merchantID); err != nil {
		return nil, err
	}
	end := day.AddDate(0, 0, 1)
	out := &DaySummary{Object: "day_summary", MerchantID: merchantID, Date: day.Format("2006-01-02"), Hourly: make([]int64, 24),
		ByMethod: []MethodTotal{}, Recent: []RecentPayment{}}

	var err error
	if out.ByMethod, out.Sales, out.Gross, out.Refunded, out.Fees, err = s.totals(ctx, tenantID, merchantID, day, end); err != nil {
		return nil, err
	}
	out.Net = out.Gross - out.Refunded - out.Fees
	if out.Sales > 0 {
		out.AverageTicket = out.Gross / out.Sales
	}
	if out.Hourly, err = s.hourly(ctx, tenantID, merchantID, day, end); err != nil {
		return nil, err
	}

	// The same weekday a week before, up to the same time of day when looking at today.
	lwStart, lwEnd := day.AddDate(0, 0, -7), end.AddDate(0, 0, -7)
	if out.Date == now.Format("2006-01-02") {
		lwEnd = now.AddDate(0, 0, -7)
	}
	out.LastWeek.Date = lwStart.Format("2006-01-02")
	if err := s.pool.QueryRow(ctx, `SELECT count(*), COALESCE(sum(amount_captured), 0) FROM payment_intents
		WHERE tenant_id = $1 AND merchant_id = $2 AND captured_at >= $3 AND captured_at < $4`, tenantID, merchantID, lwStart, lwEnd).
		Scan(&out.LastWeek.Sales, &out.LastWeek.Gross); err != nil {
		return nil, err
	}
	out.LastWeek.ChangePct = changePct(out.Gross, out.LastWeek.Gross)
	if out.LastWeek.Hourly, err = s.hourly(ctx, tenantID, merchantID, lwStart, lwStart.AddDate(0, 0, 1)); err != nil {
		return nil, err
	}

	if err := s.pool.QueryRow(ctx, `SELECT count(*), COALESCE(sum(amount), 0) FROM payment_intents
		WHERE tenant_id = $1 AND merchant_id = $2 AND created_at >= $3 AND created_at < $4 AND status IN ($5, $6)`,
		tenantID, merchantID, day, end, StatusRequiresAction, StatusProcessing).Scan(&out.Waiting.Count, &out.Waiting.Amount); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `SELECT id, amount, `+methodSQL+`, status, COALESCE(card_brand, ''), COALESCE(card_last4, ''), created_at
		FROM payment_intents WHERE tenant_id = $1 AND merchant_id = $2 AND created_at >= $3 AND created_at < $4
		ORDER BY created_at DESC, id DESC LIMIT 8`, tenantID, merchantID, day, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p RecentPayment
		var brand, last4 string
		var at time.Time
		if err := rows.Scan(&p.ID, &p.Amount, &p.Method, &p.Status, &brand, &last4, &at); err != nil {
			return nil, err
		}
		if last4 != "" {
			p.Card = brand + " •••• " + last4
		}
		p.CreatedAt = at.UTC().Format(time.RFC3339)
		out.Recent = append(out.Recent, p)
	}
	return out, rows.Err()
}

// copysignHalf rounds half away from zero when truncating to one decimal.
func copysignHalf(x float64) float64 {
	if x < 0 {
		return -0.5
	}
	return 0.5
}

// PeriodSummary is a merchant's sales over a run of Brasília days, by day, against the same
// number of days just before (docs/02 §8.5): what the 7- and 30-day charts show.
type PeriodSummary struct {
	Object        string        `json:"object"`
	MerchantID    string        `json:"merchant_id"`
	From          string        `json:"from"`
	To            string        `json:"to"`
	Days          int           `json:"days"`
	Sales         int64         `json:"sales"`
	Gross         int64         `json:"gross"`
	Refunded      int64         `json:"refunded"`
	Fees          int64         `json:"fees"`
	Net           int64         `json:"net"`
	AverageTicket int64         `json:"average_ticket"`
	ByMethod      []MethodTotal `json:"by_method"`
	// Daily has one entry per day, from the first to the last, days without sales included.
	Daily    []DayTotal `json:"daily"`
	Previous Previous   `json:"previous"`
}

// DayTotal is one day of a period.
type DayTotal struct {
	Date  string `json:"date"`
	Sales int64  `json:"sales"`
	Gross int64  `json:"gross"`
}

// Previous is the period just before, as long as the one asked for. When the period ends
// today it ends at the same time of day, so the comparison is fair.
type Previous struct {
	From      string   `json:"from"`
	To        string   `json:"to"`
	Sales     int64    `json:"sales"`
	Gross     int64    `json:"gross"`
	ChangePct *float64 `json:"change_pct"`
	// Daily is its gross by day, aligned with the period's: day i of one against day i of the other.
	Daily []int64 `json:"daily"`
}

// MaxPeriodDays bounds a period summary: a quarter.
const MaxPeriodDays = 92

// PeriodSummary sums a merchant's sales from one Brasília day to another, both included (the
// last 30 days, ending today, by default).
func (s *Service) PeriodSummary(ctx context.Context, tenantID, merchantID, from, to string) (*PeriodSummary, error) {
	now := s.cfg.Now().In(brt)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, brt)
	last := today
	if to != "" {
		d, err := time.ParseInLocation("2006-01-02", to, brt)
		if err != nil {
			return nil, invalid("to is YYYY-MM-DD")
		}
		last = d
	}
	first := last.AddDate(0, 0, -29)
	if from != "" {
		d, err := time.ParseInLocation("2006-01-02", from, brt)
		if err != nil {
			return nil, invalid("from is YYYY-MM-DD")
		}
		first = d
	}
	switch {
	case last.After(today):
		return nil, invalid("to is in the future")
	case first.After(last):
		return nil, invalid("from is after to")
	}
	days := int(last.Sub(first).Hours()/24+0.5) + 1
	if days > MaxPeriodDays {
		return nil, invalid("a period is at most %d days", MaxPeriodDays)
	}
	if _, err := s.GetMerchant(ctx, tenantID, merchantID); err != nil {
		return nil, err
	}
	end := last.AddDate(0, 0, 1)
	out := &PeriodSummary{Object: "period_summary", MerchantID: merchantID, From: first.Format("2006-01-02"), To: last.Format("2006-01-02"), Days: days,
		Daily: make([]DayTotal, days)}
	index := map[string]int{}
	for i := range out.Daily {
		d := first.AddDate(0, 0, i).Format("2006-01-02")
		out.Daily[i], index[d] = DayTotal{Date: d}, i
	}
	var err error
	if out.ByMethod, out.Sales, out.Gross, out.Refunded, out.Fees, err = s.totals(ctx, tenantID, merchantID, first, end); err != nil {
		return nil, err
	}
	out.Net = out.Gross - out.Refunded - out.Fees
	if out.Sales > 0 {
		out.AverageTicket = out.Gross / out.Sales
	}
	if err := s.buckets(ctx, tenantID, merchantID, "day", first, end, func(k string, sales, gross int64) {
		if i, ok := index[k]; ok {
			out.Daily[i].Sales, out.Daily[i].Gross = sales, gross
		}
	}); err != nil {
		return nil, err
	}

	pFirst := first.AddDate(0, 0, -days)
	pEnd := first
	if last.Equal(today) {
		pEnd = now.AddDate(0, 0, -days) // up to the same time of day
	}
	out.Previous = Previous{From: pFirst.Format("2006-01-02"), To: first.AddDate(0, 0, -1).Format("2006-01-02"), Daily: make([]int64, days)}
	if _, out.Previous.Sales, out.Previous.Gross, _, _, err = s.totals(ctx, tenantID, merchantID, pFirst, pEnd); err != nil {
		return nil, err
	}
	if err := s.buckets(ctx, tenantID, merchantID, "day", pFirst, pEnd, func(k string, _, gross int64) {
		if d, err := time.ParseInLocation("2006-01-02", k, brt); err == nil {
			if i := int(d.Sub(pFirst).Hours()/24 + 0.5); i >= 0 && i < days {
				out.Previous.Daily[i] = gross
			}
		}
	}); err != nil {
		return nil, err
	}
	out.Previous.ChangePct = changePct(out.Gross, out.Previous.Gross)
	return out, nil
}
