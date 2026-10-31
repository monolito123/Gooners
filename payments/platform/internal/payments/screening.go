package payments

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
	"github.com/monolito123/Gooners/payments/platform/internal/screening"
)

// AddressScreener checks an address against sanctions lists (screening.Set).
type AddressScreener interface {
	Screen(ctx context.Context, network, address string) (screening.Result, error)
}

var mScreenings = metrics.Default.Counter("goonerspay_address_screenings_total", "Withdrawal addresses screened, by result (clear, hit, error).", "result")

// screenAddress screens a destination before anything is sent to it, and records the result
// either way: the record is the evidence the check was made. A hit refuses the operation
// (ErrScreened); so does a screening that could not be completed (fail closed).
func (s *Service) screenAddress(ctx context.Context, tenantID, merchantID, network, address string) error {
	if s.screener == nil {
		return fmt.Errorf("%w: no sanctions screening is configured; nothing was sent", ErrDisabled)
	}
	res, err := s.screener.Screen(ctx, network, address)
	result := "clear"
	switch {
	case err != nil:
		result = "error"
	case res.Hit:
		result = "hit"
	}
	detail := map[string]any{"matches": res.Matches}
	if err != nil {
		detail["error"] = err.Error()
	}
	d, _ := json.Marshal(detail)
	if _, dbErr := s.pool.Exec(ctx, `INSERT INTO address_screenings (tenant_id, merchant_id, network, address, result, sources, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		tenantID, merchantID, network, address, result, strings.Join(res.Sources, ","), d); dbErr != nil {
		return dbErr
	}
	mScreenings.Inc(result)
	switch result {
	case "error":
		s.log.Error("sanctions screening unavailable", "merchant", merchantID, "network", network, "err", err)
		return fmt.Errorf("%w: sanctions screening could not be completed; nothing was sent", ErrUnavailable)
	case "hit":
		s.log.Warn("sanctions screening hit", "tenant", tenantID, "merchant", merchantID, "network", network, "matches", res.Matches)
		s.notify(ctx, tenantID, "compliance.address_refused", map[string]any{"merchant_id": merchantID, "network": network})
		return fmt.Errorf("%w: this address cannot receive transfers from the platform", ErrScreened)
	}
	return nil
}
