package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/travelrule"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
)

func listed[T any](w http.ResponseWriter, data []T, more bool, cursor func(T) any) {
	var next any
	if more && len(data) > 0 {
		next = cursor(data[len(data)-1])
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": data, "has_more": more, "next_cursor": next})
}

func (s *Server) listCases(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	cs, more, err := s.svc.ListCases(r.Context(), from(r.Context()).tenantID, q.Get("status"), q.Get("starting_after"), limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	listed(w, cs, more, func(c *payments.ComplianceCase) any { return c.ID })
}

func (s *Server) getCase(w http.ResponseWriter, r *http.Request) {
	c, err := s.svc.GetCase(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) decideCase(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Action string `json:"action"` // release, block or close
		Note   string `json:"note"`
	}
	if !decode(w, r, &in) {
		return
	}
	p := from(r.Context())
	c, err := s.svc.DecideCase(r.Context(), p.tenantID, r.PathValue("id"), in.Action, in.Note, p.actor())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) listScreenings(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	before, _ := strconv.ParseInt(q.Get("starting_after"), 10, 64)
	ss, more, err := s.svc.ListScreenings(r.Context(), from(r.Context()).tenantID, q.Get("purpose"), q.Get("result"), before, limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	listed(w, ss, more, func(x *payments.Screening) any { return strconv.FormatInt(x.ID, 10) })
}

func (s *Server) listTravelRule(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	ms, more, err := s.svc.ListTravelRule(r.Context(), from(r.Context()).tenantID, q.Get("direction"), q.Get("starting_after"), limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	listed(w, ms, more, func(m *payments.TravelRuleMessage) any { return m.ID })
}

func (s *Server) getTravelRule(w http.ResponseWriter, r *http.Request) {
	m, err := s.svc.GetTravelRule(r.Context(), from(r.Context()).tenantID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

// travelRuleInbound takes a message another provider sent through the travel-rule network.
// The adapter signs each delivery like the platform's own webhooks (webhook-id,
// webhook-timestamp and webhook-signature headers, HMAC-SHA256 with the shared secret), so
// nobody else can plant identification data. The answer is the platform's to the sender:
// accepted, or rejected with the reason.
func (s *Server) travelRuleInbound(w http.ResponseWriter, r *http.Request) {
	if s.cfg.TravelRuleSecret == "" {
		problem(w, r, http.StatusServiceUnavailable, "not-configured", "Feature not configured", "no travel-rule network is configured")
		return
	}
	body, err := io.ReadAll(r.Body)
	if tooLarge(err) {
		problem(w, r, http.StatusRequestEntityTooLarge, "body-too-large", "Request body too large", "the limit is 1 MiB")
		return
	}
	if err != nil {
		problem(w, r, http.StatusBadRequest, "bad-body", "Unreadable body", "")
		return
	}
	if err := webhooks.Verify(s.cfg.TravelRuleSecret, r.Header.Get("webhook-id"), r.Header.Get("webhook-timestamp"), r.Header.Get("webhook-signature"),
		body, 5*time.Minute, time.Now()); err != nil {
		problem(w, r, http.StatusUnauthorized, "bad-signature", "The delivery is not signed by the travel-rule adapter", "")
		return
	}
	var in travelrule.Inbound
	dec := json.NewDecoder(strings.NewReader(string(body)))
	if err := dec.Decode(&in); err != nil {
		problem(w, r, http.StatusBadRequest, "bad-body", "The body is not a travel-rule message", err.Error())
		return
	}
	m, err := s.svc.ReceiveTravelRule(r.Context(), in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	status := travelrule.Accepted
	if m.Status == "refused" {
		status = travelrule.Rejected
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": status, "reference": m.ID, "reason": m.Reason})
}
