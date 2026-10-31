package exchange

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

var ctx = context.Background()

// The Binance fake checks the HMAC over the query exactly as Binance does.
func TestBinance(t *testing.T) {
	const key, secret = "k", "s3cret"
	orders := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.RawQuery
		if strings.Contains(q, "signature=") {
			i := strings.LastIndex(q, "&signature=")
			m := hmac.New(sha256.New, []byte(secret))
			m.Write([]byte(q[:i]))
			if hex.EncodeToString(m.Sum(nil)) != q[i+len("&signature="):] || r.Header.Get("X-MBX-APIKEY") != key {
				w.WriteHeader(401)
				_, _ = w.Write([]byte(`{"code":-1022,"msg":"Signature for this request is not valid."}`))
				return
			}
		}
		v := r.URL.Query()
		switch r.URL.Path {
		case "/api/v3/ticker/bookTicker":
			if v.Get("symbol") != "BTCBRL" {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"code":-1121,"msg":"Invalid symbol."}`))
				return
			}
			_, _ = w.Write([]byte(`{"symbol":"BTCBRL","bidPrice":"349000.00","askPrice":"351000.00"}`))
		case "/api/v3/order":
			if r.Method == http.MethodPost {
				orders++
				if orders > 1 {
					w.WriteHeader(400)
					_, _ = w.Write([]byte(`{"code":-2010,"msg":"Duplicate order sent."}`))
					return
				}
			}
			if v.Get("type") != "" && (v.Get("type") != "MARKET" || v.Get("quantity") != "0.0015" || v.Get("newClientOrderId") != "pi_1") {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"orderId":7,"clientOrderId":"pi_1","status":"FILLED","executedQty":"0.00150000","cummulativeQuoteQty":"523.50000000",
				"fills":[{"commission":"0.52350000","commissionAsset":"BRL"}]}`))
		case "/sapi/v1/capital/deposit/address":
			_, _ = w.Write([]byte(`{"address":"TXyz","coin":"USDT","tag":""}`))
		case "/sapi/v1/capital/deposit/hisrec":
			_, _ = w.Write([]byte(`[{"id":"d1","amount":"18.523","coin":"USDT","network":"TRX","status":1,"address":"TXyz","txId":"0xab","insertTime":1700000000000},
				{"id":"d2","amount":"5","coin":"USDT","network":"TRX","status":0,"address":"TXyz","txId":"0xcd","insertTime":1700000001000}]`))
		case "/sapi/v1/capital/withdraw/apply":
			_, _ = w.Write([]byte(`{"id":"w9"}`))
		case "/api/v3/account":
			_, _ = w.Write([]byte(`{"balances":[{"asset":"BTC","free":"0.10000000","locked":"0.00500000"},{"asset":"BRL","free":"1234.56","locked":"0.00"},
				{"asset":"DOGE","free":"100","locked":"0"},{"asset":"ETH","free":"1.123456789123456789","locked":"0"}]}`))
		}
	}))
	defer srv.Close()
	b := &Binance{BaseURL: srv.URL, APIKey: key, SecretKey: secret}
	book, err := b.Book(ctx, "BTC", "BRL")
	if err != nil || book.Bid != "349000.00" || book.Ask != "351000.00" {
		t.Fatalf("book: %+v %v", book, err)
	}
	if _, err := b.Book(ctx, "DOGE", "BRL"); err == nil || !strings.Contains(err.Error(), "Invalid symbol") {
		t.Fatalf("an unknown pair: %v", err)
	}
	f, err := b.Market(ctx, Order{ClientID: "pi_1", Side: Sell, Base: "BTC", Quote: "BRL", BaseUnits: 150_000})
	if err != nil || f.BaseUnits != 150_000 || f.QuoteUnits != 52350 || f.FeeUnits != 52 || f.OrderID != "7" {
		t.Fatalf("market: %+v %v", f, err)
	}
	// A retry with the same client ID finds the first order instead of selling twice.
	if f2, err := b.Market(ctx, Order{ClientID: "pi_1", Side: Sell, Base: "BTC", Quote: "BRL", BaseUnits: 150_000}); err != nil || f2.OrderID != "7" {
		t.Fatalf("retry: %+v %v", f2, err)
	}
	if addr, _, err := b.DepositAddress(ctx, "USDT", "tron"); err != nil || addr != "TXyz" {
		t.Fatalf("address: %s %v", addr, err)
	}
	ds, err := b.Deposits(ctx, "USDT", time.Unix(1699999999, 0))
	if err != nil || len(ds) != 2 || ds[0].Units != 18_523_000 || !ds[0].Confirmed || ds[1].Confirmed || ds[0].Network != "tron" {
		t.Fatalf("deposits: %+v %v", ds, err)
	}
	if id, err := b.Withdraw(ctx, Withdrawal{ClientID: "w_1", Asset: "USDT", Network: "tron", Address: "TAbc", Units: 1_000_000}); err != nil || id != "w9" {
		t.Fatalf("withdraw: %s %v", id, err)
	}
	// Balances: free plus locked, assets the registry knows, extra precision dropped.
	if bs, err := b.Balances(ctx); err != nil || len(bs) != 3 || bs["BTC"] != 10_500_000 || bs["BRL"] != 123456 || bs["ETH"] != 1_123456789 {
		t.Fatalf("balances: %v %v", bs, err)
	}
	if _, err := (&Binance{BaseURL: srv.URL, APIKey: key, SecretKey: "wrong"}).Deposits(ctx, "USDT", time.Now()); err == nil {
		t.Fatal("a bad signature must be refused")
	}
}

