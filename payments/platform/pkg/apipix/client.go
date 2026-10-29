package apipix

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Config of a PSP connection. API Pix requires OAuth 2.0 client credentials over mutual TLS.
type Config struct {
	BaseURL      string // e.g. https://pix.psp.example/api/v2 (major version in the path)
	TokenURL     string // e.g. https://pix.psp.example/oauth/token
	ClientID     string
	ClientSecret string
	Scopes       []string
	// TokenAuth chooses how client credentials are sent: "basic" (HTTP Basic, the common
	// choice) or "body" (form fields). PSPs document which they accept.
	TokenAuth string
	// TLS must carry the client certificate the PSP issued or registered for this client.
	TLS     *tls.Config
	Timeout time.Duration
	Logger  *slog.Logger
	// HTTPClient overrides the client built from TLS (tests).
	HTTPClient *http.Client
}

// Client talks to one PSP.
type Client struct {
	cfg  Config
	http *http.Client

	mu      sync.Mutex
	token   string
	expires time.Time
}

// New returns a client.
func New(cfg Config) *Client {
	if cfg.Timeout == 0 {
		cfg.Timeout = 15 * time.Second
	}
	if cfg.TokenAuth == "" {
		cfg.TokenAuth = "basic"
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	hc := cfg.HTTPClient
	if hc == nil {
		tr := http.DefaultTransport.(*http.Transport).Clone()
		tr.TLSClientConfig = cfg.TLS
		hc = &http.Client{Transport: tr, Timeout: cfg.Timeout}
	}
	cfg.BaseURL = strings.TrimRight(cfg.BaseURL, "/")
	return &Client{cfg: cfg, http: hc}
}

// Error is an API Pix problem response (RFC 7807 with "violacoes").
type Error struct {
	Status    int        `json:"status"`
	Type      string     `json:"type"`
	Title     string     `json:"title"`
	Detail    string     `json:"detail"`
	Violacoes []Violacao `json:"violacoes,omitempty"`
}

// Violacao is one validation failure.
type Violacao struct {
	Razao       string `json:"razao"`
	Propriedade string `json:"propriedade"`
	Valor       string `json:"valor,omitempty"`
}

func (e *Error) Error() string {
	msg := fmt.Sprintf("apipix: %d %s: %s", e.Status, e.Title, e.Detail)
	for _, v := range e.Violacoes {
		msg += fmt.Sprintf(" [%s: %s]", v.Propriedade, v.Razao)
	}
	return msg
}

// accessToken returns a cached token, fetching a new one 30 s before expiry.
func (c *Client) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && time.Now().Before(c.expires) {
		return c.token, nil
	}
	form := url.Values{"grant_type": {"client_credentials"}}
	if len(c.cfg.Scopes) > 0 {
		form.Set("scope", strings.Join(c.cfg.Scopes, " "))
	}
	if c.cfg.TokenAuth == "body" {
		form.Set("client_id", c.cfg.ClientID)
		form.Set("client_secret", c.cfg.ClientSecret)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if c.cfg.TokenAuth != "body" {
		req.SetBasicAuth(c.cfg.ClientID, c.cfg.ClientSecret)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("apipix: token: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("apipix: token: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var t struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &t); err != nil || t.AccessToken == "" {
		return "", fmt.Errorf("apipix: token: bad response")
	}
	if t.ExpiresIn <= 0 {
		t.ExpiresIn = 300
	}
	c.token = t.AccessToken
	c.expires = time.Now().Add(time.Duration(t.ExpiresIn)*time.Second - 30*time.Second)
	return c.token, nil
}

func (c *Client) invalidateToken() {
	c.mu.Lock()
	c.token = ""
	c.mu.Unlock()
}

// do sends a JSON request. PUT and GET are idempotent in API Pix, so they are retried on
// 429 and 5xx with backoff; a 401 refreshes the token once.
func (c *Client) do(ctx context.Context, method, path string, in, out any, ok ...int) error {
	var payload []byte
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		payload = b
	}
	refreshed := false
	var lastErr error
	for attempt := 0; attempt < 4; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(200*(1<<attempt)) * time.Millisecond):
			}
		}
		tok, err := c.accessToken(ctx)
		if err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, method, c.cfg.BaseURL+path, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Accept", "application/json")
		if in != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := c.http.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		for _, code := range ok {
			if resp.StatusCode == code {
				if out != nil && len(body) > 0 {
					if err := json.Unmarshal(body, out); err != nil {
						return fmt.Errorf("apipix: decode %s %s: %w", method, path, err)
					}
				}
				return nil
			}
		}
		if resp.StatusCode == http.StatusUnauthorized && !refreshed {
			refreshed = true
			c.invalidateToken()
			attempt--
			continue
		}
		pe := &Error{Status: resp.StatusCode}
		if err := json.Unmarshal(body, pe); err != nil || pe.Title == "" {
			pe.Title = http.StatusText(resp.StatusCode)
			pe.Detail = strings.TrimSpace(string(body))
		}
		pe.Status = resp.StatusCode
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = pe
			continue
		}
		return pe
	}
	return lastErr
}

