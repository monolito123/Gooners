package exchange

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Coinbase speaks the Coinbase Advanced Trade API (https://docs.cdp.coinbase.com): each
// request carries a fresh ES256 JWT naming its method, host and path. It trades USD and EUR
// pairs; deposits and withdrawals go through Coinbase's v2 wallet API, which this adapter
// leaves out (ErrUnsupported), so the router uses it for trading only.
type Coinbase struct {
	BaseURL string // default https://api.coinbase.com
	KeyName string // organizations/{org}/apiKeys/{id}
	Key     *ecdsa.PrivateKey
	Client  *http.Client
	Now     func() time.Time
}

// ParseCoinbaseKey reads the EC private key Coinbase issues (PEM, SEC 1 or PKCS #8).
func ParseCoinbaseKey(pemText string) (*ecdsa.PrivateKey, error) {
	b, _ := pem.Decode([]byte(strings.ReplaceAll(pemText, `\n`, "\n")))
	if b == nil {
		return nil, errors.New("coinbase: the key is not PEM")
	}
	if k, err := x509.ParseECPrivateKey(b.Bytes); err == nil {
		return k, nil
	}
	k, err := x509.ParsePKCS8PrivateKey(b.Bytes)
	if err != nil {
		return nil, fmt.Errorf("coinbase: %w", err)
	}
	ec, ok := k.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("coinbase: not an EC key")
	}
	return ec, nil
}

// Name implements Exchange.
func (c *Coinbase) Name() string { return "coinbase" }

func (c *Coinbase) base() string {
	if c.BaseURL != "" {
		return strings.TrimRight(c.BaseURL, "/")
	}
	return "https://api.coinbase.com"
}

// jwt signs the token for one request: uri is "METHOD host/path".
func (c *Coinbase) jwt(method, host, path string) (string, error) {
	now := time.Now
	if c.Now != nil {
		now = c.Now
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	t := now().Unix()
	hdr, _ := json.Marshal(map[string]any{"alg": "ES256", "kid": c.KeyName, "nonce": hex.EncodeToString(nonce), "typ": "JWT"})
	claims, _ := json.Marshal(map[string]any{"sub": c.KeyName, "iss": "cdp", "nbf": t, "exp": t + 120, "uri": method + " " + host + path})
	enc := base64.RawURLEncoding
	signing := enc.EncodeToString(hdr) + "." + enc.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signing))
	r, s, err := ecdsa.Sign(rand.Reader, c.Key, digest[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64) // JOSE: r ‖ s, 32 bytes each
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return signing + "." + enc.EncodeToString(sig), nil
}

func (c *Coinbase) do(ctx context.Context, method, path string, q url.Values, body, out any) error {
	u, err := url.Parse(c.base() + path)
	if err != nil {
		return err
	}
	token, err := c.jwt(method, u.Host, u.Path)
	if err != nil {
		return err
	}
	if len(q) > 0 {
		u.RawQuery = q.Encode()
	}
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	return doJSON(httpClient(c.Client), req, out, func(b []byte) error {
		var e struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		}
		if json.Unmarshal(b, &e) == nil && (e.Error != "" || e.Message != "") {
			return fmt.Errorf("coinbase: %s %s", e.Error, e.Message)
		}
		return nil
	})
}

// Book implements Exchange.
func (c *Coinbase) Book(ctx context.Context, base, quote string) (Book, error) {
	var r struct {
		Pricebooks []struct {
			Bids []struct {
				Price string `json:"price"`
			} `json:"bids"`
			Asks []struct {
				Price string `json:"price"`
			} `json:"asks"`
		} `json:"pricebooks"`
	}
	if err := c.do(ctx, http.MethodGet, "/api/v3/brokerage/best_bid_ask", url.Values{"product_ids": {base + "-" + quote}}, nil, &r); err != nil {
		return Book{}, err
	}
	if len(r.Pricebooks) == 0 || len(r.Pricebooks[0].Bids) == 0 || len(r.Pricebooks[0].Asks) == 0 {
		return Book{}, fmt.Errorf("%w: %s-%s", ErrUnsupported, base, quote)
	}
	pb := r.Pricebooks[0]
	return Book{Exchange: c.Name(), Base: base, Quote: quote, Bid: pb.Bids[0].Price, Ask: pb.Asks[0].Price, At: time.Now()}, nil
}

// Market implements Exchange: a market IOC order, then its historical record for the fill.
func (c *Coinbase) Market(ctx context.Context, o Order) (Fill, error) {
	if err := o.validate(); err != nil {
		return Fill{}, err
	}
	size := map[string]string{}
	if o.BaseUnits > 0 {
		size["base_size"] = trimmed(o.BaseUnits, o.Base)
	} else {
		size["quote_size"] = trimmed(o.QuoteUnits, o.Quote)
	}
	var placed struct {
		Success         bool `json:"success"`
		SuccessResponse struct {
			OrderID string `json:"order_id"`
		} `json:"success_response"`
		ErrorResponse struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		} `json:"error_response"`
	}
	req := map[string]any{"client_order_id": o.ClientID, "product_id": o.Base + "-" + o.Quote, "side": strings.ToUpper(o.Side),
		"order_configuration": map[string]any{"market_market_ioc": size}}
	if err := c.do(ctx, http.MethodPost, "/api/v3/brokerage/orders", nil, req, &placed); err != nil {
		return Fill{}, err
	}
	if !placed.Success {
		return Fill{}, fmt.Errorf("coinbase: %s %s", placed.ErrorResponse.Error, placed.ErrorResponse.Message)
	}
	id := placed.SuccessResponse.OrderID
	var h struct {
		Order struct {
			Status      string `json:"status"`
			FilledSize  string `json:"filled_size"`
			FilledValue string `json:"filled_value"`
			TotalFees   string `json:"total_fees"`
		} `json:"order"`
	}
	if err := c.do(ctx, http.MethodGet, "/api/v3/brokerage/orders/historical/"+url.PathEscape(id), nil, nil, &h); err != nil {
		return Fill{}, err
	}
	if h.Order.Status != "FILLED" {
		return Fill{}, fmt.Errorf("coinbase: order %s is %s", id, h.Order.Status)
	}
	f := Fill{Exchange: c.Name(), OrderID: id, ClientID: o.ClientID, FeeAsset: o.Quote}
	var err error
	if f.BaseUnits, err = decimal(h.Order.FilledSize, o.Base); err == nil {
		if f.QuoteUnits, err = decimal(h.Order.FilledValue, o.Quote); err == nil {
			f.FeeUnits, err = decimal(h.Order.TotalFees, o.Quote)
		}
	}
	return f, err
}

// DepositAddress implements Exchange (not through Advanced Trade).
func (c *Coinbase) DepositAddress(context.Context, string, string) (string, string, error) {
	return "", "", fmt.Errorf("%w: coinbase deposits go through the v2 wallet API", ErrUnsupported)
}

// Deposits implements Exchange (not through Advanced Trade).
func (c *Coinbase) Deposits(context.Context, string, time.Time) ([]Deposit, error) {
	return nil, fmt.Errorf("%w: coinbase deposits go through the v2 wallet API", ErrUnsupported)
}

// Withdraw implements Exchange (not through Advanced Trade).
func (c *Coinbase) Withdraw(context.Context, Withdrawal) (string, error) {
	return "", fmt.Errorf("%w: coinbase withdrawals go through the v2 wallet API", ErrUnsupported)
}
