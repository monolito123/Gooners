package payments

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
	"github.com/monolito123/Gooners/payments/platform/internal/risk"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
	"github.com/monolito123/Gooners/payments/platform/pkg/emv"
)

// Risk modes (Config.RiskMode).
const (
	RiskEnforce = "enforce" // the policy acts (default)
	RiskShadow  = "shadow"  // assessments are recorded and counted, every sale goes on (docs/07 §3.4 "7-day shadow")
	RiskOff     = "off"
)

var (
	mRiskActions = metrics.Default.Counter("goonerspay_risk_assessments_total", "Fraud shield decisions by action and mode.", "action", "mode")
	mRiskSignals = metrics.Default.Counter("goonerspay_risk_signals_total", "Fraud shield signals by source.", "source", "signal")
)

// riskCard is what the assessment needs from the card; nothing in it is sensitive.
type riskCard struct {
	fingerprint, bin string
	instance         string // one physical card: the counter restarts on a reissued card
	atc              int    // -1 when the kernel did not send 9F36
}

func newRiskCard(fingerprint, bin, expiry, panSequence, emvHex string) riskCard {
	h := sha256.Sum256([]byte(fingerprint + "|" + expiry + "|" + panSequence))
	c := riskCard{fingerprint: fingerprint, bin: bin, instance: hex.EncodeToString(h[:8]), atc: -1}
	if objs, err := emv.ParseHex(emvHex); err == nil {
		if t, ok := emv.Find(objs, "9F36"); ok && len(t.Value) == 2 {
			c.atc = int(t.Value[0])<<8 | int(t.Value[1])
		}
	}
	return c
}

// assessment is a recorded risk.Assessment.
type assessment struct {
	risk.Assessment
	id       string
	enforced bool
}

// act reports whether the policy's action applies (enforce mode).
func (a *assessment) act() risk.Action {
	if a == nil || !a.enforced {
		return risk.Allow
	}
	return a.Action
}