func esc(s string) string { return url.PathEscape(s) }

// CreateCob creates (or replaces, while ATIVA) an immediate charge: PUT /cob/{txid}.
func (c *Client) CreateCob(ctx context.Context, txid string, req CobRequest) (*Cob, error) {
	if !ValidTxID(txid) {
		return nil, fmt.Errorf("apipix: txid %q must be 26-35 alphanumerics", txid)
	}
	if !reValor.MatchString(req.Valor.Original) {
		return nil, fmt.Errorf("apipix: valor.original %q must be 123.45", req.Valor.Original)
	}
	var out Cob
	if err := c.do(ctx, http.MethodPut, "/cob/"+esc(txid), req, &out, http.StatusCreated, http.StatusOK); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetCob reads a charge: GET /cob/{txid}.
func (c *Client) GetCob(ctx context.Context, txid string) (*Cob, error) {
	var out Cob
	if err := c.do(ctx, http.MethodGet, "/cob/"+esc(txid), nil, &out, http.StatusOK); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetPix reads a received Pix: GET /pix/{e2eid}. Use it to confirm every webhook notification.
func (c *Client) GetPix(ctx context.Context, e2eid string) (*Pix, error) {
	if !ValidEndToEndID(e2eid) {
		return nil, fmt.Errorf("apipix: endToEndId %q must be 32 alphanumerics", e2eid)
	}
	var out Pix
	if err := c.do(ctx, http.MethodGet, "/pix/"+esc(e2eid), nil, &out, http.StatusOK); err != nil {
		return nil, err
	}
	return &out, nil
}

// Devolver requests a devolução: PUT /pix/{e2eid}/devolucao/{id}. The id is the caller's
// idempotency key: repeating the call with the same id does not refund twice.
func (c *Client) Devolver(ctx context.Context, e2eid, id string, req DevolucaoRequest) (*Devolucao, error) {
	if !ValidEndToEndID(e2eid) || !reDevID.MatchString(id) {
		return nil, fmt.Errorf("apipix: bad endToEndId or devolução id")
	}
	var out Devolucao
	if err := c.do(ctx, http.MethodPut, "/pix/"+esc(e2eid)+"/devolucao/"+esc(id), req, &out, http.StatusCreated, http.StatusOK); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetDevolucao reads a devolução.
func (c *Client) GetDevolucao(ctx context.Context, e2eid, id string) (*Devolucao, error) {
	var out Devolucao
	if err := c.do(ctx, http.MethodGet, "/pix/"+esc(e2eid)+"/devolucao/"+esc(id), nil, &out, http.StatusOK); err != nil {
		return nil, err
	}
	return &out, nil
}

// ConfigureWebhook registers the notification URL for a Pix key: PUT /webhook/{chave}.
// The PSP will POST to webhookURL + "/pix" using mutual TLS.
func (c *Client) ConfigureWebhook(ctx context.Context, chave, webhookURL string) error {
	return c.do(ctx, http.MethodPut, "/webhook/"+esc(chave), WebhookConfig{WebhookURL: webhookURL}, nil, http.StatusOK, http.StatusCreated, http.StatusNoContent)
}

// WebhookHandler serves POST {webhookUrl}/pix. Mount it on a server that requires and
// verifies the PSP's client certificate (tls.RequireAndVerifyClientCert). The handler
// answers 200 only after onPix accepted every item, so the PSP retries failures.
// onPix must be idempotent and must confirm the Pix with GetPix before crediting anyone.
func WebhookHandler(onPix func(ctx context.Context, p Pix) error, log *slog.Logger) http.Handler {
	if log == nil {
		log = slog.Default()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 {
			http.Error(w, "mutual TLS required", http.StatusUnauthorized)
			return
		}
		var payload WebhookPayload
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
			http.Error(w, "bad payload", http.StatusBadRequest)
			return
		}
		for _, p := range payload.Pix {
			if !ValidEndToEndID(p.EndToEndID) {
				http.Error(w, "bad endToEndId", http.StatusBadRequest)
				return
			}
			if err := onPix(r.Context(), p); err != nil {
				log.Error("pix webhook item failed", "e2eid", p.EndToEndID, "err", err)
				http.Error(w, "retry later", http.StatusInternalServerError)
				return
			}
		}
		w.WriteHeader(http.StatusOK)
	})
}

// IsNotFound reports a 404 from the PSP.
func IsNotFound(err error) bool {
	var pe *Error
	return errors.As(err, &pe) && pe.Status == http.StatusNotFound
}

// Token returns a valid access token. Partner-bank APIs that share the PSP's OAuth server
// (for example the transfer API in internal/pixout) can reuse it.
func (c *Client) Token(ctx context.Context) (string, error) { return c.accessToken(ctx) }
