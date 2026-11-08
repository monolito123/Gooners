// Package kyb clears merchants before they sell (docs/04 §2.5, "KYB"): it reads the company's
// registration at the Receita Federal, compares it with what the merchant declared, and says
// what people still have to decide. The registry is a contract: BrasilAPI's open CNPJ data
// (https://brasilapi.com.br/api/cnpj/v1/{cnpj}) or a server with the same answer (a
// self-hosted minhareceita), and Memory in the sandbox.
//
// What the check cannot do from public data is left to people, by name: an individual (CPF)
// has no public registry, liveness needs a vendor, and PEP lists are not loaded. Sanctions
// screening of the company's and its partners' names is the service's (payments).
package kyb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
)

// Company is a company's registration at the Receita Federal.
type Company struct {
	CNPJ      string `json:"cnpj"`
	LegalName string `json:"legal_name"`
	TradeName string `json:"trade_name,omitempty"`
	// Status is the registration status (situação cadastral): active, suspended, unfit
	// (inapta), closed (baixada) or null (nula).
	Status          string    `json:"status"`
	StatusSince     string    `json:"status_since,omitempty"`
	Opened          string    `json:"opened,omitempty"` // YYYY-MM-DD
	CNAE            string    `json:"cnae"`             // main activity, 7 digits
	CNAEDescription string    `json:"cnae_description,omitempty"`
	LegalNature     string    `json:"legal_nature,omitempty"`
	City            string    `json:"city,omitempty"`
	State           string    `json:"state,omitempty"`
	MEI             bool      `json:"mei"`
	Partners        []Partner `json:"partners"`
}

// Partner is one entry of the company's partners and administrators (QSA). The registry
// publishes a CPF masked to its middle six digits (***456789**).
type Partner struct {
	Name     string `json:"name"`
	Document string `json:"document,omitempty"`
	Role     string `json:"role,omitempty"`
}

// Registry reads companies' registrations.
type Registry interface {
	Name() string
	Company(ctx context.Context, cnpj string) (*Company, error)
}

// ErrNotRegistered is a CNPJ the registry does not know.
var ErrNotRegistered = errors.New("kyb: no company is registered with this CNPJ")

// BrasilAPI reads the Receita Federal's open CNPJ data through BrasilAPI.
type BrasilAPI struct {
	BaseURL string // https://brasilapi.com.br/api/cnpj/v1
	HTTP    *http.Client
}

// Name implements Registry.
func (b *BrasilAPI) Name() string { return "brasilapi" }

var statuses = map[int]string{1: "null", 2: "active", 3: "suspended", 4: "unfit", 8: "closed"}

// Company implements Registry.
func (b *BrasilAPI) Company(ctx context.Context, cnpj string) (*Company, error) {
	base := b.BaseURL
	if base == "" {
		base = "https://brasilapi.com.br/api/cnpj/v1"
	}
	hc := b.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 15 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(base, "/")+"/"+url.PathEscape(cnpj), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("kyb: registry: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil, ErrNotRegistered
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("kyb: registry answered HTTP %d: %.200s", resp.StatusCode, body)
	}
	var in struct {
		CNPJ          string `json:"cnpj"`
		RazaoSocial   string `json:"razao_social"`
		NomeFantasia  string `json:"nome_fantasia"`
		Situacao      int    `json:"situacao_cadastral"`
		SituacaoDesde string `json:"data_situacao_cadastral"`
		Inicio        string `json:"data_inicio_atividade"`
		CNAE          int    `json:"cnae_fiscal"`
		CNAEDescricao string `json:"cnae_fiscal_descricao"`
		Natureza      string `json:"natureza_juridica"`
		Municipio     string `json:"municipio"`
		UF            string `json:"uf"`
		MEI           *bool  `json:"opcao_pelo_mei"`
		QSA           []struct {
			Nome         string `json:"nome_socio"`
			Documento    string `json:"cnpj_cpf_do_socio"`
			Qualificacao string `json:"qualificacao_socio"`
		} `json:"qsa"`
	}
	if err := json.Unmarshal(body, &in); err != nil {
		return nil, fmt.Errorf("kyb: registry answer: %w", err)
	}
	if in.CNPJ == "" {
		return nil, ErrNotRegistered
	}
	c := &Company{CNPJ: in.CNPJ, LegalName: in.RazaoSocial, TradeName: in.NomeFantasia, Status: statuses[in.Situacao], StatusSince: in.SituacaoDesde,
		Opened: in.Inicio, CNAE: fmt.Sprintf("%07d", in.CNAE), CNAEDescription: in.CNAEDescricao, LegalNature: in.Natureza,
		City: in.Municipio, State: in.UF, MEI: in.MEI != nil && *in.MEI, Partners: []Partner{}}
	if c.Status == "" {
		c.Status = fmt.Sprintf("unknown (%d)", in.Situacao)
	}
	for _, p := range in.QSA {
		c.Partners = append(c.Partners, Partner{Name: p.Nome, Document: p.Documento, Role: p.Qualificacao})
	}
	return c, nil
}

