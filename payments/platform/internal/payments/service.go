// Package payments is the business core: payment intents, card-present authorizations,
// Pix charges, refunds, receivables, risk-priced payouts and the ledger journals for each.
package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/monolito123/Gooners/payments/platform/internal/authswitch"
	"github.com/monolito123/Gooners/payments/platform/internal/brokerage"
	"github.com/monolito123/Gooners/payments/platform/internal/carddata"
	"github.com/monolito123/Gooners/payments/platform/internal/exchange"
	"github.com/monolito123/Gooners/payments/platform/internal/fx"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/pixout"
	"github.com/monolito123/Gooners/payments/platform/internal/pricing"
	"github.com/monolito123/Gooners/payments/platform/internal/receipts"
	"github.com/monolito123/Gooners/payments/platform/internal/registrar"
	"github.com/monolito123/Gooners/payments/platform/internal/vault"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
	"github.com/monolito123/Gooners/payments/platform/pkg/apipix"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// Config of the service.
type Config struct {
	Env             string // sandbox or production
	Currency        string // BRL
	CurrencyNumeric string // 986
	AcquirerID      string
	PixKey          string        // the platform's receiving key at its PSP (merchants are credited in the ledger)
	PixExpiry       time.Duration // charge validity
	Costs           pricing.Costs
	QuoteTTL        time.Duration
	RelayURL        string
	NIP05Domain     string
	Now             func() time.Time
	// MaxPaymentAmount caps one payment intent (centavos), limiting what a stolen credential
	// can charge or move in one request. Default R$ 1.000.000,00; never above MaxAmount.
	MaxPaymentAmount int64
	// TransparencyPadTo pads each day's transparency log to a multiple of this many leaves
	// (docs/03 §6.4). Default 4096.
	TransparencyPadTo int
	// PlatformDocument is the platform's CNPJ: the beneficiary of the assignments it registers.
	PlatformDocument string
	// RiskMode is how the fraud shield acts on card-present sales: enforce (default),
	// shadow (assess and record only) or off.
	RiskMode string
	// Crypto and FX pricing in basis points (docs/09); zero takes the defaults.
	CryptoFeeBps, CryptoSpreadBps int
	FXFeeBps, FXSpreadBps         int
	// IOF on foreign exchange, in basis points: reais going abroad, currency coming in.
	IOFOutBps, IOFInBps int
}

// MaxAmount is the largest amount the rails carry: DE 4 is n12 (twelve digits of centavos)
// and an API Pix valor has at most ten integer digits; both stop at R$ 9.999.999.999,99.
const MaxAmount int64 = 999_999_999_999

// Service wires the components.
type Service struct {
	cfg          Config
	pool         *pgxpool.Pool
	ledger       *ledger.Ledger
	sw           *authswitch.Switch
	vault        *vault.Vault
	dec          carddata.Decryptor
	pix          *apipix.Client
	payout       pixout.Sender
	receipts     *receipts.Issuer
	publisher    *receipts.Publisher
	attest       Attestor
	transparency nostr.Author
	registrar    registrar.Registrar
	log          *slog.Logger
	baselines    sync.Map // tenant/merchant → baseline (risk.go)
	exchanges    *exchange.Router
	fx           fx.Provider
	broker       brokerage.Broker
	opened       sync.Map // tenant/account → true: ledger accounts opened (crypto.go)
}

// Deps are the service's collaborators. Pix, Payout, Receipts and Publisher are optional.
type Deps struct {
	Pool      *pgxpool.Pool
	Ledger    *ledger.Ledger
	Switch    *authswitch.Switch
	Vault     *vault.Vault
	Decryptor carddata.Decryptor
	Pix       *apipix.Client
	Payout    pixout.Sender
	Receipts  *receipts.Issuer
	Publisher *receipts.Publisher
	Attestor  Attestor // device attestation; required in production
	// Transparency signs the daily public roots (kind 7715). With Receipts, it turns on
	// daily statements; in production it is the attested enclave signer.
	Transparency nostr.Author
	// Registrar registers receivable units and the platform's contract effects before any
	// advance (docs/07 §1.6). Required in production; the sandbox uses an in-memory one.
	Registrar registrar.Registrar
	// Exchanges trade and hold crypto-assets (docs/09); nil turns crypto off.
	Exchanges *exchange.Router
	// FX converts currency and holds merchants' international accounts; nil turns it off.
	FX fx.Provider
	// Broker routes merchants' orders to B3; nil turns investments off.
	Broker brokerage.Broker
	Logger *slog.Logger
}

