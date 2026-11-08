package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/kyb"
	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
)

// KYB (docs/04 §2.5). A merchant created where KYB is required starts kyb_in_review; the
// periodic job reads its CNPJ's registration (kyb.Registry), compares it with what was
// declared, and screens the company's, its partners' and its representatives' names against
// the sanctions lists. The result is kept on the merchant:
//
//   - approved: with KYBAutoApprove the merchant becomes active (merchant.kyb.approved);
//     without it, an operator activates it with the result in hand.
//   - review: people decide. Findings the partner can act on (a legal name or a representative
//     the registry does not show) go to the tenant as merchant.kyb.action_required; a name on
//     a sanctions list opens a compliance case and is never shown to the partner.
//   - rejected: the registration rules the merchant out (a closed or unfit CNPJ); an operator
//     closes it (merchant.kyb.rejected) after reading the result.
//
// A registry that does not answer, or screening that cannot run, is retried every ten minutes.

// CaseMerchantKYB is a compliance case about a merchant's onboarding.
const CaseMerchantKYB = "merchant_kyb"

var mKYB = metrics.Default.Counter("goonerspay_kyb_checks_total", "KYB checks of new merchants, by outcome (approved, review, rejected, error).", "outcome")

// KYBResult is a merchant's KYB check: the outcome, and what a partner may see of it.
type KYBResult struct {
	Outcome   string       `json:"outcome"`
	Findings  []KYBFinding `json:"findings"`
	CheckedAt time.Time    `json:"checked_at"`
}

// KYBFinding is a finding the partner can act on.
type KYBFinding struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
}

func publicFindings(r *kyb.Result) []KYBFinding {
	out := []KYBFinding{}
	for _, f := range r.PublicFindings() {
		out = append(out, KYBFinding{Code: f.Code, Detail: f.Detail})
	}
	return out
}

type kybMerchant struct {
	tenantID, id, legalName, tradeName, document, mcc, city string
	declared                                                map[string]any
}