// Memory is a fixed registry: the sandbox's test companies, tests.
type Memory map[string]*Company

// Name implements Registry.
func (Memory) Name() string { return "sandbox-registry" }

// Company implements Registry.
func (m Memory) Company(_ context.Context, cnpj string) (*Company, error) {
	if c, ok := m[cnpj]; ok {
		cp := *c
		return &cp, nil
	}
	return nil, ErrNotRegistered
}

// Declared is what the merchant declared at onboarding.
type Declared struct {
	Document, LegalName, TradeName, MCC, City string
	Representatives                           []Person
}

// Person is a merchant's representative.
type Person struct {
	Name string `json:"name"`
	CPF  string `json:"cpf"`
}

// Outcomes.
const (
	Approved = "approved"
	Review   = "review"   // people decide: a medium risk, data that does not match
	Rejected = "rejected" // the registration rules the merchant out
)

// Finding is one thing the check found. Public findings may be shown to the partner who
// onboarded the merchant; the others (sanctions screening) are for compliance only.
type Finding struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
	Public bool   `json:"public"`
}

// Result is the check's outcome.
type Result struct {
	Outcome   string    `json:"outcome"`
	Findings  []Finding `json:"findings"`
	Registry  string    `json:"registry,omitempty"`
	Company   *Company  `json:"company,omitempty"`
	CheckedAt time.Time `json:"checked_at"`
}

// Add records a finding and raises the outcome to at least outcome.
func (r *Result) Add(outcome, code, detail string, public bool) {
	r.Findings = append(r.Findings, Finding{Code: code, Detail: detail, Public: public})
	if rank[outcome] > rank[r.Outcome] {
		r.Outcome = outcome
	}
}

var rank = map[string]int{Approved: 0, Review: 1, Rejected: 2}

// PublicFindings are the findings the partner may see.
func (r *Result) PublicFindings() []Finding {
	out := []Finding{}
	for _, f := range r.Findings {
		if f.Public {
			out = append(out, f)
		}
	}
	return out
}

// Policy tunes Assess.
type Policy struct {
	// MinAge sends a younger company to review: new companies carry more fraud. Default 180 days.
	MinAge time.Duration
	// HighRiskMCCs go to review whatever the registry says. Default DefaultHighRiskMCCs.
	HighRiskMCCs map[string]string
}

// DefaultHighRiskMCCs are the categories the card schemes treat as high risk (Visa's
// high-integrity-risk and Mastercard's high-brand-risk programs) and money services.
var DefaultHighRiskMCCs = map[string]string{
	"4829": "money transfer", "5122": "drugs and pharmaceuticals", "5912": "drug stores and pharmacies (online)",
	"5962": "direct marketing: travel", "5966": "direct marketing: outbound telemarketing", "5967": "direct marketing: inbound teleservices",
	"5993": "cigar stores", "6051": "quasi-cash and crypto-assets", "6211": "securities brokers", "7273": "dating services", "7995": "betting and gambling",
}

// Assess compares the declared data with the registration c (nil for an individual, who
// has no public registry) and applies the policy.
func Assess(d Declared, c *Company, now time.Time, p Policy) Result {
	if p.MinAge == 0 {
		p.MinAge = 180 * 24 * time.Hour
	}
	if p.HighRiskMCCs == nil {
		p.HighRiskMCCs = DefaultHighRiskMCCs
	}
	r := Result{Outcome: Approved, Findings: []Finding{}, Company: c, CheckedAt: now.UTC()}
	if what, ok := p.HighRiskMCCs[d.MCC]; ok {
		r.Add(Review, "high_risk_mcc", fmt.Sprintf("MCC %s (%s) is reviewed by people before the merchant sells", d.MCC, what), true)
	}
	if c == nil {
		r.Add(Review, "identity_check_required", "an individual (CPF) has no public registry: identity and liveness are checked by people or an identity provider", true)
		return r
	}
	switch c.Status {
	case "active":
	case "suspended":
		r.Add(Review, "registration_suspended", "the CNPJ is suspended at the Receita Federal"+since(c), true)
	default:
		r.Add(Rejected, "registration_inactive", fmt.Sprintf("the CNPJ is %s at the Receita Federal%s", c.Status, since(c)), true)
	}
	if CompanyKey(d.LegalName) != CompanyKey(c.LegalName) {
		r.Add(Review, "legal_name_mismatch", fmt.Sprintf("declared %q; the registry has %q", d.LegalName, c.LegalName), true)
	}
	if d.City != "" && c.City != "" && fold(d.City) != fold(c.City) {
		r.Add(Review, "city_mismatch", fmt.Sprintf("declared %q; the registry has %q (%s)", d.City, c.City, c.State), true)
	}
	if opened, err := time.Parse("2006-01-02", c.Opened); err == nil && now.Sub(opened) < p.MinAge {
		r.Add(Review, "recently_opened", fmt.Sprintf("the company opened on %s, less than %d days ago", c.Opened, int(p.MinAge.Hours()/24)), true)
	}
	for _, rep := range d.Representatives {
		if !representedBy(c, rep) {
			r.Add(Review, "representative_not_registered", fmt.Sprintf("%s is not among the company's registered partners and administrators", rep.Name), true)
		}
	}
	return r
}

