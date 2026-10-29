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
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/pkg/apipix"
)

// Config of the API server.
type Config struct {
	Env string // sandbox or production
}

// Server serves the API.
type Server struct {
	cfg  Config
	svc  *payments.Service
	pool *pgxpool.Pool
	log  *slog.Logger
}

// New returns a server.
func New(cfg Config, svc *payments.Service, pool *pgxpool.Pool, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{cfg: cfg, svc: svc, pool: pool, log: log}
}

type principal struct {
	tenantID string
	scopes   map[string]bool
	terminal string // set when authenticated by a terminal certificate
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
		mux.Handle(pattern, s.authenticate(scope, h))
	}
	route("POST /v1/merchants", "merchants:write", true, s.createMerchant)
	route("GET /v1/merchants/{id}", "merchants:write", false, s.getMerchant)
	route("POST /v1/terminals", "merchants:write", true, s.registerTerminal)
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
	route("POST /v1/webhook-endpoints", "webhooks:write", true, s.createWebhook)
	return s.recover(s.requestID(mux))
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
		problem(w, r, http.StatusServiceUnavailable, "not-ready", "Database unavailable", err.Error())
		return
	}
	w.WriteHeader(http.StatusOK)
}

// ---------------------------------------------------------------- middleware

func (s *Server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := ids.New("req")
		w.Header().Set("Request-Id", id)
		next.ServeHTTP(w, r)
	})
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

func (s *Server) authenticate(scope string, next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Terminals authenticate with their mutual-TLS certificate.
		if scope == "terminal" && r.TLS != nil && len(r.TLS.VerifiedChains) > 0 {
			tenant, terminal, err := s.svc.TerminalByFingerprint(r.Context(), CertFingerprint(r.TLS.PeerCertificates[0].Raw))
			if err != nil {
				problem(w, r, http.StatusUnauthorized, "unknown-terminal", "Unknown terminal certificate", "")
				return
			}
			next(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, principal{tenantID: tenant, terminal: terminal})))
			return
		}
		key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if key == "" || key == r.Header.Get("Authorization") {
			problem(w, r, http.StatusUnauthorized, "unauthorized", "Missing API key", "send Authorization: Bearer <key>")
			return
		}
		var tenant string
		var scopes []string
		err := s.pool.QueryRow(r.Context(), `SELECT tenant_id::text, scopes FROM api_clients WHERE key_hash = $1 AND revoked_at IS NULL`, hashKey(key)).Scan(&tenant, &scopes)
		if err != nil {
			problem(w, r, http.StatusUnauthorized, "unauthorized", "Invalid API key", "")
			return
		}
		p := principal{tenantID: tenant, scopes: map[string]bool{}}
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
		next(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, p)))
	})
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
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
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
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		problem(w, r, http.StatusBadRequest, "bad-json", "Malformed JSON", err.Error())
		return false
	}
	return true
}
