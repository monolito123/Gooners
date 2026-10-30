// Package api is the platform's HTTP API (docs/02-api-reference.md, api/openapi.yaml):
// API-key and certificate authentication, idempotency keys, Problem Details errors.
package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
	"github.com/monolito123/Gooners/payments/platform/internal/mobileauth"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/pkg/apipix"
)

// Config of the API server.
type Config struct {
	Env string // sandbox or production
	// Per-credential rate limit (requests per second and burst) on this replica. The edge
	// enforces the global limits; this one stops a single key from starving the others.
	RatePerSecond, RateBurst float64
	// Failed authentications allowed per client IP and minute before 429.
	AuthFailuresPerMinute float64
	// TrustProxy takes the client IP from the last X-Forwarded-For entry (behind the edge).
	TrustProxy bool
	// PublicURL is the API's external base URL (https://api.goonerspay.example). NIP-98 events
	// and DPoP proofs sign the exact URL, so it must be what clients call. Empty in the
	// sandbox: derived from the request.
	PublicURL string
}

// MaxBody is the largest request body accepted.
const MaxBody = 1 << 20

// Server serves the API.
type Server struct {
	cfg      Config
	svc      *payments.Service
	pool     *pgxpool.Pool
	log      *slog.Logger
	perKey   *limiter
	failures *limiter
}

// New returns a server.
func New(cfg Config, svc *payments.Service, pool *pgxpool.Pool, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	if cfg.RatePerSecond == 0 {
		cfg.RatePerSecond, cfg.RateBurst = 50, 100
	}
	if cfg.RateBurst == 0 {
		cfg.RateBurst = 2 * cfg.RatePerSecond
	}
	if cfg.AuthFailuresPerMinute == 0 {
		cfg.AuthFailuresPerMinute = 30
	}
	return &Server{cfg: cfg, svc: svc, pool: pool, log: log,
		perKey: newLimiter(cfg.RatePerSecond, cfg.RateBurst), failures: newLimiter(cfg.AuthFailuresPerMinute/60, cfg.AuthFailuresPerMinute)}
}

type principal struct {
	tenantID string
	scopes   map[string]bool
	terminal string // set when authenticated by a terminal certificate
	keyID    string // set when authenticated by an API key
	// A merchant app session: limited to this merchant, this device and its terminal.
	sessionID, merchantID, deviceID, deviceTerminal string
}

// limitKey identifies the credential for rate limiting.
func (p principal) limitKey() string {
	switch {
	case p.terminal != "":
		return "terminal:" + p.tenantID + ":" + p.terminal
	case p.sessionID != "":
		return "device:" + p.deviceID
	}
	return "key:" + p.keyID
}

// actor names the caller in the audit trail.
func (p principal) actor() string {
	switch {
	case p.terminal != "":
		return "terminal:" + p.terminal
	case p.sessionID != "":
		return "device:" + p.deviceID
	}
	return "api:" + p.keyID
}

type ctxKey struct{}

func from(ctx context.Context) principal { p, _ := ctx.Value(ctxKey{}).(principal); return p }