func since(c *Company) string {
	if c.StatusSince == "" {
		return ""
	}
	return " since " + c.StatusSince
}

// representedBy reports whether rep is one of the company's partners (name and the CPF's
// published middle digits), or, for a company without partners (an individual entrepreneur,
// a MEI), whether the legal name carries rep's name.
func representedBy(c *Company, rep Person) bool {
	if len(c.Partners) == 0 {
		return strings.Contains(fold(c.LegalName), fold(rep.Name))
	}
	for _, p := range c.Partners {
		if fold(p.Name) != fold(rep.Name) {
			continue
		}
		masked := strings.Trim(p.Document, "*")
		if masked == "" || len(rep.CPF) != 11 || strings.Contains(rep.CPF, masked) {
			return true
		}
	}
	return false
}

// CompanyKey is the form legal names are compared in: folded, without punctuation, and
// without the company-type words (LTDA, S/A, ME, EPP, EIRELI, SLU), which merchants write in
// many ways or leave out.
func CompanyKey(name string) string {
	var out []string
	for _, w := range strings.Fields(fold(name)) {
		if !companyTypes[w] {
			out = append(out, w)
		}
	}
	return strings.Join(out, " ")
}

var companyTypes = map[string]bool{"LTDA": true, "LIMITADA": true, "SA": true, "ME": true, "EPP": true, "EIRELI": true, "SLU": true, "MEI": true}

// fold is a name in capitals, without accents or punctuation, single-spaced.
func fold(s string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(s) {
		if f, ok := folded[r]; ok {
			r = f
		}
		switch {
		case r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '/' || r == '.':
			// S/A, S.A. and LTDA. fold to their letters
		case r == '&':
			b.WriteString(" E ")
		case unicode.IsSpace(r) || unicode.IsPunct(r):
			b.WriteByte(' ')
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

var folded = map[rune]rune{
	'Á': 'A', 'À': 'A', 'Â': 'A', 'Ã': 'A', 'Ä': 'A', 'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E', 'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
	'Ó': 'O', 'Ò': 'O', 'Ô': 'O', 'Õ': 'O', 'Ö': 'O', 'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U', 'Ç': 'C', 'Ñ': 'N',
}

// Sandbox is the sandbox's registry (KYB_REGISTRY=sandbox): a company of each kind, so
// integrators can see every outcome. 12345678000195 is the documentation's Café Aurora (its
// partner Ana Souza, CPF 123.456.789-09); 11222333000181 closed; 22333444000181 opened last
// month; 33444555000181 suspended. Any other CNPJ is not registered.
var Sandbox = Memory{
	"12345678000195": {CNPJ: "12345678000195", LegalName: "CAFE AURORA LTDA", TradeName: "CAFE AURORA", Status: "active", StatusSince: "2019-03-01",
		Opened: "2019-03-01", CNAE: "5611201", CNAEDescription: "Restaurantes e similares", LegalNature: "Sociedade Empresária Limitada",
		City: "SAO PAULO", State: "SP", Partners: []Partner{{Name: "ANA SOUZA", Document: "***456789**", Role: "Sócio-Administrador"}}},
	"11222333000181": {CNPJ: "11222333000181", LegalName: "PADARIA ENCERRADA LTDA", Status: "closed", StatusSince: "2024-01-15", Opened: "2012-06-20",
		CNAE: "1091102", CNAEDescription: "Fabricação de produtos de padaria e confeitaria", City: "RECIFE", State: "PE", Partners: []Partner{}},
	"22333444000181": {CNPJ: "22333444000181", LegalName: "LOJA NOVA LTDA", Status: "active", Opened: time.Now().AddDate(0, -1, 0).Format("2006-01-02"),
		CNAE: "4781400", CNAEDescription: "Comércio varejista de artigos do vestuário e acessórios", City: "CURITIBA", State: "PR", Partners: []Partner{}},
	"33444555000181": {CNPJ: "33444555000181", LegalName: "MERCADO SUSPENSO LTDA", Status: "suspended", StatusSince: "2026-02-10", Opened: "2015-09-01",
		CNAE: "4711302", CNAEDescription: "Comércio varejista de mercadorias em geral", City: "BELO HORIZONTE", State: "MG", Partners: []Partner{}},
}
