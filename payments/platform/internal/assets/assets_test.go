package assets

import "testing"

func TestFormatParse(t *testing.T) {
	brl, _ := Get("brl")
	btc, _ := Get("BTC")
	usdt, _ := Get("USDT")
	for _, c := range []struct {
		a     Asset
		units int64
		s     string
	}{{brl, 12990, "129.90"}, {btc, 150_000, "0.00150000"}, {usdt, 1_000_000, "1.000000"}, {brl, 0, "0.00"}} {
		if got := c.a.Format(c.units); got != c.s {
			t.Errorf("%s %d: %s, want %s", c.a.Code, c.units, got, c.s)
		}
		if got, err := c.a.Parse(c.s); err != nil || got != c.units {
			t.Errorf("parse %s: %d %v", c.s, got, err)
		}
	}
	for _, bad := range []string{"", "1e3", "abc", "1.001", "+1", "99999999999999999999"} {
		if _, err := brl.Parse(bad); err == nil {
			t.Errorf("%q parsed", bad)
		}
	}
	if _, err := Get("DOGE"); err == nil {
		t.Error("an unknown asset")
	}
	if !usdt.OnNetwork("tron") || btc.OnNetwork("tron") {
		t.Error("networks")
	}
}

func TestConvertAndPrice(t *testing.T) {
	brl, _ := Get("BRL")
	btc, _ := Get("BTC")
	// 0.0015 BTC at R$ 350.000,00: R$ 525,00.
	if got, err := Convert(150_000, btc, brl, "350000"); err != nil || got != 52500 {
		t.Fatalf("convert: %d %v", got, err)
	}
	// R$ 100,00 at 350.000: 0.00028571 BTC, rounded down.
	if got, _ := Convert(10000, brl, btc, "0.0000028571428571"); got != 28571 {
		t.Fatalf("convert down: %d", got)
	}
	if p := Price(150_000, btc, 52500, brl, 2); p != "350000.00" {
		t.Fatalf("price %s", p)
	}
	if p, _ := ApplyBps("100", 150); p != "101.5000000000" {
		t.Fatalf("spread %s", p)
	}
	if _, err := Convert(1, btc, brl, "-1"); err == nil {
		t.Fatal("a negative price")
	}
	if All()[0].Kind != "fiat" {
		t.Fatal("fiat first")
	}
}
