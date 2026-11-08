package travelrule

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
)

// CNPJRegistrationAuthority is the code of Brazil's Cadastro Nacional da Pessoa Jurídica
// (Receita Federal) in GLEIF's Registration Authorities List: a CNPJ is sent as a RAID
// issued by it (IVMS101 C7, C9 and C10).
const CNPJRegistrationAuthority = "RA000681"

// Party is a person as the API takes it, simpler than IVMS101: Person builds the standard's
// form from it. A Brazilian document (CPF, 11 digits; CNPJ, 14) needs no type; any other
// needs DocumentType, one of IVMS101's national identifier types, and for a legal person a
// RegistrationAuthority unless it is an LEI.
type Party struct {
	Type                  string        `json:"type"` // natural or legal
	Name                  string        `json:"name"` // the full legal name
	Document              string        `json:"document,omitempty"`
	DocumentType          string        `json:"document_type,omitempty"`
	RegistrationAuthority string        `json:"registration_authority,omitempty"`
	Country               string        `json:"country,omitempty"` // of residence (natural) or registration (legal)
	Address               *PartyAddress `json:"address,omitempty"`
	DateOfBirth           string        `json:"date_of_birth,omitempty"`
	PlaceOfBirth          string        `json:"place_of_birth,omitempty"`
	CustomerID            string        `json:"customer_id,omitempty"`
}

// PartyAddress is an address in free lines.
type PartyAddress struct {
	Line    string `json:"line"`
	Town    string `json:"town"`
	Country string `json:"country"`
}

// VASP is a virtual-asset service provider: the other end of a transfer.
type VASP struct {
	Name    string `json:"name"`
	LEI     string `json:"lei,omitempty"`
	Country string `json:"country,omitempty"`
	// ID is how the travel-rule network knows it (a directory id, a DID, a domain).
	ID string `json:"id,omitempty"`
}

func digits(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsDigit(r) {
			return r
		}
		return -1
	}, s)
}

// Person is the party in IVMS101 form, holding account (a wallet address) when given.
func (p Party) Person(account string) (Person, error) {
	name := strings.TrimSpace(p.Name)
	if name == "" {
		return Person{}, errors.New("name is required")
	}
	country := strings.ToUpper(strings.TrimSpace(p.Country))
	var ni *NationalIdentification
	if doc := strings.TrimSpace(p.Document); doc != "" {
		ni = &NationalIdentification{NationalIdentifier: doc, NationalIdentifierType: strings.ToUpper(p.DocumentType), RegistrationAuthority: p.RegistrationAuthority}
		if ni.NationalIdentifierType == "" {
			switch d := digits(doc); {
			case p.Type == "natural" && len(d) == 11:
				ni.NationalIdentifier, ni.NationalIdentifierType, ni.CountryOfIssue = d, "TXID", "BR" // CPF
			case p.Type == "legal" && len(d) == 14:
				ni.NationalIdentifier, ni.NationalIdentifierType, ni.RegistrationAuthority = d, "RAID", CNPJRegistrationAuthority // CNPJ
			default:
				return Person{}, errors.New("document_type is required for a document that is not a CPF or CNPJ")
			}
		} else if p.Type == "natural" && ni.CountryOfIssue == "" {
			ni.CountryOfIssue = country
		}
	}
	var addrs []Address
	if a := p.Address; a != nil {
		t := "HOME"
		if p.Type == "legal" {
			t = "GEOG"
		}
		addrs = []Address{{AddressType: t, AddressLine: []string{strings.TrimSpace(a.Line)}, TownName: strings.TrimSpace(a.Town), Country: strings.ToUpper(strings.TrimSpace(a.Country))}}
	}
	out := Person{}
	if account != "" {
		out.AccountNumber = []string{account}
	}
	switch p.Type {
	case "natural":
		n := &NaturalPerson{Name: NaturalPersonName{NameIdentifier: []NaturalPersonNameID{{PrimaryIdentifier: name, NaturalPersonNameIdentifierType: "LEGL"}}},
			GeographicAddress: addrs, NationalIdentification: ni, CustomerIdentification: p.CustomerID, CountryOfResidence: country}
		if p.DateOfBirth != "" || p.PlaceOfBirth != "" {
			n.DateAndPlaceOfBirth = &DateAndPlaceOfBirth{DateOfBirth: p.DateOfBirth, PlaceOfBirth: p.PlaceOfBirth}
		}
		out.NaturalPerson = n
	case "legal":
		if p.DateOfBirth != "" {
			return Person{}, errors.New("a legal person has no date of birth")
		}
		out.LegalPerson = &LegalPerson{Name: LegalPersonName{NameIdentifier: []LegalPersonNameID{{LegalPersonName: name, LegalPersonNameIdentifierType: "LEGL"}}},
			GeographicAddress: addrs, NationalIdentification: ni, CustomerIdentification: p.CustomerID, CountryOfRegistration: country}
	default:
		return Person{}, fmt.Errorf("type is natural or legal, not %q", p.Type)
	}
	return out, nil
}

// Person is the provider in IVMS101 form: its legal name and, when it has one, its LEI.
func (v VASP) Person() (Person, error) {
	name := strings.TrimSpace(v.Name)
	if name == "" {
		return Person{}, errors.New("the provider's name is required")
	}
	l := &LegalPerson{Name: LegalPersonName{NameIdentifier: []LegalPersonNameID{{LegalPersonName: name, LegalPersonNameIdentifierType: "LEGL"}}},
		CountryOfRegistration: strings.ToUpper(strings.TrimSpace(v.Country))}
	if v.LEI != "" {
		if !ValidLEI(v.LEI) {
			return Person{}, fmt.Errorf("%q is not a valid LEI", v.LEI)
		}
		l.NationalIdentification = &NationalIdentification{NationalIdentifier: v.LEI, NationalIdentifierType: "LEIX"}
	}
	return Person{LegalPerson: l}, nil
}

// Names lists every name in a person, for screening and display.
func (p Person) Names() []string {
	var out []string
	if n := p.NaturalPerson; n != nil {
		for _, id := range n.Name.NameIdentifier {
			out = append(out, strings.TrimSpace(id.SecondaryIdentifier+" "+id.PrimaryIdentifier))
		}
	}
	if l := p.LegalPerson; l != nil {
		for _, id := range l.Name.NameIdentifier {
			out = append(out, id.LegalPersonName)
		}
	}
	return out
}

// Document is the person's national identifier, digits only for a Brazilian CPF or CNPJ.
func (p Person) Document() string {
	var ni *NationalIdentification
	switch {
	case p.NaturalPerson != nil:
		ni = p.NaturalPerson.NationalIdentification
	case p.LegalPerson != nil:
		ni = p.LegalPerson.NationalIdentification
	}
	if ni == nil {
		return ""
	}
	if d := digits(ni.NationalIdentifier); (len(d) == 11 || len(d) == 14) && (ni.CountryOfIssue == "BR" || ni.RegistrationAuthority == CNPJRegistrationAuthority) {
		return d
	}
	return ni.NationalIdentifier
}
