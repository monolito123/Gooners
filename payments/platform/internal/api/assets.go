package api

import (
	"net/http"

	"github.com/monolito123/Gooners/payments/platform/internal/fx"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
)

// merchantFor is the merchant a call acts for: an app session's own, or the merchant_id a
// partner names.
func (s *Server) merchantFor(w http.ResponseWriter, r *http.Request, requested string) (string, bool) {
	p := from(r.Context())
	if p.merchantID != "" {
		if requested != "" && requested != p.merchantID {
			notYours(w, r)
			return "", false
		}
		return p.merchantID, true
	}
	if requested == "" {
		problem(w, r, http.StatusUnprocessableEntity, "invalid-request", "Invalid request", "merchant_id is required")
		return "", false
	}
	return requested, true
}

func (s *Server) cryptoMarkets(w http.ResponseWriter, r *http.Request) {
	ms, err := s.svc.CryptoMarkets(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": ms})
}

func (s *Server) holdings(w http.ResponseWriter, r *http.Request) {
	m, ok := s.merchantFor(w, r, r.URL.Query().Get("merchant_id"))
	if !ok {
		return
	}
	hs, err := s.svc.Holdings(r.Context(), from(r.Context()).tenantID, m)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": hs})
}

func (s *Server) quoteConversion(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MerchantID string `json:"merchant_id"`
		Side       string `json:"side"`
		Asset      string `json:"asset"`
		BRLAmount  int64  `json:"brl_amount"`
		Amount     string `json:"amount"`
	}
	if !decode(w, r, &in) {
		return
	}
	m, ok := s.merchantFor(w, r, in.MerchantID)
	if !ok {
		return
	}
	c, err := s.svc.QuoteConversion(r.Context(), from(r.Context()).tenantID, payments.ConversionRequest{MerchantID: m, Side: in.Side, Asset: in.Asset, BRLUnits: in.BRLAmount, Amount: in.Amount})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) conversion(w http.ResponseWriter, r *http.Request, execute bool) {
	p := from(r.Context())
	c, err := s.svc.GetConversion(r.Context(), p.tenantID, r.PathValue("id"))
	if err == nil && p.merchantID != "" && c.MerchantID != p.merchantID {
		notYours(w, r)
		return
	}
	if err == nil && execute {
		c, err = s.svc.ExecuteConversion(r.Context(), p.tenantID, r.PathValue("id"))
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) getConversion(w http.ResponseWriter, r *http.Request)     { s.conversion(w, r, false) }
func (s *Server) executeConversion(w http.ResponseWriter, r *http.Request) { s.conversion(w, r, true) }

func (s *Server) cryptoWithdrawal(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MerchantID string `json:"merchant_id"`
		Asset      string `json:"asset"`
		Network    string `json:"network"`
		Address    string `json:"address"`
		Memo       string `json:"memo"`
		Amount     string `json:"amount"`
		// DestinationType is wallet (a self-hosted wallet, the default) or exchange.
		DestinationType string `json:"destination_type"`
	}
	if !decode(w, r, &in) {
		return
	}
	m, ok := s.merchantFor(w, r, in.MerchantID)
	if !ok {
		return
	}
	cw, err := s.svc.WithdrawCrypto(r.Context(), from(r.Context()).tenantID, m, in.Asset, in.Network, in.Address, in.Memo, in.Amount, in.DestinationType)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": cw.ID, "object": "crypto_withdrawal", "merchant_id": m, "asset": cw.Asset, "network": cw.Network,
		"address": cw.Address, "amount": cw.Amount, "network_fee_units": cw.FeeUnits, "venue": cw.Venue, "status": cw.Status,
		"destination_type": cw.DestinationType, "value_brl": cw.ValueBRL})
}

func (s *Server) internationalAccounts(w http.ResponseWriter, r *http.Request) {
	m, ok := s.merchantFor(w, r, r.URL.Query().Get("merchant_id"))
	if !ok {
		return
	}
	as, err := s.svc.InternationalAccounts(r.Context(), from(r.Context()).tenantID, m)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": as})
}

func (s *Server) internationalPayout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MerchantID  string         `json:"merchant_id"`
		Currency    string         `json:"currency"`
		Amount      string         `json:"amount"`
		Reference   string         `json:"reference"`
		Beneficiary fx.Beneficiary `json:"beneficiary"`
	}
	if !decode(w, r, &in) {
		return
	}
	m, ok := s.merchantFor(w, r, in.MerchantID)
	if !ok {
		return
	}
	p, err := s.svc.PayAbroad(r.Context(), from(r.Context()).tenantID, m, in.Currency, in.Amount, in.Reference, in.Beneficiary)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) investmentQuote(w http.ResponseWriter, r *http.Request) {
	q, err := s.svc.QuoteInstrument(r.Context(), r.PathValue("ticker"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, q)
}

func (s *Server) investorProfile(w http.ResponseWriter, r *http.Request) {
	p := from(r.Context())
	if r.Method == http.MethodGet {
		m, ok := s.merchantFor(w, r, r.URL.Query().Get("merchant_id"))
		if !ok {
			return
		}
		prof, err := s.svc.GetInvestorProfile(r.Context(), p.tenantID, m)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, prof)
		return
	}
	var in struct {
		MerchantID string                      `json:"merchant_id"`
		Answers    payments.SuitabilityAnswers `json:"answers"`
	}
	if !decode(w, r, &in) {
		return
	}
	m, ok := s.merchantFor(w, r, in.MerchantID)
	if !ok {
		return
	}
	prof, err := s.svc.SetInvestorProfile(r.Context(), p.tenantID, m, in.Answers)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, prof)
}

func (s *Server) investmentOrder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MerchantID string `json:"merchant_id"`
		Ticker     string `json:"ticker"`
		Side       string `json:"side"`
		Quantity   int64  `json:"quantity"`
	}
	if !decode(w, r, &in) {
		return
	}
	m, ok := s.merchantFor(w, r, in.MerchantID)
	if !ok {
		return
	}
	o, err := s.svc.Invest(r.Context(), from(r.Context()).tenantID, m, in.Ticker, in.Side, in.Quantity)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, o)
}

func (s *Server) investmentPositions(w http.ResponseWriter, r *http.Request) {
	m, ok := s.merchantFor(w, r, r.URL.Query().Get("merchant_id"))
	if !ok {
		return
	}
	ps, os, err := s.svc.Positions(r.Context(), from(r.Context()).tenantID, m)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "portfolio", "merchant_id": m, "positions": ps, "orders": os})
}

// ---------------------------------------------------------------- sandbox controls

func (s *Server) sandboxCryptoPayment(w http.ResponseWriter, r *http.Request) {
	if !s.ownIntent(w, r, r.PathValue("id")) {
		return
	}
	pi, err := s.svc.SimulateCryptoPayment(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, pi)
}

func (s *Server) sandboxInternationalCredit(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MerchantID string `json:"merchant_id"`
		Currency   string `json:"currency"`
		Amount     string `json:"amount"`
		Payer      string `json:"payer"`
	}
	if !decode(w, r, &in) {
		return
	}
	m, ok := s.merchantFor(w, r, in.MerchantID)
	if !ok {
		return
	}
	as, err := s.svc.SimulateFXCredit(r.Context(), from(r.Context()).tenantID, m, in.Currency, in.Amount, in.Payer)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": as})
}