// assessRisk computes the server features of a card-present attempt, applies the policy and
// records the assessment before the issuer sees anything. It returns nil when risk is off.
func (s *Service) assessRisk(ctx context.Context, tenantID string, pi *Intent, m *Merchant, terminalID string, card riskCard, device risk.Device) (*assessment, error) {
	if s.cfg.RiskMode == RiskOff {
		return nil, nil
	}
	now := s.cfg.Now()
	f := risk.Features{ATC: card.atc, LastATC: -1, Amount: pi.Amount}
	var lastATC *int
	var outcomes []string
	var median *float64
	var merchantCreated time.Time
	err := s.pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM risk_assessments WHERE card_fingerprint = $1 AND created_at > $3::timestamptz - interval '10 minutes' AND payment_intent_id <> $6),
		(SELECT count(DISTINCT merchant_id) FROM risk_assessments WHERE card_fingerprint = $1 AND created_at > $3::timestamptz - interval '1 hour' AND merchant_id <> $5),
		(SELECT count(DISTINCT card_fingerprint) FROM risk_assessments WHERE terminal_id = $2 AND created_at > $3::timestamptz - interval '10 minutes' AND card_fingerprint <> $1),
		(SELECT count(DISTINCT card_bin) FROM risk_assessments WHERE terminal_id = $2 AND created_at > $3::timestamptz - interval '10 minutes' AND card_bin <> $4),
		(SELECT max(atc) FROM risk_assessments WHERE card_fingerprint = $1 AND card_instance = $7 AND atc IS NOT NULL AND payment_intent_id <> $6),
		(SELECT COALESCE(array_agg(outcome ORDER BY created_at DESC), '{}') FROM (SELECT outcome, created_at FROM risk_assessments
			WHERE terminal_id = $2 AND outcome IS NOT NULL ORDER BY created_at DESC LIMIT 10) recent),
		(SELECT count(*) FROM payment_intents WHERE tenant_id = $8 AND merchant_id = $5 AND channel = 'card_present' AND amount_captured > 0 AND captured_at > $3::timestamptz - interval '30 days'),
		(SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) FROM payment_intents
			WHERE tenant_id = $8 AND merchant_id = $5 AND channel = 'card_present' AND amount_captured > 0 AND captured_at > $3::timestamptz - interval '30 days'),
		(SELECT created_at FROM merchants WHERE id = $5)`,
		card.fingerprint, terminalID, now, card.bin, m.ID, pi.ID, card.instance, tenantID).
		Scan(&f.CardAttempts10m, &f.CardMerchants1h, &f.TerminalCards10m, &f.TerminalBINs10m, &lastATC, &outcomes, &f.MerchantSales30d, &median, &merchantCreated)
	if err != nil {
		return nil, fmt.Errorf("risk features: %w", err)
	}
	f.CardMerchants1h++  // this merchant
	f.TerminalCards10m++ // this card
	f.TerminalBINs10m++  // this BIN
	if lastATC != nil {
		f.LastATC = *lastATC
	}
	if median != nil {
		f.MerchantMedian30d = int64(*median)
	}
	f.MerchantAgeDays = int(now.Sub(merchantCreated).Hours() / 24)
	// Issuer declines in a row. The platform's own risk outcomes neither count nor break the
	// streak: they must not feed the next decision, nor hide a card tester from it.
	for _, o := range outcomes {
		if strings.HasPrefix(o, "risk_") {
			continue
		}
		if o != "declined" && o != "pin_required" {
			break
		}
		f.TerminalDeclineStreak++
	}

	a := &assessment{Assessment: risk.Assess(f, device), id: ids.New("rsk"), enforced: s.cfg.RiskMode != RiskShadow}
	var devScore *int
	var devModel *string
	if device.Present {
		devScore, devModel = &device.Milli, &device.Model
	}
	var atc *int
	if card.atc >= 0 {
		atc = &card.atc
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO risk_assessments (id, tenant_id, merchant_id, terminal_id, payment_intent_id, card_fingerprint, card_bin, card_instance, atc, amount,
			device_score, device_model, device_signals, device_level, server_score, server_signals, server_level, action, enforced, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
		a.id, tenantID, m.ID, terminalID, pi.ID, card.fingerprint, card.bin, card.instance, atc, pi.Amount,
		devScore, devModel, nonNil(device.Signals), a.DeviceLevel.String(), a.ServerMilli, nonNil(a.ServerSignals), a.ServerLevel.String(), string(a.Action), a.enforced, now); err != nil {
		return nil, fmt.Errorf("record risk assessment: %w", err)
	}
	mode := "enforce"
	if !a.enforced {
		mode = "shadow"
	}
	mRiskActions.Inc(string(a.Action), mode)
	for _, sig := range a.ServerSignals {
		mRiskSignals.Inc("server", sig)
	}
	for _, sig := range device.Signals {
		mRiskSignals.Inc("device", sig)
	}
	return a, nil
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// riskOutcome records how the attempt ended, for the next assessment's decline streak.
func (s *Service) riskOutcome(ctx context.Context, a *assessment, outcome string) {
	if a == nil {
		return
	}
	if _, err := s.pool.Exec(ctx, `UPDATE risk_assessments SET outcome = $2 WHERE id = $1`, a.id, outcome); err != nil {
		s.log.Error("record risk outcome", "assessment", a.id, "err", err)
	}
}

// openReview opens the analyst review of an assessment; for decline_freeze it also freezes
// the terminal, in the same transaction.
func (s *Service) openReview(ctx context.Context, tenantID, merchantID, terminalID, paymentIntentID string, a *assessment) {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE risk_assessments SET review_status = 'open' WHERE id = $1`, a.id); err != nil {
			return err
		}
		if a.act() == risk.DeclineFreeze {
			if _, err := tx.Exec(ctx, `UPDATE terminals SET status = 'frozen', frozen_reason = $2 WHERE id = $1 AND status = 'active'`, terminalID, "risk review "+a.id); err != nil {
				return err
			}
			if err := webhooks.Enqueue(ctx, tx, tenantID, "terminal.frozen", map[string]any{"terminal_id": terminalID, "merchant_id": merchantID, "review_id": a.id}); err != nil {
				return err
			}
		}
		return webhooks.Enqueue(ctx, tx, tenantID, "risk.review_opened", map[string]any{
			"id": a.id, "object": "risk_review", "merchant_id": merchantID, "terminal_id": terminalID, "payment_intent_id": paymentIntentID, "action": string(a.Action)})
	})
	if err != nil {
		s.log.Error("open risk review", "assessment", a.id, "err", err)
	}
}

