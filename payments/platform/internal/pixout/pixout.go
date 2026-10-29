// Package pixout sends Pix transfers (merchant payouts) through a partner bank.
//
// Unlike receiving (the Banco Central's API Pix standard, pkg/apipix), sending Pix has no
// standard API for indirect participants: every bank exposes its own. Sender is the seam:
// HTTPSender implements a small documented JSON contract (payments/integration/pix.md), and
// a real bank gets a thin adapter that implements Sender against its API. A direct SPI
// participant would implement Sender over ISO 20022 pacs.008 on the RSFN instead.
package pixout

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/pkg/apipix"
)

// Transfer statuses.
const (
	StatusProcessing = "EM_PROCESSAMENTO"
	StatusDone       = "REALIZADO"
	StatusFailed     = "NAO_REALIZADO"
)

// Transfer is one outgoing Pix.
type Transfer struct {
	IdempotencyKey string // the payout ID; resending the same key must not pay twice
	Amount         int64  // centavos
	KeyType        string // CPF, CNPJ, EMAIL, PHONE, EVP
	Key            string
	Description    string
}

// Result of a transfer.
type Result struct {
	ID         string
	EndToEndID string
	Status     string
	Reason     string
}

// Sender sends Pix transfers.
type Sender interface {
	Send(ctx context.Context, t Transfer) (Result, error)
	Get(ctx context.Context, id string) (Result, error)
}

// HTTPConfig of the generic partner-bank adapter.
type HTTPConfig struct {
	BaseURL string
	Token   func(ctx context.Context) (string, error) // bearer token source (OAuth2 client credentials)
	TLS     *tls.Config
	Timeout time.Duration
}

// HTTPSender implements the generic contract:
//
//	POST {base}/pagamentos/pix  {"idempotencia","valor":"123.45","tipoChave","chave","descricao"} → 201/200 {"id","endToEndId","status","motivo"}
//	GET  {base}/pagamentos/pix/{id} → 200 {"id","endToEndId","status","motivo"}
type HTTPSender struct {
	cfg  HTTPConfig
	http *http.Client
}

// NewHTTPSender returns the generic adapter.
func NewHTTPSender(cfg HTTPConfig) *HTTPSender {
	if cfg.Timeout == 0 {
		cfg.Timeout = 15 * time.Second
	}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = cfg.TLS
	cfg.BaseURL = strings.TrimRight(cfg.BaseURL, "/")
	return &HTTPSender{cfg: cfg, http: &http.Client{Transport: tr, Timeout: cfg.Timeout}}
}

type wire struct {
	ID          string `json:"id,omitempty"`
	Idempotence string `json:"idempotencia,omitempty"`
	Valor       string `json:"valor,omitempty"`
	TipoChave   string `json:"tipoChave,omitempty"`
	Chave       string `json:"chave,omitempty"`
	Descricao   string `json:"descricao,omitempty"`
	EndToEndID  string `json:"endToEndId,omitempty"`
	Status      string `json:"status,omitempty"`
	Motivo      string `json:"motivo,omitempty"`
}

// ErrRejected is returned when the bank refuses a transfer synchronously.
var ErrRejected = errors.New("pixout: transfer rejected")

func (s *HTTPSender) call(ctx context.Context, method, path string, in *wire) (Result, error) {
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.cfg.BaseURL+path, body)
	if err != nil {
		return Result{}, err
	}
	if s.cfg.Token != nil {
		tok, err := s.cfg.Token(ctx)
		if err != nil {
			return Result{}, err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", in.Idempotence)
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return Result{}, fmt.Errorf("%w: HTTP %d: %s", ErrRejected, resp.StatusCode, strings.TrimSpace(string(b)))
		}
		return Result{}, fmt.Errorf("pixout: HTTP %d", resp.StatusCode)
	}
	var w wire
	if err := json.Unmarshal(b, &w); err != nil {
		return Result{}, fmt.Errorf("pixout: decode: %w", err)
	}
	return Result{ID: w.ID, EndToEndID: w.EndToEndID, Status: w.Status, Reason: w.Motivo}, nil
}

// Send posts a transfer. Network errors leave the outcome unknown: call Get with the
// same idempotency key (or resend; the contract is idempotent) before giving up.
func (s *HTTPSender) Send(ctx context.Context, t Transfer) (Result, error) {
	if t.Amount <= 0 || t.Key == "" || t.IdempotencyKey == "" {
		return Result{}, fmt.Errorf("pixout: amount, key and idempotency key are required")
	}
	return s.call(ctx, http.MethodPost, "/pagamentos/pix", &wire{
		Idempotence: t.IdempotencyKey, Valor: apipix.FormatValor(t.Amount), TipoChave: t.KeyType, Chave: t.Key, Descricao: t.Description,
	})
}

// Get reads a transfer's status.
func (s *HTTPSender) Get(ctx context.Context, id string) (Result, error) {
	return s.call(ctx, http.MethodGet, "/pagamentos/pix/"+url.PathEscape(id), nil)
}
