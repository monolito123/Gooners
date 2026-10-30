package payments

import (
	"context"
	"crypto/sha256"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/authswitch"
	"github.com/monolito123/Gooners/payments/platform/internal/carddata"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/pricing"
	"github.com/monolito123/Gooners/payments/platform/internal/receipts"
	"github.com/monolito123/Gooners/payments/platform/internal/risk"
	"github.com/monolito123/Gooners/payments/platform/pkg/apipix"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// Payment intent statuses (docs/02 §4.1).
const (
	StatusRequiresPaymentMethod = "requires_payment_method"
	StatusRequiresAction        = "requires_action"
	StatusProcessing            = "processing"
	StatusCaptured              = "captured"
	StatusFailed                = "failed"
	StatusCanceled              = "canceled"
	StatusPartiallyRefunded     = "partially_refunded"
	StatusRefunded              = "refunded"
)

// IntentInput creates a payment intent.
type IntentInput struct {
	MerchantID      string            `json:"merchant_id"`
	Amount          int64             `json:"amount"`
	Currency        string            `json:"currency"`
	Channel         string            `json:"channel"`
	Installments    int               `json:"-"`
	InstallmentType string            `json:"-"`
	Description     string            `json:"description"`
	Metadata        map[string]string `json:"metadata"`
	// StatementDescriptor overrides the merchant name sent in DE 43 (≤ 22 characters).
	StatementDescriptor string `json:"-"`
	// ReceiptRecipient is a customer npub: the receipt is also gift-wrapped to it.
	ReceiptRecipient string `json:"-"`
}

// Intent is the API view of a payment intent.
type Intent struct {
	ID             string            `json:"id"`
	Object         string            `json:"object"`
	Status         string            `json:"status"`
	Amount         int64             `json:"amount"`
	AmountCaptured int64             `json:"amount_captured"`
	AmountRefunded int64             `json:"amount_refunded"`
	Currency       string            `json:"currency"`
	MerchantID     string            `json:"merchant_id"`
	Channel        string            `json:"channel"`
	CaptureMethod  string            `json:"capture_method"`
	Installments   map[string]any    `json:"installments"`
	Description    string            `json:"description,omitempty"`
	Metadata       map[string]string `json:"metadata,omitempty"`
	LatestAttempt  map[string]any    `json:"latest_attempt"`
	NextAction     map[string]any    `json:"next_action,omitempty"`
	Receipt        map[string]any    `json:"receipt"`
	CreatedAt      string            `json:"created_at"`
	UpdatedAt      string            `json:"updated_at"`

	tenantID, authID, panToken, txid, e2e, brand, funding string
	installments                                          int
	installmentType                                       string
	descriptor, recipient                                 string
}

const intentCols = `id, tenant_id::text, merchant_id, status, amount, amount_captured, amount_refunded, currency, channel, capture_method,
	installments, installment_type, COALESCE(description, ''), COALESCE(metadata, '{}'::jsonb), COALESCE(auth_id, ''), COALESCE(card_brand, ''),
	COALESCE(card_last4, ''), COALESCE(card_funding, ''), COALESCE(pan_token, ''), COALESCE(pix_txid, ''), COALESCE(pix_e2e, ''),
	COALESCE(pix_copia_e_cola, ''), COALESCE(decline_code, ''), COALESCE(receipt_event_id, ''), COALESCE(receipt_claim_url, ''), created_at, updated_at,
	COALESCE(statement_descriptor, ''), COALESCE(receipt_recipient, '')`

func scanIntent(row pgx.Row) (*Intent, error) {
	in := &Intent{Object: "payment_intent", CaptureMethod: "automatic"}
	var meta []byte
	var last4, copia, decline, receiptID, claim string
	var created, updated time.Time
	err := row.Scan(&in.ID, &in.tenantID, &in.MerchantID, &in.Status, &in.Amount, &in.AmountCaptured, &in.AmountRefunded, &in.Currency, &in.Channel,
		&in.CaptureMethod, &in.installments, &in.installmentType, &in.Description, &meta, &in.authID, &in.brand, &last4, &in.funding,
		&in.panToken, &in.txid, &in.e2e, &copia, &decline, &receiptID, &claim, &created, &updated, &in.descriptor, &in.recipient)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(meta, &in.Metadata)
	in.Installments = map[string]any{"count": in.installments, "type": in.installmentType}
	in.CreatedAt, in.UpdatedAt = created.UTC().Format(time.RFC3339), updated.UTC().Format(time.RFC3339)
	if in.brand != "" || decline != "" {
		att := map[string]any{"type": "card"}
		if in.brand != "" {
			att["card"] = map[string]any{"brand": in.brand, "last4": last4, "funding": in.funding}
		}
		if decline != "" {
			att["decline_code"] = decline
		}
		in.LatestAttempt = att
	}
	if in.txid != "" {
		att := map[string]any{"type": "pix", "txid": in.txid}
		if in.e2e != "" {
			att["end_to_end_id"] = in.e2e
		}
		in.LatestAttempt = att
		if in.Status == StatusRequiresAction {
			in.NextAction = map[string]any{"type": "pix_qr", "txid": in.txid, "br_code": copia}
		}
	}
	if receiptID != "" {
		in.Receipt = map[string]any{"nostr_event_id": receiptID, "claim_url": claim}
	}
	return in, nil
}

// CreateIntent creates a payment intent.
func (s *Service) CreateIntent(ctx context.Context, tenantID string, in IntentInput) (*Intent, error) {
	if in.Amount <= 0 {
		return nil, invalid("amount must be a positive integer in centavos")
	}
	if in.Amount > s.cfg.MaxPaymentAmount {
		return nil, invalid("amount is above the limit of %d centavos per payment", s.cfg.MaxPaymentAmount)
	}
	if in.Currency == "" {
		in.Currency = s.cfg.Currency
	}
	if in.Currency != s.cfg.Currency {
		return nil, invalid("currency %s is not supported", in.Currency)
	}
	switch in.Channel {
	case "card_present", "pix", "ecommerce":
	case "":
		in.Channel = "card_present"
	default:
		return nil, invalid("channel must be card_present, pix or ecommerce")
	}
	if in.Installments < 1 {
		in.Installments = 1
	}
	if in.InstallmentType == "" {
		in.InstallmentType = "none"
	}
	if in.Installments > 1 && in.InstallmentType != "merchant" && in.InstallmentType != "issuer" {
		return nil, invalid("installments above 1 need type merchant or issuer")
	}
	m, err := s.GetMerchant(ctx, tenantID, in.MerchantID)
	if err != nil {
		return nil, err
	}
	if err := requireActive(m); err != nil {
		return nil, err
	}
	if len(in.StatementDescriptor) > 22 {
		return nil, invalid("statement_descriptor is limited to 22 characters")
	}
	recipient := ""
	if in.ReceiptRecipient != "" {
		h, err := nostr.DecodeNpub(in.ReceiptRecipient)
		if err != nil {
			return nil, invalid("receipt.recipient_npub: %v", err)
		}
		recipient = h
	}
	meta, _ := json.Marshal(in.Metadata)
	id := ids.New("pi")
	if _, err := s.pool.Exec(ctx, `INSERT INTO payment_intents (id, tenant_id, merchant_id, status, amount, currency, channel, capture_method, installments, installment_type, description, metadata, statement_descriptor, receipt_recipient)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'automatic', $8, $9, NULLIF($10, ''), $11, NULLIF($12, ''), NULLIF($13, ''))`,
		id, tenantID, in.MerchantID, StatusRequiresPaymentMethod, in.Amount, in.Currency, in.Channel, in.Installments, in.InstallmentType, in.Description, meta, in.StatementDescriptor, recipient); err != nil {
		return nil, err
	}
	return s.GetIntent(ctx, tenantID, id)
}

// GetIntent loads a payment intent.
func (s *Service) GetIntent(ctx context.Context, tenantID, id string) (*Intent, error) {
	return scanIntent(s.pool.QueryRow(ctx, `SELECT `+intentCols+` FROM payment_intents WHERE tenant_id = $1 AND id = $2`, tenantID, id))
}

// claim moves an intent from one of `from` to `to`; ErrConflict if it is in another state.
func (s *Service) claim(ctx context.Context, tenantID, id, to string, from ...string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE payment_intents SET status = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = ANY($4)`, tenantID, id, to, from)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		if _, err := s.GetIntent(ctx, tenantID, id); err != nil {
			return err
		}
		return fmt.Errorf("%w: payment intent is not in %v", ErrConflict, from)
	}
	return nil
}

// ---------------------------------------------------------------- card present

// TerminalAuth is a card-present authorization from a terminal.
type TerminalAuth struct {
	PaymentIntentID string
	TerminalID      string
	TerminalSTAN    string
	LocalTime       time.Time
	Application     string // credit or debit (the AID the kernel selected)
	Format, KSN     string
	Ciphertext      []byte
	Device          risk.Device // the phone's own score (docs/07 §3), inside the authenticated request
	JournalEventID  string
}

// TerminalResult is returned to the terminal.
type TerminalResult struct {
	Status          string         `json:"status"`
	PaymentIntentID string         `json:"payment_intent_id"`
	ResponseCode    string         `json:"response_code,omitempty"`
	AuthCode        string         `json:"authorization_code,omitempty"`
	RRN             string         `json:"rrn,omitempty"`
	DeclineCode     string         `json:"decline_code,omitempty"`
	CustomerMessage string         `json:"customer_message,omitempty"`
	Card            map[string]any `json:"card,omitempty"`
	IssuerEMV       string         `json:"issuer_response,omitempty"`
	Receipt         map[string]any `json:"receipt,omitempty"`
	Settlement      map[string]any `json:"settlement,omitempty"`
}

// AuthorizeTerminal decrypts the card data, authorizes through the switch and, on approval,
// captures: ledger journals, receivables, instant release when eligible, receipt, webhook.
func (s *Service) AuthorizeTerminal(ctx context.Context, tenantID string, ta TerminalAuth) (*TerminalResult, error) {
	pi, err := s.GetIntent(ctx, tenantID, ta.PaymentIntentID)
	if err != nil {
		return nil, err
	}
	if pi.Channel != "card_present" {
		return nil, invalid("payment intent channel is %s", pi.Channel)
	}
	if !terminalSTAN.MatchString(ta.TerminalSTAN) {
		return nil, invalid("stan must be the terminal's 6-digit trace number")
	}
	var termMerchant, termStatus string
	if err := s.pool.QueryRow(ctx, `SELECT merchant_id, status FROM terminals WHERE tenant_id = $1 AND id = $2 AND status IN ('active', 'frozen')`, tenantID, ta.TerminalID).Scan(&termMerchant, &termStatus); err != nil {
		return nil, fmt.Errorf("%w: unknown terminal", ErrNotFound)
	}
	if termStatus == "frozen" {
		return nil, fmt.Errorf("%w: the terminal is frozen for a risk review", ErrConflict)
	}
	if termMerchant != pi.MerchantID {
		return nil, invalid("terminal belongs to another merchant")
	}
	m, err := s.GetMerchant(ctx, tenantID, pi.MerchantID)
	if err != nil {
		return nil, err
	}
	if err := requireActive(m); err != nil {
		return nil, err
	}
	if err := s.claim(ctx, tenantID, pi.ID, StatusProcessing, StatusRequiresPaymentMethod); err != nil {
		return nil, err
	}
	fail := func(code string) {
		_, _ = s.pool.Exec(ctx, `UPDATE payment_intents SET status = $3, decline_code = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`, tenantID, pi.ID, StatusFailed, code)
	}

	card, err := s.dec.Decrypt(ctx, ta.Format, ta.KSN, ta.Ciphertext)
	if err != nil {
		fail("processing_error")
		return nil, invalid("card data: %v", err)
	}
	brand := carddata.BrandFromAID(card.AID)
	if brand == "" {
		brand = carddata.BrandFromPAN(card.PAN)
	}
	stored, err := s.vault.Store(ctx, tenantID, card.PAN)
	if err != nil {
		fail("invalid_number")
		return nil, invalid("card: %v", err)
	}
	funding := ta.Application
	if funding != "debit" {
		funding = "credit"
	}
	mdr := pricing.MDR(m.Plan, pi.Amount, funding, pi.installments)
	ic := s.cfg.Costs.Interchange(pi.Amount, funding)

	// The fraud shield decides before the issuer sees anything (docs/07 §3.6).
	ra, err := s.assessRisk(ctx, tenantID, pi, m, ta.TerminalID, newRiskCard(stored.Fingerprint, stored.BIN, card.Expiry, card.PANSequence, card.EMVHex), ta.Device)
	if err != nil {
		fail("processing_error")
		return nil, err
	}
	cardView := map[string]any{"brand": brand, "last4": stored.Last4, "funding": funding}
	if act := ra.act(); act.Declines() || (act.StepsUp() && card.PINBlockHex == "") {
		card = carddata.Card{}
		out := &TerminalResult{PaymentIntentID: pi.ID, Status: "declined", DeclineCode: "risk_declined", Card: cardView,
			CustomerMessage: "Venda não autorizada. Use outro meio de pagamento."}
		if !act.Declines() {
			out.Status, out.DeclineCode, out.CustomerMessage = "pin_required", "authentication_required", "Por segurança, este cartão precisa da senha."
		}
		if _, err := s.pool.Exec(ctx, `UPDATE payment_intents SET card_brand = $3, card_last4 = $4, card_funding = $5, pan_token = $6, updated_at = now()
			WHERE tenant_id = $1 AND id = $2`, tenantID, pi.ID, brand, stored.Last4, funding, stored.Token); err != nil {
			return nil, err
		}
		fail(out.DeclineCode)
		s.riskOutcome(ctx, ra, "risk_"+out.Status)
		if act == risk.DeclineFreeze { // a declined or stepped-up sale holds no money to review
			s.openReview(ctx, tenantID, m.ID, ta.TerminalID, pi.ID, ra)
		}
		mAuthorizations.Inc("risk_" + out.Status)
		s.notify(ctx, tenantID, "payment_intent.failed", map[string]any{"id": pi.ID, "decline_code": out.DeclineCode})
		return out, nil
	}

	authID := ids.New("auth")
	res, err := s.sw.Authorize(ctx, authswitch.Request{
		AuthID: authID, TenantID: tenantID, PaymentIntentID: pi.ID, Kind: authswitch.Purchase, Amount: pi.Amount,
		CurrencyNumeric: s.cfg.CurrencyNumeric, Channel: "card_present", TerminalID: ta.TerminalID, TerminalSTAN: ta.TerminalSTAN,
		TerminalLocal: ta.LocalTime, AcquirerID: s.cfg.AcquirerID, MDRCents: mdr, InterchangeCents: ic,
		Card: authswitch.Card{PAN: card.PAN, PANRef: stored.Token, Expiry: card.Expiry, Track2: card.Track2, PANSequence: card.PANSequence,
			EntryMode: "071", EMVHex: card.EMVHex, PINBlockHex: card.PINBlockHex, Funding: funding, Brand: brand},
		Merchant: authswitch.Merchant{SchemeMID: m.SchemeMID, MCC: m.MCC, Name: firstNonEmpty(pi.descriptor, m.TradeName), City: m.City, Country: "BR"},
	})
	card = carddata.Card{} // drop clear card data as soon as the switch has it
	if errors.Is(err, authswitch.ErrInFlight) || errors.Is(err, authswitch.ErrSTANReused) {
		// Nothing was sent for this payment: release it so the terminal can retry with a fresh STAN.
		_ = s.claim(ctx, tenantID, pi.ID, StatusRequiresPaymentMethod, StatusProcessing)
		return nil, fmt.Errorf("%w: terminal STAN %s is already used today (%v)", ErrConflict, ta.TerminalSTAN, err)
	}
	if err != nil {
		fail("processing_error")
		return nil, err
	}
	out := &TerminalResult{PaymentIntentID: pi.ID, ResponseCode: res.ResponseCode, AuthCode: res.AuthCode, RRN: res.RRN, Card: cardView, IssuerEMV: res.IssuerEMVHex}
	if _, err := s.pool.Exec(ctx, `UPDATE payment_intents SET auth_id = $3, card_brand = $4, card_last4 = $5, card_funding = $6, pan_token = $7, updated_at = now()
		WHERE tenant_id = $1 AND id = $2`, tenantID, pi.ID, authID, brand, stored.Last4, funding, stored.Token); err != nil {
		return nil, err
	}
	if !res.Approved {
		code := res.Decline.Code
		out.Status, out.DeclineCode, out.CustomerMessage = "declined", code, res.Decline.CustomerMessage
		if res.Status == authswitch.StatusTimedOut {
			out.Status = "timeout"
		}
		if res.Decline.Retry == authswitch.RetryStepUp {
			out.Status = "pin_required"
		}
		fail(code)
		s.riskOutcome(ctx, ra, out.Status)
		mAuthorizations.Inc(out.Status)
		s.notify(ctx, tenantID, "payment_intent.failed", map[string]any{"id": pi.ID, "decline_code": code})
		return out, nil
	}

	hold := ra.act().Holds()
	settle, err := s.capture(ctx, tenantID, pi, m, brand, funding, mdr, ic, hold)
	if err != nil {
		return nil, err
	}
	out.Status = "approved"
	s.riskOutcome(ctx, ra, out.Status)
	if hold {
		s.openReview(ctx, tenantID, m.ID, ta.TerminalID, pi.ID, ra)
	}
	mAuthorizations.Inc(out.Status)
	out.Settlement = settle
	out.Receipt = s.issueReceipt(ctx, tenantID, pi, m, map[string]any{
		"type": "card", "brand": brand, "funding": funding, "last4": stored.Last4, "entry_mode": "contactless", "cvm": "no_cvm",
	}, map[string]any{"code": res.AuthCode, "rrn": res.RRN, "stan": res.NetworkSTAN, "terminal_id": ta.TerminalID, "approved_at": s.cfg.Now().UTC().Format(time.RFC3339)}, ta.JournalEventID)
	s.notify(ctx, tenantID, "payment_intent.captured", map[string]any{"id": pi.ID, "object": "payment_intent", "status": StatusCaptured, "amount": pi.Amount, "currency": pi.Currency, "merchant_id": pi.MerchantID})
	return out, nil
}

// capture posts the capture journal and the receivables, and releases instantly when the
// merchant is eligible (docs/07 §1). A held sale's receivables wait for its risk review: no
// instant release, no advance, no settlement (docs/07 §3.6).
func (s *Service) capture(ctx context.Context, tenantID string, pi *Intent, m *Merchant, brand, funding string, mdr, ic int64, hold bool) (map[string]any, error) {
	fees := s.cfg.Costs.SchemeFees(pi.Amount)
	if err := s.post(ctx, tenantID, "capture:"+pi.ID, "card_capture", pi.ID,
		ledger.CardCapture(brand, m.ID, ledger.CardCaptureAmounts{Gross: pi.Amount, MDR: mdr, Interchange: ic, SchemeFees: fees})); err != nil {
		return nil, err
	}
	payable := pi.Amount - mdr
	dates := pricing.SettlementDates(s.cfg.Now(), funding, pi.installments)
	parts := pricing.Split(payable, len(dates))
	annual, eligible := s.cfg.Costs.AnnualRate(m.Plan.Tier)
	instant := m.Plan.Instant && eligible && !hold
	arr := arrangement(brand, funding)
	recIDs := make([]int64, len(dates))
	for i, d := range dates {
		if err := s.pool.QueryRow(ctx, `INSERT INTO receivables (tenant_id, merchant_id, payment_intent_id, brand, arrangement, settles_on, amount, status, held)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8) RETURNING id`, tenantID, m.ID, pi.ID, brand, arr, d, parts[i], hold).Scan(&recIDs[i]); err != nil {
			return nil, err
		}
	}
	// Instant settlement advances the receivables: their assignment to the platform is
	// registered first. Without it the sale settles on schedule (docs/07 §1.6).
	if instant && s.registrar != nil {
		// The card authorization is waiting: a slow registrar costs the merchant the instant
		// release, never the sale.
		rctx, cancel := context.WithTimeout(ctx, registrarBudget)
		lines, err := s.receivableLines(rctx, tenantID, recIDs)
		if err == nil {
			err = s.commitAdvance(rctx, tenantID, m.ID, "capture:"+pi.ID, "instant_release", pi.ID, lines)
		}
		cancel()
		if err != nil {
			s.log.Warn("instant settlement not registered; the sale settles on schedule", "payment_intent", pi.ID, "err", err)
			instant = false
		}
	}
	var feeTotal int64
	if instant {
		for i, d := range dates {
			fee := pricing.AdvanceFee(parts[i], annual, pricing.BusinessDaysBetween(s.cfg.Now(), d))
			if err := s.post(ctx, tenantID, fmt.Sprintf("release:%s:%d", pi.ID, i), "instant_release", pi.ID, releaseInstant(m.ID, parts[i], fee)); err != nil {
				return nil, err
			}
			if _, err := s.pool.Exec(ctx, `UPDATE receivables SET status = 'advanced', advance_fee = $2 WHERE id = $1`, recIDs[i], fee); err != nil {
				return nil, err
			}
			feeTotal += fee
		}
	}
	if _, err := s.pool.Exec(ctx, `UPDATE payment_intents SET status = $3, amount_captured = amount, fee = $4, settlement_mode = $5, captured_at = $6, updated_at = now()
		WHERE tenant_id = $1 AND id = $2`, tenantID, pi.ID, StatusCaptured, mdr, settlementMode(instant, len(dates)), s.cfg.Now()); err != nil {
		return nil, err
	}
	mode := "standard"
	if instant {
		mode = "instant"
	}
	out := map[string]any{"mode": mode, "merchant_discount": mdr, "advance_fee": feeTotal, "net_available": payable - feeTotal, "settles_on": dates[len(dates)-1].Format("2006-01-02")}
	if hold {
		out["held"] = true // shown to the merchant: the money waits for a review
	}
	return out, nil
}

func (s *Service) issueReceipt(ctx context.Context, tenantID string, pi *Intent, m *Merchant, method, auth map[string]any, journal string) map[string]any {
	if s.receipts == nil {
		return nil
	}
	r := receipts.Receipt{PaymentIntentID: pi.ID, MerchantID: m.ID, MerchantName: m.TradeName, MerchantRootPub: m.rootPubHex, Amount: pi.Amount,
		Currency: pi.Currency, Method: method, Authorization: auth, Installments: pi.installments, InstallmentType: pi.installmentType,
		SettlementDate: pricing.Date(s.cfg.Now()).Format("2006-01-02"), JournalEventID: journal, RelayURL: s.cfg.RelayURL, CreatedAt: s.cfg.Now()}
	issued, err := s.receipts.Issue(r)
	if err != nil {
		s.log.Error("issue receipt", "payment_intent", pi.ID, "err", err)
		return nil
	}
	_, _ = s.pool.Exec(ctx, `UPDATE payment_intents SET receipt_event_id = $3, receipt_claim_url = $4 WHERE tenant_id = $1 AND id = $2`, tenantID, pi.ID, issued.Receipt.ID, issued.ClaimURL)
	evs := []*nostr.Event{issued.ClaimWrap}
	if issued.MerchantWrap != nil {
		evs = append(evs, issued.MerchantWrap)
	}
	if pi.recipient != "" {
		if _, w, err := nostr.Wrap(issued.Receipt, s.receipts.Author, pi.recipient, nostr.WrapOptions{}); err == nil {
			evs = append(evs, w) // the customer asked for the receipt in their own Nostr inbox
		}
	}
	if s.publisher != nil {
		go func() {
			c, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second) // publishing outlives the request
			defer cancel()
			if _, err := s.publisher.Publish(c, evs...); err != nil {
				s.log.Warn("publish receipt", "payment_intent", pi.ID, "err", err) // republished from the archive by the sweeper (docs/03 §9)
			}
		}()
	}
	return map[string]any{"nostr_event_id": issued.Receipt.ID, "claim_qr": issued.ClaimURL}
}

// ---------------------------------------------------------------- Pix

// ConfirmPix creates the immediate charge at the PSP and returns the dynamic BR Code.
func (s *Service) ConfirmPix(ctx context.Context, tenantID, id string) (*Intent, error) {
	if s.pix == nil {
		return nil, fmt.Errorf("%w: Pix PSP", ErrDisabled)
	}
	pi, err := s.GetIntent(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if pi.Channel != "pix" {
		return nil, invalid("payment intent channel is %s", pi.Channel)
	}
	if pi.Status == StatusRequiresAction {
		return pi, nil // idempotent: the same QR
	}
	m, err := s.GetMerchant(ctx, tenantID, pi.MerchantID)
	if err != nil {
		return nil, err
	}
	if err := requireActive(m); err != nil {
		return nil, err
	}
	if err := s.claim(ctx, tenantID, id, StatusProcessing, StatusRequiresPaymentMethod); err != nil {
		return nil, err
	}
	txid := strings.ReplaceAll(strings.ToLower(pi.ID[3:]), "_", "") + "px" // 26 + 2 = 28 alphanumerics, derived from the intent
	cob, err := s.pix.CreateCob(ctx, txid, apipix.CobRequest{
		Calendario: apipix.Calendario{Expiracao: int(s.cfg.PixExpiry.Seconds())}, Valor: apipix.Valor{Original: apipix.FormatValor(pi.Amount)},
		Chave: s.cfg.PixKey, SolicitacaoPagador: truncate(m.TradeName+" "+pi.Description, 140),
		InfoAdicionais: []apipix.InfoAdicional{{Nome: "pedido", Valor: pi.ID}},
	})
	if err != nil {
		_ = s.claim(ctx, tenantID, id, StatusRequiresPaymentMethod, StatusProcessing)
		return nil, err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE payment_intents SET status = $3, pix_txid = $4, pix_copia_e_cola = $5, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
		tenantID, id, StatusRequiresAction, txid, cob.PixCopiaECola); err != nil {
		return nil, err
	}
	s.notify(ctx, tenantID, "payment_intent.requires_action", map[string]any{"id": id, "next_action": "pix_qr"})
	return s.GetIntent(ctx, tenantID, id)
}

var terminalSTAN = regexp.MustCompile(`^[0-9]{6}$`)

// platformSTAN is the terminal-STAN idempotency key of a platform-initiated message: "R" and
// five base-32 characters of the SHA-256 of its ID.
func platformSTAN(id string) string {
	h := sha256.Sum256([]byte(id))
	return "R" + base32.StdEncoding.EncodeToString(h[:])[:5]
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// OnPix handles one webhook item from the PSP. It never trusts the webhook body: the Pix is
// re-read with GET /pix/{e2eid} before any money moves. Safe to call repeatedly.
func (s *Service) OnPix(ctx context.Context, hint apipix.Pix) error {
	if s.pix == nil {
		return ErrDisabled
	}
	p, err := s.pix.GetPix(ctx, hint.EndToEndID)
	if err != nil {
		return err
	}
	var tenantID, id string
	if err := s.pool.QueryRow(ctx, `SELECT tenant_id::text, id FROM payment_intents WHERE pix_txid = $1`, p.TxID).Scan(&tenantID, &id); err != nil {
		s.log.Warn("pix for unknown txid", "txid", p.TxID, "e2e", p.EndToEndID)
		return nil // not ours; acknowledge so the PSP stops retrying
	}
	pi, err := s.GetIntent(ctx, tenantID, id)
	if err != nil {
		return err
	}
	if err := s.applyDevolucoes(ctx, pi, p); err != nil {
		return err
	}
	if pi.Status != StatusRequiresAction {
		return nil // already captured (or canceled): idempotent
	}
	amount, err := apipix.ParseValor(p.Valor)
	if err != nil {
		return err
	}
	if amount != pi.Amount {
		s.log.Error("pix amount differs from the charge", "payment_intent", pi.ID, "paid", amount, "expected", pi.Amount)
	}
	m, err := s.GetMerchant(ctx, tenantID, pi.MerchantID)
	if err != nil {
		return err
	}
	fee := pricing.PixFee(m.Plan, amount)
	if err := s.post(ctx, tenantID, "pix:"+p.EndToEndID, "pix_received", pi.ID, pixReceived(m.ID, amount, fee)); err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `UPDATE payment_intents SET status = $3, amount_captured = $4, pix_e2e = $5, fee = $7, settlement_mode = 'instant', captured_at = $8, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND status = $6`,
		tenantID, pi.ID, StatusCaptured, amount, p.EndToEndID, StatusRequiresAction, fee, s.cfg.Now())
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 1 {
		mPixReceived.Inc()
		pi.e2e = p.EndToEndID
		s.issueReceipt(ctx, tenantID, pi, m, map[string]any{"type": "pix", "end_to_end_id": p.EndToEndID}, nil, "")
		s.notify(ctx, tenantID, "payment_intent.captured", map[string]any{"id": pi.ID, "object": "payment_intent", "status": StatusCaptured, "amount": amount, "currency": pi.Currency, "merchant_id": pi.MerchantID})
	}
	return nil
}

// applyDevolucoes settles Pix refunds whose final status arrived with the webhook, and
// applies returns the payer's PSP made under the MED.
func (s *Service) applyDevolucoes(ctx context.Context, pi *Intent, p *apipix.Pix) error {
	for _, d := range p.Devolucoes {
		if d.Status != apipix.DevolucaoDevolvido && d.Status != apipix.DevolucaoNaoRealizado {
			continue
		}
		if d.Natureza == apipix.NaturezaMEDFraude || d.Natureza == apipix.NaturezaMEDOperacional {
			if d.Status == apipix.DevolucaoDevolvido {
				if err := s.applyMED(ctx, pi, p.EndToEndID, d); err != nil {
					return err
				}
			}
			continue
		}
		var refundID string
		var amount int64
		var status string
		err := s.pool.QueryRow(ctx, `SELECT id, amount, status FROM refunds WHERE tenant_id = $1 AND payment_intent_id = $2 AND devolucao_id = $3`, pi.tenantID, pi.ID, d.ID).Scan(&refundID, &amount, &status)
		if errors.Is(err, pgx.ErrNoRows) || status != "pending" {
			continue
		}
		if err != nil {
			return err
		}
		if d.Status == apipix.DevolucaoDevolvido {
			if err := s.post(ctx, pi.tenantID, "refund-done:"+refundID, "pix_refund_confirm", refundID, outflowConfirmed(amount)); err != nil {
				return err
			}
			_, _ = s.pool.Exec(ctx, `UPDATE refunds SET status = 'succeeded', updated_at = now() WHERE id = $1`, refundID)
			s.notify(ctx, pi.tenantID, "refund.succeeded", map[string]any{"id": refundID, "payment_intent_id": pi.ID, "amount": amount})
		} else {
			if err := s.post(ctx, pi.tenantID, "refund-failed:"+refundID, "pix_refund_returned", refundID, ledger.PayoutReturned(pi.MerchantID, amount)); err != nil {
				return err
			}
			_, _ = s.pool.Exec(ctx, `UPDATE refunds SET status = 'failed', updated_at = now() WHERE id = $1`, refundID)
			_, _ = s.pool.Exec(ctx, `UPDATE payment_intents SET amount_refunded = amount_refunded - $3 WHERE tenant_id = $1 AND id = $2`, pi.tenantID, pi.ID, amount)
			s.notify(ctx, pi.tenantID, "refund.failed", map[string]any{"id": refundID, "payment_intent_id": pi.ID})
		}
	}
	return nil
}

// applyMED debits the merchant for a Pix the payer's PSP returned under the Mecanismo
// Especial de Devolução. The money already left the platform's account, so whatever the
// merchant's balance cannot cover is booked as owed (and recovered by RecoverShortfalls).
func (s *Service) applyMED(ctx context.Context, pi *Intent, e2e string, d apipix.Devolucao) error {
	amount, err := apipix.ParseValor(d.Valor)
	if err != nil {
		return err
	}
	key := "med:" + e2e + ":" + d.ID
	var done bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM journals WHERE tenant_id = $1 AND idempotency_key = $2)`, pi.tenantID, key).Scan(&done); err != nil || done {
		return err
	}
	for attempt := 0; ; attempt++ {
		avail, err := s.ledger.Balance(ctx, pi.tenantID, ledger.MerchantWallet(pi.MerchantID))
		if err != nil {
			return err
		}
		w := min(max(avail, 0), amount)
		ps := []ledger.Posting{}
		if w > 0 {
			ps = append(ps, ledger.Posting{Account: ledger.MerchantWallet(pi.MerchantID), Direction: ledger.Debit, Amount: w},
				ledger.Posting{Account: ledger.AccSafeguardingReserve, Direction: ledger.Credit, Amount: w})
		}
		if r := amount - w; r > 0 {
			ps = append(ps, ledger.Posting{Account: ledger.MerchantRecoverable(pi.MerchantID), Direction: ledger.Debit, Amount: r},
				ledger.Posting{Account: ledger.AccSettlementBank, Direction: ledger.Credit, Amount: r})
		}
		err = s.post(ctx, pi.tenantID, key, "pix_med_return", pi.ID, ps)
		if errors.Is(err, ledger.ErrIdempotencyConflict) {
			return nil // posted by a concurrent delivery with the balance it saw
		}
		if err == nil {
			break
		}
		if !errors.Is(err, ErrFunds) || attempt == 2 {
			return err
		}
	}
	if _, err := s.pool.Exec(ctx, `UPDATE payment_intents SET amount_refunded = LEAST(amount_captured, amount_refunded + $3),
		status = CASE WHEN amount_refunded + $3 >= amount_captured THEN 'refunded' ELSE 'partially_refunded' END, updated_at = now()
		WHERE tenant_id = $1 AND id = $2`, pi.tenantID, pi.ID, amount); err != nil {
		return err
	}
	mMED.Inc(d.Natureza)
	s.log.Warn("pix returned under MED", "payment_intent", pi.ID, "e2e", e2e, "natureza", d.Natureza, "amount", amount)
	s.notify(ctx, pi.tenantID, "payment_intent.med_returned", map[string]any{"id": pi.ID, "object": "payment_intent", "amount": amount, "natureza": d.Natureza, "devolucao_id": d.ID})
	return nil
}