// Handler returns the routed API.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("GET /readyz", s.ready)

	route := func(pattern, scope string, idem bool, h http.HandlerFunc) {
		if idem {
			h = s.idempotent(h)
		}
		mux.Handle(pattern, instrument(pattern, s.authenticate(scope, sessionRoutes[pattern], h)))
	}
	open := func(pattern string, h http.HandlerFunc) { mux.Handle(pattern, instrument(pattern, h)) }
	open("POST /v1/auth/nostr", s.loginNostr)
	open("GET /v1/enrollment", s.getEnrollment)
	open("POST /v1/enrollment", s.enroll)
	route("POST /v1/merchants/{id}/devices", "merchants:write", true, s.registerDevice)
	route("POST /v1/merchants/{id}/enrollment-codes", "merchants:write", true, s.createEnrollmentCode)
	route("POST /v1/merchants", "merchants:write", true, s.createMerchant)
	route("GET /v1/merchants/{id}", "merchants:write", false, s.getMerchant)
	route("POST /v1/terminals", "merchants:write", true, s.registerTerminal)
	route("POST /v1/terminals/{id}/revoke", "merchants:write", true, s.revokeTerminal)
	route("POST /v1/payment-intents", "payments:write", true, s.createIntent)
	route("GET /v1/payment-intents/{id}", "payments:read", false, s.getIntent)
	route("POST /v1/payment-intents/{id}/confirm", "payments:write", true, s.confirmIntent)
	route("POST /v1/payment-intents/{id}/capture", "payments:write", true, s.captureIntent)
	route("POST /v1/payment-intents/{id}/cancel", "payments:write", true, s.cancelIntent)
	route("POST /v1/terminal/authorizations", "terminal", false, s.terminalAuthorization)
	route("POST /v1/refunds", "refunds:write", true, s.createRefund)
	route("GET /v1/refunds/{id}", "payments:read", false, s.getRefund)
	route("GET /v1/accounts/{id}/balance", "accounts:read", false, s.balance)
	route("GET /v1/accounts/{id}/entries", "accounts:read", false, s.entries)
	route("POST /v1/payouts/quotes", "payouts:write", true, s.quote)
	route("POST /v1/payouts", "payouts:write", true, s.payout)
	route("GET /v1/disputes", "disputes:write", false, s.listDisputes)
	route("GET /v1/disputes/{id}", "disputes:write", false, s.getDispute)
	route("POST /v1/disputes/{id}/evidence", "disputes:write", true, s.disputeEvidence)
	route("POST /v1/disputes/{id}/accept", "disputes:write", true, s.acceptDispute)
	route("POST /v1/webhook-endpoints", "webhooks:write", true, s.createWebhook)
	route("POST /v1/webhook-endpoints/{id}/replay", "webhooks:write", true, s.replayWebhooks)
	return s.recover(s.requestID(secureHeaders(limitBody(cleanInput(mux)))))
}

// sessionRoutes are the only routes a merchant app session may call. Each handler also
// holds the session to its own merchant (ownership checks in handlers.go).
var sessionRoutes = map[string]bool{
	"GET /v1/merchants/{id}":                   true,
	"POST /v1/merchants/{id}/devices":          true,
	"POST /v1/merchants/{id}/enrollment-codes": true,
	"POST /v1/payment-intents":                 true,
	"GET /v1/payment-intents/{id}":             true,
	"POST /v1/payment-intents/{id}/confirm":    true,
	"POST /v1/payment-intents/{id}/cancel":     true,
	"POST /v1/terminal/authorizations":         true,
	"GET /v1/accounts/{id}/balance":            true,
	"GET /v1/accounts/{id}/entries":            true,
	"POST /v1/payouts/quotes":                  true,
	"POST /v1/payouts":                         true,
}

// PixWebhookHandler serves the PSP's notifications at {webhookUrl}/pix. Mount it on a
// listener that requires the PSP's client certificate.
func (s *Server) PixWebhookHandler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("POST /pix", apipix.WebhookHandler(s.svc.OnPix, s.log))
	return mux
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.pool.Ping(ctx); err != nil {
		s.log.Error("readiness", "err", err) // the cause stays in the logs: this endpoint is unauthenticated
		problem(w, r, http.StatusServiceUnavailable, "not-ready", "Not ready", "")
		return
	}
	w.WriteHeader(http.StatusOK)
}

// ---------------------------------------------------------------- middleware

var (
	mRequests = metrics.Default.Counter("goonerspay_http_requests_total", "API requests by route and status code.", "route", "code")
	mSeconds  = metrics.Default.Counter("goonerspay_http_request_seconds_total", "Time spent serving API requests, by route.", "route")
)

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (w *statusWriter) WriteHeader(code int) {
	if w.code == 0 {
		w.code = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.code == 0 {
		w.code = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

// instrument counts requests per route pattern (never per raw path, which holds IDs).
func instrument(pattern string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		mRequests.Inc(pattern, strconv.Itoa(sw.code))
		mSeconds.Add(time.Since(start).Seconds(), pattern)
	})
}

func (s *Server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := ids.New("req")
		w.Header().Set("Request-Id", id)
		next.ServeHTTP(w, r)
	})
}

// secureHeaders marks every response as non-cacheable, non-sniffable JSON that no page may
// frame or load resources for. HSTS is set when the request arrived over TLS.
func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Cache-Control", "no-store")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("Referrer-Policy", "no-referrer")
		if r.TLS != nil {
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

// limitBody caps request bodies; handlers answer 413 when the cap is hit.
func limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, MaxBody)
		next.ServeHTTP(w, r)
	})
}

