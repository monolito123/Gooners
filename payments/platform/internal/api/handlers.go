package api

import (
	"bytes"
	"encoding/base64"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/pricing"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

func (s *Server) createMerchant(w http.ResponseWriter, r *http.Request) {
	// Request shape of docs/02 §8.1 (MerchantCreate), plus two platform extensions:
	// scheme_mid (assigned automatically when absent) and plan (pricing).
	var in struct {
		Legal struct {
			Document struct {
				Type   string `json:"type"`
				Number string `json:"number"`
			} `json:"document"`
			LegalName string `json:"legal_name"`
			TradeName string `json:"trade_name"`
			MCC       string `json:"mcc"`
			City      string `json:"city"`
			Address   *struct {
				Street     string `json:"street"`
				Number     string `json:"number"`
				City       string `json:"city"`
				State      string `json:"state"`
				PostalCode string `json:"postal_code"`
				Country    string `json:"country"`
			} `json:"address"`
			Representatives []map[string]any `json:"representatives"`
		} `json:"legal"`
		SchemeMID  string         `json:"scheme_mid"`
		RootNpub   string         `json:"root_npub"`
		Contact    map[string]any `json:"contact"`
		Settlement struct {
			DefaultSpeed string `json:"default_speed"`
			PixKey       struct {
				Type string `json:"type"`
				Key  string `json:"key"`
			} `json:"pix_key"`
		} `json:"settlement"`
		Plan *pricing.Plan `json:"plan"`
	}
	if !decode(w, r, &in) {
		return
	}
	plan := pricing.DefaultPlan
	if in.Plan != nil {
		plan = *in.Plan
	}
	switch in.Settlement.DefaultSpeed {
	case "instant":
		plan.Instant = true
	case "standard":
		plan.Instant = false
	}
	city := in.Legal.City
	if city == "" && in.Legal.Address != nil {
		city = in.Legal.Address.City
	}
	kyb := map[string]any{}
	if in.Legal.Address != nil {
		kyb["address"] = in.Legal.Address
	}
	if len(in.Legal.Representatives) > 0 {
		kyb["representatives"] = in.Legal.Representatives
	}
	if len(in.Contact) > 0 {
		kyb["contact"] = in.Contact
	}
	m, err := s.svc.CreateMerchant(r.Context(), from(r.Context()).tenantID, payments.MerchantInput{
		LegalName: in.Legal.LegalName, TradeName: in.Legal.TradeName, Document: in.Legal.Document.Number, MCC: in.Legal.MCC,
		SchemeMID: in.SchemeMID, City: city, RootNpub: in.RootNpub, PixKey: in.Settlement.PixKey.Key, PixKeyType: in.Settlement.PixKey.Type,
		Plan: plan, KYB: kyb,
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) getMerchant(w http.ResponseWriter, r *http.Request) {
	if !owns(from(r.Context()), r.PathValue("id")) {
		notYours(w, r)
		return
	}
	m, err := s.svc.GetMerchant(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) registerTerminal(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MerchantID      string `json:"merchant_id"`
		DeviceID        string `json:"device_id"`
		Type            string `json:"type"`
		CertFingerprint string `json:"certificate_sha256"`
		CSR             string `json:"csr"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.CSR != "" && in.CertFingerprint == "" {
		problem(w, r, http.StatusNotImplemented, "terminal-pki-not-enabled", "Certificate issuance needs the terminal PKI",
			"issue the terminal certificate after attestation (docs/05 §2.4) and register its SHA-256 as certificate_sha256")
		return
	}
	t, err := s.svc.RegisterTerminal(r.Context(), from(r.Context()).tenantID, in.MerchantID, in.Type, in.CertFingerprint)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) revokeTerminal(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Reason string `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	p := from(r.Context())
	t, err := s.svc.RevokeTerminal(r.Context(), p.tenantID, r.PathValue("id"), in.Reason, p.actor())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) listRiskReviews(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	rs, more, err := s.svc.ListRiskReviews(r.Context(), from(r.Context()).tenantID, q.Get("status"), q.Get("starting_after"), limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var next any
	if more {
		next = rs[len(rs)-1].ID
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rs, "has_more": more, "next_cursor": next})
}

func (s *Server) getRiskReview(w http.ResponseWriter, r *http.Request) {
	rv, err := s.svc.GetRiskReview(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, rv)
}

func (s *Server) resolveRiskReview(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Resolution string `json:"resolution"`
		Note       string `json:"note"`
	}
	if !decode(w, r, &in) {
		return
	}
	p := from(r.Context())
	rv, err := s.svc.ResolveRiskReview(r.Context(), p.tenantID, r.PathValue("id"), in.Resolution, in.Note, p.actor())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, rv)
}

func (s *Server) listDisputes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	ds, more, err := s.svc.ListDisputes(r.Context(), from(r.Context()).tenantID, q.Get("status"), q.Get("merchant_id"), q.Get("starting_after"), limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if ds == nil {
		ds = []*payments.Dispute{}
	}
	var next any
	if more {
		next = ds[len(ds)-1].ID
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": ds, "has_more": more, "next_cursor": next})
}

func (s *Server) getDispute(w http.ResponseWriter, r *http.Request) {
	d, err := s.svc.GetDispute(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) disputeEvidence(w http.ResponseWriter, r *http.Request) {
	var in payments.EvidenceInput
	if !decode(w, r, &in) {
		return
	}
	d, err := s.svc.SubmitEvidence(r.Context(), from(r.Context()).tenantID, r.PathValue("id"), in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) acceptDispute(w http.ResponseWriter, r *http.Request) {
	d, err := s.svc.AcceptDispute(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) createIntent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		payments.IntentInput
		PaymentMethodTypes  []string `json:"payment_method_types"`
		CaptureMethod       string   `json:"capture_method"`
		StatementDescriptor string   `json:"statement_descriptor"`
		Installments        *struct {
			Count int    `json:"count"`
			Type  string `json:"type"`
		} `json:"installments"`
		Customer map[string]any `json:"customer"` // accepted for compatibility; not stored (data minimization)
		Receipt  *struct {
			Nostr         *bool  `json:"nostr"`
			RecipientNpub string `json:"recipient_npub"`
		} `json:"receipt"`
		Splits []any `json:"splits"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Splits) > 0 {
		problem(w, r, http.StatusUnprocessableEntity, "splits-not-supported", "Split payments are not supported in this release",
			"see payments/platform/README.md, implemented subset")
		return
	}
	in.IntentInput.StatementDescriptor = in.StatementDescriptor
	if in.Receipt != nil {
		in.IntentInput.ReceiptRecipient = in.Receipt.RecipientNpub
	}
	if in.CaptureMethod != "" && in.CaptureMethod != "automatic" {
		problem(w, r, http.StatusUnprocessableEntity, "invalid-request", "Unsupported capture method", "this release captures automatically")
		return
	}
	if in.Installments != nil {
		in.IntentInput.Installments, in.IntentInput.InstallmentType = in.Installments.Count, in.Installments.Type
	}
	if in.Channel == "" && len(in.PaymentMethodTypes) == 1 && in.PaymentMethodTypes[0] == "pix" {
		in.Channel = "pix"
	}
	if p := from(r.Context()); p.merchantID != "" {
		if in.MerchantID == "" {
			in.MerchantID = p.merchantID
		}
		if in.MerchantID != p.merchantID {
			notYours(w, r)
			return
		}
	}
	pi, err := s.svc.CreateIntent(r.Context(), from(r.Context()).tenantID, in.IntentInput)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, pi)
}

func (s *Server) getIntent(w http.ResponseWriter, r *http.Request) {
	if !s.ownIntent(w, r, r.PathValue("id")) {
		return
	}
	pi, err := s.svc.GetIntent(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, pi)
}

func (s *Server) confirmIntent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PaymentMethodType string `json:"payment_method_type"`
		PaymentMethod     string `json:"payment_method"`
		Asset             string `json:"asset"`   // crypto
		Network           string `json:"network"` // crypto
	}
	if r.ContentLength != 0 && !decode(w, r, &in) {
		return
	}
	if !s.ownIntent(w, r, r.PathValue("id")) {
		return
	}
	if in.PaymentMethodType == "crypto" {
		pi, err := s.svc.ConfirmCrypto(r.Context(), from(r.Context()).tenantID, r.PathValue("id"), in.Asset, in.Network)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, pi)
		return
	}
	if in.PaymentMethodType != "" && in.PaymentMethodType != "pix" {
		problem(w, r, http.StatusNotImplemented, "card-not-present-not-enabled", "Card-not-present needs the 3DS server integration",
			"enable it after EMVCo 3DS Server certification (docs/01 §4); card-present uses POST /v1/terminal/authorizations")
		return
	}
	pi, err := s.svc.ConfirmPix(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, pi)
}

func (s *Server) captureIntent(w http.ResponseWriter, r *http.Request) {
	pi, err := s.svc.GetIntent(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if pi.Status != payments.StatusCaptured {
		problem(w, r, http.StatusConflict, "conflict", "Not capturable", "payments are captured automatically on approval")
		return
	}
	writeJSON(w, http.StatusOK, pi)
}

func (s *Server) cancelIntent(w http.ResponseWriter, r *http.Request) {
	if !s.ownIntent(w, r, r.PathValue("id")) {
		return
	}
	pi, err := s.svc.Cancel(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, pi)
}

func (s *Server) terminalAuthorization(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PaymentIntentID string `json:"payment_intent_id"`
		TerminalID      string `json:"terminal_id"`
		STAN            string `json:"stan"`
		LocalTime       string `json:"local_time"`
		EMVApplication  string `json:"emv_application"`
		SRED            struct {
			Format     string `json:"format"`
			KSN        string `json:"ksn"`
			Ciphertext string `json:"ciphertext"`
		} `json:"sred"`
		PIN        any `json:"pin"`
		DeviceRisk *struct {
			Score   float64  `json:"score"`
			Model   string   `json:"model"`
			Signals []string `json:"signals"`
		} `json:"device_risk"`
		Attestation *struct {
			VerdictToken string `json:"verdict_token"`
			ObtainedAt   string `json:"obtained_at"`
		} `json:"attestation"`
		JournalEventID string `json:"journal_event_id"`
	}
	// The exact bytes are kept: an iPhone's App Attest assertion signs them.
	raw, err := io.ReadAll(r.Body)
	if tooLarge(err) {
		problem(w, r, http.StatusRequestEntityTooLarge, "body-too-large", "Request body too large", "the limit is 1 MiB")
		return
	}
	if err != nil {
		problem(w, r, http.StatusBadRequest, "bad-body", "Unreadable body", "")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	if !decode(w, r, &in) {
		return
	}
	p := from(r.Context())
	if p.terminal != "" && p.terminal != in.TerminalID {
		problem(w, r, http.StatusForbidden, "terminal-mismatch", "Certificate belongs to another terminal", "")
		return
	}
	if p.sessionID != "" && (p.deviceTerminal == "" || p.deviceTerminal != in.TerminalID) {
		problem(w, r, http.StatusForbidden, "terminal-mismatch", "A device may only use its own terminal", "")
		return
	}
	if !s.ownIntent(w, r, in.PaymentIntentID) {
		return
	}
	if p.sessionID != "" {
		assertion, err := base64.StdEncoding.DecodeString(r.Header.Get("App-Attest-Assertion"))
		if err != nil {
			problem(w, r, http.StatusBadRequest, "bad-assertion", "App-Attest-Assertion must be base64", "")
			return
		}
		if err := s.svc.CheckAssertion(r.Context(), p.tenantID, p.deviceID, raw, assertion); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	ct, err := base64.StdEncoding.DecodeString(in.SRED.Ciphertext)
	if err != nil {
		problem(w, r, http.StatusBadRequest, "bad-ciphertext", "sred.ciphertext must be base64", "")
		return
	}
	local := time.Time{}
	if in.LocalTime != "" {
		if local, err = time.Parse(time.RFC3339, in.LocalTime); err != nil {
			problem(w, r, http.StatusBadRequest, "bad-local-time", "local_time must be RFC 3339", "")
			return
		}
	}
	ta := payments.TerminalAuth{
		PaymentIntentID: in.PaymentIntentID, TerminalID: in.TerminalID, TerminalSTAN: in.STAN, LocalTime: local, Application: in.EMVApplication,
		Format: in.SRED.Format, KSN: in.SRED.KSN, Ciphertext: ct, JournalEventID: in.JournalEventID,
	}
	if in.DeviceRisk != nil {
		if ta.Device, err = payments.DeviceRisk(in.DeviceRisk.Score, in.DeviceRisk.Model, in.DeviceRisk.Signals); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	res, err := s.svc.AuthorizeTerminal(r.Context(), p.tenantID, ta)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) createRefund(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PaymentIntentID string            `json:"payment_intent_id"`
		Amount          int64             `json:"amount"`
		Reason          string            `json:"reason"`
		Metadata        map[string]string `json:"metadata"`
	}
	if !decode(w, r, &in) {
		return
	}
	ref, err := s.svc.CreateRefund(r.Context(), from(r.Context()).tenantID, in.PaymentIntentID, in.Amount)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, ref)
}

func (s *Server) getRefund(w http.ResponseWriter, r *http.Request) {
	ref, err := s.svc.GetRefund(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, ref)
}

func (s *Server) balance(w http.ResponseWriter, r *http.Request) {
	if !s.ownAccount(w, r, r.PathValue("id")) {
		return
	}
	b, err := s.svc.GetBalance(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, b)
}

func (s *Server) entries(w http.ResponseWriter, r *http.Request) {
	if !s.ownAccount(w, r, r.PathValue("id")) {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	es, more, err := s.svc.Entries(r.Context(), from(r.Context()).tenantID, r.PathValue("id"), limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": es, "has_more": more})
}

func (s *Server) quote(w http.ResponseWriter, r *http.Request) {
	var in struct {
		AccountID   string               `json:"account_id"`
		Amount      int64                `json:"amount"`
		Speed       string               `json:"speed"`
		Destination payments.Destination `json:"destination"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !s.ownAccount(w, r, in.AccountID) {
		return
	}
	q, err := s.svc.QuotePayout(r.Context(), from(r.Context()).tenantID, in.AccountID, in.Amount, in.Destination)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, q)
}

func (s *Server) payout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		QuoteID string `json:"quote_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if p := from(r.Context()); p.merchantID != "" {
		m, err := s.svc.QuoteMerchant(r.Context(), p.tenantID, in.QuoteID)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		if m != p.merchantID {
			notYours(w, r)
			return
		}
	}
	po, err := s.svc.ExecutePayout(r.Context(), from(r.Context()).tenantID, in.QuoteID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, po)
}

func (s *Server) replayWebhooks(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Since time.Time `json:"since"`
		Until time.Time `json:"until"`
	}
	if !decode(w, r, &in) {
		return
	}
	n, err := s.svc.ReplayWebhooks(r.Context(), from(r.Context()).tenantID, r.PathValue("id"), in.Since, in.Until)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"replayed": n})
}

func (s *Server) createWebhook(w http.ResponseWriter, r *http.Request) {
	var in struct {
		URL             string   `json:"url"`
		Events          []string `json:"events"`
		SignatureScheme string   `json:"signature_scheme"`
	}
	if !decode(w, r, &in) {
		return
	}
	e, err := s.svc.CreateWebhookEndpoint(r.Context(), from(r.Context()).tenantID, in.URL, in.Events)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, e)
}

// ---------------------------------------------------------------- settlements and transparency

func (s *Server) listSettlements(w http.ResponseWriter, r *http.Request) {
	p, q := from(r.Context()), r.URL.Query()
	merchant := q.Get("merchant_id")
	if p.merchantID != "" {
		if merchant != "" && merchant != p.merchantID {
			notYours(w, r)
			return
		}
		merchant = p.merchantID // an app session sees only its own merchant
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	sts, more, err := s.svc.ListSettlements(r.Context(), p.tenantID, merchant, q.Get("starting_after"), limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if sts == nil {
		sts = []*payments.Settlement{}
	}
	var next any
	if more {
		next = sts[len(sts)-1].ID
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": sts, "has_more": more, "next_cursor": next})
}

// ownSettlement loads a settlement the caller may read.
func (s *Server) ownSettlement(w http.ResponseWriter, r *http.Request) (*payments.Settlement, bool) {
	p := from(r.Context())
	st, err := s.svc.GetSettlement(r.Context(), p.tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return nil, false
	}
	if !owns(p, st.MerchantID) {
		notYours(w, r)
		return nil, false
	}
	return st, true
}

func (s *Server) getSettlement(w http.ResponseWriter, r *http.Request) {
	if st, ok := s.ownSettlement(w, r); ok {
		writeJSON(w, http.StatusOK, st)
	}
}

func (s *Server) settlementStatement(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.ownSettlement(w, r); !ok {
		return
	}
	ev, err := s.svc.StatementEvent(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, ev)
}

func (s *Server) settlementProof(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.ownSettlement(w, r); !ok {
		return
	}
	proof, err := s.svc.SettlementProof(r.Context(), from(r.Context()).tenantID, r.PathValue("id"), r.PathValue("receipt_event_id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, proof)
}

// transparencyRoot serves a day's public root without authentication: it is published to
// public relays anyway, and anyone may verify a merchant's proof against it.
func (s *Server) transparencyRoot(w http.ResponseWriter, r *http.Request) {
	root, err := s.svc.GetTransparencyRoot(r.Context(), r.PathValue("date"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, root)
}

// ---------------------------------------------------------------- terminal journal

// postJournal takes a device's signed journal entries (docs/03 §7). Only enrolled devices
// keep a journal: the entries must be signed by the session's own device key.
func (s *Server) postJournal(w http.ResponseWriter, r *http.Request) {
	p := from(r.Context())
	if p.deviceID == "" {
		problem(w, r, http.StatusForbidden, "forbidden", "Journal entries come from enrolled devices", "log in with the device key (POST /v1/auth/nostr)")
		return
	}
	var in struct {
		Entries []nostr.Event `json:"entries"`
	}
	if !decode(w, r, &in) {
		return
	}
	st, err := s.svc.IngestJournal(r.Context(), p.tenantID, p.merchantID, p.deviceID, in.Entries)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) journalState(w http.ResponseWriter, r *http.Request) {
	p := from(r.Context())
	if p.deviceID == "" {
		problem(w, r, http.StatusForbidden, "forbidden", "Journal state is per device", "")
		return
	}
	st, err := s.svc.JournalState(r.Context(), p.tenantID, p.merchantID, p.deviceID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) intentJournal(w http.ResponseWriter, r *http.Request) {
	if !s.ownIntent(w, r, r.PathValue("id")) {
		return
	}
	if _, err := s.svc.GetIntent(r.Context(), from(r.Context()).tenantID, r.PathValue("id")); err != nil {
		s.fail(w, r, err) // an unknown payment is a 404, not an empty journal
		return
	}
	evs, err := s.svc.IntentJournal(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": evs})
}
