package travelrule

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

var now = time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)

func TestValidLEI(t *testing.T) {
	// GLEIF's own LEI, and another real one. (The standard's examples use an illustrative LEI,
	// 3M5E1GQKGL17HI8CPN20, whose check digits do not add up.)
	for _, ok := range []string{"506700GE1G29325QX363", "HWUPKR0MPOU8FGXBT394"} {
		if !ValidLEI(ok) {
			t.Errorf("%s rejected", ok)
		}
	}
	for _, bad := range []string{"3M5E1GQKGL17HI8CPN20", "506700GE1G29325QX364", "506700ge1g29325qx363", "123", ""} {
		if ValidLEI(bad) {
			t.Errorf("%s accepted", bad)
		}
	}
}

func TestThePlatformsPartiesAreValidIVMS101(t *testing.T) {
	merchant, err := Party{Type: "legal", Name: "Padaria Pão Quente Ltda", Document: "12.345.678/0001-95", Country: "BR"}.Person("")
	if err != nil {
		t.Fatal(err)
	}
	if ni := merchant.LegalPerson.NationalIdentification; ni.NationalIdentifierType != "RAID" || ni.RegistrationAuthority != CNPJRegistrationAuthority || ni.NationalIdentifier != "12345678000195" {
		t.Fatalf("a CNPJ is a RAID of the CNPJ registry: %+v", ni)
	}
	owner, err := Party{Type: "natural", Name: "Maria da Silva", Document: "123.456.789-09", Country: "BR"}.Person("0x00000000000000000000000000000000000c0ffe")
	if err != nil {
		t.Fatal(err)
	}
	if ni := owner.NaturalPerson.NationalIdentification; ni.NationalIdentifierType != "TXID" || ni.CountryOfIssue != "BR" {
		t.Fatalf("a CPF is a tax id issued by Brazil: %+v", ni)
	}
	vasp, err := VASP{Name: "Exchange Example S.A.", LEI: "506700GE1G29325QX363", Country: "BR"}.Person()
	if err != nil {
		t.Fatal(err)
	}
	m := Message{Originator: Originator{OriginatorPerson: []Person{merchant}}, Beneficiary: Beneficiary{BeneficiaryPerson: []Person{owner}},
		BeneficiaryVASP: &BeneficiaryVASP{BeneficiaryVASP: vasp}, PayloadMetadata: &PayloadMetadata{PayloadVersion: PayloadVersion}}
	if err := m.Validate(now); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(m)
	for _, want := range []string{`"originatorPerson"`, `"legalPersonNameIdentifierType":"LEGL"`, `"naturalPersonNameIdentifierType":"LEGL"`, `"payloadVersion":"101.2023"`, `"accountNumber":["0x`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("%s missing from %s", want, b)
		}
	}
	if owner.Document() != "12345678909" || merchant.Document() != "12345678000195" {
		t.Fatalf("documents: %q %q", owner.Document(), merchant.Document())
	}
}