// RiskReview is an assessment an analyst has to look at: a held sale or a frozen terminal.
type RiskReview struct {
	ID              string     `json:"id"`
	Object          string     `json:"object"`
	Status          string     `json:"status"`
	Action          string     `json:"action"`
	MerchantID      string     `json:"merchant_id"`
	TerminalID      string     `json:"terminal_id"`
	PaymentIntentID string     `json:"payment_intent_id"`
	Amount          int64      `json:"amount"`
	Outcome         *string    `json:"outcome"`
	Device          RiskSide   `json:"device"`
	Server          RiskSide   `json:"server"`
	CreatedAt       time.Time  `json:"created_at"`
	ReviewedAt      *time.Time `json:"reviewed_at,omitempty"`
	ReviewedBy      *string    `json:"reviewed_by,omitempty"`
	Note            *string    `json:"note,omitempty"`
}

// RiskSide is one half of an assessment. Scores are fractions of 1.
type RiskSide struct {
	Level   string   `json:"level"`
	Score   *float64 `json:"score"`
	Model   *string  `json:"model,omitempty"`
	Signals []string `json:"signals"`
}

const reviewCols = `id, review_status, action, merchant_id, terminal_id, payment_intent_id, amount, outcome, device_level, device_score, device_model, device_signals,
	server_level, server_score, server_signals, created_at, reviewed_at, reviewed_by, review_note`

func scanReview(row pgx.Row) (*RiskReview, error) {
	r := &RiskReview{Object: "risk_review"}
	var dev *int
	var srv int
	if err := row.Scan(&r.ID, &r.Status, &r.Action, &r.MerchantID, &r.TerminalID, &r.PaymentIntentID, &r.Amount, &r.Outcome, &r.Device.Level, &dev, &r.Device.Model, &r.Device.Signals,
		&r.Server.Level, &srv, &r.Server.Signals, &r.CreatedAt, &r.ReviewedAt, &r.ReviewedBy, &r.Note); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if dev != nil {
		f := float64(*dev) / 1000
		r.Device.Score = &f
	}
	f := float64(srv) / 1000
	r.Server.Score = &f
	return r, nil
}

