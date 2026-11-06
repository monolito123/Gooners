package brokerage

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTickersAndLots(t *testing.T) {
	for ticker, kind := range map[string]string{"PETR4": "share", "vale3": "share", "BOVA11": "unit", "HGLG11": "unit", "AAPL34": "bdr", "PETR4F": "share"} {
		in, err := Parse(ticker)
		if err != nil || in.Kind != kind {
			t.Errorf("%s: %+v %v", ticker, in, err)
		}
	}
	for _, bad := range []string{"PETR", "PETR2", "PETR44", "XX4", "BITCOIN"} {
		if _, err := Parse(bad); err == nil {
			t.Errorf("%s accepted", bad)
		}
	}
	petr, _ := Parse("PETR4")
	legs := petr.Legs(250)
	if len(legs) != 2 || legs[0] != (Order{Ticker: "PETR4", Quantity: 200}) || legs[1] != (Order{Ticker: "PETR4F", Quantity: 50}) {
		t.Fatalf("legs %+v", legs)
	}
	if l := petr.Legs(40); len(l) != 1 || l[0].Ticker != "PETR4F" {
		t.Fatalf("fractional only %+v", l)
	}
	bova, _ := Parse("BOVA11")
	if l := bova.Legs(3); len(l) != 1 || l[0].Ticker != "BOVA11" || l[0].Quantity != 3 {
		t.Fatalf("units %+v", l)
	}
}

func TestCalendar(t *testing.T) {
	at := func(s string) time.Time { v, _ := time.ParseInLocation("2006-01-02 15:04", s, brt); return v }
	if !DefaultSession.IsOpen(at("2026-10-30 10:00")) || DefaultSession.IsOpen(at("2026-10-30 09:59")) || DefaultSession.IsOpen(at("2026-10-30 18:00")) {
		t.Fatal("session hours")
	}
	// The close follows New York's clocks: 16:55 while it keeps daylight time, 17:55 after.
	for when, open := range map[string]bool{"2026-10-30 16:54": true, "2026-10-30 17:00": false, "2026-11-03 17:30": true, "2026-11-03 17:55": false,
		"2026-03-06 17:30": true, "2026-03-09 17:30": false, "2026-03-09 16:54": true} {
		if DefaultSession.IsOpen(at(when)) != open {
			t.Errorf("open at %s: want %v", when, open)
		}
	}
	if DefaultSession.IsOpen(at("2026-10-31 12:00")) || DefaultSession.IsOpen(at("2026-12-24 12:00")) || DefaultSession.IsOpen(at("2026-11-20 12:00")) {
		t.Fatal("Saturday, 24 December and Consciência Negra are closed")
	}
	// Thursday 29 October 2026 settles on Monday 2 November? No: 2 November is a holiday, so Tuesday 3.
	if s := Settlement(at("2026-10-29 11:00")).Format("2006-01-02"); s != "2026-11-03" {
		t.Fatalf("D+2 over a weekend and Finados: %s", s)
	}
	if g, _ := Cost(150, "38.505"); g != 577575 {
		t.Fatalf("cost %d", g)
	}
	if f := Fees(577575); f != 174 {
		t.Fatalf("fees %d", f)
	}
}

func TestMemoryAndHTTP(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	e, err := m.Place(ctx, Order{ClientID: "o1", Ticker: "PETR4", Side: "buy", Quantity: 100})
	if err != nil || e.GrossCents != 385000 || e.FeesCents != 116 {
		t.Fatalf("fill %+v %v", e, err)
	}
	if again, _ := m.Place(ctx, Order{ClientID: "o1", Ticker: "VALE3", Quantity: 1}); again != e {
		t.Fatal("idempotent")
	}
	if _, err := m.Quote(ctx, "ZZZZ3"); err == nil {
		t.Fatal("an unknown ticker")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/quote/PETR4":
			if r.URL.Query().Get("token") != "tk" {
				w.WriteHeader(401)
				_, _ = w.Write([]byte(`{"error":true,"message":"token"}`))
				return
			}
			_, _ = w.Write([]byte(`{"results":[{"symbol":"PETR4","shortName":"PETROBRAS PN","regularMarketPrice":38.62,"regularMarketChangePercent":1.15,"regularMarketTime":"2026-10-30T20:07:00Z"}]}`))
		case "/orders":
			if r.Header.Get("Authorization") != "Bearer bt" {
				w.WriteHeader(401)
				return
			}
			var o Order
			_ = json.NewDecoder(r.Body).Decode(&o)
			_ = json.NewEncoder(w).Encode(Execution{OrderID: "B1", ClientID: o.ClientID, Ticker: o.Ticker, Side: o.Side, Quantity: o.Quantity, Price: "38.62", GrossCents: 3862, FeesCents: 2})
		}
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL, Token: "bt", BrokerName: "partner", Quotes: &Brapi{BaseURL: srv.URL, Token: "tk"}}
	if q, err := c.Quote(ctx, "PETR4"); err != nil || q.Last != "38.62" || q.Name != "PETROBRAS PN" {
		t.Fatalf("brapi quote %+v %v", q, err)
	}
	if e, err := c.Place(ctx, Order{ClientID: "c1", Ticker: "PETR4F", Side: "buy", Quantity: 1}); err != nil || e.OrderID != "B1" {
		t.Fatalf("place %+v %v", e, err)
	}
	if _, err := (&Brapi{BaseURL: srv.URL}).Quote(ctx, "PETR4"); err == nil {
		t.Fatal("brapi without a token")
	}
}
