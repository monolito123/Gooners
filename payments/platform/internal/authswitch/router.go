package authswitch

import (
	"sort"

	"github.com/monolito123/Gooners/payments/platform/internal/scheme"
	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
)

// Fees charged on a route (docs/01-acquiring-engine.md §6.2).
type Fees struct {
	BasisPoints     int64 // scheme or sponsor fee, in hundredths of a percent of the amount
	FixedCents      int64 // per approved transaction
	PerAttemptCents int64 // charged on approvals and declines
	TokenFeeCents   int64
}

// Route is one way to reach the networks: a direct scheme connection or a sponsor acquirer.
type Route struct {
	Name          string
	Pool          *scheme.Pool
	Codec         *iso8583.Codec
	Schemes       map[string]bool // brands this route can carry
	Fees          Fees
	ApprovalPrior float64 // calibrated approval probability (replaced by the model in production)
	AcquirerID    string
	STAN          *scheme.STANSource
}

// Ranked is a route with its expected margin, in centavos (fractional).
type Ranked struct {
	Route          *Route
	ExpectedMargin float64
}

// Rank orders eligible, healthy routes by expected margin:
//
//	E = p · (MDR − IC − fees − token fee) − (1 − p) · per-attempt fee
//
// Routes that cannot carry the brand, or whose pool is unhealthy, are excluded.
func Rank(routes []*Route, r Request) []Ranked {
	var out []Ranked
	for _, rt := range routes {
		if rt.Schemes != nil && !rt.Schemes[r.Card.Brand] {
			continue
		}
		if rt.Pool != nil && !rt.Pool.Healthy() {
			continue
		}
		fees := r.Amount*rt.Fees.BasisPoints/10000 + rt.Fees.FixedCents + rt.Fees.PerAttemptCents
		margin := float64(r.MDRCents - r.InterchangeCents - fees - rt.Fees.TokenFeeCents)
		p := rt.ApprovalPrior
		if p <= 0 {
			p = 0.9
		}
		e := p*margin - (1-p)*float64(rt.Fees.PerAttemptCents)
		out = append(out, Ranked{rt, e})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ExpectedMargin > out[j].ExpectedMargin })
	return out
}