// ListRiskReviews lists a tenant's reviews in one status (open by default), oldest first,
// a page at a time.
func (s *Service) ListRiskReviews(ctx context.Context, tenantID, status, startingAfter string, limit int) ([]*RiskReview, bool, error) {
	if status == "" {
		status = "open"
	}
	if !slices.Contains([]string{"open", "released", "fraud"}, status) {
		return nil, false, invalid("status must be open, released or fraud")
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `SELECT `+reviewCols+` FROM risk_assessments WHERE tenant_id = $1 AND review_status = $2
		AND ($3 = '' OR (created_at, id) > (SELECT created_at, id FROM risk_assessments WHERE tenant_id = $1 AND id = $3))
		ORDER BY created_at, id LIMIT $4`, tenantID, status, startingAfter, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []*RiskReview{}
	for rows.Next() {
		r, err := scanReview(rows)
		if err != nil {
			return nil, false, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	if len(out) > limit {
		return out[:limit], true, nil
	}
	return out, false, nil
}

// GetRiskReview reads one review.
func (s *Service) GetRiskReview(ctx context.Context, tenantID, id string) (*RiskReview, error) {
	return scanReview(s.pool.QueryRow(ctx, `SELECT `+reviewCols+` FROM risk_assessments WHERE tenant_id = $1 AND id = $2 AND review_status <> 'none'`, tenantID, id))
}

// Review resolutions.
const (
	ResolveRelease = "release" // genuine: the held money settles on schedule, a frozen terminal sells again
	ResolveFraud   = "fraud"   // confirmed: the money stays held for the chargeback, a frozen terminal is revoked
)

// ResolveRiskReview closes an open review. It is recorded in the audit trail.
func (s *Service) ResolveRiskReview(ctx context.Context, tenantID, id, resolution, note, actor string) (*RiskReview, error) {
	if resolution != ResolveRelease && resolution != ResolveFraud {
		return nil, invalid("resolution must be release or fraud")
	}
	if note == "" {
		return nil, invalid("a note is required")
	}
	status := map[string]string{ResolveRelease: "released", ResolveFraud: "fraud"}[resolution]
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var merchant, terminal, pi, action string
		err := tx.QueryRow(ctx, `UPDATE risk_assessments SET review_status = $3, reviewed_at = $4, reviewed_by = $5, review_note = $6
			WHERE tenant_id = $1 AND id = $2 AND review_status = 'open' RETURNING merchant_id, terminal_id, payment_intent_id, action`,
			tenantID, id, status, s.cfg.Now(), actor, note).Scan(&merchant, &terminal, &pi, &action)
		if errors.Is(err, pgx.ErrNoRows) {
			var cur string
			if err := tx.QueryRow(ctx, `SELECT review_status FROM risk_assessments WHERE tenant_id = $1 AND id = $2 AND review_status <> 'none'`, tenantID, id).Scan(&cur); err != nil {
				return ErrNotFound
			}
			return fmt.Errorf("%w: the review is already %s", ErrConflict, cur)
		}
		if err != nil {
			return err
		}
		frozenBy := "risk review " + id
		if resolution == ResolveRelease {
			if _, err := tx.Exec(ctx, `UPDATE receivables SET held = false WHERE tenant_id = $1 AND payment_intent_id = $2 AND held`, tenantID, pi); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE terminals SET status = 'active', frozen_reason = NULL WHERE id = $1 AND status = 'frozen' AND frozen_reason = $2`, terminal, frozenBy); err != nil {
				return err
			}
		} else {
			tag, err := tx.Exec(ctx, `UPDATE terminals SET status = 'revoked', revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND status = 'frozen' AND frozen_reason = $3`,
				terminal, "fraud confirmed by "+frozenBy, frozenBy)
			if err != nil {
				return err
			}
			if tag.RowsAffected() > 0 {
				if err := webhooks.Enqueue(ctx, tx, tenantID, "terminal.revoked", map[string]any{"terminal_id": terminal, "merchant_id": merchant, "reason": "fraud confirmed"}); err != nil {
					return err
				}
			}
		}
		if err := audit(ctx, tx, tenantID, actor, "risk_review."+resolution, id, map[string]string{"note": note, "payment_intent_id": pi}); err != nil {
			return err
		}
		return webhooks.Enqueue(ctx, tx, tenantID, "risk.review_resolved", map[string]any{
			"id": id, "object": "risk_review", "merchant_id": merchant, "terminal_id": terminal, "payment_intent_id": pi, "resolution": resolution})
	})
	if err != nil {
		return nil, err
	}
	return s.GetRiskReview(ctx, tenantID, id)
}

// DeviceRisk turns the API's device_risk into a risk.Device: the score as thousandths, the
// model name bounded, unknown signal codes dropped.
func DeviceRisk(score float64, model string, signals []string) (risk.Device, error) {
	if score < 0 || score > 1 {
		return risk.Device{}, invalid("device_risk.score must be between 0 and 1")
	}
	if len(model) > 40 {
		return risk.Device{}, invalid("device_risk.model is too long")
	}
	milli, _ := strconv.Atoi(strconv.FormatFloat(score*1000, 'f', 0, 64))
	return risk.Device{Present: true, Milli: milli, Model: model, Signals: risk.CleanSignals(signals)}, nil
}