// cleanInput refuses paths and query strings that are not valid UTF-8 or contain NUL:
// PostgreSQL rejects those bytes, and they have no business in an identifier or a filter.
func cleanInput(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, v := range []string{r.URL.Path, r.URL.RawQuery} {
			if u, err := url.PathUnescape(v); err != nil || !utf8.ValidString(u) || strings.ContainsRune(u, 0) {
				problem(w, r, http.StatusBadRequest, "bad-request", "Invalid characters in the URL", "")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func tooLarge(err error) bool {
	var mbe *http.MaxBytesError
	return errors.As(err, &mbe)
}

func (s *Server) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.log.Error("panic", "path", r.URL.Path, "panic", fmt.Sprint(v))
				problem(w, r, http.StatusInternalServerError, "internal", "Internal error", "")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// NewAPIKey creates an API key for a tenant and returns it (only its hash is stored).
func NewAPIKey(ctx context.Context, pool *pgxpool.Pool, tenantID, name string, scopes []string, live bool) (string, error) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	var sb strings.Builder
	if live {
		sb.WriteString("sk_live_")
	} else {
		sb.WriteString("sk_test_")
	}
	for i := 0; i < 32; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		sb.WriteByte(alphabet[n.Int64()])
	}
	key := sb.String()
	_, err := pool.Exec(ctx, `INSERT INTO api_clients (key_hash, tenant_id, name, scopes) VALUES ($1, $2, $3, $4)`, hashKey(key), tenantID, name, scopes)
	return key, err
}

func hashKey(k string) string { h := sha256.Sum256([]byte(k)); return hex.EncodeToString(h[:]) }

// CertFingerprint is the SHA-256 of a DER certificate, hex.
func CertFingerprint(der []byte) string { h := sha256.Sum256(der); return hex.EncodeToString(h[:]) }

func (s *Server) authenticate(scope string, sessionOK bool, next http.HandlerFunc) http.Handler {
	authenticated := func(w http.ResponseWriter, r *http.Request, p principal) {
		if ok, wait := s.perKey.take(p.limitKey()); !ok {
			w.Header().Set("Retry-After", retryAfter(wait))
			problem(w, r, http.StatusTooManyRequests, "rate-limited", "Too many requests", "slow down and retry after the Retry-After delay")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, p)))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only failed attempts count against the client's IP, so a client sharing an address
		// (carrier-grade NAT) with an attacker is never locked out with a valid credential.
		unauthorized := func(code, title, detail string) {
			if ok, wait := s.failures.take(clientIP(r, s.cfg.TrustProxy)); !ok {
				w.Header().Set("Retry-After", retryAfter(wait))
				problem(w, r, http.StatusTooManyRequests, "rate-limited", "Too many failed authentications", "")
				return
			}
			problem(w, r, http.StatusUnauthorized, code, title, detail)
		}
		// Terminals authenticate with their mutual-TLS certificate.
		if scope == "terminal" && r.TLS != nil && len(r.TLS.VerifiedChains) > 0 {
			tenant, terminal, err := s.svc.TerminalByFingerprint(r.Context(), CertFingerprint(r.TLS.PeerCertificates[0].Raw))
			if err != nil {
				unauthorized("unknown-terminal", "Unknown terminal certificate", "")
				return
			}
			authenticated(w, r, principal{tenantID: tenant, terminal: terminal})
			return
		}
		// Merchant apps: a session token bound to a DPoP key (docs/02 §3.2).
		if token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "DPoP "); ok {
			p, err := s.sessionPrincipal(r, token)
			if err != nil {
				unauthorized("unauthorized", "Invalid session", err.Error())
				return
			}
			if !sessionOK {
				problem(w, r, http.StatusForbidden, "forbidden", "Not available to app sessions", "")
				return
			}
			if scope == "terminal" {
				if s.cfg.Env == "production" {
					problem(w, r, http.StatusUnauthorized, "terminal-certificate-required", "Terminal certificate required", "card-present authorizations need the terminal's mutual-TLS certificate")
					return
				}
				scope = "payments:write"
			}
			if scope != "merchants:write" && !p.scopes[scope] { // merchants:write routes check ownership instead
				problem(w, r, http.StatusForbidden, "forbidden", "Missing scope", scope)
				return
			}
			authenticated(w, r, p)
			return
		}
		key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if key == "" || key == r.Header.Get("Authorization") {
			unauthorized("unauthorized", "Missing API key", "send Authorization: Bearer <key>")
			return
		}
		var tenant string
		var scopes []string
		err := s.pool.QueryRow(r.Context(), `SELECT tenant_id::text, scopes FROM api_clients WHERE key_hash = $1 AND revoked_at IS NULL`, hashKey(key)).Scan(&tenant, &scopes)
		if err != nil {
			unauthorized("unauthorized", "Invalid API key", "")
			return
		}
		p := principal{tenantID: tenant, scopes: map[string]bool{}, keyID: payments.APIKeyID(hashKey(key))}
		for _, sc := range scopes {
			p.scopes[sc] = true
		}
		if scope == "terminal" {
			// Without a certificate, terminals may use an API key only in the sandbox.
			if s.cfg.Env == "production" {
				problem(w, r, http.StatusUnauthorized, "terminal-certificate-required", "Terminal certificate required", "card-present authorizations need the terminal's mutual-TLS certificate")
				return
			}
			scope = "payments:write"
		}
		if !p.scopes[scope] && !p.scopes["*"] {
			problem(w, r, http.StatusForbidden, "forbidden", "Missing scope", scope)
			return
		}
		authenticated(w, r, p)
	})
}

