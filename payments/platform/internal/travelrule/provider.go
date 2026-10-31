package travelrule

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Transfer is what the platform sends before a withdrawal to another provider: the
// IVMS101 payload and where the coins will go.
type Transfer struct {
	ID              string  `json:"id"` // the withdrawal's
	Asset           string  `json:"asset"`
	Network         string  `json:"network"`
	Address         string  `json:"address"`
	Memo            string  `json:"memo,omitempty"`
	Amount          string  `json:"amount"`
	BeneficiaryVASP VASP    `json:"beneficiary_vasp"`
	IVMS101         Message `json:"ivms101"`
}

// Answer is the beneficiary provider's: accepted (the coins may go) or rejected (they must
// not: an unknown address, a name that does not match its customer, a sanctioned party).
type Answer struct {
	Status    string `json:"status"`
	Reference string `json:"reference"`
	Reason    string `json:"reason,omitempty"`
}

// Accepted and Rejected are the two answers.
const (
	Accepted = "accepted"
	Rejected = "rejected"
)

// Provider sends travel-rule data through a network that reaches other providers (TRP,
// TRISA, or a vendor's network, behind an adapter).
type Provider interface {
	Send(ctx context.Context, t Transfer) (Answer, error)
}

// Service is a travel-rule adapter answering a small contract:
//
//	POST {URL}/transfers   (header Authorization: Bearer {Token}; body: Transfer)
//	→ 200 {"status": "accepted"|"rejected", "reference": "…", "reason": "…"}
//
// The adapter waits for the beneficiary provider's answer (it has up to Timeout): the
// platform sends nothing on-chain before an acceptance.
type Service struct {
	URL, Token string
	Client     *http.Client
	Timeout    time.Duration // default 30 seconds
}

// Send implements Provider.
func (s *Service) Send(ctx context.Context, t Transfer) (Answer, error) {
	b, err := json.Marshal(t)
	if err != nil {
		return Answer{}, err
	}
	timeout := s.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.URL, "/")+"/transfers", bytes.NewReader(b))
	if err != nil {
		return Answer{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", t.ID)
	if s.Token != "" {
		req.Header.Set("Authorization", "Bearer "+s.Token)
	}
	c := s.Client
	if c == nil {
		c = &http.Client{}
	}
	resp, err := c.Do(req)
	if err != nil {
		return Answer{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Answer{}, fmt.Errorf("travel rule: HTTP %d", resp.StatusCode)
	}
	var a Answer
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&a); err != nil {
		return Answer{}, err
	}
	if a.Status != Accepted && a.Status != Rejected {
		return Answer{}, fmt.Errorf("travel rule: unknown answer %q", a.Status)
	}
	return a, nil
}

// Sandbox is the sandbox's travel-rule network: every provider accepts, except one whose
// name contains "reject" (it rejects) or "offline" (it does not answer), so integrations can
// see both outcomes.
type Sandbox struct{}

// ErrUnreachable is a provider the network could not reach.
var ErrUnreachable = errors.New("travel rule: the beneficiary provider did not answer")

// Send implements Provider.
func (Sandbox) Send(_ context.Context, t Transfer) (Answer, error) {
	n := strings.ToLower(t.BeneficiaryVASP.Name)
	switch {
	case strings.Contains(n, "offline"):
		return Answer{}, ErrUnreachable
	case strings.Contains(n, "reject"):
		return Answer{Status: Rejected, Reference: "sbx_" + t.ID, Reason: "the beneficiary is not a customer of this provider"}, nil
	}
	return Answer{Status: Accepted, Reference: "sbx_" + t.ID}, nil
}

// Inbound is a message another provider sent the platform through the network, before or
// with a deposit to one of the platform's addresses. The adapter posts it, signed, to
// POST /v1/travel-rule/inbound.
type Inbound struct {
	Reference      string  `json:"reference"` // the network's id for the message
	Asset          string  `json:"asset"`
	Network        string  `json:"network"`
	Address        string  `json:"address"` // the platform's deposit address
	Memo           string  `json:"memo,omitempty"`
	Amount         string  `json:"amount"`
	TxID           string  `json:"txid,omitempty"`
	OriginatorVASP VASP    `json:"originator_vasp"`
	IVMS101        Message `json:"ivms101"`
}

// Check validates an inbound message: the fields the platform matches deposits by, and the
// IVMS101 payload.
func (in *Inbound) Check(now time.Time) error {
	var errs []error
	if strings.TrimSpace(in.Reference) == "" {
		errs = append(errs, errors.New("reference: required"))
	}
	if in.Asset == "" || in.Network == "" || in.Address == "" || in.Amount == "" {
		errs = append(errs, errors.New("asset, network, address and amount are required"))
	}
	if strings.TrimSpace(in.OriginatorVASP.Name) == "" {
		errs = append(errs, errors.New("originator_vasp.name: required"))
	}
	if err := in.IVMS101.Validate(now); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}
