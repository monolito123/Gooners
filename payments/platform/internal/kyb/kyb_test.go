package kyb

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// An answer of BrasilAPI's CNPJ endpoint, trimmed to the fields read (the shape as served in
// November 2026).
const brasilAPIAnswer = `{"uf":"SP","cep":"01311902","qsa":[{"pais":null,"nome_socio":"LUIZ CARLOS PINHO GUEDES","codigo_pais":null,
"faixa_etaria":"Entre 31 a 40 anos","cnpj_cpf_do_socio":"***682847**","qualificacao_socio":"Diretor","codigo_faixa_etaria":4}],
"cnpj":"19131243000197","porte":"DEMAIS","municipio":"SAO PAULO","cnae_fiscal":9430800,"razao_social":"OPEN KNOWLEDGE BRASIL",
"nome_fantasia":"REDE PELO CONHECIMENTO LIVRE","opcao_pelo_mei":null,"natureza_juridica":"Associação Privada","situacao_cadastral":2,
"cnae_fiscal_descricao":"Atividades de associações de defesa de direitos sociais","data_inicio_atividade":"2013-10-03",
"data_situacao_cadastral":"2013-10-03","descricao_situacao_cadastral":"ATIVA"}`

func TestBrasilAPI(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cnpj/v1/19131243000197":
			_, _ = w.Write([]byte(brasilAPIAnswer))
		case "/api/cnpj/v1/11222333000181":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"message":"CNPJ 11.222.333/0001-81 não encontrado.","type":"not_found","name":"NotFoundError"}`))
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer srv.Close()
	reg := &BrasilAPI{BaseURL: srv.URL + "/api/cnpj/v1"}
	c, err := reg.Company(context.Background(), "19131243000197")
	if err != nil {
		t.Fatal(err)
	}
	if c.LegalName != "OPEN KNOWLEDGE BRASIL" || c.Status != "active" || c.CNAE != "9430800" || c.Opened != "2013-10-03" || c.City != "SAO PAULO" ||
		len(c.Partners) != 1 || c.Partners[0].Document != "***682847**" || c.MEI {
		t.Fatalf("company %+v", c)
	}
	if _, err := reg.Company(context.Background(), "11222333000181"); !errors.Is(err, ErrNotRegistered) {
		t.Fatalf("an unknown CNPJ: %v", err)
	}
	if _, err := reg.Company(context.Background(), "00000000000191"); err == nil || errors.Is(err, ErrNotRegistered) {
		t.Fatalf("a registry failure must not read as unregistered: %v", err)
	}
}

func TestAssess(t *testing.T) {
	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	cafe := &Company{CNPJ: "12345678000195", LegalName: "CAFE AURORA LTDA", Status: "active", Opened: "2019-03-01", City: "SAO PAULO", State: "SP",
		Partners: []Partner{{Name: "ANA LUCIA PEREIRA", Document: "***456789**", Role: "Sócio-Administrador"}}}
	ana := Person{Name: "Ana Lúcia Pereira", CPF: "12345678909"}
	declared := Declared{Document: "12345678000195", LegalName: "Café Aurora Ltda.", MCC: "5812", City: "São Paulo", Representatives: []Person{ana}}
	codes := func(r Result) string {
		var c []string
		for _, f := range r.Findings {
			c = append(c, f.Code)
		}
		return strings.Join(c, ",")
	}
	if r := Assess(declared, cafe, now, Policy{}); r.Outcome != Approved || len(r.Findings) != 0 {
		t.Fatalf("a clean company: %s %s", r.Outcome, codes(r))
	}
	// Spelling the company type another way, or leaving it out, is the same name.
	for _, n := range []string{"CAFE AURORA LIMITADA", "Café Aurora", "café aurora ltda"} {
		d := declared
		d.LegalName = n
		if r := Assess(d, cafe, now, Policy{}); r.Outcome != Approved {
			t.Errorf("%q: %s %s", n, r.Outcome, codes(r))
		}
	}
	for name, tc := range map[string]struct {
		change  func(*Declared, *Company)
		outcome string
		code    string
	}{
		"closed":            {func(_ *Declared, c *Company) { c.Status, c.StatusSince = "closed", "2024-05-02" }, Rejected, "registration_inactive"},
		"unfit":             {func(_ *Declared, c *Company) { c.Status = "unfit" }, Rejected, "registration_inactive"},
		"suspended":         {func(_ *Declared, c *Company) { c.Status = "suspended" }, Review, "registration_suspended"},
		"another name":      {func(d *Declared, _ *Company) { d.LegalName = "Padaria Central Ltda" }, Review, "legal_name_mismatch"},
		"another city":      {func(d *Declared, _ *Company) { d.City = "Recife" }, Review, "city_mismatch"},
		"opened last month": {func(_ *Declared, c *Company) { c.Opened = "2026-10-01" }, Review, "recently_opened"},
		"betting":           {func(d *Declared, _ *Company) { d.MCC = "7995" }, Review, "high_risk_mcc"},
		"not a partner": {func(d *Declared, _ *Company) {
			d.Representatives = []Person{{Name: "Bruno Costa", CPF: "98765432100"}}
		}, Review, "representative_not_registered"},
		"a namesake with another CPF": {func(d *Declared, _ *Company) {
			d.Representatives = []Person{{Name: "Ana Lucia Pereira", CPF: "11111111111"}}
		}, Review, "representative_not_registered"},
	} {
		d, c := declared, *cafe
		tc.change(&d, &c)
		r := Assess(d, &c, now, Policy{})
		if r.Outcome != tc.outcome || !strings.Contains(codes(r), tc.code) {
			t.Errorf("%s: %s %s, want %s %s", name, r.Outcome, codes(r), tc.outcome, tc.code)
		}
		if len(r.PublicFindings()) != len(r.Findings) {
			t.Errorf("%s: registry findings are the partner's to see", name)
		}
	}
	// A MEI has no partners: its legal name carries its owner's name.
	mei := &Company{CNPJ: "45678912000110", LegalName: "ANA LUCIA PEREIRA 12345678909", Status: "active", Opened: "2020-01-10", MEI: true, Partners: []Partner{}}
	if r := Assess(Declared{LegalName: "Ana Lucia Pereira 12345678909", MCC: "5812", Representatives: []Person{ana}}, mei, now, Policy{}); r.Outcome != Approved {
		t.Errorf("a MEI and its owner: %s %s", r.Outcome, codes(r))
	}
	// An individual has no public registry.
	if r := Assess(Declared{Document: "12345678909", LegalName: "Ana", MCC: "5812"}, nil, now, Policy{}); r.Outcome != Review || codes(r) != "identity_check_required" {
		t.Errorf("an individual: %s %s", r.Outcome, codes(r))
	}
	// A finding only compliance sees.
	r := Assess(declared, cafe, now, Policy{})
	r.Add(Review, "sanctions_screening", "possible match", false)
	if r.Outcome != Review || len(r.PublicFindings()) != 0 {
		t.Errorf("a private finding: %s %v", r.Outcome, r.PublicFindings())
	}
}
