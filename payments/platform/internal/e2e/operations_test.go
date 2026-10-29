package e2e

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/api"
	"github.com/monolito123/Gooners/payments/platform/internal/db"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/pricing"
)

const visaAID = "A0000000031010"

func (st *stack) authOf(pi string) (rrn, code string) {
	st.t.Helper()
	if err := st.pool.QueryRow(context.Background(), `SELECT rrn, auth_code FROM authorizations WHERE payment_intent_id = $1 AND kind = 'purchase' AND status = 'approved'`, pi).Scan(&rrn, &code); err != nil {
		st.t.Fatal(err)
	}
	return rrn, code
}

func (st *stack) ledgerBalance(acc string) int64 {
	st.t.Helper()
	b, err := st.ledger.Balance(context.Background(), tenant, acc)
	if err != nil {
		st.t.Fatal(err)
	}
	return b
}

func (st *stack) sale(merchant, terminal string, amount int64) string {
	st.t.Helper()
	_, pi := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": amount, "channel": "card_present"}, 201)
	if r := st.tap(pi["id"].(string), terminal, "4111111111111111", visaAID, "credit"); r["status"] != "approved" {
		st.t.Fatalf("sale of %d: %v", amount, r)
	}
	return pi["id"].(string)
}

func TestOperations(t *testing.T) {
	st := newStack(t)
	ctx := context.Background()
	svc := st.svc

	_, m := st.call("POST", "/v1/merchants", map[string]any{
		"legal":      map[string]any{"document": map[string]any{"type": "cnpj", "number": "12345678000195"}, "legal_name": "Cafe Aurora Ltda", "trade_name": "Café Aurora", "mcc": "5812", "city": "São Paulo"},
		"scheme_mid": "000000004127731",
		"plan":       map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": true},
	}, 201)
	merchant, account := m["id"].(string), m["account_id"].(string)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant}, 201)
	terminal := term["terminal_id"].(string)

	// ---- 1. merchant lifecycle ----
	if _, err := st.pool.Exec(ctx, `UPDATE merchants SET status = 'kyb_in_review' WHERE id = $1`, merchant); err != nil {
		t.Fatal(err)
	}
	if code, p := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 100}, 0); code != http.StatusConflict || p["code"] != "merchant_not_active" {
		t.Fatalf("intent for a merchant in KYB review: %d %v", code, p)
	}
	if _, err := svc.SetMerchantStatus(ctx, tenant, merchant, payments.MerchantActive, "KYB approved, case 2026-0042", ""); err == nil {
		t.Fatal("status change without an actor accepted")
	}
	if _, err := svc.SetMerchantStatus(ctx, tenant, merchant, payments.MerchantActive, "KYB approved, case 2026-0042", "ops:ana"); err != nil {
		t.Fatal(err)
	}
	pi1 := st.sale(merchant, terminal, 12990)
	if _, err := svc.SetMerchantStatus(ctx, tenant, merchant, payments.MerchantRestricted, "VAMP ratio above 60% of threshold", "risk:bot"); err != nil {
		t.Fatal(err)
	}
	if code, _ := st.call("POST", "/v1/payouts/quotes", map[string]any{"account_id": account, "amount": 100, "destination": map[string]any{"type": "pix", "key_type": "CNPJ", "key": "12345678000195"}}, 0); code != http.StatusConflict {
		t.Fatalf("payout quote for a restricted merchant: %d", code)
	}
	if _, err := svc.SetMerchantStatus(ctx, tenant, merchant, payments.MerchantClosed, "merchant asked", "ops:ana"); !errors.Is(err, payments.ErrConflict) {
		t.Fatalf("closing a merchant with a balance: %v", err)
	}
	if _, err := svc.SetMerchantStatus(ctx, tenant, merchant, payments.MerchantActive, "review cleared", "ops:ana"); err != nil {
		t.Fatal(err)
	}
	pi2 := st.sale(merchant, terminal, 2000)

	// ---- 2. terminal and API key revocation ----
	if code, _ := st.call("POST", "/v1/terminals/"+terminal+"/revoke", map[string]any{}, 0); code != http.StatusUnprocessableEntity {
		t.Fatalf("revoke without a reason: %d", code)
	}
	st.call("POST", "/v1/terminals/"+terminal+"/revoke", map[string]any{"reason": "device lost"}, 200)
	_, pi3 := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 1500}, 201)
	if code, _ := st.call("POST", "/v1/terminal/authorizations", map[string]any{"payment_intent_id": pi3["id"], "terminal_id": terminal, "stan": "000001",
		"emv_application": "credit", "sred": map[string]any{"format": "x", "ksn": "x", "ciphertext": ""}}, 0); code != http.StatusNotFound {
		t.Fatalf("authorization from a revoked terminal: %d", code)
	}
	_, term2 := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant}, 201)
	terminal = term2["terminal_id"].(string)

	second, err := api.NewAPIKey(ctx, st.pool, tenant, "integration", []string{"payments:read"}, false)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := svc.ListAPIKeys(ctx, tenant)
	if err != nil || len(keys) != 2 {
		t.Fatalf("keys %v %v", keys, err)
	}
	var keyID string
	for _, k := range keys {
		if k.Name == "integration" {
			keyID = k.ID
		}
	}
	if err := svc.RevokeAPIKey(ctx, tenant, keyID, "leaked in a log", "ops:ana"); err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("GET", st.api+"/v1/payment-intents/"+pi1, nil)
	req.Header.Set("Authorization", "Bearer "+second)
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked key: %d", resp.StatusCode)
	}

	// ---- 3. chargeback larger than the balance, represented, won ----
	wallet := st.ledgerBalance(ledger.MerchantWallet(merchant))
	rrn1, code1 := st.authOf(pi1)
	// Leave less than the chargeback in the wallet, so part of it is booked as owed.
	_, q := st.call("POST", "/v1/payouts/quotes", map[string]any{"account_id": account, "amount": wallet - 3000, "destination": map[string]any{"type": "pix", "key_type": "CNPJ", "key": "12345678000195"}}, 201)
	st.call("POST", "/v1/payouts", map[string]any{"quote_id": q["id"]}, 201)
	notice := payments.DisputeNotice{Event: payments.NoticeOpened, Scheme: "visa", NetworkCaseID: "VCR-2026-11-0458812", ReasonCode: "10.4", Category: "fraud",
		Amount: 12990, RRN: rrn1, AuthCode: code1, EvidenceDueAt: time.Now().Add(20 * 24 * time.Hour), Source: "test:1"}
	d1, err := svc.ApplyDisputeNotice(ctx, tenant, notice)
	if err != nil {
		t.Fatal(err)
	}
	if d1.PaymentIntentID != pi1 || d1.Status != payments.DisputeEvidenceRequired || d1.Recommendation != "represent" {
		t.Fatalf("dispute %+v", d1)
	}
	if got := st.ledgerBalance(ledger.MerchantWallet(merchant)); got != 0 {
		t.Fatalf("wallet after chargeback %d", got)
	}
	if got := st.ledgerBalance(ledger.MerchantRecoverable(merchant)); got != 12990-3000 {
		t.Fatalf("owed after chargeback %d, want %d", got, 12990-3000)
	}
	if _, err := svc.ApplyDisputeNotice(ctx, tenant, notice); err != nil { // the same file again
		t.Fatal(err)
	}
	if got := st.ledgerBalance(ledger.SchemePayable("visa")); got != 12990 {
		t.Fatalf("scheme payable %d after a repeated notice", got)
	}
	if code, _ := st.call("POST", "/v1/refunds", map[string]any{"payment_intent_id": pi1, "amount": 100}, 0); code != http.StatusConflict {
		t.Fatalf("refund of a disputed payment: %d", code)
	}
	_, got := st.call("GET", "/v1/disputes/"+d1.ID, nil, 200)
	ev := got["auto_evidence"].(map[string]any)
	if ev["card_present"].(map[string]any)["emv_cryptogram"] != true || got["ledger"].(map[string]any)["owed_by_merchant"].(float64) != 9990 {
		t.Fatalf("dispute view %v", got)
	}
	_, sub := st.call("POST", "/v1/disputes/"+d1.ID+"/evidence", map[string]any{"explanation": "Contactless EMV, signed receipt delivered.", "submit": true}, 200)
	if sub["status"] != "represented" {
		t.Fatalf("after evidence: %v", sub["status"])
	}
	if _, err := svc.ApplyDisputeNotice(ctx, tenant, payments.DisputeNotice{Event: payments.NoticeWon, Scheme: "visa", NetworkCaseID: notice.NetworkCaseID, Source: "test:2"}); err != nil {
		t.Fatal(err)
	}
	if n, err := svc.RecoverShortfalls(ctx); err != nil || n != 1 {
		t.Fatalf("recovered %d: %v", n, err)
	}
	if owed, w := st.ledgerBalance(ledger.MerchantRecoverable(merchant)), st.ledgerBalance(ledger.MerchantWallet(merchant)); owed != 0 || w != 3000 {
		t.Fatalf("after winning: owed %d, wallet %d", owed, w)
	}

	// ---- 4. a dispute accepted by the merchant, one expired at its deadline ----
	rrn2, _ := st.authOf(pi2)
	d2, err := svc.ApplyDisputeNotice(ctx, tenant, payments.DisputeNotice{Event: payments.NoticeOpened, Scheme: "visa", NetworkCaseID: "VCR-2026-11-0458813", ReasonCode: "13.1",
		Category: "consumer_dispute", Amount: 2000, RRN: rrn2, EvidenceDueAt: time.Now().Add(24 * time.Hour), Source: "test:3"})
	if err != nil {
		t.Fatal(err)
	}
	if d2.Recommendation != "refund" {
		t.Fatalf("recommendation %s", d2.Recommendation)
	}
	st.call("POST", "/v1/disputes/"+d2.ID+"/accept", nil, 200)
	pi4 := st.sale(merchant, terminal, 4000)
	rrn4, _ := st.authOf(pi4)
	d3, err := svc.ApplyDisputeNotice(ctx, tenant, payments.DisputeNotice{Event: payments.NoticeOpened, Scheme: "visa", NetworkCaseID: "VCR-2026-11-0458814", ReasonCode: "12.6",
		Category: "processing_error", Amount: 4000, RRN: rrn4, EvidenceDueAt: time.Now().Add(-time.Minute), Source: "test:4"})
	if err != nil {
		t.Fatal(err)
	}
	if n, err := svc.SweepDisputes(ctx, time.Now()); err != nil || n != 1 {
		t.Fatalf("expired %d: %v", n, err)
	}
	if d, _ := svc.GetDispute(ctx, tenant, d3.ID); d.Status != payments.DisputeAccepted {
		t.Fatalf("expired dispute is %s", d.Status)
	}
	_, list := st.call("GET", "/v1/disputes?status=accepted", nil, 200)
	if n := len(list["data"].([]any)); n != 2 {
		t.Fatalf("%d accepted disputes", n)
	}

	// ---- 5. card settlement report ----
	sale := func(pi string, amount, ic, fee int64) payments.SettlementLine {
		rrn, code := st.authOf(pi)
		return payments.SettlementLine{RecordType: "sale", Brand: "visa", RRN: rrn, AuthCode: code, Amount: amount, Interchange: ic, SchemeFees: fee, Net: amount - ic - fee}
	}
	icBefore := st.ledgerBalance(ledger.AccExpenseInterchange)
	report := []payments.SettlementLine{
		sale(pi1, 12990, 210, 16), // actual interchange 2.10 vs 2.08 estimated
		sale(pi2, 2000, 32, 5),
		sale(pi4, 4000, 64, 7),
		{RecordType: "sale", Brand: "visa", RRN: "999999999999", Amount: 5000, Interchange: 80, SchemeFees: 8, Net: 4912},
		{RecordType: "chargeback", Brand: "visa", RRN: rrn1, Amount: 12990, Net: -12990, CaseID: "VCR-2026-11-0458812"},
		{RecordType: "chargeback_reversal", Brand: "visa", RRN: rrn1, Amount: 12990, Net: 12990, CaseID: "VCR-2026-11-0458812"},
		{RecordType: "chargeback", Brand: "visa", RRN: rrn2, Amount: 2000, Net: -2000, CaseID: "VCR-2026-11-0458813"},
		{RecordType: "chargeback", Brand: "visa", RRN: rrn4, Amount: 4000, Net: -4000, CaseID: "VCR-2026-11-0458814"},
	}
	var csv bytes.Buffer
	csv.WriteString("record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id\n")
	for _, l := range report {
		csv.WriteString(strings.Join([]string{l.RecordType, l.Brand, l.RRN, l.AuthCode, itoa(l.Amount), itoa(l.Interchange), itoa(l.SchemeFees), itoa(l.Net), l.CaseID}, ",") + "\n")
	}
	lines, err := payments.ParseSettlementCSV(&csv)
	if err != nil {
		t.Fatal(err)
	}
	run, err := svc.ReconcileCardReport(ctx, tenant, "SPONSOR-2026-11-02", time.Now(), lines)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "exceptions" || len(run.Exceptions) != 1 || run.Exceptions[0].Kind != "unmatched_sale" {
		t.Fatalf("reconciliation %+v", run)
	}
	for acc, want := range map[string]int64{ledger.SchemeReceivable("visa"): 0, ledger.SchemePayable("visa"): 0, ledger.AccReconSuspense: 4912} {
		if got := st.ledgerBalance(acc); got != want {
			t.Errorf("%s = %d after settlement, want %d", acc, got, want)
		}
	}
	if d := st.ledgerBalance(ledger.AccExpenseInterchange) - icBefore; d != 2+(32-pricingIC(2000))+(64-pricingIC(4000)) {
		t.Errorf("interchange true-up %d", d)
	}
	if _, err := svc.ReconcileCardReport(ctx, tenant, "SPONSOR-2026-11-02", time.Now(), lines); !errors.Is(err, payments.ErrConflict) {
		t.Fatalf("the same report twice: %v", err)
	}
	again, err := svc.ReconcileCardReport(ctx, tenant, "SPONSOR-2026-11-03", time.Now(), []payments.SettlementLine{withLine(sale(pi1, 12990, 210, 16), 2)})
	if err != nil || len(again.Exceptions) != 1 || again.Exceptions[0].Kind != "duplicate_settlement" {
		t.Fatalf("a sale settled twice: %+v %v", again, err)
	}
	if got := st.ledgerBalance(ledger.AccReconSuspense); got != 4912+12764 {
		t.Fatalf("suspense after the duplicate %d", got)
	}
	ex, _ := svc.OpenExceptions(ctx, tenant)
	if len(ex) != 2 {
		t.Fatalf("open exceptions %v", ex)
	}
	if err := svc.AllocateSuspense(ctx, tenant, 4912, ledger.MerchantWallet(merchant), "line 5 was this merchant's sale on a terminal registered late", "ops:ana"); err != nil {
		t.Fatal(err)
	}
	if err := svc.AllocateSuspense(ctx, tenant, 100, ledger.AccEquityCapital, "x", "ops:ana"); err == nil {
		t.Fatal("suspense allocated to equity")
	}
	if err := svc.ResolveException(ctx, tenant, ex[0]["id"].(int64), "allocated to the merchant, ticket 881", "ops:ana"); err != nil {
		t.Fatal(err)
	}

	// ---- 6. Pix: a lost webhook healed by reconciliation, then a MED return ----
	_, pix := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 2390, "payment_method_types": []string{"pix"}}, 201)
	_, conf := st.call("POST", "/v1/payment-intents/"+pix["id"].(string)+"/confirm", nil, 200)
	st.pspControl("/sim/pagar/" + conf["next_action"].(map[string]any)["txid"].(string) + "?webhook=false")
	if _, p := st.call("GET", "/v1/payment-intents/"+pix["id"].(string), nil, 200); p["status"] != "requires_action" {
		t.Fatalf("pix without webhook: %v", p["status"])
	}
	prun, err := svc.ReconcilePix(ctx, tenant, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if prun.Summary["healed"] != 1 || prun.Status != "balanced" {
		t.Fatalf("pix reconciliation %+v", prun)
	}
	_, paid := st.call("GET", "/v1/payment-intents/"+pix["id"].(string), nil, 200)
	if paid["status"] != "captured" {
		t.Fatalf("after reconciliation: %v", paid["status"])
	}
	walletBeforeMED := st.ledgerBalance(ledger.MerchantWallet(merchant))
	e2e := paid["latest_attempt"].(map[string]any)["end_to_end_id"].(string)
	st.pspControl("/sim/med/" + e2e)
	if _, p := st.call("GET", "/v1/payment-intents/"+pix["id"].(string), nil, 200); p["status"] != "refunded" {
		t.Fatalf("after MED: %v", p["status"])
	}
	if got := st.ledgerBalance(ledger.MerchantWallet(merchant)); got != walletBeforeMED-2390 {
		t.Fatalf("wallet after MED %d, want %d", got, walletBeforeMED-2390)
	}
	if _, err := svc.ReconcilePix(ctx, tenant, time.Now()); err != nil { // replays the MED: applied once
		t.Fatal(err)
	}
	if got := st.ledgerBalance(ledger.MerchantWallet(merchant)); got != walletBeforeMED-2390 {
		t.Fatalf("MED applied twice: wallet %d", got)
	}

	// ---- 7. invariants, metrics, webhooks ----
	if v, err := st.ledger.Verify(ctx, ledger.DefaultVerifyOptions); err != nil || len(v) > 0 {
		t.Fatalf("ledger invariants: %v %v", v, err)
	}
	reg := metrics.NewRegistry()
	svc.RegisterMetrics(reg)
	var mb bytes.Buffer
	reg.Write(ctx, &mb)
	metrics.Default.Write(ctx, &mb)
	for _, want := range []string{`goonerspay_recon_exceptions_open{kind="duplicate_settlement"} 1`, `goonerspay_recon_suspense_centavos{tenant="` + tenant + `"} 12764`,
		`goonerspay_merchants{status="active"}`, `goonerspay_safeguarding_headroom_centavos{tenant="` + tenant + `"}`, `goonerspay_card_authorizations_total{outcome="approved"}`,
		`goonerspay_http_requests_total{code="201",route="POST /v1/payment-intents"}`, `goonerspay_pix_med_returns_total{natureza="MED_FRAUDE"} 1`} {
		if !strings.Contains(mb.String(), want) {
			t.Errorf("metrics lack %s", want)
		}
	}
	if strings.Contains(mb.String(), "goonerspay_safeguarding_headroom_centavos{tenant=\""+tenant+"\"} -") {
		t.Error("negative safeguarding headroom")
	}
	n, err := st.dispatch.Once(ctx)
	if err != nil {
		t.Fatal(err)
	}
	types := map[string]bool{}
	for i := 0; i < n; i++ {
		var ev map[string]any
		_ = json.Unmarshal((<-st.hooks).body, &ev)
		types[ev["type"].(string)] = true
	}
	for _, want := range []string{"merchant.kyb.approved", "merchant.status_changed", "terminal.revoked", "dispute.opened", "dispute.won", "dispute.lost", "dispute.evidence_due_soon", "payment_intent.med_returned"} {
		if !types[want] {
			t.Errorf("missing webhook %s", want)
		}
	}
	// Periodic jobs run on one replica at a time.
	svc.RunPeriodic(ctx, "replica-a")
	if ok, err := db.TryLease(ctx, st.pool, "periodic-jobs", "replica-b", time.Minute); err != nil || ok {
		t.Fatalf("a second replica took the jobs lease: %v %v", ok, err)
	}
	if ok, _ := db.TryLease(ctx, st.pool, "periodic-jobs", "replica-a", time.Minute); !ok {
		t.Fatal("the holder could not renew its lease")
	}

	var audited int
	_ = st.pool.QueryRow(ctx, `SELECT count(*) FROM ops_audit WHERE tenant_id = $1`, tenant).Scan(&audited)
	if audited != 7 { // 3 status changes, terminal, key, allocation, exception (refusals are not recorded)
		t.Errorf("audit trail has %d entries", audited)
	}
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

func withLine(l payments.SettlementLine, n int) payments.SettlementLine { l.Line = n; return l }

// pricingIC is the interchange the capture journal estimated for a credit sale.
func pricingIC(amount int64) int64 { return pricing.DefaultCosts.Interchange(amount, "credit") }
