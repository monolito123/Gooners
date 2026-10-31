package payments

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/assets"
	"github.com/monolito123/Gooners/payments/platform/internal/exchange"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
)

// Crypto defaults (Config overrides them).
const (
	defaultCryptoFeeBps    = 150 // the merchant's fee on a crypto payment or conversion
	defaultCryptoSpreadBps = 50  // margin over the venue's price in a quote
	cryptoChargeTTL        = 15 * time.Minute
	conversionTTL          = 30 * time.Second
	maxSlippageBps         = 100 // a conversion refuses to execute if the market moved more against it
)

// cryptoNetworkFees are what a withdrawal costs on each network, in the asset's units: the
// venue keeps them, the merchant pays them. Set from the venues' current fees in production.
var cryptoNetworkFees = map[string]int64{
	"BTC/bitcoin": 10_000, "ETH/ethereum": 500_000, "USDT/ethereum": 5_000_000, "USDT/tron": 1_000_000,
	"USDT/polygon": 500_000, "USDT/solana": 500_000, "USDC/ethereum": 5_000_000, "USDC/polygon": 500_000, "USDC/solana": 500_000,
}

var addressFormats = map[string]*regexp.Regexp{
	"bitcoin":  regexp.MustCompile(`^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$`),
	"ethereum": regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`),
	"polygon":  regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`),
	"tron":     regexp.MustCompile(`^T[1-9A-HJ-NP-Za-km-z]{33}$`),
	"solana":   regexp.MustCompile(`^[1-9A-HJ-NP-Za-km-z]{32,44}$`),
}

// ErrCryptoDisabled is a crypto call without a configured exchange.
var ErrCryptoDisabled = fmt.Errorf("%w: no crypto exchange is configured", ErrDisabled)

func (s *Service) cryptoFeeBps() int64 {
	if s.cfg.CryptoFeeBps > 0 {
		return int64(s.cfg.CryptoFeeBps)
	}
	return defaultCryptoFeeBps
}

func (s *Service) cryptoSpreadBps() int {
	if s.cfg.CryptoSpreadBps > 0 {
		return s.cfg.CryptoSpreadBps
	}
	return defaultCryptoSpreadBps
}

func cryptoAsset(code string) (assets.Asset, error) {
	a, err := assets.Get(code)
	if err != nil || a.Kind != "crypto" {
		return assets.Asset{}, invalid("asset must be one of BTC, ETH, USDT, USDC")
	}
	return a, nil
}

// ensure opens the ledger accounts a flow needs, once per process and tenant.
func (s *Service) ensure(ctx context.Context, tenantID string, accts ...ledger.Account) error {
	for _, a := range accts {
		key := tenantID + "/" + a.ID
		if _, ok := s.opened.Load(key); ok {
			continue
		}
		a.TenantID = tenantID
		if err := s.ledger.EnsureAccount(ctx, a); err != nil {
			return err
		}
		s.opened.Store(key, true)
	}
	return nil
}

func custodyAcct(venue, code string) ledger.Account {
	return ledger.Account{ID: ledger.Custody(venue, code), Code: "asset.custody", Currency: code, NormalSide: ledger.Debit}
}

func holdingAcct(m, code string) ledger.Account {
	return ledger.Account{ID: ledger.MerchantHolding(m, code), Code: "liability.merchant_holding", Currency: code, NormalSide: ledger.Credit}
}

func (s *Service) conversionAccts(ctx context.Context, tenantID string) error {
	return s.ensure(ctx, tenantID,
		ledger.Account{ID: ledger.AccRevenueConversionFees, Code: "revenue.conversion_fees", Currency: assets.Base, NormalSide: ledger.Credit},
		ledger.Account{ID: ledger.AccConversionResult, Code: "revenue.conversion_result", Currency: assets.Base, NormalSide: ledger.Credit, AllowNegative: true},
		ledger.Account{ID: ledger.AccIOFPayable, Code: "liability.iof_payable", Currency: assets.Base, NormalSide: ledger.Credit})
}

// result books the difference between what a conversion promised and what it raised.
func result(n int64) []ledger.Posting {
	switch {
	case n > 0:
		return []ledger.Posting{{Account: ledger.AccConversionResult, Direction: ledger.Credit, Amount: n}}
	case n < 0:
		return []ledger.Posting{{Account: ledger.AccConversionResult, Direction: ledger.Debit, Amount: -n}}
	}
	return nil
}

// ---------------------------------------------------------------- crypto payments

// CryptoCharge is what the customer must send.
type CryptoCharge struct {
	Asset, Network, Address, Memo, Amount, Price string
	Units                                        int64
	ExpiresAt                                    time.Time
	URI                                          string
}

