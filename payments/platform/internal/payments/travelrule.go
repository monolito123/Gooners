package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/assets"
	"github.com/monolito123/Gooners/payments/platform/internal/exchange"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
	"github.com/monolito123/Gooners/payments/platform/internal/travelrule"
)

// TravelRuleProvider sends travel-rule data to other providers (travelrule.Service).
type TravelRuleProvider interface {
	Send(ctx context.Context, t travelrule.Transfer) (travelrule.Answer, error)
}

var mTravelRule = metrics.Default.Counter("goonerspay_travel_rule_messages_total", "Travel-rule messages, by direction and status.", "direction", "status")

// TravelRuleMessage is the record of travel-rule data sent with a withdrawal or received
// with a deposit.
type TravelRuleMessage struct {
	ID           string         `json:"id"`
	Object       string         `json:"object"`
	Direction    string         `json:"direction"` // outbound or inbound
	MerchantID   string         `json:"merchant_id,omitempty"`
	TransferID   string         `json:"transfer_id,omitempty"` // outbound: the withdrawal
	Deposit      string         `json:"deposit,omitempty"`     // inbound, once matched: venue/id
	Asset        string         `json:"asset"`
	Network      string         `json:"network"`
	Address      string         `json:"address"`
	Memo         string         `json:"memo,omitempty"`
	Amount       string         `json:"amount"`
	Units        int64          `json:"units"`
	TxID         string         `json:"txid,omitempty"`
	Counterparty map[string]any `json:"counterparty"`
	// IVMS101 is the payload, only when one message is read with travel_rule:read; lists
	// leave it out, and it is gone once redacted.
	IVMS101    json.RawMessage `json:"ivms101,omitempty"`
	Status     string          `json:"status"`
	Reference  string          `json:"reference,omitempty"`
	Reason     string          `json:"reason,omitempty"`
	CreatedAt  string          `json:"created_at"`
	RedactedAt *string         `json:"redacted_at,omitempty"`

	plain  []byte // a payload stored before sealing (or without a vault)
	sealed string // the payload sealed under the vault's KEK
}

const travelCols = `id, direction, COALESCE(merchant_id, ''), COALESCE(transfer_id, ''), COALESCE(deposit_exchange || '/' || deposit_id, ''), asset, network, address, memo,
	units, COALESCE(txid, ''), counterparty, ivms101, COALESCE(ivms101_sealed, ''), status, COALESCE(reference, ''), COALESCE(reason, ''), created_at, redacted_at`

func scanTravel(row pgx.Row) (*TravelRuleMessage, error) {
	m := &TravelRuleMessage{Object: "travel_rule_message"}
	var cp []byte
	var at time.Time
	var redacted *time.Time
	if err := row.Scan(&m.ID, &m.Direction, &m.MerchantID, &m.TransferID, &m.Deposit, &m.Asset, &m.Network, &m.Address, &m.Memo, &m.Units, &m.TxID, &cp, &m.plain, &m.sealed,
		&m.Status, &m.Reference, &m.Reason, &at, &redacted); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	m.Asset = strings.TrimSpace(m.Asset)
	if a, err := assets.Get(m.Asset); err == nil {
		m.Amount = a.Format(m.Units)
	}
	_ = json.Unmarshal(cp, &m.Counterparty)
	m.CreatedAt = at.UTC().Format(time.RFC3339)
	if redacted != nil {
		r := redacted.UTC().Format(time.RFC3339)
		m.RedactedAt = &r
	}
	return m, nil
}

// sealPII seals personal data under the vault's KEK, bound to the record it belongs to.
// Without a vault (unit tests, the sandbox's operator commands) it is kept as it is, which
// production refuses.
func (s *Service) sealPII(ctx context.Context, data []byte, aad string) (string, error) {
	if s.vault == nil {
		if s.cfg.Env == "production" {
			return "", fmt.Errorf("%w: the vault is required to store personal data", ErrDisabled)
		}
		return "", nil
	}
	return s.vault.SealSecret(ctx, string(data), aad)
}

