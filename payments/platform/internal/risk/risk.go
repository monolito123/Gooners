// Package risk is the server half of the fraud shield (docs/07 §3): it scores a card-present
// authorization from what only the platform sees, weighs the phone's own score as one more
// input, and applies the decision policy of §3.6.
//
// Scores are in thousandths (0 to 1000) so the phone cores and the platform compute the same
// numbers bit for bit; the API carries them as a fraction.
package risk

import (
	"slices"
	"sort"
)

// Level buckets a score.
type Level int

const (
	Low Level = iota
	Medium
	High
)

func (l Level) String() string { return [...]string{"low", "medium", "high"}[l] }

// Action is what the policy decides for an authorization.
type Action string

const (
	Allow         Action = "allow"
	AllowHold     Action = "allow_hold"     // approve, but no instant advance and no settlement until reviewed
	StepUp        Action = "step_up"        // ask for the card's PIN
	StepUpHold    Action = "step_up_hold"   // ask for the PIN and hold settlement
	Decline       Action = "decline"        // decline without asking the issuer
	DeclineFreeze Action = "decline_freeze" // decline and freeze the terminal for review
)

// Holds reports whether an approved sale under a settles only after review.
func (a Action) Holds() bool { return a == AllowHold || a == StepUpHold }

// StepsUp reports whether a needs the cardholder's PIN.
func (a Action) StepsUp() bool { return a == StepUp || a == StepUpHold }

// Declines reports whether a stops the sale before the issuer.
func (a Action) Declines() bool { return a == Decline || a == DeclineFreeze }

// Reviewed reports whether a opens a review for an analyst.
func (a Action) Reviewed() bool { return a.Holds() || a == DeclineFreeze }

// policy is docs/07 §3.6: rows are the device level, columns the server level. A device
// that reports "all fine" never lowers what the server alone would decide below a hold.
var policy = [3][3]Action{
	Low:    {Allow, AllowHold, StepUpHold},
	Medium: {Allow, StepUp, Decline},
	High:   {StepUpHold, Decline, DeclineFreeze},
}

// Decide applies the policy.
func Decide(device, server Level) Action { return policy[device][server] }

// ---------------------------------------------------------------- device model

// DeviceModel is the on-device model the platform knows. Its weights are compiled into both
// phone cores; the conformance vectors (cmd/conformance) hold the three to the same results.
const DeviceModel = "gp-device-1"

// MaxDeviceSignals is how many signal codes a device sends (docs/07 §3.4).
const MaxDeviceSignals = 5

// DeviceWeights are the per-signal weights of DeviceModel, in thousandths (docs/07 §3.3).
var DeviceWeights = map[string]int{
	// Device posture
	"hooking":               700,
	"root_indicators":       600,
	"debugger":              600,
	"emulator":              500,
	"overlay_active":        400,
	"accessibility_service": 350,
	"screen_captured":       300,
	"adb_enabled":           200,
	"developer_options":     100,
	// Relay timing (reported by the MPoC kernel)
	"apdu_rtt_p99_exceeded": 500,
	// Interaction
	"fast_amount_to_tap": 250,
	"cancelled_taps":     200,
	"repeated_amount":    150,
	"just_under_limit":   150,
	// Session
	"decline_streak": 350,
	"tap_burst":      300,
}

// DeviceScore combines signals as a noisy OR in integer thousandths: each signal leaves
// (1000 - weight)/1000 of the remaining "clean" mass, truncated at every step. Unknown codes
// weigh nothing. It returns the score and the codes to send: the heaviest first (ties by
// name), at most MaxDeviceSignals.
func DeviceScore(signals []string) (milli int, top []string) {
	seen := map[string]bool{}
	var known []string
	for _, s := range signals {
		if _, ok := DeviceWeights[s]; ok && !seen[s] {
			seen[s] = true
			known = append(known, s)
		}
	}
	sort.Slice(known, func(i, j int) bool {
		wi, wj := DeviceWeights[known[i]], DeviceWeights[known[j]]
		if wi != wj {
			return wi > wj
		}
		return known[i] < known[j]
	})
	clean := 1000
	for _, s := range known {
		clean = clean * (1000 - DeviceWeights[s]) / 1000
	}
	if len(known) > MaxDeviceSignals {
		known = known[:MaxDeviceSignals]
	}
	return 1000 - clean, known
}

// Device is what the phone reported inside its authenticated request.
type Device struct {
	Present bool
	Milli   int // reported score
	Model   string
	Signals []string
}

// DeviceLevel buckets the device's score. For DeviceModel the score is recomputed from the
// signal codes and the higher of the two counts: a phone cannot report trouble and a low
// score at once. consistent is false when the reported score was below the recomputed one.
func DeviceLevel(d Device) (level Level, milli int, consistent bool) {
	if !d.Present {
		return Low, 0, true
	}
	milli, consistent = d.Milli, true
	if d.Model == DeviceModel {
		if m, _ := DeviceScore(d.Signals); m > milli {
			milli, consistent = m, m-d.Milli <= 1 // a rounding step in the fraction is not tampering
		}
	}
	switch {
	case milli >= 750:
		return High, milli, consistent
	case milli >= 400:
		return Medium, milli, consistent
	}
	return Low, milli, consistent
}

// ---------------------------------------------------------------- server features