// The Kraken fake checks API-Sign the way Kraken does.
func TestKraken(t *testing.T) {
	secret := base64.StdEncoding.EncodeToString([]byte("kraken secret"))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reply := func(v string) { _, _ = w.Write([]byte(`{"error":[],"result":` + v + `}`)) }
		if strings.HasPrefix(r.URL.Path, "/0/private/") {
			body, _ := io.ReadAll(r.Body)
			form, _ := url.ParseQuery(string(body))
			sum := sha256.Sum256([]byte(form.Get("nonce") + string(body)))
			raw, _ := base64.StdEncoding.DecodeString(secret)
			m := hmac.New(sha512.New, raw)
			m.Write([]byte(r.URL.Path))
			m.Write(sum[:])
			if r.Header.Get("API-Sign") != base64.StdEncoding.EncodeToString(m.Sum(nil)) {
				_, _ = w.Write([]byte(`{"error":["EAPI:Invalid signature"]}`))
				return
			}
			switch r.URL.Path {
			case "/0/private/AddOrder":
				if form.Get("pair") != "XBTUSD" || form.Get("oflags") != "viqc" || form.Get("volume") != "100" {
					_, _ = w.Write([]byte(`{"error":["EGeneral:Invalid arguments"]}`))
					return
				}
				reply(`{"txid":["OABC-1"]}`)
			case "/0/private/QueryOrders":
				reply(`{"OABC-1":{"status":"closed","vol_exec":"0.00153846","cost":"100.00","fee":"0.26"}}`)
			case "/0/private/DepositAddresses":
				reply(`[{"address":"bc1qkraken","expiretm":"0","new":true}]`)
			case "/0/private/DepositStatus":
				reply(`[{"method":"Bitcoin","refid":"R1","txid":"tx","info":"bc1qkraken","amount":"0.01","time":1700000000,"status":"Success"}]`)
			case "/0/private/Withdraw":
				reply(`{"refid":"W1"}`)
			case "/0/private/Balance":
				reply(`{"XXBT":"0.0500000000","XETH":"2.5000000000","ZEUR":"100.0000","USDT":"25.00000000","ETH2.S":"1.0","XXDG":"10"}`)
			}
			return
		}
		reply(`{"XXBTZUSD":{"a":["65010.0","1","1.000"],"b":["64990.0","2","2.000"]}}`)
	}))
	defer srv.Close()
	k := &Kraken{BaseURL: srv.URL, APIKey: "k", SecretKey: secret, WithdrawKeys: map[string]string{"bc1qmine": "my cold wallet"}}
	// Kraken's legacy codes map back (XXBT is BTC, ZEUR is EUR); staked products are not custody.
	if bs, err := k.Balances(ctx); err != nil || len(bs) != 4 || bs["BTC"] != 5_000_000 || bs["ETH"] != 2_500_000_000 || bs["EUR"] != 10000 || bs["USDT"] != 25_000_000 {
		t.Fatalf("kraken balances: %v %v", bs, err)
	}
	if b, err := k.Book(ctx, "BTC", "USD"); err != nil || b.Bid != "64990.0" || b.Ask != "65010.0" {
		t.Fatalf("book: %+v %v", b, err)
	}
	f, err := k.Market(ctx, Order{ClientID: "c1", Side: Buy, Base: "BTC", Quote: "USD", QuoteUnits: 10000})
	if err != nil || f.BaseUnits != 153_846 || f.QuoteUnits != 10000 || f.FeeUnits != 26 {
		t.Fatalf("market: %+v %v", f, err)
	}
	if _, err := k.Market(ctx, Order{ClientID: "c2", Side: Sell, Base: "BTC", Quote: "USD", QuoteUnits: 10000}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("a quote-sized sell: %v", err)
	}
	if a, _, err := k.DepositAddress(ctx, "BTC", "bitcoin"); err != nil || a != "bc1qkraken" {
		t.Fatalf("address: %s %v", a, err)
	}
	if ds, err := k.Deposits(ctx, "BTC", time.Unix(0, 0)); err != nil || len(ds) != 1 || ds[0].Units != 1_000_000 || ds[0].Network != "bitcoin" || !ds[0].Confirmed {
		t.Fatalf("deposits: %+v %v", ds, err)
	}
	if id, err := k.Withdraw(ctx, Withdrawal{Asset: "BTC", Address: "bc1qmine", Units: 1000}); err != nil || id != "W1" {
		t.Fatalf("withdraw: %s %v", id, err)
	}
	if _, err := k.Withdraw(ctx, Withdrawal{Asset: "BTC", Address: "bc1qstranger", Units: 1000}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("an address without a key: %v", err)
	}
	if _, err := (&Kraken{BaseURL: srv.URL, SecretKey: base64.StdEncoding.EncodeToString([]byte("x"))}).Deposits(ctx, "BTC", time.Now()); err == nil {
		t.Fatal("a bad signature must be refused")
	}
}

