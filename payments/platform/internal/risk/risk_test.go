package risk

import (
	"slices"
	"testing"
)

func TestPolicyMatchesDocs(t *testing.T) {
	// docs/07 §3.6, row by row.
	want := map[[2]Level]Action{
		{Low, Low}: Allow, {Low, Medium}: AllowHold, {Low, High}: StepUpHold,
		{Medium, Low}: Allow, {Medium, Medium}: StepUp, {Medium, High}: Decline,
		{High, Low}: StepUpHold, {High, Medium}: Decline, {High, High}: DeclineFreeze,
	}
	for k, a := range want {
		if got := Decide(k[0], k[1]); got != a {
			t.Errorf("device %s, server %s: %s, want %s", k[0], k[1], got, a)
		}
	}
	// A device reporting "all fine" never does better than the server alone.
	for _, sl := range []Level{Low, Medium, High} {
		for _, dl := range []Level{Medium, High} {
			if rank(Decide(Low, sl)) > rank(Decide(dl, sl)) {
				t.Errorf("server %s: a low device score is stricter than a %s one", sl, dl)
			}
		}
	}
}

func rank(a Action) int {
	return slices.Index([]Action{Allow, AllowHold, StepUp, StepUpHold, Decline, DeclineFreeze}, a)
}

func TestDeviceScore(t *testing.T) {
	cases := []struct {
		in   []string
		want int
		top  []string
	}{
		{nil, 0, nil},
		{[]string{"unknown_code"}, 0, nil},
		{[]string{"debugger"}, 600, []string{"debugger"}},
		{[]string{"debugger", "debugger"}, 600, []string{"debugger"}},
		// 1000 → 400 (root) → 160 (debugger): 840
		{[]string{"debugger", "root_indicators"}, 840, []string{"debugger", "root_indicators"}},
		// heaviest first, truncating at each step: 1000·0.8 = 800 → ·0.85 = 680 → ·0.85 = 578 → ·0.9 = 520.2 → 520
		{[]string{"developer_options", "adb_enabled", "repeated_amount", "just_under_limit"}, 480,
			[]string{"adb_enabled", "just_under_limit", "repeated_amount", "developer_options"}},
	}
	for _, c := range cases {
		got, top := DeviceScore(c.in)
		if got != c.want || !slices.Equal(top, c.top) {
			t.Errorf("%v: %d %v, want %d %v", c.in, got, top, c.want, c.top)
		}
	}
	all := make([]string, 0, len(DeviceWeights))
	for k := range DeviceWeights {
		all = append(all, k)
	}
	m, top := DeviceScore(all)
	if len(top) != MaxDeviceSignals || top[0] != "hooking" || m < 990 || m > 1000 {
		t.Errorf("all signals: %d %v", m, top)
	}
}

func TestDeviceLevelRecomputesTheScore(t *testing.T) {
	if l, _, ok := DeviceLevel(Device{}); l != Low || !ok {
		t.Error("no device score is low")
	}
	// Reporting trouble with a low score: the signals win, and the inconsistency is noted.
	l, m, ok := DeviceLevel(Device{Present: true, Model: DeviceModel, Milli: 10, Signals: []string{"hooking", "root_indicators"}})
	if l != High || m != 880 || ok {
		t.Errorf("tampered: %s %d %v", l, m, ok)
	}
	// A higher score than the five codes explain is fine (it had more signals).
	if l, m, ok := DeviceLevel(Device{Present: true, Model: DeviceModel, Milli: 800, Signals: []string{"debugger"}}); l != High || m != 800 || !ok {
		t.Errorf("more signals than sent: %s %d %v", l, m, ok)
	}
	// Another model: the reported score as is.
	if l, _, ok := DeviceLevel(Device{Present: true, Model: "vendor-x", Milli: 500, Signals: []string{"hooking"}}); l != Medium || !ok {
		t.Errorf("other model: %s %v", l, ok)
	}
}