// ConfirmCrypto quotes a crypto payment: the asset amount for the intent's reais at the best
// venue's bid less the spread, made unique among pending charges on the same address, and the
// address to send it to. The quote holds for 15 minutes.
func (s *Service) ConfirmCrypto(ctx context.Context, tenantID, id, code, network string) (*Intent, error) {
	if s.exchanges == nil {
		return nil, ErrCryptoDisabled
	}
	a, err := cryptoAsset(code)
	if err != nil {
		return nil, err
	}
	if !a.OnNetwork(network) {
		return nil, invalid("%s moves on %s, not %q", a.Code, strings.Join(a.Networks, ", "), network)
	}
	pi, err := s.GetIntent(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if pi.Channel != "crypto" {
		return nil, invalid("payment intent channel is %s", pi.Channel)
	}
	if pi.Status == StatusRequiresAction {
		return pi, nil // already quoted: the same address and amount
	}
	if err := s.claim(ctx, tenantID, id, StatusProcessing, StatusRequiresPaymentMethod); err != nil {
		return nil, err
	}
	release := func() { _ = s.claim(ctx, tenantID, id, StatusRequiresPaymentMethod, StatusProcessing) }
	venue, book, err := s.exchanges.Best(ctx, exchange.Sell, a.Code, assets.Base)
	if err != nil {
		release()
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	address, memo, err := venue.DepositAddress(ctx, a.Code, network)
	if err != nil {
		release()
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	// The customer pays at the bid less the spread: the sale must raise the reais even if
	// the market moves a little before the coins arrive.
	price, _ := assets.ApplyBps(book.Bid, -s.cryptoSpreadBps())
	brl, _ := assets.Get(assets.Base)
	units, err := ceilConvert(pi.Amount, brl, a, price)
	if err != nil {
		release()
		return nil, err
	}
	expires := s.cfg.Now().Add(cryptoChargeTTL)
	for attempt := 0; ; attempt++ {
		u := units + uniqueTail(a) // tells this payment's deposit apart from others to the same address
		_, err = s.pool.Exec(ctx, `INSERT INTO crypto_charges (payment_intent_id, tenant_id, merchant_id, exchange, asset, network, address, memo, units, price, status, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)`, id, tenantID, pi.MerchantID, venue.Name(), a.Code, network, address, memo, u, price, expires)
		if err == nil || attempt == 4 || !strings.Contains(err.Error(), "crypto_charges_match") {
			break
		}
	}
	if err != nil {
		release()
		return nil, err
	}
	if err := s.claim(ctx, tenantID, id, StatusRequiresAction, StatusProcessing); err != nil {
		return nil, err
	}
	s.notify(ctx, tenantID, "payment_intent.requires_action", map[string]any{"id": id, "next_action": "crypto_transfer"})
	return s.GetIntent(ctx, tenantID, id)
}

// ceilConvert is the asset amount worth at least brlUnits at price (reais per whole asset).
func ceilConvert(brlUnits int64, brl, a assets.Asset, price string) (int64, error) {
	p, ok := new(big.Rat).SetString(price)
	if !ok || p.Sign() <= 0 {
		return 0, fmt.Errorf("bad price %q", price)
	}
	v := new(big.Rat).SetFrac(big.NewInt(brlUnits), brl.Scale())
	v.Quo(v, p)
	v.Mul(v, new(big.Rat).SetInt(a.Scale()))
	q, r := new(big.Int).QuoRem(v.Num(), v.Denom(), new(big.Int))
	if r.Sign() > 0 {
		q.Add(q, big.NewInt(1))
	}
	if !q.IsInt64() {
		return 0, errors.New("amount out of range")
	}
	return q.Int64(), nil
}

// uniqueTail is a few of the asset's smallest units: worth a fraction of a centavo.
func uniqueTail(a assets.Asset) int64 {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	n := int64(b[0])<<8 | int64(b[1])
	if a.Decimals >= 8 {
		return 1 + n%999
	}
	return 1 + n%99
}

func (s *Service) cryptoAction(ctx context.Context, in *Intent) {
	var c CryptoCharge
	var status string
	var txid *string
	err := s.pool.QueryRow(ctx, `SELECT asset, network, address, memo, units, price, expires_at, status, txid FROM crypto_charges WHERE payment_intent_id = $1`, in.ID).
		Scan(&c.Asset, &c.Network, &c.Address, &c.Memo, &c.Units, &c.Price, &c.ExpiresAt, &status, &txid)
	if err != nil {
		return
	}
	a, _ := assets.Get(c.Asset)
	c.Amount = a.Format(c.Units)
	att := map[string]any{"type": "crypto", "asset": c.Asset, "network": c.Network, "status": status}
	if txid != nil {
		att["txid"] = *txid
	}
	in.LatestAttempt = att
	if in.Status == StatusRequiresAction && status == "pending" {
		act := map[string]any{"type": "crypto_transfer", "asset": c.Asset, "network": c.Network, "address": c.Address, "amount": c.Amount,
			"amount_units": c.Units, "price": c.Price, "expires_at": c.ExpiresAt.UTC().Format(time.RFC3339), "uri": paymentURI(c, a)}
		if c.Memo != "" {
			act["memo"] = c.Memo
		}
		in.NextAction = act
	}
}

// paymentURI is what a wallet reads from the QR code (BIP-21 for bitcoin, EIP-681-style for
// the others; wallets that do not parse it still read the address).
func paymentURI(c CryptoCharge, a assets.Asset) string {
	switch c.Network {
	case "bitcoin":
		return "bitcoin:" + c.Address + "?amount=" + strings.TrimRight(strings.TrimRight(c.Amount, "0"), ".")
	case "ethereum", "polygon":
		if c.Asset == "ETH" {
			return "ethereum:" + c.Address + "?value=" + new(big.Int).Mul(big.NewInt(c.Units), big.NewInt(1_000_000_000)).String() // gwei to wei
		}
	}
	return c.Address
}

// PollCryptoDeposits reads the deposits every venue with pending charges has seen, and
// settles each charge its deposit matches: the asset is sold for reais at once and the
// merchant credited the intent's amount less the fee. A deposit that matches nothing is
// recorded for operations. It returns how many payments it settled.
func (s *Service) PollCryptoDeposits(ctx context.Context) (int, error) {
	if s.exchanges == nil {
		return 0, nil
	}
	rows, err := s.pool.Query(ctx, `SELECT exchange, asset, min(created_at) FROM crypto_charges WHERE status = 'pending' GROUP BY 1, 2`)
	if err != nil {
		return 0, err
	}
	type group struct {
		venue, asset string
		since        time.Time
	}
	var gs []group
	for rows.Next() {
		var g group
		if err := rows.Scan(&g.venue, &g.asset, &g.since); err != nil {
			rows.Close()
			return 0, err
		}
		gs = append(gs, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	settled := 0
	for _, g := range gs {
		venue, ok := s.exchanges.Venue(g.venue)
		if !ok {
			continue
		}
		deps, err := venue.Deposits(ctx, g.asset, g.since.Add(-time.Hour))
		if err != nil {
			s.log.Warn("crypto deposits", "venue", g.venue, "asset", g.asset, "err", err)
			continue
		}
		for _, d := range deps {
			if !d.Confirmed {
				continue
			}
			ok, err := s.settleDeposit(ctx, venue, d)
			if err != nil {
				s.log.Error("crypto deposit", "venue", g.venue, "deposit", d.ID, "err", err)
				continue
			}
			if ok {
				settled++
			}
		}
	}
	return settled, nil
}

func (s *Service) settleDeposit(ctx context.Context, venue exchange.Exchange, d exchange.Deposit) (bool, error) {
	var piID, tenantID, merchantID, status string
	var expires time.Time
	err := s.pool.QueryRow(ctx, `SELECT payment_intent_id, tenant_id::text, merchant_id, status, expires_at FROM crypto_charges
		WHERE exchange = $1 AND asset = $2 AND network = $3 AND address = $4 AND memo = $5 AND units = $6 AND status IN ('pending', 'expired')
		ORDER BY status DESC LIMIT 1`, venue.Name(), d.Asset, d.Network, d.Address, d.Memo, d.Units).Scan(&piID, &tenantID, &merchantID, &status, &expires)
	var match *string
	if err == nil {
		match = &piID
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	tag, err := s.pool.Exec(ctx, `INSERT INTO crypto_deposits (exchange, deposit_id, asset, units, matched_to) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
		venue.Name(), d.ID, d.Asset, d.Units, match)
	if err != nil || tag.RowsAffected() == 0 || match == nil {
		return false, err // seen before, or an exception for operations
	}
	if status == "expired" || s.cfg.Now().After(expires) {
		// Paid after the quote ran out: the price is no longer honoured. Operations returns
		// the coins or settles at the market with the customer's agreement.
		_, err := s.pool.Exec(ctx, `UPDATE crypto_charges SET status = 'late', deposit_id = $2, txid = $3 WHERE payment_intent_id = $1`, piID, d.ID, d.TxID)
		return false, err
	}
	pi, err := s.GetIntent(ctx, tenantID, piID)
	if err != nil {
		return false, err
	}
	fill, err := venue.Market(ctx, exchange.Order{ClientID: piID, Side: exchange.Sell, Base: d.Asset, Quote: assets.Base, BaseUnits: d.Units})
	if err != nil {
		// The sale failed: the coins stay in custody and the next poll will not see the deposit
		// again, so the charge is left pending for operations to sell by hand.
		s.log.Error("sell crypto payment", "payment_intent", piID, "err", err)
		return false, err
	}
	exFee := int64(0)
	if fill.FeeAsset == assets.Base {
		exFee = fill.FeeUnits
	}
	fee := pi.Amount * s.cryptoFeeBps() / 10000
	net := pi.Amount - fee
	if err := s.conversionAccts(ctx, tenantID); err != nil {
		return false, err
	}
	if err := s.ensure(ctx, tenantID, custodyAcct(venue.Name(), d.Asset), custodyAcct(venue.Name(), assets.Base),
		ledger.Account{ID: ledger.AssetClearing(d.Asset), Code: "liability.asset_clearing", Currency: d.Asset, NormalSide: ledger.Credit}); err != nil {
		return false, err
	}
	custody, clearing := ledger.Custody(venue.Name(), d.Asset), ledger.AssetClearing(d.Asset)
	if err := s.post(ctx, tenantID, "crypto_deposit:"+piID, "crypto_deposit", piID, []ledger.Posting{
		{Account: custody, Direction: ledger.Debit, Amount: d.Units}, {Account: clearing, Direction: ledger.Credit, Amount: d.Units}}); err != nil {
		return false, err
	}
	if err := s.post(ctx, tenantID, "crypto_sale:"+piID, "crypto_sale", piID, []ledger.Posting{
		{Account: clearing, Direction: ledger.Debit, Amount: d.Units}, {Account: custody, Direction: ledger.Credit, Amount: d.Units}}); err != nil {
		return false, err
	}
	raised := fill.QuoteUnits - exFee
	ps := []ledger.Posting{
		{Account: ledger.Custody(venue.Name(), assets.Base), Direction: ledger.Debit, Amount: raised},
		{Account: ledger.MerchantWallet(merchantID), Direction: ledger.Credit, Amount: net},
		{Account: ledger.AccRevenueConversionFees, Direction: ledger.Credit, Amount: fee},
	}
	ps = append(ps, result(raised-pi.Amount)...)
	ps = append(ps, ledger.SafeguardTopup(net)...)
	if err := s.post(ctx, tenantID, "crypto_settle:"+piID, "crypto_settle", piID, ps); err != nil {
		return false, err
	}
	now := s.cfg.Now()
	if _, err := s.pool.Exec(ctx, `UPDATE crypto_charges SET status = 'paid', deposit_id = $2, txid = $3, proceeds = $4, paid_at = $5 WHERE payment_intent_id = $1`,
		piID, d.ID, d.TxID, raised, now); err != nil {
		return false, err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE payment_intents SET status = $3, amount_captured = amount, fee = $4, settlement_mode = 'instant', captured_at = $5, updated_at = now()
		WHERE tenant_id = $1 AND id = $2`, tenantID, piID, StatusCaptured, fee, now); err != nil {
		return false, err
	}
	if m, err := s.GetMerchant(ctx, tenantID, merchantID); err == nil {
		s.issueReceipt(ctx, tenantID, pi, m, map[string]any{"type": "crypto", "asset": d.Asset, "network": d.Network, "txid": d.TxID},
			map[string]any{"approved_at": now.UTC().Format(time.RFC3339)}, "")
	}
	s.notify(ctx, tenantID, "payment_intent.captured", map[string]any{"id": piID, "object": "payment_intent", "status": StatusCaptured, "amount": pi.Amount,
		"currency": pi.Currency, "merchant_id": merchantID})
	return true, nil
}

// ExpireCryptoCharges ends the quotes nobody paid in time: their intents are canceled.
func (s *Service) ExpireCryptoCharges(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.pool.Query(ctx, `UPDATE crypto_charges SET status = 'expired' WHERE status = 'pending' AND expires_at < $1 RETURNING payment_intent_id, tenant_id::text`, now)
	if err != nil {
		return 0, err
	}
	type x struct{ pi, tenant string }
	var xs []x
	for rows.Next() {
		var v x
		if err := rows.Scan(&v.pi, &v.tenant); err == nil {
			xs = append(xs, v)
		}
	}
	rows.Close()
	for _, v := range xs {
		_, _ = s.pool.Exec(ctx, `UPDATE payment_intents SET status = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = $4`,
			v.tenant, v.pi, StatusCanceled, StatusRequiresAction)
		s.notify(ctx, v.tenant, "payment_intent.canceled", map[string]any{"id": v.pi, "reason": "crypto quote expired"})
	}
	return len(xs), rows.Err()
}

// SimulateCryptoPayment pays a pending crypto charge from the sandbox's exchange, as the
// customer's wallet would, then polls. Sandbox only.
func (s *Service) SimulateCryptoPayment(ctx context.Context, tenantID, id string) (*Intent, error) {
	mem, ok := s.sandboxExchange()
	if !ok {
		return nil, fmt.Errorf("%w: the sandbox exchange is not running", ErrDisabled)
	}
	var c CryptoCharge
	if err := s.pool.QueryRow(ctx, `SELECT asset, network, address, memo, units FROM crypto_charges WHERE tenant_id = $1 AND payment_intent_id = $2 AND status = 'pending'`,
		tenantID, id).Scan(&c.Asset, &c.Network, &c.Address, &c.Memo, &c.Units); err != nil {
		return nil, fmt.Errorf("%w: no pending crypto charge", ErrNotFound)
	}
	mem.SimulateDeposit(c.Asset, c.Network, c.Address, c.Memo, c.Units)
	if _, err := s.PollCryptoDeposits(ctx); err != nil {
		return nil, err
	}
	return s.GetIntent(ctx, tenantID, id)
}

func (s *Service) sandboxExchange() (*exchange.Memory, bool) {
	if s.exchanges == nil || s.cfg.Env == "production" {
		return nil, false
	}
	for _, v := range s.exchanges.Venues {
		if m, ok := v.(*exchange.Memory); ok {
			return m, true
		}
	}
	return nil, false
}

// ---------------------------------------------------------------- markets and holdings

// Market is an asset's price in reais at the best venues.
type Market struct {
	Asset    string   `json:"asset"`
	Name     string   `json:"name"`
	Networks []string `json:"networks"`
	Bid      string   `json:"bid,omitempty"` // the best price to sell at
	BidVenue string   `json:"bid_venue,omitempty"`
	Ask      string   `json:"ask,omitempty"` // the best price to buy at
	AskVenue string   `json:"ask_venue,omitempty"`
}

// CryptoMarkets lists every crypto-asset's best prices in reais.
func (s *Service) CryptoMarkets(ctx context.Context) ([]Market, error) {
	if s.exchanges == nil {
		return nil, ErrCryptoDisabled
	}
	out := []Market{}
	for _, a := range assets.All() {
		if a.Kind != "crypto" {
			continue
		}
		m := Market{Asset: a.Code, Name: a.Name, Networks: a.Networks}
		if v, b, err := s.exchanges.Best(ctx, exchange.Sell, a.Code, assets.Base); err == nil {
			m.Bid, m.BidVenue = b.Bid, v.Name()
		}
		if v, b, err := s.exchanges.Best(ctx, exchange.Buy, a.Code, assets.Base); err == nil {
			m.Ask, m.AskVenue = b.Ask, v.Name()
		}
		out = append(out, m)
	}
	return out, nil
}

// Holding is a merchant's balance in an asset other than reais.
type Holding struct {
	Asset    string `json:"asset"`
	Kind     string `json:"kind"`
	Units    int64  `json:"units"`
	Amount   string `json:"amount"`
	ValueBRL *int64 `json:"value_brl"` // at the best price to sell now; null when no venue quotes it
}

// Holdings lists a merchant's balances in crypto-assets and foreign currencies.
func (s *Service) Holdings(ctx context.Context, tenantID, merchantID string) ([]Holding, error) {
	rows, err := s.pool.Query(ctx, `SELECT a.account_id, a.currency, COALESCE(SUM(b.balance), 0) FROM ledger_accounts a LEFT JOIN balances b USING (tenant_id, account_id)
		WHERE a.tenant_id = $1 AND a.account_id LIKE $2 GROUP BY 1, 2 ORDER BY 2`, tenantID, ledger.MerchantHolding(merchantID, "")+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Holding{}
	brl, _ := assets.Get(assets.Base)
	for rows.Next() {
		var acct, code string
		var units int64
		if err := rows.Scan(&acct, &code, &units); err != nil {
			return nil, err
		}
		a, err := assets.Get(strings.TrimSpace(code))
		if err != nil {
			continue
		}
		h := Holding{Asset: a.Code, Kind: a.Kind, Units: units, Amount: a.Format(units)}
		if price, ok := s.sellPrice(ctx, a); ok && units > 0 {
			if v, err := assets.Convert(units, a, brl, price); err == nil {
				h.ValueBRL = &v
			}
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// sellPrice is the reais one whole unit of a would fetch now.
func (s *Service) sellPrice(ctx context.Context, a assets.Asset) (string, bool) {
	if a.Kind == "crypto" && s.exchanges != nil {
		if _, b, err := s.exchanges.Best(ctx, exchange.Sell, a.Code, assets.Base); err == nil {
			return b.Bid, true
		}
	}
	if a.Kind == "fiat" && s.fx != nil {
		if q, err := s.fx.Rate(ctx, a.Code, assets.Base); err == nil {
			return q, true
		}
	}
	return "", false
}

// ---------------------------------------------------------------- conversions

// Conversion is a quote to move a merchant's money between reais and another asset, and,
// once executed, its record.
type Conversion struct {
	ID         string `json:"id"`
	Object     string `json:"object"`
	Kind       string `json:"kind"`
	MerchantID string `json:"merchant_id"`
	Side       string `json:"side"` // buy: reais into the asset; sell: the asset into reais
	Asset      string `json:"asset"`
	AssetUnits int64  `json:"asset_units"`
	Amount     string `json:"amount"` // the asset, as a decimal
	BRLUnits   int64  `json:"brl_units"`
	Fee        int64  `json:"fee"`
	Tax        int64  `json:"tax"`
	Total      int64  `json:"total"` // buy: what leaves the wallet; sell: what arrives in it
	Price      string `json:"price"`
	Venue      string `json:"venue"`
	Status     string `json:"status"`
	ExpiresAt  string `json:"expires_at"`
}

const conversionCols = `id, kind, merchant_id, side, asset, asset_units, brl_units, fee, tax, price, venue, status, expires_at`

func scanConversion(row pgx.Row) (*Conversion, error) {
	c := &Conversion{Object: "conversion"}
	var exp time.Time
	if err := row.Scan(&c.ID, &c.Kind, &c.MerchantID, &c.Side, &c.Asset, &c.AssetUnits, &c.BRLUnits, &c.Fee, &c.Tax, &c.Price, &c.Venue, &c.Status, &exp); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.Asset = strings.TrimSpace(c.Asset)
	a, _ := assets.Get(c.Asset)
	c.Amount = a.Format(c.AssetUnits)
	c.ExpiresAt = exp.UTC().Format(time.RFC3339)
	if c.Side == exchange.Buy {
		c.Total = c.BRLUnits + c.Fee + c.Tax
	} else {
		c.Total = c.BRLUnits - c.Fee - c.Tax
	}
	return c, nil
}

// ConversionRequest asks for a quote: an amount in reais (BRLUnits) or in the asset (Amount).
type ConversionRequest struct {
	MerchantID string
	Side       string
	Asset      string
	BRLUnits   int64
	Amount     string
}

// QuoteConversion prices a conversion for 30 seconds: crypto at the best venue, foreign
// currency at the FX provider, with the spread, the fee and, for currency, the IOF.
func (s *Service) QuoteConversion(ctx context.Context, tenantID string, r ConversionRequest) (*Conversion, error) {
	if r.Side != exchange.Buy && r.Side != exchange.Sell {
		return nil, invalid("side must be buy or sell")
	}
	m, err := s.GetMerchant(ctx, tenantID, r.MerchantID)
	if err != nil {
		return nil, err
	}
	if err := requireActive(m); err != nil {
		return nil, err
	}
	a, err := assets.Get(r.Asset)
	if err != nil || a.Code == assets.Base {
		return nil, invalid("asset must be a crypto-asset or a foreign currency")
	}
	var assetUnits int64
	if r.Amount != "" {
		if assetUnits, err = a.Parse(r.Amount); err != nil || assetUnits <= 0 {
			return nil, invalid("amount: a positive %s amount", a.Code)
		}
	} else if r.BRLUnits <= 0 {
		return nil, invalid("set brl_amount or amount")
	}
	if a.Kind == "crypto" {
		return s.quoteCrypto(ctx, tenantID, m.ID, r.Side, a, r.BRLUnits, assetUnits)
	}
	return s.quoteFX(ctx, tenantID, m.ID, r.Side, a, r.BRLUnits, assetUnits)
}

func (s *Service) quoteCrypto(ctx context.Context, tenantID, merchantID, side string, a assets.Asset, brlUnits, assetUnits int64) (*Conversion, error) {
	if s.exchanges == nil {
		return nil, ErrCryptoDisabled
	}
	venue, book, err := s.exchanges.Best(ctx, side, a.Code, assets.Base)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	spread := s.cryptoSpreadBps()
	price := book.Ask
	if side == exchange.Sell {
		price, spread = book.Bid, -spread
	}
	price, _ = assets.ApplyBps(price, spread)
	brl, _ := assets.Get(assets.Base)
	switch {
	case assetUnits > 0:
		if brlUnits, err = assets.Convert(assetUnits, a, brl, price); err != nil {
			return nil, err
		}
	default:
		inv := new(big.Rat).Inv(rat(price))
		if assetUnits, err = assets.Convert(brlUnits, brl, a, inv.FloatString(24)); err != nil {
			return nil, err
		}
	}
	if assetUnits <= 0 || brlUnits <= 0 {
		return nil, invalid("the amount is too small to convert")
	}
	fee := brlUnits * s.cryptoFeeBps() / 10000
	return s.storeQuote(ctx, tenantID, merchantID, "crypto", venue.Name(), side, a.Code, assetUnits, brlUnits, fee, 0, price)
}

func rat(s string) *big.Rat { r, _ := new(big.Rat).SetString(s); return r }

func (s *Service) storeQuote(ctx context.Context, tenantID, merchantID, kind, venue, side, code string, assetUnits, brlUnits, fee, tax int64, price string) (*Conversion, error) {
	id := ids.New("cv")
	if _, err := s.pool.Exec(ctx, `INSERT INTO conversions (id, tenant_id, merchant_id, kind, venue, side, asset, asset_units, brl_units, fee, tax, price, status, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'quoted', $13)`, id, tenantID, merchantID, kind, venue, side, code, assetUnits, brlUnits, fee, tax, price,
		s.cfg.Now().Add(conversionTTL)); err != nil {
		return nil, err
	}
	return s.GetConversion(ctx, tenantID, id)
}

// GetConversion reads a conversion.
func (s *Service) GetConversion(ctx context.Context, tenantID, id string) (*Conversion, error) {
	return scanConversion(s.pool.QueryRow(ctx, `SELECT `+conversionCols+` FROM conversions WHERE tenant_id = $1 AND id = $2`, tenantID, id))
}

// ExecuteConversion carries out a quote once: the trade at the venue, then the journals.
func (s *Service) ExecuteConversion(ctx context.Context, tenantID, id string) (*Conversion, error) {
	c, err := s.GetConversion(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if c.Status == "executed" {
		return c, nil
	}
	if c.Status != "quoted" {
		return nil, fmt.Errorf("%w: the quote is %s", ErrConflict, c.Status)
	}
	if exp, _ := time.Parse(time.RFC3339, c.ExpiresAt); s.cfg.Now().After(exp) {
		_, _ = s.pool.Exec(ctx, `UPDATE conversions SET status = 'expired' WHERE id = $1 AND status = 'quoted'`, id)
		return nil, fmt.Errorf("%w: the quote expired; ask for a new one", ErrExpired)
	}
	// The wallet pays first: a buy needs the reais, a sell the asset.
	if c.Side == exchange.Buy {
		if b, err := s.ledger.Balance(ctx, tenantID, ledger.MerchantWallet(c.MerchantID)); err != nil || b < c.Total {
			return nil, fmt.Errorf("%w: the wallet holds less than %d", ErrFunds, c.Total)
		}
	} else if b, err := s.ledger.Balance(ctx, tenantID, ledger.MerchantHolding(c.MerchantID, c.Asset)); err != nil || b < c.AssetUnits {
		return nil, fmt.Errorf("%w: the %s balance is less than %s", ErrFunds, c.Asset, c.Amount)
	}
	tag, err := s.pool.Exec(ctx, `UPDATE conversions SET status = 'executed', executed_at = $2 WHERE id = $1 AND status = 'quoted'`, id, s.cfg.Now())
	if err != nil || tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("%w: the quote was already used", ErrConflict)
	}
	fail := func(err error) (*Conversion, error) {
		_, _ = s.pool.Exec(ctx, `UPDATE conversions SET status = 'failed' WHERE id = $1`, id)
		return nil, err
	}
	if c.Kind == "crypto" {
		err = s.executeCrypto(ctx, tenantID, c)
	} else {
		err = s.executeFX(ctx, tenantID, c)
	}
	if err != nil {
		return fail(err)
	}
	return s.GetConversion(ctx, tenantID, id)
}

func (s *Service) executeCrypto(ctx context.Context, tenantID string, c *Conversion) error {
	if s.exchanges == nil {
		return ErrCryptoDisabled
	}
	venue, ok := s.exchanges.Venue(c.Venue)
	if !ok {
		return fmt.Errorf("%w: venue %s is gone", ErrUnavailable, c.Venue)
	}
	// The market may have moved since the quote: refuse beyond the slippage limit rather
	// than trade at a price the merchant did not see.
	b, err := venue.Book(ctx, c.Asset, assets.Base)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	now := b.Ask
	if c.Side == exchange.Sell {
		now = b.Bid
	}
	if moved(c.Side, c.Price, now) > maxSlippageBps {
		return fmt.Errorf("%w: the price moved; ask for a new quote", ErrExpired)
	}
	if err := s.conversionAccts(ctx, tenantID); err != nil {
		return err
	}
	if err := s.ensure(ctx, tenantID, custodyAcct(c.Venue, c.Asset), custodyAcct(c.Venue, assets.Base), holdingAcct(c.MerchantID, c.Asset)); err != nil {
		return err
	}
	fill, err := venue.Market(ctx, exchange.Order{ClientID: c.ID, Side: c.Side, Base: c.Asset, Quote: assets.Base, BaseUnits: c.AssetUnits})
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	quoteFee, baseFee := int64(0), int64(0)
	switch fill.FeeAsset {
	case assets.Base:
		quoteFee = fill.FeeUnits
	case c.Asset:
		baseFee = fill.FeeUnits
	}
	custody, holding, wallet := ledger.Custody(c.Venue, c.Asset), ledger.MerchantHolding(c.MerchantID, c.Asset), ledger.MerchantWallet(c.MerchantID)
	brlCustody := ledger.Custody(c.Venue, assets.Base)
	if c.Side == exchange.Buy {
		// The merchant gets the asset the venue delivered, net of a fee taken in it.
		got := fill.BaseUnits - baseFee
		if err := s.post(ctx, tenantID, "conv_asset:"+c.ID, "conversion", c.ID, []ledger.Posting{
			{Account: custody, Direction: ledger.Debit, Amount: got}, {Account: holding, Direction: ledger.Credit, Amount: got}}); err != nil {
			return err
		}
		cost := fill.QuoteUnits + quoteFee
		ps := []ledger.Posting{
			{Account: wallet, Direction: ledger.Debit, Amount: c.Total},
			{Account: brlCustody, Direction: ledger.Credit, Amount: cost},
			{Account: ledger.AccRevenueConversionFees, Direction: ledger.Credit, Amount: c.Fee},
		}
		ps = append(ps, result(c.BRLUnits-cost)...)
		ps = append(ps, ledger.SafeguardRelease(c.Total)...)
		if err := s.ensureFunded(ctx, tenantID, brlCustody, cost); err != nil {
			return err
		}
		if err := s.post(ctx, tenantID, "conv_brl:"+c.ID, "conversion", c.ID, ps); err != nil {
			return err
		}
		_, err = s.pool.Exec(ctx, `UPDATE conversions SET asset_units = $2, venue_ref = $3 WHERE id = $1`, c.ID, got, fill.OrderID)
		return err
	}
	// A venue that takes its fee in the asset sold takes it from custody: booked as an expense
	// in that asset, and L6 shows the shortfall treasury must cover.
	sold := []ledger.Posting{{Account: holding, Direction: ledger.Debit, Amount: c.AssetUnits}, {Account: custody, Direction: ledger.Credit, Amount: c.AssetUnits + baseFee}}
	if baseFee > 0 {
		if err := s.ensure(ctx, tenantID, ledger.Account{ID: ledger.VenueFees(c.Asset), Code: "expense.venue_fees", Currency: c.Asset, NormalSide: ledger.Debit}); err != nil {
			return err
		}
		sold = append(sold, ledger.Posting{Account: ledger.VenueFees(c.Asset), Direction: ledger.Debit, Amount: baseFee})
	}
	if err := s.post(ctx, tenantID, "conv_asset:"+c.ID, "conversion", c.ID, sold); err != nil {
		return err
	}
	raised := fill.QuoteUnits - quoteFee
	ps := []ledger.Posting{
		{Account: brlCustody, Direction: ledger.Debit, Amount: raised},
		{Account: wallet, Direction: ledger.Credit, Amount: c.Total},
		{Account: ledger.AccRevenueConversionFees, Direction: ledger.Credit, Amount: c.Fee},
	}
	ps = append(ps, result(raised-c.BRLUnits)...)
	ps = append(ps, ledger.SafeguardTopup(c.Total)...)
	if err := s.post(ctx, tenantID, "conv_brl:"+c.ID, "conversion", c.ID, ps); err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `UPDATE conversions SET venue_ref = $2 WHERE id = $1`, c.ID, fill.OrderID)
	return err
}

// ensureFunded tops up the platform's reais at a venue in the sandbox, as treasury would
// before trading; in production the shortfall is an error for treasury to fix.
func (s *Service) ensureFunded(ctx context.Context, tenantID, account string, need int64) error {
	have, err := s.ledger.Balance(ctx, tenantID, account)
	if err != nil {
		return err
	}
	if have >= need {
		return nil
	}
	if s.cfg.Env == "production" {
		return fmt.Errorf("%w: treasury must fund %s (has %d, needs %d)", ErrUnavailable, account, have, need)
	}
	if err := s.post(ctx, tenantID, ids.New("fund"), "treasury_funding", account, []ledger.Posting{
		{Account: account, Direction: ledger.Debit, Amount: need - have}, {Account: ledger.AccSettlementBank, Direction: ledger.Credit, Amount: need - have}}); err != nil {
		return err
	}
	s.fundVenue(account, need-have)
	return nil
}

// moved is how many basis points the market moved against the merchant since price.
func moved(side, quoted, now string) int64 {
	q, n := rat(quoted), rat(now)
	if q == nil || n == nil || q.Sign() == 0 {
		return 1 << 30
	}
	d := new(big.Rat).Sub(n, q) // a buy suffers a rise, a sell a fall
	if side == exchange.Sell {
		d.Neg(d)
	}
	d.Quo(d, q)
	d.Mul(d, big.NewRat(10000, 1))
	f, _ := d.Float64()
	return int64(f)
}

// ---------------------------------------------------------------- withdrawals

// CryptoWithdrawal sends a merchant's crypto to an address.
type CryptoWithdrawal struct {
	ID, MerchantID, Asset, Network, Address, Memo, Amount, Venue, Status string
	Units, FeeUnits                                                      int64
	// DestinationType says where the coins go: "wallet" (one no provider keeps, the
	// default) or "exchange" (an account at another provider). The DeCripto reports them
	// apart (records 0650 and 0450).
	DestinationType string
	ValueBRL        *int64 // at the best price to sell when sent
}

// WithdrawCrypto sends units of an asset from the merchant's holding to an address outside
// the platform, from a venue whose custody covers it. The network fee is the merchant's.
func (s *Service) WithdrawCrypto(ctx context.Context, tenantID, merchantID, code, network, address, memo, amount, destinationType string) (*CryptoWithdrawal, error) {
	if s.exchanges == nil {
		return nil, ErrCryptoDisabled
	}
	switch destinationType {
	case "":
		destinationType = "wallet"
	case "wallet", "exchange":
	default:
		return nil, invalid("destination_type is wallet or exchange")
	}
	a, err := cryptoAsset(code)
	if err != nil {
		return nil, err
	}
	if !a.OnNetwork(network) {
		return nil, invalid("%s moves on %s, not %q", a.Code, strings.Join(a.Networks, ", "), network)
	}
	if re := addressFormats[network]; re == nil || !re.MatchString(address) {
		return nil, invalid("%q is not a %s address", address, network)
	}
	units, err := a.Parse(amount)
	if err != nil || units <= 0 {
		return nil, invalid("amount: a positive %s amount", a.Code)
	}
	// Nothing is sent to an address sanctions screening has not cleared (docs/09 §6.1). It
	// comes before the balance check, so every attempt is screened and recorded.
	if err := s.screenAddress(ctx, tenantID, merchantID, network, address); err != nil {
		return nil, err
	}
	fee := cryptoNetworkFees[a.Code+"/"+network]
	holding := ledger.MerchantHolding(merchantID, a.Code)
	if b, err := s.ledger.Balance(ctx, tenantID, holding); err != nil || b < units+fee {
		return nil, fmt.Errorf("%w: the %s balance does not cover %s plus the network fee %s", ErrFunds, a.Code, a.Format(units), a.Format(fee))
	}
	var venue exchange.Exchange
	for _, v := range s.exchanges.Venues {
		if c, err := s.ledger.Balance(ctx, tenantID, ledger.Custody(v.Name(), a.Code)); err == nil && c >= units+fee {
			venue = v
			break
		}
	}
	if venue == nil {
		return nil, fmt.Errorf("%w: no venue holds enough %s; treasury must rebalance", ErrUnavailable, a.Code)
	}
	w := &CryptoWithdrawal{ID: ids.New("cw"), MerchantID: merchantID, Asset: a.Code, Network: network, Address: address, Memo: memo, Amount: a.Format(units),
		Venue: venue.Name(), Units: units, FeeUnits: fee, DestinationType: destinationType}
	if price, ok := s.sellPrice(ctx, a); ok {
		brl, _ := assets.Get(assets.Base)
		if v, err := assets.Convert(units, a, brl, price); err == nil {
			w.ValueBRL = &v
		}
	}
	// The journal first: if the venue then fails, the reversal puts the balance back.
	custody := ledger.Custody(venue.Name(), a.Code)
	if err := s.post(ctx, tenantID, "crypto_withdraw:"+w.ID, "crypto_withdrawal", w.ID, []ledger.Posting{
		{Account: holding, Direction: ledger.Debit, Amount: units + fee}, {Account: custody, Direction: ledger.Credit, Amount: units + fee}}); err != nil {
		return nil, err
	}
	ref, err := venue.Withdraw(ctx, exchange.Withdrawal{ClientID: w.ID, Asset: a.Code, Network: network, Address: address, Memo: memo, Units: units, FeeUnits: fee})
	w.Status = "sent"
	if err != nil {
		w.Status = "failed"
		_ = s.post(ctx, tenantID, "crypto_withdraw_back:"+w.ID, "crypto_withdrawal_reversed", w.ID, []ledger.Posting{
			{Account: custody, Direction: ledger.Debit, Amount: units + fee}, {Account: holding, Direction: ledger.Credit, Amount: units + fee}})
	}
	dest := fmt.Sprintf(`{"network":%q,"address":%q,"memo":%q,"type":%q}`, network, address, memo, destinationType)
	if _, dbErr := s.pool.Exec(ctx, `INSERT INTO asset_transfers (id, tenant_id, merchant_id, kind, venue, asset, units, fee_units, destination, status, venue_ref, value_brl)
		VALUES ($1, $2, $3, 'crypto', $4, $5, $6, $7, $8, $9, NULLIF($10, ''), $11)`, w.ID, tenantID, merchantID, venue.Name(), a.Code, units, fee, dest, w.Status, ref, w.ValueBRL); dbErr != nil {
		return nil, dbErr
	}
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	s.notify(ctx, tenantID, "crypto.withdrawal.sent", map[string]any{"id": w.ID, "merchant_id": merchantID, "asset": a.Code, "amount": w.Amount, "network": network})
	return w, nil
}