func (s *Service) openPII(ctx context.Context, plain []byte, sealed, aad string) ([]byte, error) {
	if sealed == "" {
		return plain, nil
	}
	if s.vault == nil {
		return nil, fmt.Errorf("%w: the vault is required to read personal data", ErrDisabled)
	}
	pt, err := s.vault.OpenSecret(ctx, sealed, aad)
	return []byte(pt), err
}

// reveal opens a message's payload.
func (s *Service) reveal(ctx context.Context, m *TravelRuleMessage) error {
	b, err := s.openPII(ctx, m.plain, m.sealed, m.ID)
	if err != nil {
		return err
	}
	if len(b) > 0 {
		m.IVMS101 = b
	}
	return nil
}

// RedactTravelRule removes the personal data of travel-rule messages and payers'
// declarations older than the record-keeping period (TravelRuleRetention, default ten
// years); what each transfer was and how it ended stays. It returns how many it redacted.
func (s *Service) RedactTravelRule(ctx context.Context, now time.Time) (int64, error) {
	before := now.Add(-s.cfg.TravelRuleRetention)
	tag, err := s.pool.Exec(ctx, `UPDATE travel_rule_messages SET ivms101 = NULL, ivms101_sealed = NULL, redacted_at = $2
		WHERE redacted_at IS NULL AND created_at < $1`, before, now)
	if err != nil {
		return 0, err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE crypto_charges SET payer = NULL, payer_sealed = NULL
		WHERE (payer IS NOT NULL OR payer_sealed IS NOT NULL) AND created_at < $1`, before); err != nil {
		return tag.RowsAffected(), err
	}
	return tag.RowsAffected(), nil
}

// platformVASP is the platform as the originating (or beneficiary) provider: its legal name
// and its LEI, or its CNPJ in the CNPJ registry.
func (s *Service) platformVASP() travelrule.Person {
	name := s.cfg.ReportingName
	if name == "" {
		name = "GoonersPay"
	}
	l := &travelrule.LegalPerson{Name: travelrule.LegalPersonName{NameIdentifier: []travelrule.LegalPersonNameID{{LegalPersonName: name, LegalPersonNameIdentifierType: "LEGL"}}},
		CountryOfRegistration: "BR"}
	switch doc := strings.Map(keepDigits, s.cfg.PlatformDocument); {
	case travelrule.ValidLEI(s.cfg.PlatformLEI):
		l.NationalIdentification = &travelrule.NationalIdentification{NationalIdentifier: s.cfg.PlatformLEI, NationalIdentifierType: "LEIX"}
	case len(doc) == 14:
		l.NationalIdentification = &travelrule.NationalIdentification{NationalIdentifier: doc, NationalIdentifierType: "RAID", RegistrationAuthority: travelrule.CNPJRegistrationAuthority}
	}
	return travelrule.Person{LegalPerson: l}
}

// merchantParty is a merchant as a travel-rule party: a company by its CNPJ, or an
// individual (an MEI, a sole trader) by the CPF, identified at the platform by its id.
func merchantParty(m *Merchant) travelrule.Party {
	p := travelrule.Party{Type: "legal", Name: m.LegalName, Document: m.document, Country: "BR", CustomerID: m.ID}
	if len(strings.Map(keepDigits, m.document)) == 11 {
		p.Type = "natural"
	}
	return p
}

// travelRuleOut identifies originator and beneficiary of a withdrawal before anything moves
// (Resolução BCB 520/2025, art. 44). To another provider (destination_type exchange) the
// data goes through the travel-rule network and the coins go only if that provider accepts:
// no network, no answer or a rejection refuses the withdrawal (fail closed). To a
// self-hosted wallet there is nobody to send it to: the merchant's declaration of who owns
// the wallet is recorded instead (Resolução BCB 521/2025 lets a provider rely on documented
// self-declarations). The beneficiary defaults to the merchant itself (its own wallet or
// account).
func (s *Service) travelRuleOut(ctx context.Context, tenantID string, m *Merchant, w *CryptoWithdrawal, beneficiary *travelrule.Party, vasp *travelrule.VASP) (*TravelRuleMessage, error) {
	if w.DestinationType == "exchange" && vasp == nil {
		return nil, invalid("beneficiary_vasp is required for a transfer to another provider (destination_type exchange)")
	}
	if w.DestinationType != "exchange" && vasp != nil {
		return nil, invalid("beneficiary_vasp is only for destination_type exchange")
	}
	if t := s.cfg.TravelRuleThreshold; t > 0 && w.ValueBRL != nil && *w.ValueBRL < t {
		return nil, nil
	}
	originator, err := merchantParty(m).Person(m.ID)
	if err != nil {
		return nil, fmt.Errorf("travel rule: the merchant: %w", err)
	}
	owner := "merchant"
	b := merchantParty(m)
	if beneficiary != nil {
		b, owner = *beneficiary, "third_party"
	}
	benef, err := b.Person(w.Address)
	if err != nil {
		return nil, invalid("beneficiary: %v", err)
	}
	msg := travelrule.Message{
		Originator:      travelrule.Originator{OriginatorPerson: []travelrule.Person{originator}},
		Beneficiary:     travelrule.Beneficiary{BeneficiaryPerson: []travelrule.Person{benef}},
		OriginatingVASP: &travelrule.OriginatingVASP{OriginatingVASP: s.platformVASP()},
		PayloadMetadata: &travelrule.PayloadMetadata{PayloadVersion: travelrule.PayloadVersion},
	}
	counterparty := map[string]any{"self_hosted": true, "owner": owner}
	if vasp != nil {
		vp, err := vasp.Person()
		if err != nil {
			return nil, invalid("beneficiary_vasp: %v", err)
		}
		msg.BeneficiaryVASP = &travelrule.BeneficiaryVASP{BeneficiaryVASP: vp}
		counterparty = map[string]any{"vasp": vasp, "owner": owner}
	}
	if err := msg.Validate(s.cfg.Now()); err != nil {
		return nil, invalid("travel rule: %v", err)
	}
	// The beneficiary and its provider are screened by name too, where a list carries names.
	parties := []travelrule.Person{benef}
	if msg.BeneficiaryVASP != nil {
		parties = append(parties, msg.BeneficiaryVASP.BeneficiaryVASP)
	}
	hits, err := s.screenNames(ctx, parties)
	if err != nil {
		return nil, fmt.Errorf("%w: name screening could not be completed; nothing was sent: %v", ErrUnavailable, err)
	}
	if len(hits) > 0 {
		refused := &TravelRuleMessage{ID: ids.New("tr"), Direction: "outbound", MerchantID: m.ID, TransferID: w.ID, Asset: w.Asset, Network: w.Network, Address: w.Address,
			Memo: w.Memo, Units: w.Units, Counterparty: counterparty, Status: "refused", Reason: "name screening"}
		if err := s.saveTravel(ctx, tenantID, refused, msg); err != nil {
			return nil, err
		}
		if _, err := s.openCase(ctx, tenantID, m.ID, CaseTravelRule, ReasonNameMatch, "withdrawal:"+w.ID, "", false, w.Asset, w.Units,
			map[string]any{"matches": hits, "message": refused.ID, "note": "a withdrawal was refused: its beneficiary or receiving provider is named on a sanctions list"}); err != nil {
			return nil, err
		}
		s.log.Warn("withdrawal refused by name screening", "merchant", m.ID, "withdrawal", w.ID, "matches", hits)
		s.notify(ctx, tenantID, "compliance.party_refused", map[string]any{"merchant_id": m.ID})
		return nil, fmt.Errorf("%w: the beneficiary cannot receive transfers from the platform; nothing was sent", ErrScreened)
	}
	rec := &TravelRuleMessage{ID: ids.New("tr"), Direction: "outbound", MerchantID: m.ID, TransferID: w.ID, Asset: w.Asset, Network: w.Network, Address: w.Address,
		Memo: w.Memo, Units: w.Units, Counterparty: counterparty, Status: "self_declared"}
	var sendErr error
	if vasp != nil {
		if s.travelRule == nil {
			return nil, fmt.Errorf("%w: no travel-rule network is configured, so transfers to other providers are refused; nothing was sent", ErrDisabled)
		}
		a, err := s.travelRule.Send(ctx, travelrule.Transfer{ID: w.ID, Asset: w.Asset, Network: w.Network, Address: w.Address, Memo: w.Memo, Amount: w.Amount,
			BeneficiaryVASP: *vasp, IVMS101: msg})
		switch {
		case err != nil:
			rec.Status, rec.Reason = "unreachable", err.Error()
			sendErr = fmt.Errorf("%w: the receiving provider did not answer the travel-rule message; nothing was sent: %v", ErrUnavailable, err)
		case a.Status == travelrule.Rejected:
			rec.Status, rec.Reference, rec.Reason = "rejected", a.Reference, a.Reason
			sendErr = fmt.Errorf("%w: %s; nothing was sent", ErrTravelRuleRejected, nonEmpty(a.Reason, "the receiving provider refused the transfer"))
		default:
			rec.Status, rec.Reference = "accepted", a.Reference
		}
	}
	if err := s.saveTravel(ctx, tenantID, rec, msg); err != nil {
		return nil, err
	}
	return rec, sendErr
}

func nonEmpty(s, or string) string {
	if strings.TrimSpace(s) == "" {
		return or
	}
	return s
}

func (s *Service) saveTravel(ctx context.Context, tenantID string, rec *TravelRuleMessage, msg travelrule.Message) error {
	payload, _ := json.Marshal(msg)
	sealed, err := s.sealPII(ctx, payload, rec.ID)
	if err != nil {
		return err
	}
	stored := payload // JSONB in the clear only where there is no vault
	if sealed != "" {
		stored = nil
	}
	cp, _ := json.Marshal(rec.Counterparty)
	rec.IVMS101, rec.Object, rec.CreatedAt = payload, "travel_rule_message", s.cfg.Now().UTC().Format(time.RFC3339)
	if a, err := assets.Get(rec.Asset); err == nil {
		rec.Amount = a.Format(rec.Units)
	}
	var dep, depID *string
	if v, id, ok := strings.Cut(rec.Deposit, "/"); ok {
		dep, depID = &v, &id
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO travel_rule_messages (id, direction, tenant_id, merchant_id, transfer_id, deposit_exchange, deposit_id, asset, network, address, memo, units, txid,
		counterparty, ivms101, ivms101_sealed, status, reference, reason) VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6, $7, $8, $9, $10, $11, $12, NULLIF($13, ''), $14, $15, NULLIF($16, ''), $17, NULLIF($18, ''), NULLIF($19, ''))`,
		rec.ID, rec.Direction, tenantID, rec.MerchantID, rec.TransferID, dep, depID, rec.Asset, rec.Network, rec.Address, rec.Memo, rec.Units, rec.TxID, cp, stored, sealed, rec.Status, rec.Reference, rec.Reason)
	if err == nil {
		mTravelRule.Inc(rec.Direction, rec.Status)
	}
	return err
}