// New returns the service.
func New(cfg Config, d Deps) *Service {
	if cfg.Currency == "" {
		cfg.Currency, cfg.CurrencyNumeric = "BRL", "986"
	}
	if cfg.PixExpiry == 0 {
		cfg.PixExpiry = 30 * time.Minute
	}
	if cfg.QuoteTTL == 0 {
		cfg.QuoteTTL = 15 * time.Minute
	}
	if cfg.Costs.TierSpread == nil {
		cfg.Costs = pricing.DefaultCosts
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.MaxPaymentAmount <= 0 || cfg.MaxPaymentAmount > MaxAmount {
		cfg.MaxPaymentAmount = 100_000_000
	}
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	return &Service{cfg: cfg, pool: d.Pool, ledger: d.Ledger, sw: d.Switch, vault: d.Vault, dec: d.Decryptor,
		pix: d.Pix, payout: d.Payout, receipts: d.Receipts, publisher: d.Publisher, attest: d.Attestor, transparency: d.Transparency, registrar: d.Registrar, log: d.Logger,
		exchanges: d.Exchanges, fx: d.FX, broker: d.Broker}
}

// Errors surfaced to the API as problem details.
var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
	ErrInvalid  = errors.New("invalid request")
	ErrDisabled = errors.New("not configured")
	ErrDeclined = errors.New("declined")
	ErrFunds    = errors.New("insufficient funds")
	ErrExpired  = errors.New("expired")
	// ErrUnavailable is an upstream the operation needs (the receivables registrar) not answering.
	ErrUnavailable = errors.New("upstream unavailable")
	ErrSandboxed   = errors.New("not allowed outside the sandbox")
)

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, a...))
}

// ---------------------------------------------------------------- tenants and merchants

// BootstrapTenant creates the tenant's platform accounts. In the sandbox it also funds the
// settlement bank account with opening capital so instant releases can be backed.
func (s *Service) BootstrapTenant(ctx context.Context, tenantID string, sandboxCapital int64) error {
	if err := s.ledger.BootstrapTenant(ctx, tenantID, s.cfg.Currency); err != nil {
		return err
	}
	if sandboxCapital > 0 {
		if s.cfg.Env == "production" {
			return ErrSandboxed
		}
		j := ledger.NewJournal(tenantID, ids.New("jr"), "opening-capital", "opening_capital", "",
			[]ledger.Posting{{Account: ledger.AccSettlementBank, Direction: ledger.Debit, Amount: sandboxCapital}, {Account: ledger.AccEquityCapital, Direction: ledger.Credit, Amount: sandboxCapital}})
		if _, err := s.ledger.Post(ctx, j); err != nil {
			return err
		}
	}
	return nil
}

// MerchantInput creates a merchant.
type MerchantInput struct {
	LegalName, TradeName, Document, MCC, SchemeMID, City string
	RootNpub                                             string
	PixKey, PixKeyType                                   string
	Plan                                                 pricing.Plan
	KYB                                                  map[string]any // address, representatives, contact
}

// Merchant as returned by the API.
type Merchant struct {
	ID         string       `json:"id"`
	Object     string       `json:"object"`
	AccountID  string       `json:"account_id"`
	LegalName  string       `json:"legal_name"`
	TradeName  string       `json:"trade_name"`
	MCC        string       `json:"mcc"`
	SchemeMID  string       `json:"scheme_mid"`
	City       string       `json:"city"`
	RootNpub   string       `json:"root_npub,omitempty"`
	Plan       pricing.Plan `json:"plan"`
	Status     string       `json:"status"`
	StatusNote string       `json:"status_reason,omitempty"`
	rootPubHex string
	document   string
	pixKey     string
	pixKeyType string
}

