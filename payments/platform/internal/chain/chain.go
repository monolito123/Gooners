// Package chain finds who sent a deposit: the addresses a transaction's coins came from, read
// from the blockchain itself (docs/09 §6.5). The platform screens them against sanctions lists
// before it settles the deposit. Exchanges report the address a deposit arrived at, not
// where it came from, so each network has its own lookup:
//
//   - Bitcoin: an Esplora server (GET /tx/:txid, the inputs' prevout addresses);
//   - Ethereum and Polygon: a JSON-RPC node (the transaction's signer, and for tokens the
//     "from" of each ERC-20 Transfer log paying the deposit address);
//   - Tron: a full node's HTTP API (the owner_address of the transaction's contract);
//   - any network: a provider that answers a small JSON contract (Service), which an adapter
//     translates to a blockchain-analytics vendor's API.
package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Lookup finds the addresses that funded the transaction txid, which paid to on network.
type Lookup interface {
	Senders(ctx context.Context, network, asset, txid, to string) ([]string, error)
}

// ErrNoLookup is a network nobody configured a lookup for: the deposit cannot be screened.
var ErrNoLookup = errors.New("chain: no sender lookup for this network")

// Router picks the lookup for each network.
type Router map[string]Lookup

// Senders implements Lookup.
func (r Router) Senders(ctx context.Context, network, asset, txid, to string) ([]string, error) {
	l, ok := r[network]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrNoLookup, network)
	}
	out, err := l.Senders(ctx, network, asset, txid, to)
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("chain: %s transaction %s shows no sender", network, txid)
	}
	return out, nil
}

// All asks several independent sources about the same network (the platform's own node and
// a public one, or two vendors) and answers every sender any of them names. A source that
// fails fails the lookup (the deposit waits): a compromised or broken source can then add
// senders, never hide one.
type All []Lookup

// Senders implements Lookup.
func (a All) Senders(ctx context.Context, network, asset, txid, to string) ([]string, error) {
	if len(a) == 0 {
		return nil, fmt.Errorf("%w: %s", ErrNoLookup, network)
	}
	var out []string
	for i, l := range a {
		s, err := l.Senders(ctx, network, asset, txid, to)
		if err != nil {
			return nil, fmt.Errorf("source %d of %d: %w", i+1, len(a), err)
		}
		out = append(out, s...)
	}
	return unique(out), nil
}

var hexTx = regexp.MustCompile(`^(0x)?[0-9a-fA-F]{64}$`)

func checkTx(txid string) error {
	if !hexTx.MatchString(txid) {
		return fmt.Errorf("chain: %q is not a transaction id", txid)
	}
	return nil
}

func client(c *http.Client) *http.Client {
	if c != nil {
		return c
	}
	return &http.Client{Timeout: 15 * time.Second}
}