// ---------------------------------------------------------------- cancel and refund

// Cancel reverses a captured card payment before clearing (or cancels an unpaid intent).
func (s *Service) Cancel(ctx context.Context, tenantID, id string) (*Intent, error) {
	pi, err := s.GetIntent(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	switch pi.Status {
	case StatusRequiresPaymentMethod, StatusRequiresAction:
		if err := s.claim(ctx, tenantID, id, StatusCanceled, StatusRequiresPaymentMethod, StatusRequiresAction); err != nil {
			return nil, err
		}
		return s.GetIntent(ctx, tenantID, id)
	case StatusCaptured:
	default:
		return nil, fmt.Errorf("%w: cannot cancel a %s payment intent", ErrConflict, pi.Status)
	}
	if pi.authID == "" {
		return nil, fmt.Errorf("%w: captured Pix payments are refunded, not canceled", ErrConflict)
	}
	// Reverse the ledger first: if the merchant's wallet cannot cover an instant release that
	// was already paid out, the cancellation is refused before anything reaches the network.
	m, err := s.GetMerchant(ctx, tenantID, pi.MerchantID)
	if err != nil {
		return nil, err
	}
	if err := s.reverseCaptureJournals(ctx, tenantID, pi, m); err != nil {
		return nil, err
	}
	if _, err := s.sw.Reverse(ctx, pi.authID, 0, "requested_by_merchant"); err != nil {
		return nil, err // reversal_pending is not an error: store-and-forward delivers it
	}
	if _, err := s.pool.Exec(ctx, `UPDATE payment_intents SET status = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`, tenantID, id, StatusCanceled); err != nil {
		return nil, err
	}
	s.notify(ctx, tenantID, "payment_intent.canceled", map[string]any{"id": id})
	return s.GetIntent(ctx, tenantID, id)
}

func (s *Service) reverseCaptureJournals(ctx context.Context, tenantID string, pi *Intent, m *Merchant) error {
	rows, err := s.pool.Query(ctx, `SELECT id, amount, status, advance_fee FROM receivables WHERE tenant_id = $1 AND payment_intent_id = $2 ORDER BY id`, tenantID, pi.ID)
	if err != nil {
		return err
	}
	type rcv struct {
		id          int64
		amount, fee int64
		status      string
	}
	var rs []rcv
	for rows.Next() {
		var r rcv
		if err := rows.Scan(&r.id, &r.amount, &r.status, &r.fee); err != nil {
			rows.Close()
			return err
		}
		rs = append(rs, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	var ps []ledger.Posting
	for _, r := range rs {
		switch r.status {
		case "advanced":
			ps = append(ps, ledger.Reverse(releaseInstant(m.ID, r.amount, r.fee))...)
		case "released":
			ps = append(ps, ledger.Reverse(releaseScheduled(m.ID, r.amount))...)
		}
	}
	mdr := pricing.MDR(m.Plan, pi.Amount, pi.funding, pi.installments)
	ps = append(ps, ledger.Reverse(ledger.CardCapture(pi.brand, m.ID, ledger.CardCaptureAmounts{
		Gross: pi.Amount, MDR: mdr, Interchange: s.cfg.Costs.Interchange(pi.Amount, pi.funding), SchemeFees: s.cfg.Costs.SchemeFees(pi.Amount)}))...)
	if err := s.post(ctx, tenantID, "cancel:"+pi.ID, "card_capture_reversal", pi.ID, ps); err != nil {
		return err
	}
	if _, err = s.pool.Exec(ctx, `UPDATE receivables SET status = 'reversed' WHERE tenant_id = $1 AND payment_intent_id = $2`, tenantID, pi.ID); err != nil {
		return err
	}
	if s.registrar != nil {
		// The platform no longer finances the reversed sale: free its assignment at the
		// registrar. The unit's lower total is registered by the next SyncReceivableUnits.
		if err := s.registrar.CancelEffect(ctx, "capture:"+pi.ID); err != nil {
			s.log.Error("cancel the registrar effect of a reversed sale", "payment_intent", pi.ID, "err", err)
		}
	}
	return nil
}

// Refund is the API view of a refund.
type Refund struct {
	ID              string `json:"id"`
	Object          string `json:"object"`
	PaymentIntentID string `json:"payment_intent_id"`
	Amount          int64  `json:"amount"`
	Currency        string `json:"currency"`
	Status          string `json:"status"`
	Method          string `json:"method"`
}

// CreateRefund refunds a captured payment: an online refund authorization for cards, a
// devolução for Pix. The merchant's wallet funds it.
func (s *Service) CreateRefund(ctx context.Context, tenantID, piID string, amount int64) (*Refund, error) {
	pi, err := s.GetIntent(ctx, tenantID, piID)
	if err != nil {
		return nil, err
	}
	if pi.Status != StatusCaptured && pi.Status != StatusPartiallyRefunded {
		return nil, fmt.Errorf("%w: only captured payments can be refunded", ErrConflict)
	}
	if amount <= 0 {
		amount = pi.AmountCaptured - pi.AmountRefunded
	}
	if amount > pi.AmountCaptured-pi.AmountRefunded {
		return nil, invalid("amount exceeds the refundable balance")
	}
	var disputed bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM disputes WHERE tenant_id = $1 AND payment_intent_id = $2 AND status IN ('evidence_required', 'represented', 'pre_arbitration'))`,
		tenantID, piID).Scan(&disputed); err != nil {
		return nil, err
	}
	if disputed {
		// The chargeback already returns the money to the cardholder; a refund would pay twice.
		return nil, fmt.Errorf("%w: the payment has an open dispute", ErrConflict)
	}
	// Reserve the refundable amount atomically, so two concurrent refunds cannot exceed it.
	tag, err := s.pool.Exec(ctx, `UPDATE payment_intents SET amount_refunded = amount_refunded + $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND amount_refunded + $3 <= amount_captured`, tenantID, piID, amount)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, invalid("amount exceeds the refundable balance")
	}
	unreserve := func() {
		_, _ = s.pool.Exec(ctx, `UPDATE payment_intents SET amount_refunded = amount_refunded - $3 WHERE tenant_id = $1 AND id = $2`, tenantID, piID, amount)
	}
	ref := &Refund{ID: ids.New("re"), Object: "refund", PaymentIntentID: piID, Amount: amount, Currency: pi.Currency}
	if pi.txid != "" {
		ref.Method, ref.Status = "pix_return", "pending"
		devID := strings.ToLower(ref.ID[3:]) // 26 alphanumerics
		if err := s.post(ctx, tenantID, "refund:"+ref.ID, "pix_refund_send", ref.ID, ledger.PixRefundSend(pi.MerchantID, amount)); err != nil {
			unreserve()
			return nil, err
		}
		if _, err := s.pix.Devolver(ctx, pi.e2e, devID, apipix.DevolucaoRequest{Valor: apipix.FormatValor(amount), Natureza: "ORIGINAL"}); err != nil {
			_ = s.post(ctx, tenantID, "refund-failed:"+ref.ID, "pix_refund_returned", ref.ID, ledger.PayoutReturned(pi.MerchantID, amount))
			unreserve()
			return nil, err
		}
		if _, err := s.pool.Exec(ctx, `INSERT INTO refunds (id, tenant_id, payment_intent_id, amount, status, method, devolucao_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			ref.ID, tenantID, piID, amount, ref.Status, ref.Method, devID); err != nil {
			return nil, err
		}
	} else {
		ref.Method = "card_credit"
		if err := s.refundCard(ctx, tenantID, pi, ref); err != nil {
			unreserve()
			return nil, err
		}
	}
	newStatus := StatusPartiallyRefunded
	if pi.AmountRefunded+amount == pi.AmountCaptured {
		newStatus = StatusRefunded
	}
	_, _ = s.pool.Exec(ctx, `UPDATE payment_intents SET status = $3 WHERE tenant_id = $1 AND id = $2`, tenantID, piID, newStatus)
	return ref, nil
}

func (s *Service) refundCard(ctx context.Context, tenantID string, pi *Intent, ref *Refund) error {
	var terminal, mcc, mid, name, city string
	if err := s.pool.QueryRow(ctx, `SELECT a.terminal_id, m.mcc, m.scheme_mid, m.trade_name, m.city FROM authorizations a JOIN merchants m ON m.id = $2
		WHERE a.auth_id = $1`, pi.authID, pi.MerchantID).Scan(&terminal, &mcc, &mid, &name, &city); err != nil {
		return err
	}
	pan, err := s.vault.RevealPAN(ctx, pi.panToken)
	if err != nil {
		return err
	}
	// Refunds are not tapped. Their idempotency key on the terminal comes from a namespace the
	// terminal can never use (terminal STANs are digits), derived from the refund ID.
	res, err := s.sw.Authorize(ctx, authswitch.Request{
		AuthID: ids.New("auth"), TenantID: tenantID, PaymentIntentID: pi.ID, Kind: authswitch.Refund, Amount: ref.Amount,
		CurrencyNumeric: s.cfg.CurrencyNumeric, Channel: "card_present", TerminalID: terminal, TerminalSTAN: platformSTAN(ref.ID),
		AcquirerID: s.cfg.AcquirerID,
		Card:       authswitch.Card{PAN: pan, PANRef: pi.panToken, EntryMode: "012", Funding: pi.funding, Brand: pi.brand},
		Merchant:   authswitch.Merchant{SchemeMID: mid, MCC: mcc, Name: name, City: city, Country: "BR"},
	})
	if err != nil {
		return err
	}
	if !res.Approved {
		return fmt.Errorf("%w: refund authorization %s (%s)", ErrDeclined, res.ResponseCode, res.Decline.Code)
	}
	if err := s.post(ctx, tenantID, "refund:"+ref.ID, "refund", ref.ID, cardRefund(pi.brand, pi.MerchantID, ref.Amount)); err != nil {
		return err
	}
	ref.Status = "succeeded"
	if _, err := s.pool.Exec(ctx, `INSERT INTO refunds (id, tenant_id, payment_intent_id, amount, status, method, auth_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		ref.ID, tenantID, pi.ID, ref.Amount, ref.Status, ref.Method, res.AuthID); err != nil {
		return err
	}
	s.notify(ctx, tenantID, "refund.succeeded", map[string]any{"id": ref.ID, "payment_intent_id": pi.ID, "amount": ref.Amount})
	return nil
}

// GetRefund loads a refund.
func (s *Service) GetRefund(ctx context.Context, tenantID, id string) (*Refund, error) {
	r := &Refund{Object: "refund", Currency: s.cfg.Currency}
	err := s.pool.QueryRow(ctx, `SELECT id, payment_intent_id, amount, status, method FROM refunds WHERE tenant_id = $1 AND id = $2`, tenantID, id).
		Scan(&r.ID, &r.PaymentIntentID, &r.Amount, &r.Status, &r.Method)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return r, err
}
