package api

import (
	"net/http"
	"strconv"

	"github.com/monolito123/Gooners/payments/platform/internal/payments"
)

// Lists and management routes for integrators (docs/02): payments, merchants, webhook
// endpoints, and the period summary behind the charts.

func list[T any](w http.ResponseWriter, data []T, more bool, cursor func(T) string) {
	var next any
	if more && len(data) > 0 {
		next = cursor(data[len(data)-1])
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": data, "has_more": more, "next_cursor": next})
}

// listIntents: GET /v1/payment-intents. An app session sees its own merchant's only.
func (s *Server) listIntents(w http.ResponseWriter, r *http.Request) {
	p := from(r.Context())
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	f := payments.IntentFilter{MerchantID: q.Get("merchant_id"), Status: q.Get("status"), Method: q.Get("method"), From: q.Get("from"), To: q.Get("to"),
		StartingAfter: q.Get("starting_after"), Limit: limit}
	if p.merchantID != "" {
		if f.MerchantID != "" && f.MerchantID != p.merchantID {
			notYours(w, r)
			return
		}
		f.MerchantID = p.merchantID
	}
	out, more, err := s.svc.ListIntents(r.Context(), p.tenantID, f)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	list(w, out, more, func(i *payments.Intent) string { return i.ID })
}

// listMerchants: GET /v1/merchants.
func (s *Server) listMerchants(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	out, more, err := s.svc.ListMerchants(r.Context(), from(r.Context()).tenantID, q.Get("status"), q.Get("starting_after"), limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	list(w, out, more, func(m *payments.Merchant) string { return m.ID })
}

// periodSummary: GET /v1/merchants/{id}/summary/period?from=&to= (Brasília days, inclusive).
func (s *Server) periodSummary(w http.ResponseWriter, r *http.Request) {
	if !owns(from(r.Context()), r.PathValue("id")) {
		notYours(w, r)
		return
	}
	q := r.URL.Query()
	sum, err := s.svc.PeriodSummary(r.Context(), from(r.Context()).tenantID, r.PathValue("id"), q.Get("from"), q.Get("to"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, sum)
}

// sandboxPixPayment: POST /v1/sandbox/pix/payments/{id}, the customer pays a Pix charge.
func (s *Server) sandboxPixPayment(w http.ResponseWriter, r *http.Request) {
	if !s.ownIntent(w, r, r.PathValue("id")) {
		return
	}
	pi, err := s.svc.SimulatePixPayment(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, pi)
}

func (s *Server) listWebhooks(w http.ResponseWriter, r *http.Request) {
	out, err := s.svc.ListWebhookEndpoints(r.Context(), from(r.Context()).tenantID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	list(w, out, false, func(e *payments.WebhookEndpoint) string { return e.ID })
}

func (s *Server) getWebhook(w http.ResponseWriter, r *http.Request) {
	e, err := s.svc.GetWebhookEndpoint(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

// deleteWebhook stops an endpoint for good (it stays listed, disabled, with its history).
func (s *Server) deleteWebhook(w http.ResponseWriter, r *http.Request) {
	p := from(r.Context())
	e, err := s.svc.DisableWebhookEndpoint(r.Context(), p.tenantID, r.PathValue("id"), p.actor())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}
