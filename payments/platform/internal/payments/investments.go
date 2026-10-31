package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/assets"
	"github.com/monolito123/Gooners/payments/platform/internal/brokerage"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/pricing"
)

// ErrInvestDisabled is an investment call without a configured broker.
var ErrInvestDisabled = fmt.Errorf("%w: no broker is configured", ErrDisabled)

// Investor profiles (suitability, Resolução CVM 30).
const (
	ProfileConservative = "conservador"
	ProfileModerate     = "moderado"
	ProfileAggressive   = "arrojado"
)

// SuitabilityAnswers are the questionnaire's three answers, each 0 to 2: how long the money
// can stay invested, how much loss the merchant accepts, how much the merchant knows of
// variable income.
type SuitabilityAnswers struct {
	Horizon    int `json:"horizon"`    // 0 under a year, 1 one to three years, 2 longer
	Tolerance  int `json:"tolerance"`  // 0 no loss, 1 some loss, 2 large swings
	Experience int `json:"experience"` // 0 none, 1 some, 2 broad
}

// Profile scores the answers.
func (a SuitabilityAnswers) Profile() (string, error) {
	for _, v := range []int{a.Horizon, a.Tolerance, a.Experience} {
		if v < 0 || v > 2 {
			return "", invalid("each answer is 0, 1 or 2")
		}
	}
	switch n := a.Horizon + a.Tolerance + a.Experience; {
	case n <= 1 || a.Tolerance == 0:
		return ProfileConservative, nil
	case n <= 4:
		return ProfileModerate, nil
	}
	return ProfileAggressive, nil
}

// InvestorProfile is the merchant's suitability on file.
type InvestorProfile struct {
	MerchantID string             `json:"merchant_id"`
	Profile    string             `json:"profile"`
	Answers    SuitabilityAnswers `json:"answers"`
	UpdatedAt  string             `json:"updated_at"`
}

// SetInvestorProfile records the questionnaire and the profile it gives.
func (s *Service) SetInvestorProfile(ctx context.Context, tenantID, merchantID string, a SuitabilityAnswers) (*InvestorProfile, error) {
	if _, err := s.GetMerchant(ctx, tenantID, merchantID); err != nil {
		return nil, err
	}
	p, err := a.Profile()
	if err != nil {
		return nil, err
	}
	b, _ := json.Marshal(a)
	if _, err := s.pool.Exec(ctx, `INSERT INTO investor_profiles (tenant_id, merchant_id, profile, answers, updated_at) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (merchant_id) DO UPDATE SET profile = EXCLUDED.profile, answers = EXCLUDED.answers, updated_at = EXCLUDED.updated_at`,
		tenantID, merchantID, p, b, s.cfg.Now()); err != nil {
		return nil, err
	}
	return s.GetInvestorProfile(ctx, tenantID, merchantID)
}