// ---------------------------------------------------------------- inbound

// ReceiveTravelRule takes a message another provider sent through the network about a
// transfer to one of the platform's addresses, usually before the coins arrive. A valid
// message is recorded and linked to its deposit as soon as both exist; the answer to the
// sender is accepted, or rejected (invalid data, an address that is not the platform's),
// which is recorded too. Delivering the same reference twice answers the first result.
func (s *Service) ReceiveTravelRule(ctx context.Context, in travelrule.Inbound) (*TravelRuleMessage, error) {
	if strings.TrimSpace(in.Reference) == "" {
		return nil, invalid("reference is required")
	}
	if prev, err := scanTravel(s.pool.QueryRow(ctx, `SELECT `+travelCols+` FROM travel_rule_messages WHERE direction = 'inbound' AND reference = $1`, in.Reference)); err == nil {
		return prev, nil
	}
	code := strings.ToUpper(strings.TrimSpace(in.Asset))
	if len(code) > 8 {
		code = code[:8] // the column's width: a code that long is refused below anyway
	}
	rec := &TravelRuleMessage{ID: ids.New("tr"), Direction: "inbound", Asset: code, Network: in.Network, Address: in.Address, TxID: in.TxID,
		Counterparty: map[string]any{"vasp": in.OriginatorVASP}, Status: "received", Reference: in.Reference}
	refuse := func(reason string) (*TravelRuleMessage, error) {
		rec.Status, rec.Reason = "refused", reason
		if err := s.saveTravel(ctx, PlatformTenant, rec, in.IVMS101); err != nil {
			return nil, err
		}
		return rec, nil
	}
	if err := in.Check(s.cfg.Now()); err != nil {
		return refuse(err.Error())
	}
	a, err := cryptoAsset(rec.Asset)
	if err != nil || !a.OnNetwork(in.Network) {
		return refuse(fmt.Sprintf("%s on %s is not an asset this provider receives", in.Asset, in.Network))
	}
	if rec.Units, err = a.Parse(in.Amount); err != nil || rec.Units <= 0 {
		return refuse("amount: a positive " + a.Code + " amount")
	}
	rec.Memo = in.Memo
	var ours bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM crypto_charges WHERE network = $1 AND address = $2)
		OR EXISTS (SELECT 1 FROM crypto_deposits WHERE network = $1 AND address = $2)`, in.Network, in.Address).Scan(&ours); err != nil {
		return nil, err
	}
	if !ours {
		return refuse("the address is not one of this provider's")
	}
	if err := s.saveTravel(ctx, PlatformTenant, rec, in.IVMS101); err != nil {
		var dup bool
		_ = s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM travel_rule_messages WHERE direction = 'inbound' AND reference = $1)`, in.Reference).Scan(&dup)
		if dup { // delivered twice at once
			return scanTravel(s.pool.QueryRow(ctx, `SELECT `+travelCols+` FROM travel_rule_messages WHERE direction = 'inbound' AND reference = $1`, in.Reference))
		}
		return nil, err
	}
	// The coins may already be here.
	var venue, depID, tenant, merchant string
	err = s.pool.QueryRow(ctx, `SELECT d.exchange, d.deposit_id, COALESCE(d.tenant_id::text, $7), COALESCE(c.merchant_id, '') FROM crypto_deposits d
		LEFT JOIN crypto_charges c ON c.payment_intent_id = d.matched_to
		WHERE d.travel_rule IN ('missing', 'not_required') AND ((d.txid IS NOT NULL AND d.txid = NULLIF($1, ''))
		   OR (d.asset = $2 AND d.network = $3 AND d.address = $4 AND d.memo = $5 AND d.units = $6))
		ORDER BY (d.txid = NULLIF($1, '')) DESC NULLS LAST, d.created_at DESC LIMIT 1`,
		in.TxID, rec.Asset, in.Network, in.Address, in.Memo, rec.Units, PlatformTenant).Scan(&venue, &depID, &tenant, &merchant)
	switch {
	case err == nil:
		if err := s.linkInbound(ctx, rec.ID, venue, depID, tenant, merchant, in.IVMS101); err != nil {
			return nil, err
		}
		// The deposit came first and was settled or held on its senders alone: a name on a
		// list now is a review (a deposit not yet recorded is held instead, in settleDeposit).
		hits, err := s.screenNames(ctx, in.IVMS101.Originator.OriginatorPerson)
		reason, detail := ReasonNameMatch, map[string]any{"message": rec.ID, "matches": hits,
			"note": "the sending provider names an originator on a sanctions list, after the deposit was recorded"}
		if err != nil {
			reason, detail = ReasonScreeningFailed, map[string]any{"message": rec.ID, "errors": []string{err.Error()},
				"note": "the originator's name could not be screened: screen it by hand"}
		}
		if err != nil || len(hits) > 0 {
			if _, err := s.openCase(ctx, tenant, merchant, CaseTravelRule, reason, "deposit:"+venue+"/"+depID, "", false, "", 0, detail); err != nil {
				return nil, err
			}
		}
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, err
	}
	return s.getTravel(ctx, rec.ID)
}

