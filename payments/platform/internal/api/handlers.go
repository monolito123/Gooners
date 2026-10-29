package api

import (
	"encoding/base64"
	"net/http"
	"strconv"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/pricing"
)

func (s *Server) createMerchant(w http.ResponseWriter, r *http.Request) {
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
		} `json:"legal"`
		SchemeMID  string `json:"scheme_mid"`
		RootNpub   string `json:"root_npub"`
		Settlement struct {
			PixKey struct {
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
	m, err := s.svc.CreateMerchant(r.Context(), from(r.Context()).tenantID, payments.MerchantInput{
		LegalName: in.Legal.LegalName, TradeName: in.Legal.TradeName, Document: in.Legal.Document.Number, MCC: in.Legal.MCC,
		SchemeMID: in.SchemeMID, City: in.Legal.City, RootNpub: in.RootNpub, PixKey: in.Settlement.PixKey.Key, PixKeyType: in.Settlement.PixKey.Type, Plan: plan,
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) getMerchant(w http.ResponseWriter, r *http.Request) {
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
		Type            string `json:"type"`
		CertFingerprint string `json:"certificate_sha256"`
	}
	if !decode(w, r, &in) {
		return
	}
	t, err := s.svc.RegisterTerminal(r.Context(), from(r.Context()).tenantID, in.MerchantID, in.Type, in.CertFingerprint)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) createIntent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		payments.IntentInput
		PaymentMethodTypes []string `json:"payment_method_types"`
		CaptureMethod      string   `json:"capture_method"`
		Installments       *struct {
			Count int    `json:"count"`
			Type  string `json:"type"`
		} `json:"installments"`
	}
	if !decode(w, r, &in) {
		return
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
	pi, err := s.svc.CreateIntent(r.Context(), from(r.Context()).tenantID, in.IntentInput)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, pi)
}

func (s *Server) getIntent(w http.ResponseWriter, r *http.Request) {
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
	}
	if r.ContentLength != 0 && !decode(w, r, &in) {
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
	if !decode(w, r, &in) {
		return
	}
	p := from(r.Context())
	if p.terminal != "" && p.terminal != in.TerminalID {
		problem(w, r, http.StatusForbidden, "terminal-mismatch", "Certificate belongs to another terminal", "")
		return
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
	res, err := s.svc.AuthorizeTerminal(r.Context(), p.tenantID, payments.TerminalAuth{
		PaymentIntentID: in.PaymentIntentID, TerminalID: in.TerminalID, TerminalSTAN: in.STAN, LocalTime: local, Application: in.EMVApplication,
		Format: in.SRED.Format, KSN: in.SRED.KSN, Ciphertext: ct, JournalEventID: in.JournalEventID,
	})
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
	b, err := s.svc.GetBalance(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, b)
}

func (s *Server) entries(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	es, err := s.svc.Entries(r.Context(), from(r.Context()).tenantID, r.PathValue("id"), limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": es, "has_more": false})
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
	po, err := s.svc.ExecutePayout(r.Context(), from(r.Context()).tenantID, in.QuoteID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, po)
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