// GetInvestorProfile reads the profile on file.
func (s *Service) GetInvestorProfile(ctx context.Context, tenantID, merchantID string) (*InvestorProfile, error) {
	p := &InvestorProfile{MerchantID: merchantID}
	var b []byte
	var at time.Time
	err := s.pool.QueryRow(ctx, `SELECT profile, answers, updated_at FROM investor_profiles WHERE tenant_id = $1 AND merchant_id = $2`, tenantID, merchantID).Scan(&p.Profile, &b, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: no investor profile; answer the suitability questionnaire first", ErrNotFound)
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(b, &p.Answers)
	p.UpdatedAt = at.UTC().Format(time.RFC3339)
	return p, nil
}

// InvestmentQuote is an instrument's price with what B3 says about it.
type InvestmentQuote struct {
	Ticker     string    `json:"ticker"`
	Name       string    `json:"name"`
	Kind       string    `json:"kind"` // share, unit or bdr
	Lot        int64     `json:"lot"`
	Last       string    `json:"last"`
	Change     string    `json:"change,omitempty"`
	At         time.Time `json:"at"`
	MarketOpen bool      `json:"market_open"`
}

// QuoteInstrument returns a B3 instrument's last price.
func (s *Service) QuoteInstrument(ctx context.Context, ticker string) (*InvestmentQuote, error) {
	if s.broker == nil {
		return nil, ErrInvestDisabled
	}
	in, err := brokerage.Parse(ticker)
	if err != nil {
		return nil, invalid("%v", err)
	}
	q, err := s.broker.Quote(ctx, in.Ticker)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return &InvestmentQuote{Ticker: in.Ticker, Name: q.Name, Kind: in.Kind, Lot: in.Lot, Last: q.Last, Change: q.Change, At: q.At, MarketOpen: s.marketOpen()}, nil
}

// marketOpen is B3's session; the sandbox trades around the clock.
func (s *Service) marketOpen() bool {
	return s.cfg.Env != "production" || brokerage.DefaultSession.IsOpen(s.cfg.Now())
}

// InvestmentOrder is a buy or sell at B3 and its settlement.
type InvestmentOrder struct {
	ID         string   `json:"id"`
	Object     string   `json:"object"`
	MerchantID string   `json:"merchant_id"`
	Ticker     string   `json:"ticker"`
	Side       string   `json:"side"`
	Quantity   int64    `json:"quantity"`
	Price      string   `json:"price"`
	Gross      int64    `json:"gross"`
	Fees       int64    `json:"fees"`
	Total      int64    `json:"total"` // buy: debited now; sell: credited at settlement
	Status     string   `json:"status"`
	TradeDate  string   `json:"trade_date"`
	SettlesOn  string   `json:"settles_on"`
	Legs       []string `json:"legs"` // the broker's order IDs: standard lot and fractional market
}

// Invest buys or sells quantity of a B3 instrument for the merchant, at the market, through
// the broker: whole lots on the standard market, the rest on the fractional one. A buy is
// paid from the wallet at once (and owed to the broker until D+2); a sale's proceeds arrive
// in the wallet at D+2.
func (s *Service) Invest(ctx context.Context, tenantID, merchantID, ticker, side string, quantity int64) (*InvestmentOrder, error) {
	if s.broker == nil {
		return nil, ErrInvestDisabled
	}
	if side != "buy" && side != "sell" {
		return nil, invalid("side must be buy or sell")
	}
	if quantity <= 0 || quantity > 1_000_000 {
		return nil, invalid("quantity must be between 1 and 1.000.000")
	}
	in, err := brokerage.Parse(ticker)
	if err != nil {
		return nil, invalid("%v", err)
	}
	m, err := s.GetMerchant(ctx, tenantID, merchantID)
	if err != nil {
		return nil, err
	}
	if err := requireActive(m); err != nil {
		return nil, err
	}
	if !s.marketOpen() {
		return nil, fmt.Errorf("%w: B3 is closed; orders go in during the session (10:00 to 17:55, Brasília)", ErrConflict)
	}
	prof, err := s.GetInvestorProfile(ctx, tenantID, merchantID)
	if err != nil {
		return nil, err
	}
	if side == "buy" && prof.Profile == ProfileConservative {
		return nil, fmt.Errorf("%w: a conservative investor profile does not fit variable income (%s); review the questionnaire", ErrConflict, in.Ticker)
	}
	if side == "sell" {
		var held int64
		_ = s.pool.QueryRow(ctx, `SELECT quantity FROM positions WHERE merchant_id = $1 AND ticker = $2`, merchantID, in.Ticker).Scan(&held)
		if held < quantity {
			return nil, fmt.Errorf("%w: %d %s held, %d to sell", ErrFunds, held, in.Ticker, quantity)
		}
	} else {
		q, err := s.broker.Quote(ctx, in.Ticker)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		est, _ := brokerage.Cost(quantity, q.Last)
		est += brokerage.Fees(est) + est/50 // 2% for the market to move before the fill
		if bal, err := s.ledger.Balance(ctx, tenantID, ledger.MerchantWallet(merchantID)); err != nil || bal < est {
			return nil, fmt.Errorf("%w: about %s needed, %s available", ErrFunds, brlText(est), brlText(bal))
		}
	}
	o := &InvestmentOrder{ID: ids.New("inv"), Object: "investment_order", MerchantID: merchantID, Ticker: in.Ticker, Side: side, Quantity: quantity, Status: "executed"}
	for i, leg := range in.Legs(quantity) {
		e, err := s.broker.Place(ctx, brokerage.Order{ClientID: fmt.Sprintf("%s-%d", o.ID, i), Account: merchantID, Ticker: leg.Ticker, Side: side, Quantity: leg.Quantity})
		if err != nil {
			if i == 0 {
				return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
			}
			// A later leg failed after an earlier one filled: book what filled, report the rest.
			s.log.Error("investment leg", "order", o.ID, "leg", leg.Ticker, "err", err)
			o.Quantity -= leg.Quantity
			continue
		}
		o.Gross += e.GrossCents
		o.Fees += e.FeesCents
		o.Legs = append(o.Legs, e.OrderID)
	}
	if o.Quantity <= 0 {
		return nil, fmt.Errorf("%w: nothing filled", ErrUnavailable)
	}
	o.Price = assets.Price(o.Quantity*100, assetBRL(), o.Gross, assetBRL(), 4)
	now := s.cfg.Now()
	trade, settles := pricing.Date(now), brokerage.Settlement(now)
	if side == "buy" {
		o.Total = o.Gross + o.Fees
		if err := s.ensure(ctx, tenantID, ledger.Account{ID: ledger.BrokerSettlement(s.broker.Name()), Code: "liability.broker_settlement", Currency: assets.Base, NormalSide: ledger.Credit}); err != nil {
			return nil, err
		}
		ps := []ledger.Posting{{Account: ledger.MerchantWallet(merchantID), Direction: ledger.Debit, Amount: o.Total},
			{Account: ledger.BrokerSettlement(s.broker.Name()), Direction: ledger.Credit, Amount: o.Total}}
		if err := s.post(ctx, tenantID, "invest_buy:"+o.ID, "investment_buy", o.ID, append(ps, ledger.SafeguardRelease(o.Total)...)); err != nil {
			return nil, err
		}
		if _, err := s.pool.Exec(ctx, `INSERT INTO positions (tenant_id, merchant_id, ticker, quantity, cost) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (merchant_id, ticker) DO UPDATE SET quantity = positions.quantity + EXCLUDED.quantity, cost = positions.cost + EXCLUDED.cost`,
			tenantID, merchantID, in.Ticker, o.Quantity, o.Total); err != nil {
			return nil, err
		}
	} else {
		o.Total = o.Gross - o.Fees
		// The cost of what is sold leaves the position at its average.
		if _, err := s.pool.Exec(ctx, `UPDATE positions SET cost = cost - (cost * $3 / quantity), quantity = quantity - $3 WHERE merchant_id = $1 AND ticker = $2`,
			merchantID, in.Ticker, o.Quantity); err != nil {
			return nil, err
		}
	}
	o.TradeDate, o.SettlesOn = trade.Format("2006-01-02"), settles.Format("2006-01-02")
	if _, err := s.pool.Exec(ctx, `INSERT INTO investment_orders (id, tenant_id, merchant_id, broker, ticker, side, quantity, price, gross, fees, status, trade_date, settles_on, broker_refs)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'executed', $11, $12, $13)`, o.ID, tenantID, merchantID, s.broker.Name(), in.Ticker, side, o.Quantity, o.Price,
		o.Gross, o.Fees, trade, settles, o.Legs); err != nil {
		return nil, err
	}
	s.notify(ctx, tenantID, "investment.order.executed", map[string]any{"id": o.ID, "merchant_id": merchantID, "ticker": in.Ticker, "side": side, "quantity": o.Quantity})
	return o, nil
}

func assetBRL() assets.Asset { a, _ := assets.Get(assets.Base); return a }

func brlText(c int64) string { return "R$ " + assetBRL().Format(c) }

// SettleInvestments settles the trades due by day: the platform pays the broker for buys,
// and sales' proceeds reach the merchants' wallets.
func (s *Service) SettleInvestments(ctx context.Context, day time.Time) (int, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, tenant_id::text, merchant_id, broker, side, gross, fees FROM investment_orders WHERE status = 'executed' AND settles_on <= $1`, pricing.Date(day))
	if err != nil {
		return 0, err
	}
	type o struct {
		id, tenant, merchant, broker, side string
		gross, fees                        int64
	}
	var os []o
	for rows.Next() {
		var x o
		if err := rows.Scan(&x.id, &x.tenant, &x.merchant, &x.broker, &x.side, &x.gross, &x.fees); err != nil {
			rows.Close()
			return 0, err
		}
		os = append(os, x)
	}
	rows.Close()
	n := 0
	for _, x := range os {
		var ps []ledger.Posting
		if x.side == "buy" {
			ps = []ledger.Posting{{Account: ledger.BrokerSettlement(x.broker), Direction: ledger.Debit, Amount: x.gross + x.fees},
				{Account: ledger.AccSettlementBank, Direction: ledger.Credit, Amount: x.gross + x.fees}}
		} else {
			net := x.gross - x.fees
			ps = append([]ledger.Posting{{Account: ledger.AccSettlementBank, Direction: ledger.Debit, Amount: net},
				{Account: ledger.MerchantWallet(x.merchant), Direction: ledger.Credit, Amount: net}}, ledger.SafeguardTopup(net)...)
		}
		if err := s.post(ctx, x.tenant, "invest_settle:"+x.id, "investment_settlement", x.id, ps); err != nil {
			return n, err
		}
		if _, err := s.pool.Exec(ctx, `UPDATE investment_orders SET status = 'settled' WHERE id = $1`, x.id); err != nil {
			return n, err
		}
		s.notify(ctx, x.tenant, "investment.order.settled", map[string]any{"id": x.id, "merchant_id": x.merchant})
		n++
	}
	return n, nil
}

// Position is what a merchant holds of an instrument, at the last price.
type Position struct {
	Ticker   string `json:"ticker"`
	Name     string `json:"name"`
	Quantity int64  `json:"quantity"`
	Cost     int64  `json:"cost"`
	Last     string `json:"last,omitempty"`
	Value    *int64 `json:"value"`
	Result   *int64 `json:"result"` // value − cost
}

// Positions lists a merchant's holdings at B3 and the orders not yet settled.
func (s *Service) Positions(ctx context.Context, tenantID, merchantID string) ([]Position, []InvestmentOrder, error) {
	rows, err := s.pool.Query(ctx, `SELECT ticker, quantity, cost FROM positions WHERE tenant_id = $1 AND merchant_id = $2 AND quantity > 0 ORDER BY ticker`, tenantID, merchantID)
	if err != nil {
		return nil, nil, err
	}
	ps := []Position{}
	for rows.Next() {
		var p Position
		if err := rows.Scan(&p.Ticker, &p.Quantity, &p.Cost); err != nil {
			rows.Close()
			return nil, nil, err
		}
		ps = append(ps, p)
	}
	rows.Close()
	for i := range ps {
		if s.broker == nil {
			break
		}
		if q, err := s.broker.Quote(ctx, ps[i].Ticker); err == nil {
			ps[i].Name, ps[i].Last = q.Name, q.Last
			if v, err := brokerage.Cost(ps[i].Quantity, q.Last); err == nil {
				r := v - ps[i].Cost
				ps[i].Value, ps[i].Result = &v, &r
			}
		}
	}
	os, err := s.investmentOrders(ctx, tenantID, merchantID)
	return ps, os, err
}

func (s *Service) investmentOrders(ctx context.Context, tenantID, merchantID string) ([]InvestmentOrder, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, ticker, side, quantity, price, gross, fees, status, trade_date, settles_on, broker_refs FROM investment_orders
		WHERE tenant_id = $1 AND merchant_id = $2 ORDER BY created_at DESC LIMIT 50`, tenantID, merchantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvestmentOrder{}
	for rows.Next() {
		o := InvestmentOrder{Object: "investment_order", MerchantID: merchantID}
		var trade, settles time.Time
		if err := rows.Scan(&o.ID, &o.Ticker, &o.Side, &o.Quantity, &o.Price, &o.Gross, &o.Fees, &o.Status, &trade, &settles, &o.Legs); err != nil {
			return nil, err
		}
		o.TradeDate, o.SettlesOn = trade.Format("2006-01-02"), settles.Format("2006-01-02")
		if o.Side == "buy" {
			o.Total = o.Gross + o.Fees
		} else {
			o.Total = o.Gross - o.Fees
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