// The Coinbase fake verifies the ES256 JWT: the key, the claims and the request it names.
func TestCoinbase(t *testing.T) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	const name = "organizations/o/apiKeys/k"
	var host string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		parts := strings.Split(tok, ".")
		var claims struct {
			Sub, Iss, URI string
			Exp, Nbf      int64
		}
		cb, _ := base64.RawURLEncoding.DecodeString(parts[1])
		_ = json.Unmarshal(cb, &claims)
		sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
		digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
		ok := len(sig) == 64 && ecdsa.Verify(&key.PublicKey, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:]))
		if !ok || claims.Sub != name || claims.Iss != "cdp" || claims.URI != r.Method+" "+host+r.URL.Path || claims.Exp-claims.Nbf != 120 {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":"UNAUTHENTICATED","message":"bad jwt"}`))
			return
		}
		switch {
		case r.URL.Path == "/api/v3/brokerage/best_bid_ask":
			_, _ = w.Write([]byte(`{"pricebooks":[{"product_id":"BTC-USD","bids":[{"price":"64980","size":"1"}],"asks":[{"price":"65020","size":"1"}]}]}`))
		case r.URL.Path == "/api/v3/brokerage/orders":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["client_order_id"] != "c1" || body["side"] != "SELL" {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"success":true,"success_response":{"order_id":"O1"}}`))
		case strings.HasPrefix(r.URL.Path, "/api/v3/brokerage/orders/historical/O1"):
			_, _ = w.Write([]byte(`{"order":{"status":"FILLED","filled_size":"0.001","filled_value":"64.98","total_fees":"0.39"}}`))
		case r.URL.Path == "/api/v3/brokerage/accounts" && r.URL.Query().Get("cursor") == "":
			_, _ = w.Write([]byte(`{"accounts":[{"currency":"BTC","available_balance":{"value":"0.2"},"hold":{"value":"0.05"}}],"has_next":true,"cursor":"p2"}`))
		case r.URL.Path == "/api/v3/brokerage/accounts":
			_, _ = w.Write([]byte(`{"accounts":[{"currency":"USDC","available_balance":{"value":"10.5"},"hold":{"value":"0"}}],"has_next":false,"cursor":""}`))
		}
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	host = u.Host
	c := &Coinbase{BaseURL: srv.URL, KeyName: name, Key: key}
	if b, err := c.Book(ctx, "BTC", "USD"); err != nil || b.Bid != "64980" {
		t.Fatalf("book: %+v %v", b, err)
	}
	if f, err := c.Market(ctx, Order{ClientID: "c1", Side: Sell, Base: "BTC", Quote: "USD", BaseUnits: 100_000}); err != nil || f.QuoteUnits != 6498 || f.FeeUnits != 39 {
		t.Fatalf("market: %+v %v", f, err)
	}
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if _, err := (&Coinbase{BaseURL: srv.URL, KeyName: name, Key: other}).Book(ctx, "BTC", "USD"); err == nil {
		t.Fatal("another key must be refused")
	}
	if bs, err := c.Balances(ctx); err != nil || bs["BTC"] != 25_000_000 || bs["USDC"] != 10_500_000 {
		t.Fatalf("coinbase balances, every page: %v %v", bs, err)
	}
	if _, _, err := c.DepositAddress(ctx, "BTC", "bitcoin"); !errors.Is(err, ErrUnsupported) {
		t.Fatal("deposits are not through Advanced Trade")
	}
}

func TestRouterAndMemory(t *testing.T) {
	cheap, dear := NewMemory("cheap"), NewMemory("dear")
	cheap.SetMid("BTC", "BRL", "340000")
	dear.SetMid("BTC", "BRL", "360000")
	r := &Router{Venues: []Exchange{dear, cheap, &Binance{BaseURL: "http://127.0.0.1:1"}}} // the third is down
	if ex, _, err := r.Best(ctx, Buy, "BTC", "BRL"); err != nil || ex.Name() != "cheap" {
		t.Fatalf("buy where it is cheapest: %v %v", ex, err)
	}
	if ex, _, err := r.Best(ctx, Sell, "BTC", "BRL"); err != nil || ex.Name() != "dear" {
		t.Fatalf("sell where it is dearest: %v %v", ex, err)
	}
	if _, _, err := r.Best(ctx, Buy, "BTC", "JPY"); !errors.Is(err, ErrNoVenue) {
		t.Fatalf("no venue: %v", err)
	}
	if len(r.Books(ctx, "BTC", "BRL")) != 2 {
		t.Fatal("books")
	}
	// The memory venue fills at its book, charges its fee and is idempotent by client ID.
	f, err := cheap.Market(ctx, Order{ClientID: "x", Side: Buy, Base: "BTC", Quote: "BRL", QuoteUnits: 34068_00})
	if err != nil || f.BaseUnits != 10_000_000 || f.FeeUnits != 3406 {
		t.Fatalf("memory fill: %+v %v", f, err)
	}
	if again, _ := cheap.Market(ctx, Order{ClientID: "x", Side: Buy, Base: "BTC", Quote: "BRL", QuoteUnits: 1}); again != f {
		t.Fatal("not idempotent")
	}
	a1, _, _ := cheap.DepositAddress(ctx, "USDT", "tron")
	a2, _, _ := cheap.DepositAddress(ctx, "USDT", "tron")
	if a1 != a2 || !strings.HasPrefix(a1, "T") || len(a1) != 34 {
		t.Fatalf("tron address %q", a1)
	}
	if _, _, err := cheap.DepositAddress(ctx, "BTC", "tron"); err == nil {
		t.Fatal("BTC is not on tron")
	}
	d := cheap.SimulateDeposit("USDT", "tron", a1, "", 5_000_000)
	if ds, _ := cheap.Deposits(ctx, "USDT", time.Now().Add(-time.Minute)); len(ds) != 1 || ds[0].ID != d.ID {
		t.Fatalf("deposits %+v", ds)
	}
	if _, err := cheap.Market(ctx, Order{ClientID: "y", Side: Buy, Base: "BTC", Quote: "BRL"}); err == nil {
		t.Fatal("an order without an amount")
	}
}

// The memory venue keeps balances the way an exchange account does, so the custody
// reconciliation can be tested end to end.
func TestMemoryBalances(t *testing.T) {
	m := NewMemory("m")
	m.Fund("BRL", 100_000_00)
	m.SimulateDeposit("USDT", "tron", "T", "", 10_000_000)
	buy, _ := m.Market(ctx, Order{ClientID: "b", Side: Buy, Base: "BTC", Quote: "BRL", QuoteUnits: 350_00})
	_, _ = m.Market(ctx, Order{ClientID: "b", Side: Buy, Base: "BTC", Quote: "BRL", QuoteUnits: 350_00}) // a retry fills nothing more
	sell, _ := m.Market(ctx, Order{ClientID: "s", Side: Sell, Base: "USDT", Quote: "BRL", BaseUnits: 10_000_000})
	_, _ = m.Withdraw(ctx, Withdrawal{ClientID: "w", Asset: "BTC", Units: 1_000, FeeUnits: 100})
	_, _ = m.Withdraw(ctx, Withdrawal{ClientID: "w", Asset: "BTC", Units: 1_000, FeeUnits: 100})
	bs, _ := m.Balances(ctx)
	if bs["BTC"] != buy.BaseUnits-1_100 || bs["USDT"] != 0 || bs["BRL"] != 100_000_00-buy.QuoteUnits-buy.FeeUnits+sell.QuoteUnits-sell.FeeUnits {
		t.Fatalf("balances %v (buy %+v sell %+v)", bs, buy, sell)
	}
	if _, ok := bs["USDT"]; ok {
		t.Fatal("a zero balance is not listed")
	}
}
