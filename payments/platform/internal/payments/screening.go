package payments

import (
	"context"
	"fmt"

	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
	"github.com/monolito123/Gooners/payments/platform/internal/screening"
)

// AddressScreener checks an address against sanctions lists (screening.Set).
type AddressScreener interface {
	Screen(ctx context.Context, network, address string) (screening.Result, error)
}

var mScreenings = metrics.Default.Counter("goonerspay_address_screenings_total", "Addresses screened (withdrawal destinations and deposit senders), by result (clear, hit, error).", "result")

// screenAddress screens a destination before anything is sent to it, and records the result
// either way: the record is the evidence the check was made. A hit refuses the operation
// (ErrScreened); so does a screening that could not be completed (fail closed).
func (s *Service) screenAddress(ctx context.Context, tenantID, merchantID, network, address string) error {
	if s.screener == nil {
		return fmt.Errorf("%w: no sanctions screening is configured; nothing was sent", ErrDisabled)
	}
	res, err := s.screener.Screen(ctx, network, address)
	result, dbErr := s.recordScreening(ctx, tenantID, merchantID, "withdrawal", "", network, address, res, err)
	if dbErr != nil {
		return dbErr
	}
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