// CreateMerchant registers a merchant and opens its ledger accounts. KYB happens before
// this call (in production the merchant starts as kyb_in_review).
func (s *Service) CreateMerchant(ctx context.Context, tenantID string, in MerchantInput) (*Merchant, error) {
	if in.LegalName == "" || in.TradeName == "" || len(in.MCC) != 4 || in.City == "" {
		return nil, invalid("legal_name, trade_name, mcc (4 digits) and city (legal.city or legal.address.city) are required")
	}
	if in.SchemeMID == "" {
		// Sub-acquirer model: the platform assigns the merchant ID sent in DE 42 (registered with the sponsor).
		u := ids.ULID()
		mid := make([]byte, 0, 15)
		for i := len(u) - 1; i >= 0 && len(mid) < 15; i-- {
			mid = append(mid, '0'+u[i]%10)
		}
		in.SchemeMID = string(mid)
	}
	if !ValidCPF(in.Document) && !ValidCNPJ(in.Document) {
		return nil, invalid("document must be a valid CPF (11 digits) or CNPJ (14 digits) without punctuation")
	}
	if in.PixKey != "" || in.PixKeyType != "" {
		var err error
		if in.PixKeyType, in.PixKey, err = normalizePixKey(in.PixKeyType, in.PixKey); err != nil {
			return nil, err
		}
	}
	rootHex := ""
	if in.RootNpub != "" {
		h, err := nostr.DecodeNpub(in.RootNpub)
		if err != nil {
			return nil, invalid("root_npub: %v", err)
		}
		rootHex = h
	}
	if in.Plan.CreditBps == 0 && in.Plan.DebitBps == 0 {
		in.Plan = pricing.DefaultPlan
	}
	id := ids.New("mer")
	m := &Merchant{ID: id, Object: "merchant", AccountID: "acc_" + id[4:], LegalName: in.LegalName, TradeName: in.TradeName, MCC: in.MCC,
		SchemeMID: in.SchemeMID, City: in.City, RootNpub: in.RootNpub, Plan: in.Plan, Status: "active", rootPubHex: rootHex}
	if s.cfg.Env == "production" {
		m.Status = "kyb_in_review"
	}
	plan, _ := json.Marshal(in.Plan)
	var kyb []byte
	if len(in.KYB) > 0 {
		kyb, _ = json.Marshal(in.KYB)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO merchants (id, tenant_id, account_id, legal_name, trade_name, document, mcc, scheme_mid, city, root_pubkey, pix_key, pix_key_type, plan, kyb, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), $13, $14, $15)`,
		m.ID, tenantID, m.AccountID, m.LegalName, m.TradeName, in.Document, m.MCC, m.SchemeMID, m.City, rootHex, in.PixKey, in.PixKeyType, plan, kyb, m.Status); err != nil {
		return nil, err
	}
	if err := s.ledger.OpenMerchant(ctx, tenantID, m.ID, s.cfg.Currency); err != nil {
		return nil, err
	}
	return m, nil
}

func (s *Service) merchant(ctx context.Context, q pgx.Row) (*Merchant, error) {
	m := &Merchant{Object: "merchant"}
	var plan []byte
	err := q.Scan(&m.ID, &m.AccountID, &m.LegalName, &m.TradeName, &m.document, &m.MCC, &m.SchemeMID, &m.City, &m.rootPubHex, &m.pixKey, &m.pixKeyType, &plan, &m.Status, &m.StatusNote)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(plan, &m.Plan)
	if m.rootPubHex != "" {
		m.RootNpub, _ = nostr.EncodeNpub(m.rootPubHex)
	}
	return m, nil
}

const merchantCols = `id, account_id, legal_name, trade_name, document, mcc, scheme_mid, city, COALESCE(root_pubkey, ''), COALESCE(pix_key, ''), COALESCE(pix_key_type, ''), plan, status, COALESCE(status_reason, '')`

// GetMerchant loads a merchant.
func (s *Service) GetMerchant(ctx context.Context, tenantID, id string) (*Merchant, error) {
	return s.merchant(ctx, s.pool.QueryRow(ctx, `SELECT `+merchantCols+` FROM merchants WHERE tenant_id = $1 AND id = $2`, tenantID, id))
}

func (s *Service) merchantByAccount(ctx context.Context, tenantID, accountID string) (*Merchant, error) {
	return s.merchant(ctx, s.pool.QueryRow(ctx, `SELECT `+merchantCols+` FROM merchants WHERE tenant_id = $1 AND account_id = $2`, tenantID, accountID))
}

// Terminal is a registered acceptance device.
type Terminal struct {
	ID         string `json:"terminal_id"`
	Object     string `json:"object"`
	MerchantID string `json:"merchant_id"`
	Type       string `json:"type"`
	Status     string `json:"status"`
}

// RegisterTerminal creates a terminal ID (DE 41). Certificate issuance after attestation is
// the job of the terminal PKI (docs/05 §2.4); certFingerprint binds the terminal to it.
func (s *Service) RegisterTerminal(ctx context.Context, tenantID, merchantID, typ, certFingerprint string) (*Terminal, error) {
	m, err := s.GetMerchant(ctx, tenantID, merchantID)
	if err != nil {
		return nil, err
	}
	if m.Status != MerchantActive && m.Status != MerchantKYBInReview {
		return nil, fmt.Errorf("%w: merchant %s is %s", ErrMerchantInactive, m.ID, m.Status)
	}
	if typ == "" {
		typ = "mpoc_cots"
	}
	for i := 0; i < 5; i++ {
		u := ids.ULID()
		id := "T" + u[len(u)-7:]
		_, err := s.pool.Exec(ctx, `INSERT INTO terminals (id, tenant_id, merchant_id, type, cert_fingerprint) VALUES ($1, $2, $3, $4, NULLIF($5, ''))`,
			id, tenantID, merchantID, typ, certFingerprint)
		if err == nil {
			return &Terminal{ID: id, Object: "terminal", MerchantID: merchantID, Type: typ, Status: "active"}, nil
		}
	}
	return nil, errors.New("could not allocate a terminal ID")
}

// TerminalByFingerprint finds the terminal bound to a client certificate.
func (s *Service) TerminalByFingerprint(ctx context.Context, fp string) (tenantID, terminalID string, err error) {
	err = s.pool.QueryRow(ctx, `SELECT tenant_id::text, id FROM terminals WHERE cert_fingerprint = $1 AND status = 'active'`, fp).Scan(&tenantID, &terminalID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	return tenantID, terminalID, err
}

// ---------------------------------------------------------------- journals with safeguarding legs

// Every journal that creates client money (e-money) also moves the same amount into the
// safeguarding reserve, so invariant L5 holds after every posting (docs/04 §3.6).

func releaseInstant(m string, payable, fee int64) []ledger.Posting {
	return append(ledger.InstantRelease(m, payable, fee), ledger.SafeguardTopup(payable-fee)...)
}

func releaseScheduled(m string, payable int64) []ledger.Posting {
	return append(ledger.ScheduledRelease(m, payable), ledger.SafeguardTopup(payable)...)
}

func pixReceived(m string, n, fee int64) []ledger.Posting {
	ps := ledger.PixReceived(m, n, fee)
	return append(ps, ledger.Posting{Account: ledger.AccSafeguardingReserve, Direction: ledger.Debit, Amount: n - fee},
		ledger.Posting{Account: ledger.AccPixSettlement, Direction: ledger.Credit, Amount: n - fee})
}

func outflowConfirmed(n int64) []ledger.Posting {
	return []ledger.Posting{{Account: ledger.AccPixInTransit, Direction: ledger.Debit, Amount: n}, {Account: ledger.AccSafeguardingReserve, Direction: ledger.Credit, Amount: n}}
}

func cardRefund(brand, m string, n int64) []ledger.Posting {
	return append(ledger.CardRefund(brand, m, n), ledger.SafeguardRelease(n)...)
}

func (s *Service) post(ctx context.Context, tenantID, key, typ, ref string, ps []ledger.Posting) error {
	j := ledger.NewJournal(tenantID, ids.New("jr"), key, typ, ref, ps)
	j.EffectiveDate = s.cfg.Now()
	_, err := s.ledger.Post(ctx, j)
	var ife *ledger.InsufficientFundsError
	if errors.As(err, &ife) {
		return fmt.Errorf("%w: %v", ErrFunds, err)
	}
	return err
}

// notify updates nothing but the webhook outbox, in its own transaction.
func (s *Service) notify(ctx context.Context, tenantID, typ string, data any) {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error { return webhooks.Enqueue(ctx, tx, tenantID, typ, data) })
	if err != nil {
		s.log.Error("enqueue webhook", "type", typ, "err", err)
	}
}
