package exchange

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Binance speaks the Binance spot and wallet APIs (https://developers.binance.com): requests
// signed with HMAC-SHA256 over the query string, the key in X-MBX-APIKEY. It lists BRL pairs
// (BTCBRL, ETHBRL, USDTBRL), the ones that settle crypto payments in reais.
type Binance struct {
	BaseURL   string // default https://api.binance.com
	APIKey    string
	SecretKey string
	Client    *http.Client
	Now       func() time.Time
}

var binanceNetworks = map[string]string{"bitcoin": "BTC", "ethereum": "ETH", "tron": "TRX", "polygon": "MATIC", "solana": "SOL"}

// Name implements Exchange.
func (b *Binance) Name() string { return "binance" }

func (b *Binance) base() string {
	if b.BaseURL != "" {
		return strings.TrimRight(b.BaseURL, "/")
	}
	return "https://api.binance.com"
}

// binanceError is the API's error body.
type binanceError struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
}

func (b *Binance) do(ctx context.Context, method, path string, q url.Values, signed bool, out any) error {
	if q == nil {
		q = url.Values{}
	}
	if signed {
		now := time.Now
		if b.Now != nil {
			now = b.Now
		}
		q.Set("timestamp", strconv.FormatInt(now().UnixMilli(), 10))
		q.Set("recvWindow", "5000")
	}
	query := q.Encode()
	if signed {
		m := hmac.New(sha256.New, []byte(b.SecretKey))
		m.Write([]byte(query))
		query += "&signature=" + hex.EncodeToString(m.Sum(nil))
	}
	req, err := http.NewRequestWithContext(ctx, method, b.base()+path+"?"+query, nil)
	if err != nil {
		return err
	}
	if b.APIKey != "" {
		req.Header.Set("X-MBX-APIKEY", b.APIKey)
	}
	return doJSON(httpClient(b.Client), req, out, func(body []byte) error {
		var e binanceError
		if json.Unmarshal(body, &e) == nil && e.Msg != "" {
			return &binanceError{e.Code, e.Msg}
		}
		return nil
	})
}

func (e *binanceError) Error() string { return fmt.Sprintf("binance: %d %s", e.Code, e.Msg) }

// Book implements Exchange.
func (b *Binance) Book(ctx context.Context, base, quote string) (Book, error) {
	var r struct {
		BidPrice string `json:"bidPrice"`
		AskPrice string `json:"askPrice"`
	}
	if err := b.do(ctx, http.MethodGet, "/api/v3/ticker/bookTicker", url.Values{"symbol": {base + quote}}, false, &r); err != nil {
		return Book{}, err
	}
	return Book{Exchange: b.Name(), Base: base, Quote: quote, Bid: r.BidPrice, Ask: r.AskPrice, At: time.Now()}, nil
}

type binanceOrder struct {
	OrderID             int64  `json:"orderId"`
	ClientOrderID       string `json:"clientOrderId"`
	Status              string `json:"status"`
	ExecutedQty         string `json:"executedQty"`
	CummulativeQuoteQty string `json:"cummulativeQuoteQty"`
	Fills               []struct {
		Commission      string `json:"commission"`
		CommissionAsset string `json:"commissionAsset"`
	} `json:"fills"`
}

// Market implements Exchange. A retry with the same client ID finds the first order instead
// of placing another.
func (b *Binance) Market(ctx context.Context, o Order) (Fill, error) {
	if err := o.validate(); err != nil {
		return Fill{}, err
	}
	q := url.Values{"symbol": {o.Base + o.Quote}, "side": {strings.ToUpper(o.Side)}, "type": {"MARKET"},
		"newClientOrderId": {o.ClientID}, "newOrderRespType": {"FULL"}}
	if o.BaseUnits > 0 {
		q.Set("quantity", trimmed(o.BaseUnits, o.Base))
	} else {
		q.Set("quoteOrderQty", trimmed(o.QuoteUnits, o.Quote))
	}
	var r binanceOrder
	err := b.do(ctx, http.MethodPost, "/api/v3/order", q, true, &r)
	var be *binanceError
	if errors.As(err, &be) && be.Code == -2010 { // duplicate client order ID: it was placed before
		err = b.do(ctx, http.MethodGet, "/api/v3/order", url.Values{"symbol": {o.Base + o.Quote}, "origClientOrderId": {o.ClientID}}, true, &r)
	}
	if err != nil {
		return Fill{}, err
	}
	if r.Status != "FILLED" && r.Status != "PARTIALLY_FILLED" {
		return Fill{}, fmt.Errorf("binance: order %s is %s", o.ClientID, r.Status)
	}
	f := Fill{Exchange: b.Name(), OrderID: strconv.FormatInt(r.OrderID, 10), ClientID: o.ClientID, FeeAsset: o.Quote}
	if f.BaseUnits, err = decimal(r.ExecutedQty, o.Base); err != nil {
		return Fill{}, err
	}
	if f.QuoteUnits, err = decimal(r.CummulativeQuoteQty, o.Quote); err != nil {
		return Fill{}, err
	}
	for _, c := range r.Fills {
		f.FeeAsset = c.CommissionAsset
		n, err := decimal(c.Commission, c.CommissionAsset)
		if err != nil {
			return Fill{}, err
		}
		f.FeeUnits += n
	}
	return f, nil
}