// depositTravelRule records what identification came with a deposit: a message another
// provider sent (received), the payer's declaration at the checkout (self_declared), or
// nothing (missing: above the review value, a case asks compliance to look). Missing data
// never holds the deposit: a customer paying from a self-hosted wallet is the common case at
// a counter. It returns the originators identified, for name screening.
func (s *Service) depositTravelRule(ctx context.Context, venue string, d exchange.Deposit, tenantID, merchantID, piID string, value *int64) ([]travelrule.Person, error) {
	var msgID, sealedMsg string
	var payload []byte
	err := s.pool.QueryRow(ctx, `SELECT id, ivms101, COALESCE(ivms101_sealed, '') FROM travel_rule_messages WHERE direction = 'inbound' AND status = 'received'
		AND ((txid IS NOT NULL AND txid = NULLIF($1, '')) OR (asset = $2 AND network = $3 AND address = $4 AND memo = $5 AND units = $6))
		ORDER BY (txid = NULLIF($1, '')) DESC NULLS LAST, created_at LIMIT 1`, d.TxID, d.Asset, d.Network, d.Address, d.Memo, d.Units).Scan(&msgID, &payload, &sealedMsg)
	if err == nil {
		if payload, err = s.openPII(ctx, payload, sealedMsg, msgID); err != nil {
			return nil, err
		}
		var msg travelrule.Message
		_ = json.Unmarshal(payload, &msg)
		return msg.Originator.OriginatorPerson, s.linkInbound(ctx, msgID, venue, d.ID, tenantID, merchantID, msg)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if piID != "" {
		var payer []byte
		var sealedPayer string
		if err := s.pool.QueryRow(ctx, `SELECT payer, COALESCE(payer_sealed, '') FROM crypto_charges WHERE payment_intent_id = $1 AND (payer IS NOT NULL OR payer_sealed IS NOT NULL)`,
			piID).Scan(&payer, &sealedPayer); err == nil {
			if payer, err = s.openPII(ctx, payer, sealedPayer, piID); err != nil {
				return nil, err
			}
			var p travelrule.Party
			if json.Unmarshal(payer, &p) == nil {
				orig, err := s.payerDeclaration(ctx, venue, d, tenantID, merchantID, p)
				if err != nil {
					return nil, err
				}
				_, err = s.pool.Exec(ctx, `UPDATE crypto_deposits SET travel_rule = 'self_declared' WHERE exchange = $1 AND deposit_id = $2`, venue, d.ID)
				return []travelrule.Person{orig}, err
			}
		}
	}
	if value != nil && *value < s.cfg.TravelRuleReview {
		return nil, nil // not_required
	}
	if _, err := s.pool.Exec(ctx, `UPDATE crypto_deposits SET travel_rule = 'missing' WHERE exchange = $1 AND deposit_id = $2`, venue, d.ID); err != nil {
		return nil, err
	}
	_, err = s.openCase(ctx, tenantID, merchantID, CaseTravelRule, ReasonOriginatorMissing, "deposit:"+venue+"/"+d.ID, piID, false, d.Asset, d.Units,
		map[string]any{"venue": venue, "deposit_id": d.ID, "network": d.Network, "txid": d.TxID, "value_brl": value,
			"note": "no provider sent the originator's data and the payer declared nothing: ask the merchant who paid, or record why not"})
	return nil, err
}

// payerDeclaration records what the payer declared at the checkout as the originator of a
// deposit, the merchant as its beneficiary.
func (s *Service) payerDeclaration(ctx context.Context, venue string, d exchange.Deposit, tenantID, merchantID string, p travelrule.Party) (travelrule.Person, error) {
	m, err := s.GetMerchant(ctx, tenantID, merchantID)
	if err != nil {
		return travelrule.Person{}, err
	}
	orig, err := p.Person("")
	if err != nil {
		return travelrule.Person{}, err
	}
	benef, err := merchantParty(m).Person(m.ID)
	if err != nil {
		return travelrule.Person{}, err
	}
	msg := travelrule.Message{Originator: travelrule.Originator{OriginatorPerson: []travelrule.Person{orig}},
		Beneficiary: travelrule.Beneficiary{BeneficiaryPerson: []travelrule.Person{benef}}, BeneficiaryVASP: &travelrule.BeneficiaryVASP{BeneficiaryVASP: s.platformVASP()},
		PayloadMetadata: &travelrule.PayloadMetadata{PayloadVersion: travelrule.PayloadVersion}}
	return orig, s.saveTravel(ctx, tenantID, &TravelRuleMessage{ID: ids.New("tr"), Direction: "inbound", MerchantID: merchantID, Deposit: venue + "/" + d.ID,
		Asset: d.Asset, Network: d.Network, Address: d.Address, Memo: d.Memo, Units: d.Units, TxID: d.TxID, Counterparty: map[string]any{"self_hosted": true, "declared_by": "payer"},
		Status: "self_declared"}, msg)
}

// linkInbound ties a received message to its deposit. If the message names the
// beneficiary by a document that is not the merchant's, compliance reviews it; a review
// already open because the data was missing is closed.
func (s *Service) linkInbound(ctx context.Context, msgID, venue, depID, tenantID, merchantID string, msg travelrule.Message) error {
	if _, err := s.pool.Exec(ctx, `UPDATE travel_rule_messages SET status = 'matched', deposit_exchange = $2, deposit_id = $3, tenant_id = $4, merchant_id = NULLIF($5, '')
		WHERE id = $1`, msgID, venue, depID, tenantID, merchantID); err != nil {
		return err
	}
	mTravelRule.Inc("inbound", "matched")
	if _, err := s.pool.Exec(ctx, `UPDATE crypto_deposits SET travel_rule = 'received' WHERE exchange = $1 AND deposit_id = $2`, venue, depID); err != nil {
		return err
	}
	subject := "deposit:" + venue + "/" + depID
	if _, err := s.pool.Exec(ctx, `UPDATE compliance_cases SET status = 'closed', decided_by = 'system', decision_note = 'the originator''s data arrived (' || $3 || ')',
		decided_at = now(), updated_at = now() WHERE kind = $1 AND subject = $2 AND reason = $4 AND status = 'open'`, CaseTravelRule, subject, msgID, ReasonOriginatorMissing); err != nil {
		return err
	}
	if merchantID == "" {
		return nil
	}
	m, err := s.GetMerchant(ctx, tenantID, merchantID)
	if err != nil {
		return err
	}
	ours := strings.Map(keepDigits, m.document)
	var named []string
	for _, p := range msg.Beneficiary.BeneficiaryPerson {
		if doc := p.Document(); doc != "" {
			if doc == ours {
				return nil
			}
			named = append(named, doc)
		}
	}
	if len(named) == 0 {
		return nil
	}
	_, err = s.openCase(ctx, tenantID, merchantID, CaseTravelRule, ReasonBeneficiaryMismatch, subject, "", false, "", 0,
		map[string]any{"message": msgID, "note": "the sending provider names a beneficiary whose document is not the merchant's"})
	return err
}

// ---------------------------------------------------------------- reading

func (s *Service) getTravel(ctx context.Context, id string) (*TravelRuleMessage, error) {
	return scanTravel(s.pool.QueryRow(ctx, `SELECT `+travelCols+` FROM travel_rule_messages WHERE id = $1`, id))
}

// GetTravelRule reads one of a tenant's travel-rule messages with its payload.
func (s *Service) GetTravelRule(ctx context.Context, tenantID, id string) (*TravelRuleMessage, error) {
	m, err := scanTravel(s.pool.QueryRow(ctx, `SELECT `+travelCols+` FROM travel_rule_messages WHERE tenant_id = $1 AND id = $2`, tenantID, id))
	if err != nil {
		return nil, err
	}
	return m, s.reveal(ctx, m)
}

// ListTravelRule lists a tenant's travel-rule messages, newest first, without their
// payloads; direction narrows it.
func (s *Service) ListTravelRule(ctx context.Context, tenantID, direction, startingAfter string, limit int) ([]*TravelRuleMessage, bool, error) {
	if direction != "" && direction != "outbound" && direction != "inbound" {
		return nil, false, invalid("direction is outbound or inbound")
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `SELECT `+travelCols+` FROM travel_rule_messages WHERE tenant_id = $1 AND ($2 = '' OR direction = $2)
		AND ($3 = '' OR (created_at, id) < (SELECT created_at, id FROM travel_rule_messages WHERE tenant_id = $1 AND id = $3))
		ORDER BY created_at DESC, id DESC LIMIT $4`, tenantID, direction, startingAfter, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []*TravelRuleMessage{}
	for rows.Next() {
		m, err := scanTravel(rows)
		if err != nil {
			return nil, false, err
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, nil
}
