package exchange

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Kraken speaks the Kraken spot REST API (https://docs.kraken.com/api): private calls are
// form POSTs signed with API-Sign = base64(HMAC-SHA512(secret, path ‖ SHA-256(nonce ‖ body))).
// It lists USD and EUR pairs, used for merchants' international (USD, EUR) balances.
type Kraken struct {
	BaseURL   string // default https://api.kraken.com
	APIKey    string
	SecretKey string // base64, as Kraken issues it
	// WithdrawKeys maps a destination address to the withdrawal key name registered for it
	// at Kraken, which only withdraws to addresses approved in advance.
	WithdrawKeys map[string]string
	Client       *http.Client
	Now          func() time.Time
}

var krakenAssets = map[string]string{"BTC": "XBT"}

// krakenMethods are Kraken's deposit method names per asset and network.
var krakenMethods = map[string]string{
	"BTC/bitcoin": "Bitcoin", "ETH/ethereum": "Ether (Hex)", "USDT/ethereum": "Tether USD (ERC20)",
	"USDT/tron": "Tether USD (TRC20)", "USDC/ethereum": "USDC", "USDC/solana": "USDC (SPL)",
}

// Name implements Exchange.
func (k *Kraken) Name() string { return "kraken" }

func ka(code string) string {
	if a, ok := krakenAssets[code]; ok {
		return a
	}
	return code
}

func (k *Kraken) base() string {
	if k.BaseURL != "" {
		return strings.TrimRight(k.BaseURL, "/")
	}
	return "https://api.kraken.com"
}

type krakenEnvelope struct {
	Error  []string        `json:"error"`
	Result json.RawMessage `json:"result"`
}

func (k *Kraken) public(ctx context.Context, path string, q url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, k.base()+path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	return k.decode(req, out)
}

func (k *Kraken) private(ctx context.Context, method string, form url.Values, out any) error {
	now := time.Now
	if k.Now != nil {
		now = k.Now
	}
	nonce := strconv.FormatInt(now().UnixMicro(), 10)
	form.Set("nonce", nonce)
	body := form.Encode()
	path := "/0/private/" + method
	secret, err := base64.StdEncoding.DecodeString(k.SecretKey)
	if err != nil {
		return fmt.Errorf("kraken: the secret is not base64: %w", err)
	}
	sum := sha256.Sum256([]byte(nonce + body))
	m := hmac.New(sha512.New, secret)
	m.Write([]byte(path))
	m.Write(sum[:])
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, k.base()+path, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("API-Key", k.APIKey)
	req.Header.Set("API-Sign", base64.StdEncoding.EncodeToString(m.Sum(nil)))
	return k.decode(req, out)
}

func (k *Kraken) decode(req *http.Request, out any) error {
	var env krakenEnvelope
	if err := doJSON(httpClient(k.Client), req, &env, func([]byte) error { return nil }); err != nil {
		return err
	}
	if len(env.Error) > 0 {
		return fmt.Errorf("kraken: %s", strings.Join(env.Error, "; "))
	}
	return json.Unmarshal(env.Result, out)
}

// Book implements Exchange.
func (k *Kraken) Book(ctx context.Context, base, quote string) (Book, error) {
	var r map[string]struct {
		A []string `json:"a"`
		B []string `json:"b"`
	}
	if err := k.public(ctx, "/0/public/Ticker", url.Values{"pair": {ka(base) + ka(quote)}}, &r); err != nil {
		return Book{}, err
	}
	for _, t := range r { // one pair asked, one returned (under Kraken's own pair name)
		if len(t.A) > 0 && len(t.B) > 0 {
			return Book{Exchange: k.Name(), Base: base, Quote: quote, Bid: t.B[0], Ask: t.A[0], At: time.Now()}, nil
		}
	}
	return Book{}, fmt.Errorf("%w: %s/%s", ErrUnsupported, base, quote)
}

// Market implements Exchange. A quote-sized order is a buy with the viqc flag (volume in
// quote currency); cl_ord_id keeps a retry from trading twice.
func (k *Kraken) Market(ctx context.Context, o Order) (Fill, error) {
	if err := o.validate(); err != nil {
		return Fill{}, err
	}
	form := url.Values{"pair": {ka(o.Base) + ka(o.Quote)}, "type": {o.Side}, "ordertype": {"market"}, "cl_ord_id": {o.ClientID}}
	if o.BaseUnits > 0 {
		form.Set("volume", trimmed(o.BaseUnits, o.Base))
	} else {
		if o.Side != Buy {
			return Fill{}, fmt.Errorf("%w: kraken sizes sells in the base asset", ErrUnsupported)
		}
		form.Set("volume", trimmed(o.QuoteUnits, o.Quote))
		form.Set("oflags", "viqc")
	}
	var placed struct {
		TxID []string `json:"txid"`
	}
	if err := k.private(ctx, "AddOrder", form, &placed); err != nil {
		return Fill{}, err
	}
	if len(placed.TxID) == 0 {
		return Fill{}, errors.New("kraken: no order ID")
	}
	id := placed.TxID[0]
	for attempt := 0; ; attempt++ { // a market order closes at once; give it a moment
		var q map[string]struct {
			Status  string `json:"status"`
			VolExec string `json:"vol_exec"`
			Cost    string `json:"cost"`
			Fee     string `json:"fee"`
		}
		if err := k.private(ctx, "QueryOrders", url.Values{"txid": {id}}, &q); err != nil {
			return Fill{}, err
		}
		st := q[id]
		if st.Status == "closed" || attempt == 4 {
			if st.Status != "closed" {
				return Fill{}, fmt.Errorf("kraken: order %s is %s", id, st.Status)
			}
			f := Fill{Exchange: k.Name(), OrderID: id, ClientID: o.ClientID, FeeAsset: o.Quote}
			var err error
			if f.BaseUnits, err = decimal(st.VolExec, o.Base); err == nil {
				if f.QuoteUnits, err = decimal(st.Cost, o.Quote); err == nil {
					f.FeeUnits, err = decimal(st.Fee, o.Quote)
				}
			}
			return f, err
		}
		select {
		case <-ctx.Done():
			return Fill{}, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

// DepositAddress implements Exchange.
func (k *Kraken) DepositAddress(ctx context.Context, code, network string) (string, string, error) {
	method, ok := krakenMethods[code+"/"+network]
	if !ok {
		return "", "", fmt.Errorf("%w: %s on %s", ErrUnsupported, code, network)
	}
	var r []struct {
		Address string `json:"address"`
		Tag     string `json:"tag"`
		Memo    string `json:"memo"`
	}
	if err := k.private(ctx, "DepositAddresses", url.Values{"asset": {ka(code)}, "method": {method}}, &r); err != nil {
		return "", "", err
	}
	if len(r) == 0 {
		return "", "", errors.New("kraken: no deposit address")
	}
	return r[0].Address, r[0].Tag + r[0].Memo, nil
}

// Deposits implements Exchange.
func (k *Kraken) Deposits(ctx context.Context, code string, since time.Time) ([]Deposit, error) {
	var rs []struct {
		Method string `json:"method"`
		RefID  string `json:"refid"`
		TxID   string `json:"txid"`
		Info   string `json:"info"`
		Amount string `json:"amount"`
		Time   int64  `json:"time"`
		Status string `json:"status"`
	}
	if err := k.private(ctx, "DepositStatus", url.Values{"asset": {ka(code)}, "start": {strconv.FormatInt(since.Unix(), 10)}}, &rs); err != nil {
		return nil, err
	}
	out := make([]Deposit, 0, len(rs))
	for _, r := range rs {
		units, err := decimal(r.Amount, code)
		if err != nil {
			return nil, err
		}
		network := ""
		for key, m := range krakenMethods {
			if m == r.Method && strings.HasPrefix(key, code+"/") {
				network = strings.TrimPrefix(key, code+"/")
			}
		}
		out = append(out, Deposit{ID: r.RefID, Asset: code, Network: network, Address: r.Info, TxID: r.TxID, Units: units,
			Confirmed: r.Status == "Success", At: time.Unix(r.Time, 0)})
	}
	return out, nil
}

// Withdraw implements Exchange, to an address registered at Kraken under a withdrawal key.
func (k *Kraken) Withdraw(ctx context.Context, w Withdrawal) (string, error) {
	key, ok := k.WithdrawKeys[w.Address]
	if !ok {
		return "", fmt.Errorf("%w: register %s at Kraken as a withdrawal key first", ErrUnsupported, w.Address)
	}
	var r struct {
		RefID string `json:"refid"`
	}
	if err := k.private(ctx, "Withdraw", url.Values{"asset": {ka(w.Asset)}, "key": {key}, "amount": {trimmed(w.Units, w.Asset)}}, &r); err != nil {
		return "", err
	}
	return r.RefID, nil
}