// Features are what the platform knows about an authorization before it reaches the issuer.
type Features struct {
	CardAttempts10m       int   // earlier attempts with the same card in 10 minutes, at any terminal
	CardMerchants1h       int   // distinct merchants the card was presented to in the last hour, this one included
	TerminalCards10m      int   // distinct cards on this terminal in 10 minutes, this one included
	TerminalBINs10m       int   // distinct BINs among them
	TerminalDeclineStreak int   // the terminal's most recent consecutive declines
	ATC                   int   // this tap's application transaction counter, -1 when unknown
	LastATC               int   // the highest counter seen before for the card, -1 when none
	Amount                int64 // cents
	MerchantSales30d      int   // captured card-present sales in 30 days
	MerchantMedian30d     int64 // their median amount, cents
	MerchantAgeDays       int
	DeviceInconsistent    bool // the device's score did not match its own signals
}

// Server signal codes.
const (
	SigATCReplay          = "atc_replay"
	SigATCRegression      = "atc_regression"
	SigCardVelocity       = "card_velocity"
	SigCardMultiMerchant  = "card_multi_merchant"
	SigCardTesting        = "terminal_card_testing"
	SigBINSpread          = "terminal_bin_spread"
	SigDeclineStreak      = "terminal_decline_streak"
	SigAboveBaseline      = "amount_above_baseline"
	SigNewMerchantLarge   = "new_merchant_large_amount"
	SigDeviceInconsistent = "device_score_inconsistent"
)

// serverWeights, in thousandths, combined as DeviceScore does.
var serverWeights = map[string]int{
	SigATCReplay:          900,
	SigATCRegression:      800,
	SigDeviceInconsistent: 700,
	SigCardMultiMerchant:  500,
	SigCardTesting:        500,
	SigCardVelocity:       400,
	SigAboveBaseline:      350,
	SigDeclineStreak:      300,
	SigNewMerchantLarge:   300,
	SigBINSpread:          200,
}

// Thresholds of the server rules.
const (
	CardVelocityAttempts   = 5        // earlier attempts in 10 minutes
	CardMultiMerchants     = 5        // merchants in an hour (three is an afternoon at a mall)
	CardTestingCards       = 5        // distinct cards on one terminal in 10 minutes
	BINSpread              = 4        // distinct BINs on one terminal in 10 minutes
	DeclineStreak          = 3        // consecutive declines
	BaselineMinSales       = 20       // sales before a merchant has a baseline
	BaselineMultiple       = 10       // amount above this many medians
	NewMerchantDays        = 7        // a merchant younger than this
	NewMerchantLargeAmount = 1_000_00 // R$ 1.000,00
)

// Score evaluates the server rules. It returns the score in thousandths and the signals
// that fired, heaviest first.
func Score(f Features) (milli int, signals []string) {
	add := func(cond bool, s string) {
		if cond {
			signals = append(signals, s)
		}
	}
	if f.ATC >= 0 && f.LastATC >= 0 {
		add(f.ATC == f.LastATC, SigATCReplay)
		add(f.ATC < f.LastATC, SigATCRegression)
	}
	add(f.CardAttempts10m >= CardVelocityAttempts, SigCardVelocity)
	add(f.CardMerchants1h >= CardMultiMerchants, SigCardMultiMerchant)
	add(f.TerminalCards10m >= CardTestingCards, SigCardTesting)
	add(f.TerminalBINs10m >= BINSpread, SigBINSpread)
	add(f.TerminalDeclineStreak >= DeclineStreak, SigDeclineStreak)
	add(f.MerchantSales30d >= BaselineMinSales && f.MerchantMedian30d > 0 && f.Amount > BaselineMultiple*f.MerchantMedian30d, SigAboveBaseline)
	add(f.MerchantAgeDays < NewMerchantDays && f.Amount >= NewMerchantLargeAmount, SigNewMerchantLarge)
	add(f.DeviceInconsistent, SigDeviceInconsistent)
	sort.SliceStable(signals, func(i, j int) bool { return serverWeights[signals[i]] > serverWeights[signals[j]] })
	clean := 1000
	for _, s := range signals {
		clean = clean * (1000 - serverWeights[s]) / 1000
	}
	return 1000 - clean, signals
}

// ServerLevel buckets the server's score.
func ServerLevel(milli int) Level {
	switch {
	case milli >= 700:
		return High
	case milli >= 300:
		return Medium
	}
	return Low
}

// Assessment is the full evaluation of one authorization.
type Assessment struct {
	Action        Action
	DeviceLevel   Level
	DeviceMilli   int
	ServerLevel   Level
	ServerMilli   int
	ServerSignals []string
}

// Assess runs the whole pipeline.
func Assess(f Features, d Device) Assessment {
	dl, dm, consistent := DeviceLevel(d)
	f.DeviceInconsistent = !consistent
	sm, sigs := Score(f)
	sl := ServerLevel(sm)
	return Assessment{Action: Decide(dl, sl), DeviceLevel: dl, DeviceMilli: dm, ServerLevel: sl, ServerMilli: sm, ServerSignals: sigs}
}

// CleanSignals keeps the device signal codes the platform knows, at most MaxDeviceSignals,
// in the order sent: anything else in a request is dropped before it is stored.
func CleanSignals(in []string) []string {
	var out []string
	for _, s := range in {
		if _, ok := DeviceWeights[s]; ok && !slices.Contains(out, s) && len(out) < MaxDeviceSignals {
			out = append(out, s)
		}
	}
	return out
}
