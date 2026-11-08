package e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/monolito123/Gooners/payments/platform/internal/kyb"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
)

// KYB (docs/04 §2.5): a new merchant waits in kyb_in_review while the platform reads its CNPJ at
// the Receita Federal (here a stand-in serving BrasilAPI's answers), compares what was
// declared and screens every name; a clean merchant is activated, the rest wait for people,
// and what sanctions screening found is never shown to the partner.
func TestKYB(t *testing.T) {
	var registryDown atomic.Bool
	registry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cnpj := strings.TrimPrefix(r.URL.Path, "/api/cnpj/v1/")
		if registryDown.Load() {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		answers := map[string]map[string]any{
			"12345678000195": {"cnpj": "12345678000195", "razao_social": "CAFE AURORA LTDA", "nome_fantasia": "CAFE AURORA", "situacao_cadastral": 2,
				"data_situacao_cadastral": "2019-03-01", "data_inicio_atividade": "2019-03-01", "cnae_fiscal": 5611201, "municipio": "SAO PAULO", "uf": "SP",
				"opcao_pelo_mei": false, "qsa": []map[string]any{{"nome_socio": "ANA SOUZA", "cnpj_cpf_do_socio": "***456789**", "qualificacao_socio": "Sócio-Administrador"}}},
			"11222333000181": {"cnpj": "11222333000181", "razao_social": "PADARIA ENCERRADA LTDA", "situacao_cadastral": 8, "data_situacao_cadastral": "2024-01-15",
				"data_inicio_atividade": "2012-06-20", "cnae_fiscal": 1091102, "municipio": "RECIFE", "uf": "PE", "qsa": []any{}},
		}
		a, ok := answers[cnpj]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"message":"CNPJ não encontrado.","type":"not_found","name":"NotFoundError"}`))
			return
		}
		_ = json.NewEncoder(w).Encode(a)
	}))
	defer registry.Close()
	st := newStack(t, func(d *payments.Deps) { d.KYB = &kyb.BrasilAPI{BaseURL: registry.URL + "/api/cnpj/v1"} },
		func(c *payments.Config) { c.RequireKYB, c.KYBAutoApprove = true, true })
	ctx := context.Background()

	create := func(document, legalName, city string, reps ...map[string]any) string {
		t.Helper()
		legal := map[string]any{"document": map[string]any{"type": "cnpj", "number": document}, "legal_name": legalName, "trade_name": "Loja", "mcc": "5812", "city": city}
		if len(reps) > 0 {
			legal["representatives"] = reps
		}
		_, m := st.call("POST", "/v1/merchants", map[string]any{"legal": legal}, 201)
		if m["status"] != "kyb_in_review" || m["kyb"] != nil {
			t.Fatalf("a new merchant: %v", m)
		}
		return m["id"].(string)
	}
	ana := map[string]any{"cpf": "12345678909", "name": "Ana Souza", "birth_date": "1990-04-12", "role": "partner"}
	clean := create("12345678000195", "Café Aurora Ltda.", "São Paulo", ana)
	closed := create("11222333000181", "Padaria Encerrada Ltda", "Recife")
	flagged := create("12345678000195", "Café Aurora", "São Paulo", ana, map[string]any{"cpf": "98765432100", "name": "Sandbox Sanctioned Person", "role": "partner"})
	unknown := create("44555666000181", "Loja Fantasma Ltda", "Natal")
	// A name resembling a listed one (a misspelling): a possible match, also for review.
	resembling := create("12345678000195", "Cafe Aurora", "São Paulo", ana, map[string]any{"cpf": "98765432100", "name": "Sandbox Sanctioned Persson", "role": "partner"})

	// Until KYB clears it, a merchant takes no payments.
	if c, p := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": clean, "amount": 1000, "channel": "card_present"}, 0); c != 409 {
		t.Fatalf("a payment before KYB: %d %v", c, p)
	}

	// The registry is down: nothing is decided, and the job tries again later.
	registryDown.Store(true)
	if n, err := st.svc.CheckKYB(ctx); err != nil || n != 0 {
		t.Fatalf("with the registry down: %d %v", n, err)
	}
	var attempts int
	_ = st.pool.QueryRow(ctx, `SELECT kyb_attempts FROM merchants WHERE id = $1`, clean).Scan(&attempts)
	if attempts != 1 {
		t.Fatalf("attempts %d", attempts)
	}
	if n, _ := st.svc.CheckKYB(ctx); n != 0 {
		t.Fatal("a failed check retried at once")
	}
	registryDown.Store(false)
	if _, err := st.pool.Exec(ctx, `UPDATE merchants SET kyb_checked_at = now() - interval '11 minutes'`); err != nil {
		t.Fatal(err)
	}
	if n, err := st.svc.CheckKYB(ctx); err != nil || n != 5 {
		t.Fatalf("the checks: %d %v", n, err)
	}

	get := func(id string) map[string]any { _, m := st.call("GET", "/v1/merchants/"+id, nil, 200); return m }
	findings := func(m map[string]any) []string {
		var codes []string
		for _, f := range m["kyb"].(map[string]any)["findings"].([]any) {
			codes = append(codes, f.(map[string]any)["code"].(string))
		}
		return codes
	}
	// The clean merchant is active: registry, representative and names all clear.
	if m := get(clean); m["status"] != "active" || m["kyb"].(map[string]any)["outcome"] != "approved" || len(findings(m)) != 0 {
		t.Fatalf("the clean merchant: %v", m)
	}
	if c, _ := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": clean, "amount": 1000, "channel": "card_present"}, 0); c != 201 {
		t.Fatalf("a payment after KYB: %d", c)
	}
	// A closed CNPJ, and one the registry does not know, are rejected: people close them.
	for id, code := range map[string]string{closed: "registration_inactive", unknown: "not_registered"} {
		if m := get(id); m["status"] != "kyb_in_review" || m["kyb"].(map[string]any)["outcome"] != "rejected" || !strings.Contains(strings.Join(findings(m), ","), code) {
			t.Errorf("%s: %v", code, m["kyb"])
		}
	}
	// A representative on a sanctions list: review, a compliance case, and the partner sees only
	// that the representative is not a registered partner.
	m := get(flagged)
	if m["status"] != "kyb_in_review" || m["kyb"].(map[string]any)["outcome"] != "review" || strings.Join(findings(m), ",") != "representative_not_registered" {
		t.Fatalf("the flagged merchant: %v", m["kyb"])
	}
	// (The finding names the representative the partner declared; what screening matched,
	// and against which list, stays out.)
	raw, _ := json.Marshal(m)
	if strings.Contains(string(raw), "sanctions_screening") || strings.Contains(string(raw), "sandbox test list") || strings.Contains(string(raw), "static-names") {
		t.Fatalf("the screening leaked to the partner: %s", raw)
	}
	_, cases := st.callAs(st.complianceKey(), "GET", "/v1/compliance/cases?status=open", nil, 200)
	var kybCase map[string]any
	for _, c := range cases["data"].([]any) {
		if c := c.(map[string]any); c["kind"] == "merchant_kyb" && c["merchant_id"] == flagged {
			kybCase = c
		}
	}
	if kybCase == nil || kybCase["reason"] != "sanctions_hit" || kybCase["holds_funds"] != false {
		t.Fatalf("no compliance case for the flagged merchant: %v", cases["data"])
	}
	detail, err := st.svc.KYBDetail(ctx, tenant, flagged)
	if err != nil || detail.Company == nil || detail.Company.LegalName != "CAFE AURORA LTDA" {
		t.Fatalf("the operator's view: %+v %v", detail, err)
	}
	// Compliance closes the review; an operator decides the merchant.
	st.callAs(st.complianceKey(), "POST", "/v1/compliance/cases/"+kybCase["id"].(string)+"/decision", map[string]any{"action": "close", "note": "a namesake: different CPF and birth date"}, 200)

	// Webhooks: approved for the clean merchant, action_required for the flagged one with only
	// the public finding, and rejected once the operator closes the closed CNPJ.
	if _, err := st.svc.SetMerchantStatus(ctx, tenant, closed, payments.MerchantClosed, "CNPJ baixada at the Receita Federal", "ops:alice"); err != nil {
		t.Fatal(err)
	}
	rows, _ := st.pool.Query(ctx, `SELECT type, body FROM webhook_deliveries WHERE type LIKE 'merchant.kyb.%' ORDER BY id`)
	events := map[string]string{}
	for rows.Next() {
		var typ string
		var body []byte
		_ = rows.Scan(&typ, &body)
		events[typ] = string(body)
	}
	rows.Close()
	if !strings.Contains(events["merchant.kyb.approved"], clean) || !strings.Contains(events["merchant.kyb.rejected"], closed) ||
		!strings.Contains(events["merchant.kyb.action_required"], "representative_not_registered") || strings.Contains(events["merchant.kyb.action_required"], "sandbox test list") {
		t.Fatalf("events %v", events)
	}

	// The possible match: review and a name_match case; compliance clears it as a namesake,
	// and a fresh check no longer flags that name for that entry, so the merchant clears.
	detailResembling, _ := st.svc.KYBDetail(ctx, tenant, resembling)
	var codes []string
	for _, f := range detailResembling.Findings {
		codes = append(codes, f.Code)
	}
	if detailResembling.Outcome != "review" || !strings.Contains(strings.Join(codes, ","), "possible_sanctions_match") {
		t.Fatalf("a resembling name: %s %v", detailResembling.Outcome, codes)
	}
	_, cases = st.callAs(st.complianceKey(), "GET", "/v1/compliance/cases?status=open", nil, 200)
	var possibleCase map[string]any
	for _, c := range cases["data"].([]any) {
		if c := c.(map[string]any); c["merchant_id"] == resembling && c["reason"] == "name_match" {
			possibleCase = c
		}
	}
	if possibleCase == nil {
		t.Fatalf("no name_match case: %v", cases["data"])
	}
	st.callAs(st.complianceKey(), "POST", "/v1/compliance/cases/"+possibleCase["id"].(string)+"/decision", map[string]any{"action": "close", "note": "not the listed person: another birth date and nationality"}, 200)
	var clearances int
	_ = st.pool.QueryRow(ctx, `SELECT count(*) FROM name_clearances WHERE case_id = $1`, possibleCase["id"]).Scan(&clearances)
	if clearances != 1 {
		t.Fatalf("clearances %d", clearances)
	}
	if err := st.svc.RequestKYBRecheck(ctx, tenant, resembling, "possible match cleared by compliance", "ops:alice"); err != nil {
		t.Fatal(err)
	}
	if n, _ := st.svc.CheckKYB(ctx); n != 1 {
		t.Fatalf("the recheck after clearing: %d", n)
	}
	if d, _ := st.svc.KYBDetail(ctx, tenant, resembling); d.Outcome != "review" || strings.Contains(fmt.Sprint(d.Findings), "possible_sanctions_match") {
		t.Fatalf("the cleared possible match flagged again: %+v", d.Findings)
	}

	// An operator asks for a fresh check (the merchant's data was corrected meanwhile).
	if _, err := st.pool.Exec(ctx, `UPDATE merchants SET legal_name = 'CAFE AURORA LTDA', kyb = '{}' WHERE id = $1`, flagged); err != nil {
		t.Fatal(err)
	}
	if err := st.svc.RequestKYBRecheck(ctx, tenant, flagged, "representative corrected", "ops:alice"); err != nil {
		t.Fatal(err)
	}
	if n, _ := st.svc.CheckKYB(ctx); n != 1 {
		t.Fatalf("the recheck: %d", n)
	}
	if m := get(flagged); m["status"] != "active" {
		t.Fatalf("after the correction: %v", m)
	}
	if err := st.svc.RequestKYBRecheck(ctx, tenant, clean, "x", "ops:alice"); err == nil {
		t.Fatal("a recheck of an active merchant")
	}
}