func TestConstraints(t *testing.T) {
	legal := func(ni *NationalIdentification) Person {
		return Person{LegalPerson: &LegalPerson{Name: LegalPersonName{NameIdentifier: []LegalPersonNameID{{LegalPersonName: "ABC Limited", LegalPersonNameIdentifierType: "LEGL"}}}, NationalIdentification: ni}}
	}
	natural := Person{NaturalPerson: &NaturalPerson{Name: NaturalPersonName{NameIdentifier: []NaturalPersonNameID{{PrimaryIdentifier: "Barnes", SecondaryIdentifier: "Robert", NaturalPersonNameIdentifierType: "LEGL"}}}}}
	cases := map[string]struct {
		originator Person
		want       string
	}{
		"C1 an originator needs more than a name": {natural, "(C1)"},
		"C4 a company too":                        {legal(nil), "(C4)"},
		"C7 a company's identifier type":          {legal(&NationalIdentification{NationalIdentifier: "1", NationalIdentifierType: "CCPT", RegistrationAuthority: "RA000681"}), "(C7)"},
		"C9 needs a registration authority":       {legal(&NationalIdentification{NationalIdentifier: "1", NationalIdentifierType: "RAID"}), "(C9)"},
		"C9 no country of issue":                  {legal(&NationalIdentification{NationalIdentifier: "1", NationalIdentifierType: "TXID", CountryOfIssue: "BR", RegistrationAuthority: "RA000681"}), "(C9)"},
		"C10 the authority's form":                {legal(&NationalIdentification{NationalIdentifier: "1", NationalIdentifierType: "RAID", RegistrationAuthority: "CNPJ"}), "(C10)"},
		"C11 a valid LEI":                         {legal(&NationalIdentification{NationalIdentifier: "3M5E1GQKGL17HI8CPN21", NationalIdentifierType: "LEIX"}), "(C11)"},
		"C5 a legal name": {Person{LegalPerson: &LegalPerson{Name: LegalPersonName{NameIdentifier: []LegalPersonNameID{{LegalPersonName: "CBA", LegalPersonNameIdentifierType: "TRAD"}}},
			CustomerIdentification: "c1"}}, "(C5)"},
		"C2 born in the past": {Person{NaturalPerson: &NaturalPerson{Name: natural.NaturalPerson.Name,
			DateAndPlaceOfBirth: &DateAndPlaceOfBirth{DateOfBirth: "2030-01-01", PlaceOfBirth: "London"}}}, "(C2)"},
		"C3 a real country": {Person{NaturalPerson: &NaturalPerson{Name: natural.NaturalPerson.Name, CustomerIdentification: "c1", CountryOfResidence: "BZL"}}, "(C3)"},
		"C8 a usable address": {Person{NaturalPerson: &NaturalPerson{Name: natural.NaturalPerson.Name,
			GeographicAddress: []Address{{AddressType: "HOME", StreetName: "Potential Street", TownName: "Walnut", Country: "US"}}}}, "(C8)"},
		"one of natural and legal": {Person{}, "exactly one"},
	}
	for name, c := range cases {
		m := Message{Originator: Originator{OriginatorPerson: []Person{c.originator}}, Beneficiary: Beneficiary{BeneficiaryPerson: []Person{natural}}}
		if err := m.Validate(now); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: want %q, got %v", name, c.want, err)
		}
	}
	// The standard's Example 1 passes.
	alice := Person{NaturalPerson: &NaturalPerson{Name: NaturalPersonName{NameIdentifier: []NaturalPersonNameID{{PrimaryIdentifier: "Smith", SecondaryIdentifier: "Dr Alice", NaturalPersonNameIdentifierType: "LEGL"}}},
		GeographicAddress:      []Address{{AddressType: "GEOG", StreetName: "Potential Street", BuildingNumber: "24", BuildingName: "Weathering Views", Postcode: "91765", TownName: "Walnut", CountrySubDivision: "California", Country: "US"}},
		CustomerIdentification: "1002390"}, AccountNumber: []string{"10023909"}}
	vasp := legal(&NationalIdentification{NationalIdentifier: "506700GE1G29325QX363", NationalIdentifierType: "LEIX"})
	m := Message{Originator: Originator{OriginatorPerson: []Person{alice}}, Beneficiary: Beneficiary{BeneficiaryPerson: []Person{natural}},
		OriginatingVASP: &OriginatingVASP{OriginatingVASP: vasp}, PayloadMetadata: &PayloadMetadata{PayloadVersion: PayloadVersion}}
	if err := m.Validate(now); err != nil {
		t.Fatal(err)
	}
}

func TestServiceContract(t *testing.T) {
	var got Transfer
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/transfers" || r.Header.Get("Authorization") != "Bearer tok" || r.Header.Get("Idempotency-Key") != "cw_1" {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &got)
		status := Accepted
		if got.BeneficiaryVASP.Name == "No" {
			status = Rejected
		}
		_ = json.NewEncoder(w).Encode(Answer{Status: status, Reference: "trp_9", Reason: "x"})
	}))
	defer srv.Close()
	s := &Service{URL: srv.URL, Token: "tok"}
	a, err := s.Send(context.Background(), Transfer{ID: "cw_1", Asset: "USDT", BeneficiaryVASP: VASP{Name: "Yes"}})
	if err != nil || a.Status != Accepted || a.Reference != "trp_9" || got.Asset != "USDT" {
		t.Fatalf("%+v %v %+v", a, err, got)
	}
	if a, err := s.Send(context.Background(), Transfer{ID: "cw_1", BeneficiaryVASP: VASP{Name: "No"}}); err != nil || a.Status != Rejected {
		t.Fatalf("%+v %v", a, err)
	}
	if _, err := (&Service{URL: srv.URL}).Send(context.Background(), Transfer{ID: "cw_1"}); err == nil {
		t.Fatal("an error answer was taken as an answer")
	}
}

func TestSandbox(t *testing.T) {
	ctx := context.Background()
	if a, _ := (Sandbox{}).Send(ctx, Transfer{ID: "1", BeneficiaryVASP: VASP{Name: "Exchange"}}); a.Status != Accepted {
		t.Fatal(a)
	}
	if a, _ := (Sandbox{}).Send(ctx, Transfer{ID: "1", BeneficiaryVASP: VASP{Name: "Sandbox Rejects Ltd"}}); a.Status != Rejected {
		t.Fatal(a)
	}
	if _, err := (Sandbox{}).Send(ctx, Transfer{ID: "1", BeneficiaryVASP: VASP{Name: "Offline Exchange"}}); err == nil {
		t.Fatal("offline answered")
	}
}