func getJSON(ctx context.Context, c *http.Client, method, u string, body any, header http.Header, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rd)
	if err != nil {
		return err
	}
	for k, v := range header {
		req.Header[k] = v
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client(c).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("chain: %s answered HTTP %d", req.URL.Host, resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(out)
}

func unique(xs []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, x := range xs {
		if x != "" && !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------- Bitcoin: Esplora

// Esplora reads Bitcoin transactions from an Esplora server (Blockstream's API, or one run
// by the platform: GET {URL}/tx/:txid). Every input's previous output address is a sender.
type Esplora struct {
	URL    string // e.g. https://blockstream.info/api
	Client *http.Client
}

// Senders implements Lookup.
func (e *Esplora) Senders(ctx context.Context, _, _, txid, _ string) ([]string, error) {
	if err := checkTx(txid); err != nil {
		return nil, err
	}
	var tx struct {
		Vin []struct {
			IsCoinbase bool `json:"is_coinbase"`
			Prevout    *struct {
				Address string `json:"scriptpubkey_address"`
			} `json:"prevout"`
		} `json:"vin"`
	}
	if err := getJSON(ctx, e.Client, http.MethodGet, strings.TrimRight(e.URL, "/")+"/tx/"+url.PathEscape(strings.TrimPrefix(txid, "0x")), nil, nil, &tx); err != nil {
		return nil, err
	}
	var out []string
	for _, in := range tx.Vin {
		if in.IsCoinbase {
			return nil, errors.New("chain: a coinbase transaction has no sender to screen")
		}
		if in.Prevout == nil || in.Prevout.Address == "" {
			// A script with no standard address: nobody can screen it, so neither can we.
			return nil, errors.New("chain: an input has no address")
		}
		out = append(out, in.Prevout.Address)
	}
	return unique(out), nil
}

// ---------------------------------------------------------------- Ethereum and Polygon: JSON-RPC

// TransferTopic is keccak256("Transfer(address,address,uint256)"), the ERC-20 event.
const TransferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

// EVM reads transactions from an Ethereum-compatible node over JSON-RPC. The signer of the
// transaction is a sender; for a token, so is the "from" of each Transfer log that paid the
// deposit address (a contract wallet or a router may move the tokens for someone else).
type EVM struct {
	URL    string
	Client *http.Client
}

func (e *EVM) call(ctx context.Context, method string, params []any, out any) error {
	var resp struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := getJSON(ctx, e.Client, http.MethodPost, e.URL, map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, nil, &resp); err != nil {
		return err
	}
	if resp.Error != nil {
		return fmt.Errorf("chain: %s: %d %s", method, resp.Error.Code, resp.Error.Message)
	}
	if len(resp.Result) == 0 || string(resp.Result) == "null" {
		return fmt.Errorf("chain: %s: transaction not found", method)
	}
	return json.Unmarshal(resp.Result, out)
}

// Senders implements Lookup.
func (e *EVM) Senders(ctx context.Context, _, asset, txid, to string) ([]string, error) {
	if err := checkTx(txid); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(txid, "0x") {
		txid = "0x" + txid
	}
	var tx struct {
		From string `json:"from"`
	}
	if err := e.call(ctx, "eth_getTransactionByHash", []any{txid}, &tx); err != nil {
		return nil, err
	}
	out := []string{strings.ToLower(tx.From)}
	if asset != "ETH" {
		var rc struct {
			Logs []struct {
				Topics []string `json:"topics"`
			} `json:"logs"`
		}
		if err := e.call(ctx, "eth_getTransactionReceipt", []any{txid}, &rc); err != nil {
			return nil, err
		}
		dest := strings.ToLower(to)
		paid := false
		for _, l := range rc.Logs {
			if len(l.Topics) != 3 || !strings.EqualFold(l.Topics[0], TransferTopic) {
				continue
			}
			if topicAddress(l.Topics[2]) == dest {
				out = append(out, topicAddress(l.Topics[1]))
				paid = true
			}
		}
		if !paid {
			return nil, fmt.Errorf("chain: transaction %s has no token transfer to %s", txid, to)
		}
	}
	return unique(out), nil
}

// topicAddress is the address in an indexed event argument (the last 20 of its 32 bytes).
func topicAddress(t string) string {
	t = strings.ToLower(strings.TrimPrefix(t, "0x"))
	if len(t) != 64 {
		return ""
	}
	return "0x" + t[24:]
}

// ---------------------------------------------------------------- Tron

// Tron reads a transaction from a Tron full node's HTTP API (TronGrid, or the platform's
// own node): POST {URL}/wallet/gettransactionbyid with visible=true answers base58 addresses,
// and the owner_address of the transaction's contract is who signed it (for TRC-20 tokens,
// the holder calling transfer).
type Tron struct {
	URL, APIKey string
	Client      *http.Client
}

// Senders implements Lookup.
func (t *Tron) Senders(ctx context.Context, _, _, txid, _ string) ([]string, error) {
	if err := checkTx(txid); err != nil {
		return nil, err
	}
	var h http.Header
	if t.APIKey != "" {
		h = http.Header{"Tron-Pro-Api-Key": {t.APIKey}}
	}
	var tx struct {
		RawData *struct {
			Contract []struct {
				Parameter struct {
					Value struct {
						Owner string `json:"owner_address"`
					} `json:"value"`
				} `json:"parameter"`
			} `json:"contract"`
		} `json:"raw_data"`
	}
	if err := getJSON(ctx, t.Client, http.MethodPost, strings.TrimRight(t.URL, "/")+"/wallet/gettransactionbyid",
		map[string]any{"value": strings.TrimPrefix(txid, "0x"), "visible": true}, h, &tx); err != nil {
		return nil, err
	}
	if tx.RawData == nil {
		return nil, fmt.Errorf("chain: tron transaction %s not found", txid) // the node answers {} for an unknown id
	}
	var out []string
	for _, c := range tx.RawData.Contract {
		out = append(out, c.Parameter.Value.Owner)
	}
	return unique(out), nil
}

// ---------------------------------------------------------------- a provider

// Service asks a provider (a blockchain-analytics vendor, through an adapter) who funded a
// transaction:
//
//	GET {URL}?network=…&asset=…&txid=…&address=…   (header Authorization: Bearer {Token})
//	→ {"senders": ["…", "…"]}
type Service struct {
	URL, Token string
	Client     *http.Client
}

// Senders implements Lookup.
func (s *Service) Senders(ctx context.Context, network, asset, txid, to string) ([]string, error) {
	u := s.URL + "?" + url.Values{"network": {network}, "asset": {asset}, "txid": {txid}, "address": {to}}.Encode()
	var h http.Header
	if s.Token != "" {
		h = http.Header{"Authorization": {"Bearer " + s.Token}}
	}
	var r struct {
		Senders *[]string `json:"senders"`
	}
	if err := getJSON(ctx, s.Client, http.MethodGet, u, nil, h, &r); err != nil {
		return nil, err
	}
	if r.Senders == nil {
		return nil, errors.New(`chain: the answer has no "senders" field`)
	}
	return unique(*r.Senders), nil
}
