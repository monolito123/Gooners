package payments

import (
	"context"
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

	rows, err := s.pool.Query(ctx, `SELECT `+methodSQL+`, count(*), COALESCE(sum(amount_captured), 0), COALESCE(sum(amount_refunded), 0), COALESCE(sum(fee), 0)
		FROM payment_intents WHERE tenant_id = $1 AND merchant_id = $2 AND captured_at >= $3 AND captured_at < $4
		GROUP BY 1 ORDER BY 3 DESC`, tenantID, merchantID, day, end)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var m MethodTotal
		var refunded, fees int64
		if err := rows.Scan(&m.Method, &m.Sales, &m.Gross, &refunded, &fees); err != nil {
			rows.Close()
			return nil, err
		}
		out.ByMethod = append(out.ByMethod, m)
		out.Sales += m.Sales
		out.Gross += m.Gross
		out.Refunded += refunded
		out.Fees += fees
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out.Net = out.Gross - out.Refunded - out.Fees
	if out.Sales > 0 {
		out.AverageTicket = out.Gross / out.Sales
	}

	rows, err = s.pool.Query(ctx, `SELECT extract(hour FROM captured_at AT TIME ZONE 'America/Sao_Paulo')::int, sum(amount_captured)
		FROM payment_intents WHERE tenant_id = $1 AND merchant_id = $2 AND captured_at >= $3 AND captured_at < $4 GROUP BY 1`, tenantID, merchantID, day, end)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var h int
		var v int64
		if err := rows.Scan(&h, &v); err != nil {
			rows.Close()
			return nil, err
		}
		if h >= 0 && h < 24 {
			out.Hourly[h] = v
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
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
	if out.LastWeek.Gross > 0 {
		pct := float64(out.Gross-out.LastWeek.Gross) * 100 / float64(out.LastWeek.Gross)
		pct = float64(int64(pct*10+copysignHalf(pct))) / 10
		out.LastWeek.ChangePct = &pct
	}

	if err := s.pool.QueryRow(ctx, `SELECT count(*), COALESCE(sum(amount), 0) FROM payment_intents
		WHERE tenant_id = $1 AND merchant_id = $2 AND created_at >= $3 AND created_at < $4 AND status IN ($5, $6)`,
		tenantID, merchantID, day, end, StatusRequiresAction, StatusProcessing).Scan(&out.Waiting.Count, &out.Waiting.Amount); err != nil {
		return nil, err
	}

	rows, err = s.pool.Query(ctx, `SELECT id, amount, `+methodSQL+`, status, COALESCE(card_brand, ''), COALESCE(card_last4, ''), created_at
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
