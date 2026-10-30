package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/mobileauth"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
)

// owns reports whether the caller may act for merchantID: partners (API keys) act for every
// merchant of their tenant, an app session only for its own.
func owns(p principal, merchantID string) bool {
	return p.merchantID == "" || p.merchantID == merchantID
}

// notYours answers like an unknown resource, so a session cannot probe other merchants.
func notYours(w http.ResponseWriter, r *http.Request) {
	problem(w, r, http.StatusNotFound, "not-found", "Not found", "")
}

// ownIntent loads a payment intent and checks the caller may act on it.
func (s *Server) ownIntent(w http.ResponseWriter, r *http.Request, id string) bool {
	p := from(r.Context())
	if p.merchantID == "" {
		return true
	}
	pi, err := s.svc.GetIntent(r.Context(), p.tenantID, id)
	if err != nil {
		s.fail(w, r, err)
		return false
	}
	if pi.MerchantID != p.merchantID {
		notYours(w, r)
		return false
	}
	return true
}

func (s *Server) ownAccount(w http.ResponseWriter, r *http.Request, accountID string) bool {
	p := from(r.Context())
	if p.merchantID == "" {
		return true
	}
	m, err := s.svc.AccountMerchant(r.Context(), p.tenantID, accountID)
	if err != nil {
		s.fail(w, r, err)
		return false
	}
	if m != p.merchantID {
		notYours(w, r)
		return false
	}
	return true
}

// countFailure applies the failed-authentication throttle to the open routes; it reports
// whether the caller is now throttled (and has been answered).
func (s *Server) countFailure(w http.ResponseWriter, r *http.Request) bool {
	if ok, wait := s.failures.take(clientIP(r, s.cfg.TrustProxy)); !ok {
		w.Header().Set("Retry-After", retryAfter(wait))
		problem(w, r, http.StatusTooManyRequests, "rate-limited", "Too many failed authentications", "")
		return true
	}
	return false
}

// loginNostr serves POST /v1/auth/nostr (docs/02 §3.2).
func (s *Server) loginNostr(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if tooLarge(err) || len(body) > 4096 {
		problem(w, r, http.StatusRequestEntityTooLarge, "body-too-large", "Request body too large", "")
		return
	}
	ev, err := mobileauth.VerifyNIP98(r.Header.Get("Authorization"), r.Method, s.requestURL(r), body, time.Now())
	if err != nil {
		if !s.countFailure(w, r) {
			problem(w, r, http.StatusUnauthorized, "unauthorized", "Invalid NIP-98 login", err.Error())
		}
		return
	}
	var in struct {
		DPoPJWK  mobileauth.JWK `json:"dpop_jwk"`
		DeviceID string         `json:"device_id"`
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		problem(w, r, http.StatusBadRequest, "bad-json", "Malformed JSON", err.Error())
		return
	}
	sess, err := s.svc.Login(r.Context(), ev, in.DeviceID, in.DPoPJWK)
	if errors.Is(err, mobileauth.ErrUnauthorized) {
		if !s.countFailure(w, r) {
			problem(w, r, http.StatusUnauthorized, "unauthorized", "Login refused", err.Error())
		}
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

func enrollmentCode(r *http.Request) string {
	c, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Enrollment ")
	return c
}

// getEnrollment serves GET /v1/enrollment: what the phone needs to build its device list.
func (s *Server) getEnrollment(w http.ResponseWriter, r *http.Request) {
	_, e, err := s.svc.LookupEnrollment(r.Context(), enrollmentCode(r))
	if err != nil {
		if errors.Is(err, mobileauth.ErrUnauthorized) && s.countFailure(w, r) {
			return
		}
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

// enroll serves POST /v1/enrollment: the phone registers itself with a single-use code.
func (s *Server) enroll(w http.ResponseWriter, r *http.Request) {
	if _, _, err := s.svc.LookupEnrollment(r.Context(), enrollmentCode(r)); err != nil {
		if errors.Is(err, mobileauth.ErrUnauthorized) && s.countFailure(w, r) {
			return
		}
		s.fail(w, r, err)
		return
	}
	var in payments.DeviceInput
	if !decode(w, r, &in) {
		return
	}
	d, err := s.svc.Enroll(r.Context(), enrollmentCode(r), in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

// registerDevice serves POST /v1/merchants/{id}/devices for partners and for the owner's
// app session (the root-signed device list is the authority).
func (s *Server) registerDevice(w http.ResponseWriter, r *http.Request) {
	p := from(r.Context())
	if !owns(p, r.PathValue("id")) {
		notYours(w, r)
		return
	}
	var in payments.DeviceInput
	if !decode(w, r, &in) {
		return
	}
	d, err := s.svc.RegisterDevice(r.Context(), p.tenantID, r.PathValue("id"), in, p.actor(), false)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func (s *Server) createEnrollmentCode(w http.ResponseWriter, r *http.Request) {
	p := from(r.Context())
	if !owns(p, r.PathValue("id")) {
		notYours(w, r)
		return
	}
	c, err := s.svc.CreateEnrollmentCode(r.Context(), p.tenantID, r.PathValue("id"), p.actor())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}