// DepositAddress implements Exchange.
func (b *Binance) DepositAddress(ctx context.Context, code, network string) (string, string, error) {
	nw, ok := binanceNetworks[network]
	if !ok {
		return "", "", fmt.Errorf("%w: network %s", ErrUnsupported, network)
	}
	var r struct {
		Address string `json:"address"`
		Tag     string `json:"tag"`
	}
	if err := b.do(ctx, http.MethodGet, "/sapi/v1/capital/deposit/address", url.Values{"coin": {code}, "network": {nw}}, true, &r); err != nil {
		return "", "", err
	}
	return r.Address, r.Tag, nil
}

// Deposits implements Exchange: status 1 (success) and 6 (credited, withdrawal locked) are
// confirmed; 0 is pending.
func (b *Binance) Deposits(ctx context.Context, code string, since time.Time) ([]Deposit, error) {
	var rs []struct {
		ID         string `json:"id"`
		Amount     string `json:"amount"`
		Coin       string `json:"coin"`
		Network    string `json:"network"`
		Status     int    `json:"status"`
		Address    string `json:"address"`
		AddressTag string `json:"addressTag"`
		TxID       string `json:"txId"`
		InsertTime int64  `json:"insertTime"`
	}
	if err := b.do(ctx, http.MethodGet, "/sapi/v1/capital/deposit/hisrec", url.Values{"coin": {code}, "startTime": {strconv.FormatInt(since.UnixMilli(), 10)}}, true, &rs); err != nil {
		return nil, err
	}
	out := make([]Deposit, 0, len(rs))
	for _, r := range rs {
		units, err := decimal(r.Amount, r.Coin)
		if err != nil {
			return nil, err
		}
		out = append(out, Deposit{ID: r.ID, Asset: r.Coin, Network: networkFrom(binanceNetworks, r.Network), Address: r.Address, Memo: r.AddressTag,
			TxID: r.TxID, Units: units, Confirmed: r.Status == 1 || r.Status == 6, At: time.UnixMilli(r.InsertTime)})
	}
	return out, nil
}

// Withdraw implements Exchange; withdrawOrderId makes a retry harmless.
func (b *Binance) Withdraw(ctx context.Context, w Withdrawal) (string, error) {
	nw, ok := binanceNetworks[w.Network]
	if !ok {
		return "", fmt.Errorf("%w: network %s", ErrUnsupported, w.Network)
	}
	q := url.Values{"coin": {w.Asset}, "network": {nw}, "address": {w.Address}, "amount": {trimmed(w.Units, w.Asset)}, "withdrawOrderId": {w.ClientID}}
	if w.Memo != "" {
		q.Set("addressTag", w.Memo)
	}
	var r struct {
		ID string `json:"id"`
	}
	if err := b.do(ctx, http.MethodPost, "/sapi/v1/capital/withdraw/apply", q, true, &r); err != nil {
		return "", err
	}
	return r.ID, nil
}

// ---------------------------------------------------------------- shared HTTP

func httpClient(c *http.Client) *http.Client {
	if c != nil {
		return c
	}
	return &http.Client{Timeout: 15 * time.Second}
}

// doJSON sends req and decodes a 2xx body into out; apiErr turns an error body into the
// venue's error when it can.
func doJSON(c *http.Client, req *http.Request, out any, apiErr func([]byte) error) error {
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		if e := apiErr(body); e != nil {
			return e
		}
		return fmt.Errorf("%s %s: HTTP %d", req.Method, req.URL.Path, resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(body, out)
}

func networkFrom(m map[string]string, venue string) string {
	for k, v := range m {
		if v == venue {
			return k
		}
	}
	return strings.ToLower(venue)
}