func TestServerRules(t *testing.T) {
	base := Features{ATC: -1, LastATC: -1, Amount: 50_00, MerchantAgeDays: 400, TerminalCards10m: 1, TerminalBINs10m: 1, CardMerchants1h: 1}
	if m, s := Score(base); m != 0 || len(s) != 0 {
		t.Fatalf("an ordinary sale scored %d %v", m, s)
	}
	cases := []struct {
		name  string
		mod   func(*Features)
		sig   string
		level Level
	}{
		{"same counter twice", func(f *Features) { f.ATC, f.LastATC = 66, 66 }, SigATCReplay, High},
		{"counter went back", func(f *Features) { f.ATC, f.LastATC = 65, 66 }, SigATCRegression, High},
		{"card everywhere", func(f *Features) { f.CardMerchants1h = 5 }, SigCardMultiMerchant, Medium},
		{"an afternoon at a mall", func(f *Features) { f.CardMerchants1h = 4 }, "", Low},
		{"card testing", func(f *Features) { f.TerminalCards10m = 5 }, SigCardTesting, Medium},
		{"card velocity", func(f *Features) { f.CardAttempts10m = 5 }, SigCardVelocity, Medium},
		{"far above baseline", func(f *Features) { f.MerchantSales30d, f.MerchantMedian30d, f.Amount = 40, 30_00, 400_00 }, SigAboveBaseline, Medium},
		{"declines", func(f *Features) { f.TerminalDeclineStreak = 3 }, SigDeclineStreak, Medium},
		{"new merchant", func(f *Features) { f.MerchantAgeDays, f.Amount = 2, 1_500_00 }, SigNewMerchantLarge, Medium},
		{"bins", func(f *Features) { f.TerminalBINs10m = 4 }, SigBINSpread, Low},
	}
	for _, c := range cases {
		f := base
		c.mod(&f)
		m, s := Score(f)
		if (c.sig == "" && len(s) > 0) || (c.sig != "" && !slices.Contains(s, c.sig)) || ServerLevel(m) != c.level {
			t.Errorf("%s: %d %v (%s), want %s at %s", c.name, m, s, ServerLevel(m), c.sig, c.level)
		}
	}
	// Card testing on a terminal: many cards, many BINs, a decline streak.
	f := base
	f.TerminalCards10m, f.TerminalBINs10m, f.TerminalDeclineStreak = 8, 6, 4
	m, s := Score(f)
	if ServerLevel(m) != High || s[0] != SigCardTesting {
		t.Errorf("card testing: %d %v", m, s)
	}
	// A counter at or below the last one only means something when both are known.
	f = base
	f.ATC, f.LastATC = 3, -1
	if m, _ := Score(f); m != 0 {
		t.Error("first sight of a card is not a regression")
	}
}

func TestAssess(t *testing.T) {
	f := Features{ATC: -1, LastATC: -1, Amount: 10_00, MerchantAgeDays: 100}
	if a := Assess(f, Device{}); a.Action != Allow {
		t.Errorf("clean: %+v", a)
	}
	// A tampered score is caught by the server's own rule, on top of the device's level: the
	// terminal is frozen for review.
	a := Assess(f, Device{Present: true, Model: DeviceModel, Milli: 0, Signals: []string{"hooking", "debugger"}})
	if a.Action != DeclineFreeze || !slices.Contains(a.ServerSignals, SigDeviceInconsistent) {
		t.Errorf("tampered: %+v", a)
	}
	// Card testing with a clean phone: step up and hold.
	f.TerminalCards10m, f.TerminalBINs10m, f.TerminalDeclineStreak = 8, 6, 4
	if a := Assess(f, Device{Present: true, Model: DeviceModel}); a.Action != StepUpHold || !a.Action.Holds() || !a.Action.StepsUp() {
		t.Errorf("card testing: %+v", a)
	}
}

func TestCleanSignals(t *testing.T) {
	got := CleanSignals([]string{"debugger", "<script>", "debugger", "emulator", "tap_burst", "hooking", "adb_enabled", "screen_captured"})
	if !slices.Equal(got, []string{"debugger", "emulator", "tap_burst", "hooking", "adb_enabled"}) {
		t.Errorf("%v", got)
	}
}