// requestURL is the URL a NIP-98 event or DPoP proof must name: the public base URL and the
// path, without query or fragment.
func (s *Server) requestURL(r *http.Request) string {
	if s.cfg.PublicURL != "" {
		return strings.TrimSuffix(s.cfg.PublicURL, "/") + r.URL.Path
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if s.cfg.TrustProxy && r.Header.Get("X-Forwarded-Proto") != "" {
		scheme = r.Header.Get("X-Forwarded-Proto")
	}
	return scheme + "://" + r.Host + r.URL.Path
}

// sessionPrincipal authenticates "Authorization: DPoP <token>" with its "DPoP" proof: the
// proof must be signed by the key the session is bound to, for this method and URL, and its
// jti must be new.
func (s *Server) sessionPrincipal(r *http.Request, token string) (principal, error) {
	si, err := s.svc.SessionByToken(r.Context(), token)
	if err != nil {
		return principal{}, err
	}
	proof, err := mobileauth.VerifyDPoP(r.Header.Get("DPoP"), r.Method, s.requestURL(r), token, time.Now())
	if err != nil {
		return principal{}, err
	}
	if proof.JKT != si.JKT {
		return principal{}, fmt.Errorf("%w: the DPoP key is not the session's key", mobileauth.ErrUnauthorized)
	}
	if ok, err := s.svc.ConsumeNonce(r.Context(), "dpop:"+si.JKT+":"+proof.JTI, 2*mobileauth.MaxSkew); err != nil || !ok {
		if err != nil {
			return principal{}, err
		}
		return principal{}, fmt.Errorf("%w: the DPoP proof was already used", mobileauth.ErrUnauthorized)
	}
	p := principal{tenantID: si.TenantID, scopes: map[string]bool{}, sessionID: si.ID, merchantID: si.MerchantID, deviceID: si.DeviceID, deviceTerminal: si.TerminalID}
	for _, sc := range si.Scopes {
		p.scopes[sc] = true
	}
	return p, nil
}

type recorder struct {
	http.ResponseWriter
	status int
	buf    bytes.Buffer
}

func (r *recorder) WriteHeader(code int) { r.status = code; r.ResponseWriter.WriteHeader(code) }
func (r *recorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	r.buf.Write(b)
	return r.ResponseWriter.Write(b)
}

// idempotent implements docs/02 §1.4: replay the stored response for a repeated key with the
// same body, 409 while the first request runs, 422 when the key is reused with another body.
func (s *Server) idempotent(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Idempotency-Key")
		if len(key) < 8 || len(key) > 64 {
			problem(w, r, http.StatusBadRequest, "idempotency-key-required", "Idempotency-Key header required", "8 to 64 characters")
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
		r.Body = io.NopCloser(bytes.NewReader(body))
		h := sha256.Sum256(append([]byte(r.Method+" "+r.URL.Path+"\n"), body...))
		hash := hex.EncodeToString(h[:])
		tenant := from(r.Context()).tenantID
		tag, err := s.pool.Exec(r.Context(), `INSERT INTO idempotency_keys (tenant_id, key, request_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, tenant, key, hash)
		if err != nil {
			problem(w, r, http.StatusInternalServerError, "internal", "Internal error", "")
			return
		}
		if tag.RowsAffected() == 0 {
			var stored string
			var code *int
			var resp []byte
			if err := s.pool.QueryRow(r.Context(), `SELECT request_hash, status_code, response_body FROM idempotency_keys WHERE tenant_id = $1 AND key = $2`, tenant, key).Scan(&stored, &code, &resp); err != nil {
				problem(w, r, http.StatusInternalServerError, "internal", "Internal error", "")
				return
			}
			switch {
			case stored != hash:
				problem(w, r, http.StatusUnprocessableEntity, "idempotency-key-reused", "Idempotency key reused with a different request", "")
			case code == nil:
				w.Header().Set("Retry-After", "1")
				problem(w, r, http.StatusConflict, "idempotency-in-progress", "A request with this key is still in progress", "")
			default:
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Idempotent-Replayed", "true")
				w.WriteHeader(*code)
				_, _ = w.Write(resp)
			}
			return
		}
		rec := &recorder{ResponseWriter: w}
		next(rec, r)
		if rec.status >= 500 {
			// Server errors are not stored, so the client can retry with the same key.
			_, _ = s.pool.Exec(context.WithoutCancel(r.Context()), `DELETE FROM idempotency_keys WHERE tenant_id = $1 AND key = $2`, tenant, key)
			return
		}
		_, _ = s.pool.Exec(context.WithoutCancel(r.Context()), `UPDATE idempotency_keys SET status_code = $3, response_body = $4 WHERE tenant_id = $1 AND key = $2`, tenant, key, rec.status, rec.buf.Bytes())
	}
}

// ---------------------------------------------------------------- responses

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func problem(w http.ResponseWriter, r *http.Request, status int, code, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type": "https://docs.goonerspay.example/errors/" + code, "title": title, "status": status, "code": strings.ReplaceAll(code, "-", "_"),
		"detail": detail, "instance": r.URL.Path, "request_id": w.Header().Get("Request-Id"),
	})
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	var pe *apipix.Error
	switch {
	case errors.Is(err, payments.ErrNotFound), errors.Is(err, pgx.ErrNoRows):
		problem(w, r, http.StatusNotFound, "not-found", "Not found", err.Error())
	case errors.Is(err, payments.ErrInvalid):
		problem(w, r, http.StatusUnprocessableEntity, "invalid-request", "Invalid request", err.Error())
	case errors.Is(err, mobileauth.ErrUnauthorized):
		problem(w, r, http.StatusUnauthorized, "unauthorized", "Unauthorized", err.Error())
	case errors.Is(err, payments.ErrMerchantInactive):
		problem(w, r, http.StatusConflict, "merchant-not-active", "The merchant is not active", err.Error())
	case errors.Is(err, payments.ErrConflict):
		problem(w, r, http.StatusConflict, "conflict", "Conflict", err.Error())
	case errors.Is(err, payments.ErrFunds):
		problem(w, r, http.StatusUnprocessableEntity, "insufficient-funds", "Insufficient funds", err.Error())
	case errors.Is(err, payments.ErrDeclined):
		problem(w, r, http.StatusPaymentRequired, "card-declined", "The card was declined", err.Error())
	case errors.Is(err, payments.ErrExpired):
		problem(w, r, http.StatusGone, "expired", "Expired", err.Error())
	case errors.Is(err, payments.ErrDisabled):
		problem(w, r, http.StatusServiceUnavailable, "not-configured", "Feature not configured", err.Error())
	case errors.As(err, &pe):
		problem(w, r, http.StatusBadGateway, "psp-error", "The Pix PSP refused the request", pe.Error())
	default:
		s.log.Error("request failed", "path", r.URL.Path, "err", err)
		problem(w, r, http.StatusInternalServerError, "internal", "Internal error", "")
	}
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	body, err := io.ReadAll(r.Body)
	if tooLarge(err) {
		problem(w, r, http.StatusRequestEntityTooLarge, "body-too-large", "Request body too large", "the limit is 1 MiB")
		return false
	}
	if err != nil {
		problem(w, r, http.StatusBadRequest, "bad-body", "Unreadable body", "")
		return false
	}
	// Raw NUL is invalid JSON already; the escaped form would decode and then be refused by
	// PostgreSQL. Invalid UTF-8 is replaced silently by encoding/json, so refuse it here.
	if bytes.Contains(bytes.ToLower(body), []byte(`\u0000`)) || !utf8.Valid(body) {
		problem(w, r, http.StatusBadRequest, "bad-json", "Malformed JSON", "NUL characters and invalid UTF-8 are not accepted")
		return false
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		problem(w, r, http.StatusBadRequest, "bad-json", "Malformed JSON", err.Error())
		return false
	}
	if dec.More() {
		problem(w, r, http.StatusBadRequest, "bad-json", "Malformed JSON", "one JSON object per request")
		return false
	}
	return true
}