// CheckKYB checks the merchants waiting for KYB: up to 20 a run, oldest first. It reports how
// many it decided.
func (s *Service) CheckKYB(ctx context.Context) (int, error) {
	if s.kyb == nil {
		return 0, nil
	}
	rows, err := s.pool.Query(ctx, `SELECT tenant_id::text, id, legal_name, trade_name, document, mcc, city, COALESCE(kyb, '{}') FROM merchants
		WHERE status = 'kyb_in_review' AND kyb_result IS NULL AND (kyb_checked_at IS NULL OR kyb_checked_at < now() - interval '10 minutes')
		ORDER BY created_at LIMIT 20`)
	if err != nil {
		return 0, err
	}
	var due []kybMerchant
	for rows.Next() {
		var m kybMerchant
		var raw []byte
		if err := rows.Scan(&m.tenantID, &m.id, &m.legalName, &m.tradeName, &m.document, &m.mcc, &m.city, &raw); err != nil {
			rows.Close()
			return 0, err
		}
		_ = json.Unmarshal(raw, &m.declared)
		due = append(due, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	decided := 0
	for _, m := range due {
		if err := s.checkKYB(ctx, m, "kyb:auto"); err != nil {
			mKYB.Inc("error")
			s.log.Warn("kyb check failed; retrying in ten minutes", "merchant", m.id, "err", err)
			_, _ = s.pool.Exec(ctx, `UPDATE merchants SET kyb_checked_at = now(), kyb_attempts = kyb_attempts + 1 WHERE id = $1`, m.id)
			continue
		}
		decided++
	}
	return decided, nil
}

// RequestKYBRecheck has the periodic job check a merchant in review again within a minute
// (the registry was updated, the merchant's data corrected): the operator's command, which
// needs no registry or lists of its own.
func (s *Service) RequestKYBRecheck(ctx context.Context, tenantID, merchantID, reason, actor string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE merchants SET kyb_result = NULL, kyb_checked_at = NULL WHERE tenant_id = $1 AND id = $2 AND status = 'kyb_in_review'`,
			tenantID, merchantID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: no merchant %s in KYB review", ErrNotFound, merchantID)
		}
		return audit(ctx, tx, tenantID, actor, "merchant.kyb_recheck", merchantID, map[string]string{"reason": reason})
	})
}

// RecheckKYB runs the check again at once for a merchant still in review.
func (s *Service) RecheckKYB(ctx context.Context, tenantID, merchantID, actor string) (*kyb.Result, error) {
	if s.kyb == nil {
		return nil, fmt.Errorf("%w: no KYB registry is configured (KYB_REGISTRY)", ErrDisabled)
	}
	var m kybMerchant
	var raw []byte
	var status string
	err := s.pool.QueryRow(ctx, `SELECT tenant_id::text, id, legal_name, trade_name, document, mcc, city, COALESCE(kyb, '{}'), status FROM merchants
		WHERE tenant_id = $1 AND id = $2`, tenantID, merchantID).Scan(&m.tenantID, &m.id, &m.legalName, &m.tradeName, &m.document, &m.mcc, &m.city, &raw, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if status != MerchantKYBInReview {
		return nil, fmt.Errorf("%w: the merchant is %s, not in KYB review", ErrConflict, status)
	}
	_ = json.Unmarshal(raw, &m.declared)
	if err := s.checkKYB(ctx, m, actor); err != nil {
		return nil, err
	}
	return s.KYBDetail(ctx, tenantID, merchantID)
}

// KYBDetail is a merchant's full KYB result, the registry's data and the screening included:
// for operators and compliance, never for the partner.
func (s *Service) KYBDetail(ctx context.Context, tenantID, merchantID string) (*kyb.Result, error) {
	var raw []byte
	err := s.pool.QueryRow(ctx, `SELECT kyb_result FROM merchants WHERE tenant_id = $1 AND id = $2`, tenantID, merchantID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, fmt.Errorf("%w: the merchant has no KYB result yet", ErrNotFound)
	}
	var r kyb.Result
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Service) checkKYB(ctx context.Context, m kybMerchant, actor string) error {
	d := kyb.Declared{Document: m.document, LegalName: m.legalName, TradeName: m.tradeName, MCC: m.mcc, City: m.city}
	if reps, ok := m.declared["representatives"].([]any); ok {
		for _, x := range reps {
			if rep, ok := x.(map[string]any); ok {
				name, _ := rep["name"].(string)
				cpf, _ := rep["cpf"].(string)
				d.Representatives = append(d.Representatives, kyb.Person{Name: name, CPF: cpf})
			}
		}
	}
	var company *kyb.Company
	if ValidCNPJ(m.document) {
		c, err := s.kyb.Company(ctx, m.document)
		switch {
		case errors.Is(err, kyb.ErrNotRegistered):
		case err != nil:
			return fmt.Errorf("%w: %v", ErrUnavailable, err)
		default:
			company = c
		}
	}
	r := kyb.Assess(d, company, s.cfg.Now(), s.cfg.KYBPolicy)
	r.Registry = s.kyb.Name()
	if company == nil && ValidCNPJ(m.document) {
		r.Add(kyb.Rejected, "not_registered", "no company is registered with this CNPJ at the Receita Federal", true)
	}
	// Sanctions screening of every name the onboarding involves. A hit is compliance's to
	// decide; the partner only learns that people are reviewing the merchant.
	names := []string{m.legalName, m.tradeName}
	for _, rep := range d.Representatives {
		names = append(names, rep.Name)
	}
	if company != nil {
		names = append(names, company.LegalName, company.TradeName)
		for _, p := range company.Partners {
			names = append(names, p.Name)
		}
	}
	ns, err := s.screenNameList(ctx, m.tenantID, names)
	if err != nil {
		return fmt.Errorf("%w: screening: %v", ErrUnavailable, err)
	}
	if !ns.Screened {
		r.Add(kyb.Review, "names_not_screened", "no sanctions list with names is loaded (SANCTIONS_LISTS): compliance screens the names by hand", false)
	}
	if len(ns.Hits) > 0 {
		r.Add(kyb.Review, "sanctions_screening", strings.Join(ns.Hits, "; "), false)
	}
	if len(ns.Possible) > 0 {
		r.Add(kyb.Review, "possible_sanctions_match", strings.Join(ns.matches()[len(ns.Hits):], "; "), false)
	}
	outcome := r.Outcome
	mKYB.Inc(outcome)
	stored, _ := json.Marshal(r)
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE merchants SET kyb_result = $3, kyb_checked_at = now(), kyb_attempts = kyb_attempts + 1
			WHERE tenant_id = $1 AND id = $2 AND status = 'kyb_in_review'`, m.tenantID, m.id, stored)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: the merchant left KYB review meanwhile", ErrConflict)
		}
		if err := audit(ctx, tx, m.tenantID, actor, "merchant.kyb_checked", m.id, map[string]any{"outcome": outcome, "findings": len(r.Findings)}); err != nil {
			return err
		}
		if public := publicFindings(&r); outcome == kyb.Review && len(public) > 0 {
			return webhooks.Enqueue(ctx, tx, m.tenantID, "merchant.kyb.action_required", map[string]any{"id": m.id, "object": "merchant", "findings": public})
		}
		return nil
	})
	if err != nil {
		return err
	}
	if len(ns.Hits) > 0 {
		if _, err := s.openCase(ctx, m.tenantID, m.id, CaseMerchantKYB, ReasonSanctionsHit, "merchant:"+m.id, "", false, "", 0,
			map[string]any{"matches": ns.Hits}); err != nil {
			return err
		}
	}
	if len(ns.Possible) > 0 {
		// Compliance closing this case clears these name-and-entry pairs for the tenant.
		if _, err := s.openCase(ctx, m.tenantID, m.id, CaseMerchantKYB, ReasonNameMatch, "merchant:"+m.id, "", false, "", 0,
			map[string]any{"matches": ns.matches()[len(ns.Hits):], "possible": ns.Possible}); err != nil {
			return err
		}
	}
	if outcome == kyb.Approved && s.cfg.KYBAutoApprove {
		if _, err := s.SetMerchantStatus(ctx, m.tenantID, m.id, MerchantActive, "KYB cleared by the "+r.Registry+" registry check and sanctions screening", actor); err != nil {
			return err
		}
	}
	return nil
}

// kybSummary is what the merchant object shows of the check: the outcome and the findings the
// partner may see.
func kybSummary(raw []byte) *KYBResult {
	if raw == nil {
		return nil
	}
	var r kyb.Result
	if json.Unmarshal(raw, &r) != nil {
		return nil
	}
	return &KYBResult{Outcome: r.Outcome, Findings: publicFindings(&r), CheckedAt: r.CheckedAt}
}
