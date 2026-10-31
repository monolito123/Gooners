package brokerage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Brapi reads B3 quotes from brapi.dev (https://brapi.dev/docs): GET /api/quote/{ticker}.
// Most tickers need a token; quotes are delayed per brapi's plan, which is enough to show a
// price before an order (the broker executes at the market).
type Brapi struct {
	BaseURL string // default https://brapi.dev
	Token   string
	Client  *http.Client
}

// Quote returns a ticker's last price.
func (b *Brapi) Quote(ctx context.Context, ticker string) (Quote, error) {
	in, err := Parse(ticker)
	if err != nil {
		return Quote{}, err
	}
	base := "https://brapi.dev"
	if b.BaseURL != "" {
		base = strings.TrimRight(b.BaseURL, "/")
	}
	u := base + "/api/quote/" + url.PathEscape(in.Ticker)
	if b.Token != "" {
		u += "?token=" + url.QueryEscape(b.Token)
	}
	var r struct {
		Results []struct {
			Symbol            string      `json:"symbol"`
			ShortName         string      `json:"shortName"`
			Price             json.Number `json:"regularMarketPrice"`
			ChangePercent     json.Number `json:"regularMarketChangePercent"`
			RegularMarketTime string      `json:"regularMarketTime"`
		} `json:"results"`
		Error   bool   `json:"error"`
		Message string `json:"message"`
	}
	if err := getJSON(ctx, b.Client, u, nil, &r); err != nil {
		return Quote{}, err
	}
	if r.Error || len(r.Results) == 0 {
		return Quote{}, fmt.Errorf("brapi: %s", r.Message)
	}
	x := r.Results[0]
	at, _ := time.Parse(time.RFC3339, x.RegularMarketTime)
	return Quote{Ticker: x.Symbol, Name: x.ShortName, Last: x.Price.String(), Change: x.ChangePercent.String(), At: at}, nil
}

// Client speaks the broker contract an adapter to a CVM-authorized broker implements:
//
//	GET  {base}/quotes/{ticker}  → Quote
//	POST {base}/orders           ← Order, → Execution (idempotent by client_id)
//
// with a bearer token. Quotes come from Quotes when set (brapi), else from the broker.
type Client struct {
	BaseURL, Token, BrokerName string
	Quotes                     *Brapi
	HTTP                       *http.Client
}

// Name implements Broker.
func (c *Client) Name() string { return c.BrokerName }

// Quote implements Broker.
func (c *Client) Quote(ctx context.Context, ticker string) (Quote, error) {
	if c.Quotes != nil {
		return c.Quotes.Quote(ctx, ticker)
	}
	in, err := Parse(ticker)
	if err != nil {
		return Quote{}, err
	}
	var q Quote
	err = getJSON(ctx, c.HTTP, strings.TrimRight(c.BaseURL, "/")+"/quotes/"+url.PathEscape(in.Ticker), c.auth(), &q)
	return q, err
}

// Place implements Broker.
func (c *Client) Place(ctx context.Context, o Order) (Execution, error) {
	b, _ := json.Marshal(o)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.BaseURL, "/")+"/orders", bytes.NewReader(b))
	if err != nil {
		return Execution{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range c.auth() {
		req.Header.Set(k, v)
	}
	var e Execution
	err = send(c.HTTP, req, &e)
	return e, err
}

func (c *Client) auth() map[string]string {
	return map[string]string{"Authorization": "Bearer " + c.Token}
}

func getJSON(ctx context.Context, hc *http.Client, u string, headers map[string]string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return send(hc, req, out)
}

func send(hc *http.Client, req *http.Request, out any) error {
	if hc == nil {
		hc = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s: HTTP %d %s", req.Method, req.URL.Path, resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	return d.Decode(out)
}
