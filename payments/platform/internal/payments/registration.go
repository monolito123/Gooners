package payments

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/pricing"
	"github.com/monolito123/Gooners/payments/platform/internal/registrar"
)

// arrangement is the payment arrangement code of a card receivable: the brand's letter and
// CC (credit) or CD (debit and prepaid), as registrars name them (VCC, MCD, ECC…).
func arrangement(brand, funding string) string {
	letter := map[string]string{"visa": "V", "mastercard": "M", "elo": "E", "hipercard": "H", "amex": "A"}[brand]
	if letter == "" && brand != "" {
		letter = strings.ToUpper(brand[:1])
	}
	if funding == "debit" || funding == "prepaid" {
		return letter + "CD"
	}
	return letter + "CC"
}

type registryLine struct {
	receivable int64
	key        registrar.UnitKey
	amount     int64
}

// unitTotals is what each UR is worth now: the merchant's receivables of that arrangement
// and date that are not reversed (pending, advanced or already released).
func (s *Service) unitTotals(ctx context.Context, keys []registrar.UnitKey) ([]registrar.Unit, error) {
	out := make([]registrar.Unit, 0, len(keys))
	for _, k := range keys {
		var total int64
		if err := s.pool.QueryRow(ctx, `SELECT COALESCE(sum(r.amount), 0) FROM receivables r JOIN merchants m ON m.id = r.merchant_id
			WHERE m.document = $1 AND r.arrangement = $2 AND r.settles_on = $3 AND r.status <> 'reversed'`, k.Document, k.Arrangement, k.SettlesOn).Scan(&total); err != nil {
			return nil, err
		}
		out = append(out, registrar.Unit{UnitKey: k, Total: total})
	}
	return out, nil
}

// registerUnits brings the registrar's totals for keys up to date.
func (s *Service) registerUnits(ctx context.Context, tenantID, merchantID string, keys []registrar.UnitKey) error {
	units, err := s.unitTotals(ctx, keys)
	if err != nil {
		return err
	}
	if err := s.registrar.Register(ctx, units); err != nil {
		return err
	}
	for _, u := range units {
		if _, err := s.pool.Exec(ctx, `INSERT INTO receivable_units (document, arrangement, settles_on, tenant_id, merchant_id, registered_total) VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (document, arrangement, settles_on) DO UPDATE SET registered_total = EXCLUDED.registered_total, registered_at = now()`,
			u.Document, u.Arrangement, u.SettlesOn, tenantID, merchantID, u.Total); err != nil {
			return err
		}
	}
	return nil
}

// commitAdvance registers the receivables' URs and then the platform's contract effect on
// them. Nothing is advanced unless this succeeds (docs/07 §1.6).
func (s *Service) commitAdvance(ctx context.Context, tenantID, merchantID, effectID, reason, reference string, lines []registryLine) error {
	seen := map[registrar.UnitKey]bool{}
	var keys []registrar.UnitKey
	var eff []registrar.EffectLine
	for _, l := range lines {
		if !seen[l.key] {
			seen[l.key] = true
			keys = append(keys, l.key)
		}
		eff = append(eff, registrar.EffectLine{UnitKey: l.key, Amount: l.amount})
	}
	if err := s.registerUnits(ctx, tenantID, merchantID, keys); err != nil {
		return err
	}
	if err := s.registrar.RegisterEffect(ctx, registrar.Effect{ID: effectID, Type: "assignment", Beneficiary: s.cfg.PlatformDocument, Lines: eff}); err != nil {
		return err
	}
	b, _ := json.Marshal(eff)
	_, err := s.pool.Exec(ctx, `INSERT INTO receivable_effects (id, tenant_id, merchant_id, reason, reference, lines) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
		effectID, tenantID, merchantID, reason, reference, b)
	return err
}

// receivableLines loads receivables as registry lines.
func (s *Service) receivableLines(ctx context.Context, tenantID string, ids []int64) ([]registryLine, error) {
	rows, err := s.pool.Query(ctx, `SELECT r.id, m.document, COALESCE(r.arrangement, ''), r.settles_on, r.amount FROM receivables r JOIN merchants m ON m.id = r.merchant_id
		WHERE r.tenant_id = $1 AND r.id = ANY($2) ORDER BY r.id`, tenantID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []registryLine
	for rows.Next() {
		var l registryLine
		var day time.Time
		if err := rows.Scan(&l.receivable, &l.key.Document, &l.key.Arrangement, &day, &l.amount); err != nil {
			return nil, err
		}
		l.key.SettlesOn = day.Format("2006-01-02")
		out = append(out, l)
	}
	return out, rows.Err()
}

// SyncReceivableUnits registers every future UR whose total changed since it was last
// registered (new captures, refunds, chargebacks), and returns how many it registered.
func (s *Service) SyncReceivableUnits(ctx context.Context, now time.Time) (int, error) {
	if s.registrar == nil {
		return 0, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT r.tenant_id::text, r.merchant_id, m.document, r.arrangement, r.settles_on
		FROM receivables r JOIN merchants m ON m.id = r.merchant_id
		LEFT JOIN receivable_units u ON u.document = m.document AND u.arrangement = r.arrangement AND u.settles_on = r.settles_on
		WHERE r.settles_on >= $1 AND r.arrangement IS NOT NULL
		GROUP BY 1, 2, 3, 4, 5, u.registered_total
		HAVING COALESCE(sum(r.amount) FILTER (WHERE r.status <> 'reversed'), 0) <> COALESCE(u.registered_total, -1)
		LIMIT 1000`, pricing.Date(now))
	if err != nil {
		return 0, err
	}
	type pending struct {
		tenant, merchant string
		key              registrar.UnitKey
	}
	var todo []pending
	for rows.Next() {
		var p pending
		var day time.Time
		if err := rows.Scan(&p.tenant, &p.merchant, &p.key.Document, &p.key.Arrangement, &day); err != nil {
			rows.Close()
			return 0, err
		}
		p.key.SettlesOn = day.Format("2006-01-02")
		todo = append(todo, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, p := range todo {
		if err := s.registerUnits(ctx, p.tenant, p.merchant, []registrar.UnitKey{p.key}); err != nil {
			return 0, fmt.Errorf("register %s: %w", p.key, err)
		}
	}
	return len(todo), nil
}

// freeAmounts is how much of each UR the registrar reports as free, after registering the
// URs' current totals.
func (s *Service) freeAmounts(ctx context.Context, tenantID, merchantID string, keys []registrar.UnitKey) (map[registrar.UnitKey]int64, error) {
	if err := s.registerUnits(ctx, tenantID, merchantID, keys); err != nil {
		return nil, err
	}
	av, err := s.registrar.Availability(ctx, keys)
	if err != nil {
		return nil, err
	}
	out := make(map[registrar.UnitKey]int64, len(av))
	for k, a := range av {
		out[k] = a.Free
	}
	return out, nil
}
