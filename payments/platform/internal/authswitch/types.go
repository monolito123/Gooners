// Package authswitch is the authorization switch: it turns a canonical authorization into
// the route's ISO 8583 dialect, sends it over a scheme session pool, classifies the answer,
// and guarantees that an authorization whose outcome is unknown is reversed (with
// store-and-forward until the host confirms).
package authswitch

import (
	"context"
	"errors"
	"time"
)

// Kind of authorization.
type Kind string

const (
	Purchase     Kind = "purchase"
	Refund       Kind = "refund"       // online refund authorization (processing code 20)
	Verification Kind = "verification" // zero-amount account verification
)

// Status of an authorization record.
type Status string

const (
	StatusReceived        Status = "received"
	StatusSent            Status = "sent"
	StatusApproved        Status = "approved"
	StatusDeclined        Status = "declined"
	StatusTimedOut        Status = "timed_out"
	StatusError           Status = "error"
	StatusReversed        Status = "reversed"
	StatusReversalPending Status = "reversal_pending"
	StatusPartiallyRev    Status = "partially_reversed"
)

// Card holds clear card data. It exists only in memory inside the CDE and is never stored:
// records keep PANRef, a vault token.
type Card struct {
	PAN         string
	PANRef      string // vault token used to rebuild reversals
	Expiry      string // YYMM
	Track2      string
	PANSequence string
	EntryMode   string // DE 22, e.g. 071 contactless chip
	EMVHex      string // DE 55 TLV, hex
	PINBlockHex string // translated PIN block, hex
	Funding     string // credit, debit, prepaid
	Brand       string // visa, mastercard, elo, …
}

// Merchant as known to the scheme.
type Merchant struct {
	SchemeMID string // DE 42
	MCC       string
	Name      string
	City      string
	Country   string // ISO 3166 alpha-2, e.g. BR
}

// Request is the canonical authorization (docs/01-acquiring-engine.md §3.8).
type Request struct {
	AuthID          string
	TenantID        string
	PaymentIntentID string
	Kind            Kind
	Amount          int64  // minor units
	CurrencyNumeric string // ISO 4217 numeric, "986"
	Channel         string // card_present, ecommerce
	TerminalID      string // DE 41
	TerminalSTAN    string // the terminal's own STAN: idempotency key with TerminalID and local date
	TerminalLocal   time.Time
	Card            Card
	Merchant        Merchant
	AcquirerID      string // DE 32
	// Routing inputs (03 §6): merchant discount and estimated interchange for this transaction.
	MDRCents         int64
	InterchangeCents int64
}

// Result of an authorization or a reversal.
type Result struct {
	AuthID       string
	Status       Status
	Approved     bool
	ResponseCode string
	AuthCode     string
	RRN          string
	NetworkSTAN  string
	NetworkTxnID string
	IssuerEMVHex string
	Route        string
	Decline      Decline
	Replayed     bool // idempotent replay of an earlier request
	SentAt       time.Time
	CompletedAt  time.Time
}

// Record is the persisted authorization (no clear card data).
type Record struct {
	AuthID          string
	TenantID        string
	PaymentIntentID string
	Kind            Kind
	TerminalID      string
	TerminalSTAN    string
	LocalDate       string // YYYYMMDD, part of the idempotency key
	Amount          int64
	CurrencyNumeric string
	Route           string
	NetworkSTAN     string
	RRN             string
	TransmissionDT  string // DE 7 as sent
	ProcessingCode  string
	EntryMode       string
	PANRef          string
	Expiry          string
	MerchantMID     string
	MCC             string
	MerchantName    string
	MerchantCity    string
	AcquirerID      string
	Status          Status
	ResponseCode    string
	AuthCode        string
	NetworkTxnID    string
	ReversedAmount  int64
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Reversal is a store-and-forward item: a 0400 (or, after MaxReversalAge, a 0420 advice)
// that must be delivered until the host acknowledges it.
type Reversal struct {
	ID          int64
	AuthID      string
	Route       string
	Amount      int64 // replacement amount; 0 means full reversal
	Reason      string
	NetworkSTAN string // fixed for every retry so the host can deduplicate
	DE7         string
	Attempts    int
	NextAt      time.Time
	CreatedAt   time.Time
	Done        bool
	LastError   string
}

// ErrInFlight is returned when the same terminal STAN is still being processed.
var ErrInFlight = errors.New("authswitch: authorization with this terminal STAN is in flight")

// ErrSTANReused is returned when a terminal STAN already identifies a different request
// that day. Only an identical request is answered from the stored result.
var ErrSTANReused = errors.New("authswitch: terminal STAN already used for a different request")

// ErrNotFound is returned for unknown authorizations.
var ErrNotFound = errors.New("authswitch: authorization not found")

// Store persists authorizations and the reversal queue.
type Store interface {
	// Begin inserts rec. If (tenant, terminal, terminal STAN, local date) exists, it returns the existing record.
	Begin(ctx context.Context, rec *Record) (existing *Record, err error)
	MarkSent(ctx context.Context, authID, route, networkSTAN, rrn, de7 string) error
	Complete(ctx context.Context, authID string, status Status, rc, authCode, networkTxnID string) error
	Get(ctx context.Context, authID string) (*Record, error)
	AddReversed(ctx context.Context, authID string, amount int64, status Status) error
	EnqueueReversal(ctx context.Context, r Reversal) error
	DueReversals(ctx context.Context, now time.Time, limit int) ([]Reversal, error)
	UpdateReversal(ctx context.Context, id int64, done bool, attempts int, next time.Time, lastErr string) error
}

// PANResolver reveals a PAN from its vault token, inside the CDE only.
type PANResolver interface {
	RevealPAN(ctx context.Context, panRef string) (string, error)
}
