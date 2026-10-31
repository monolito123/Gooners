package chain

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

const tx = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b"

func TestEsplora(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/tx/"+tx {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, `{"txid":"`+tx+`","vin":[{"prevout":{"scriptpubkey_address":"bc1qb"}},{"prevout":{"scriptpubkey_address":"bc1qa"}},{"prevout":{"scriptpubkey_address":"bc1qa"}}],"vout":[]}`)
	}))
	defer srv.Close()
	got, err := (&Esplora{URL: srv.URL + "/api/"}).Senders(context.Background(), "bitcoin", "BTC", tx, "bc1qdeposit")
	if err != nil || !reflect.DeepEqual(got, []string{"bc1qa", "bc1qb"}) {
		t.Fatalf("%v %v", got, err)
	}
	if _, err := (&Esplora{URL: srv.URL + "/api"}).Senders(context.Background(), "bitcoin", "BTC", "../x", ""); err == nil {
		t.Fatal("a malformed txid reached the server")
	}
	if _, err := (&Esplora{URL: srv.URL}).Senders(context.Background(), "bitcoin", "BTC", tx, ""); err == nil {
		t.Fatal("a 404 was not an error")
	}
}

func TestEVM(t *testing.T) {
	const deposit = "0x1111111111111111111111111111111111111111"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string `json:"method"`
			Params []any  `json:"params"`
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &req)
		switch req.Method {
		case "eth_getTransactionByHash":
			_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":{"from":"0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa"}}`)
		case "eth_getTransactionReceipt":
			_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":{"logs":[
				{"topics":["`+TransferTopic+`","0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","0x000000000000000000000000`+strings.TrimPrefix(deposit, "0x")+`"]},
				{"topics":["`+TransferTopic+`","0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc","0x000000000000000000000000dddddddddddddddddddddddddddddddddddddddd"]}]}}`)
		default:
			_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"no"}}`)
		}
	}))
	defer srv.Close()
	e := &EVM{URL: srv.URL}
	got, err := e.Senders(context.Background(), "ethereum", "ETH", tx, deposit)
	if err != nil || !reflect.DeepEqual(got, []string{"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}) {
		t.Fatalf("ether: %v %v", got, err)
	}
	// A token: the signer, and the holder whose Transfer paid the deposit address (not the
	// other transfer in the same transaction).
	got, err = e.Senders(context.Background(), "ethereum", "USDT", "0x"+tx, deposit)
	if err != nil || !reflect.DeepEqual(got, []string{"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}) {
		t.Fatalf("token: %v %v", got, err)
	}
	if _, err := e.Senders(context.Background(), "ethereum", "USDT", tx, "0x2222222222222222222222222222222222222222"); err == nil {
		t.Fatal("a transaction that paid someone else was taken as the deposit")
	}
}

func TestTron(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &req)
		if r.URL.Path != "/wallet/gettransactionbyid" || req["visible"] != true || r.Header.Get("TRON-PRO-API-KEY") != "k" {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		if req["value"] != tx {
			_, _ = io.WriteString(w, `{}`)
			return
		}
		_, _ = io.WriteString(w, `{"txID":"`+tx+`","raw_data":{"contract":[{"parameter":{"value":{"owner_address":"TOwnerAddress","contract_address":"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"},"type_url":"type.googleapis.com/protocol.TriggerSmartContract"},"type":"TriggerSmartContract"}]}}`)
	}))
	defer srv.Close()
	tr := &Tron{URL: srv.URL, APIKey: "k"}
	got, err := tr.Senders(context.Background(), "tron", "USDT", tx, "TDeposit")
	if err != nil || !reflect.DeepEqual(got, []string{"TOwnerAddress"}) {
		t.Fatalf("%v %v", got, err)
	}
	if _, err := tr.Senders(context.Background(), "tron", "USDT", strings.Repeat("0", 64), "TDeposit"); err == nil {
		t.Fatal("an unknown transaction answered")
	}
}

func TestServiceAndRouter(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if r.Header.Get("Authorization") != "Bearer tok" || q.Get("network") != "solana" || q.Get("txid") != "sig" {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		_, _ = io.WriteString(w, `{"senders":["So1"]}`)
	}))
	defer srv.Close()
	r := Router{"solana": &Service{URL: srv.URL, Token: "tok"}}
	got, err := r.Senders(context.Background(), "solana", "USDC", "sig", "dep")
	if err != nil || !reflect.DeepEqual(got, []string{"So1"}) {
		t.Fatalf("%v %v", got, err)
	}
	if _, err := r.Senders(context.Background(), "tron", "USDT", tx, "T"); !errors.Is(err, ErrNoLookup) {
		t.Fatalf("an unconfigured network: %v", err)
	}
}
