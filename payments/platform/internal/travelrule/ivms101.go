// Package travelrule carries the identification of who sends and who receives a virtual-asset
// transfer from one provider to the other (FATF Recommendation 16; Resolução BCB 520/2025,
// art. 44): the data in the interVASP Messaging Standard (IVMS101.2023), its validation,
// the contract the platform uses to send it through a travel-rule network, and the
// verification of messages other providers send it (docs/09 §6.6).
package travelrule

import (
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"
)

// PayloadVersion is the IVMS101 version the platform writes.
const PayloadVersion = "101.2023"

// Message is an IVMS101.2023 payload. The JSON names are the standard's.
type Message struct {
	Originator      Originator       `json:"originator"`
	Beneficiary     Beneficiary      `json:"beneficiary"`
	OriginatingVASP *OriginatingVASP `json:"originatingVASP,omitempty"`
	BeneficiaryVASP *BeneficiaryVASP `json:"beneficiaryVASP,omitempty"`
	PayloadMetadata *PayloadMetadata `json:"payloadMetadata,omitempty"`
}

// Originator is the account holder who orders the transfer.
type Originator struct {
	OriginatorPerson []Person `json:"originatorPerson"`
}

// Beneficiary is who receives it.
type Beneficiary struct {
	BeneficiaryPerson []Person `json:"beneficiaryPerson"`
}

// OriginatingVASP is the provider that sends the transfer.
type OriginatingVASP struct {
	OriginatingVASP Person `json:"originatingVASP"`
}

// BeneficiaryVASP is the provider that receives it.
type BeneficiaryVASP struct {
	BeneficiaryVASP Person `json:"beneficiaryVASP"`
}

// PayloadMetadata says which version the payload follows.
type PayloadMetadata struct {
	TransliterationMethod []string `json:"transliterationMethod,omitempty"`
	PayloadVersion        string   `json:"payloadVersion"`
}

// Person is a natural or a legal person (exactly one of them, constraint C13 of the 2020
// version, which the 2023 version keeps as an "Or"), and the accounts it uses.
type Person struct {
	NaturalPerson *NaturalPerson `json:"naturalPerson,omitempty"`
	LegalPerson   *LegalPerson   `json:"legalPerson,omitempty"`
	AccountNumber []string       `json:"accountNumber,omitempty"`
}

// NaturalPerson is an individual.
type NaturalPerson struct {
	Name                   NaturalPersonName       `json:"name"`
	GeographicAddress      []Address               `json:"geographicAddress,omitempty"`
	NationalIdentification *NationalIdentification `json:"nationalIdentification,omitempty"`
	CustomerIdentification string                  `json:"customerIdentification,omitempty"`
	DateAndPlaceOfBirth    *DateAndPlaceOfBirth    `json:"dateAndPlaceOfBirth,omitempty"`
	CountryOfResidence     string                  `json:"countryOfResidence,omitempty"`
}

// NaturalPersonName holds the names an individual is known by.
type NaturalPersonName struct {
	NameIdentifier []NaturalPersonNameID `json:"nameIdentifier"`
}

// NaturalPersonNameID is one name: primaryIdentifier is the family name (or the whole name
// when it is not split), secondaryIdentifier the given names.
type NaturalPersonNameID struct {
	PrimaryIdentifier               string `json:"primaryIdentifier"`
	SecondaryIdentifier             string `json:"secondaryIdentifier,omitempty"`
	NaturalPersonNameIdentifierType string `json:"naturalPersonNameIdentifierType"`
}

// LegalPerson is a company or another entity.
type LegalPerson struct {
	Name                   LegalPersonName         `json:"name"`
	GeographicAddress      []Address               `json:"geographicAddress,omitempty"`
	CustomerIdentification string                  `json:"customerIdentification,omitempty"`
	NationalIdentification *NationalIdentification `json:"nationalIdentification,omitempty"`
	CountryOfRegistration  string                  `json:"countryOfRegistration,omitempty"`
}

// LegalPersonName holds the names an entity is known by.
type LegalPersonName struct {
	NameIdentifier []LegalPersonNameID `json:"nameIdentifier"`
}

// LegalPersonNameID is one name of an entity.
type LegalPersonNameID struct {
	LegalPersonName               string `json:"legalPersonName"`
	LegalPersonNameIdentifierType string `json:"legalPersonNameIdentifierType"`
}

// Address is a geographic address.
type Address struct {
	AddressType        string   `json:"addressType"`
	StreetName         string   `json:"streetName,omitempty"`
	BuildingNumber     string   `json:"buildingNumber,omitempty"`
	BuildingName       string   `json:"buildingName,omitempty"`
	Postcode           string   `json:"postcode,omitempty"`
	TownName           string   `json:"townName"`
	CountrySubDivision string   `json:"countrySubDivision,omitempty"`
	AddressLine        []string `json:"addressLine,omitempty"`
	Country            string   `json:"country"`
}

// NationalIdentification is an identifier a government (or a registry) gives a person.
type NationalIdentification struct {
	NationalIdentifier     string `json:"nationalIdentifier"`
	NationalIdentifierType string `json:"nationalIdentifierType"`
	CountryOfIssue         string `json:"countryOfIssue,omitempty"`
	RegistrationAuthority  string `json:"registrationAuthority,omitempty"`
}

// DateAndPlaceOfBirth of an individual (dateOfBirth as YYYY-MM-DD).
type DateAndPlaceOfBirth struct {
	DateOfBirth  string `json:"dateOfBirth"`
	PlaceOfBirth string `json:"placeOfBirth"`
}

// Code lists of IVMS101.2023.
var (
	NationalIdentifierTypes = set("ARNU", "CCPT", "RAID", "DRLC", "FIIN", "TXID", "SOCS", "IDCD", "LEIX", "MISC")
	legalIdentifierTypes    = set("RAID", "MISC", "LEIX", "TXID") // C7
	naturalNameTypes        = set("ALIA", "BIRT", "MAID", "LEGL", "MISC")
	legalNameTypes          = set("LEGL", "SHRT", "TRAD")
	addressTypes            = set("HOME", "BIZZ", "GEOG")
)

func set(xs ...string) map[string]bool {
	m := make(map[string]bool, len(xs))
	for _, x := range xs {
		m[x] = true
	}
	return m
}

var (
	raCode  = regexp.MustCompile(`^RA[0-9]{6}$`)
	leiText = regexp.MustCompile(`^[0-9A-Z]{18}[0-9]{2}$`)
)

// ValidLEI checks an LEI's format and its ISO 17442 check digits (ISO 7064 MOD 97-10).
func ValidLEI(lei string) bool {
	if !leiText.MatchString(lei) {
		return false
	}
	var digits strings.Builder
	for _, r := range lei {
		if r >= 'A' && r <= 'Z' {
			fmt.Fprintf(&digits, "%d", r-'A'+10)
		} else {
			digits.WriteRune(r)
		}
	}
	n, _ := new(big.Int).SetString(digits.String(), 10)
	return new(big.Int).Mod(n, big.NewInt(97)).Int64() == 1
}

// Validate checks a payload against the standard's constraints: C1 and C4 (what identifies
// an originator), C2 (a birth date in the past), C3 (country codes), C5 and C6 (a legal
// name), C7 and C9 (a legal person's identifier), C8 (a usable address), C10 (the form of a
// registration authority code; the code list is GLEIF's), C11 (a valid LEI) and the "Or" of
// natural and legal person. It returns every problem found, joined.
func (m *Message) Validate(now time.Time) error {
	var errs []error
	add := func(path, format string, a ...any) { errs = append(errs, fmt.Errorf(path+": "+format, a...)) }
	if len(m.Originator.OriginatorPerson) == 0 {
		add("originator.originatorPerson", "at least one person is required")
	}
	if len(m.Beneficiary.BeneficiaryPerson) == 0 {
		add("beneficiary.beneficiaryPerson", "at least one person is required")
	}
	for i, p := range m.Originator.OriginatorPerson {
		checkPerson(fmt.Sprintf("originator.originatorPerson[%d]", i), p, true, now, add)
	}
	for i, p := range m.Beneficiary.BeneficiaryPerson {
		checkPerson(fmt.Sprintf("beneficiary.beneficiaryPerson[%d]", i), p, false, now, add)
	}
	if m.OriginatingVASP != nil {
		checkPerson("originatingVASP.originatingVASP", m.OriginatingVASP.OriginatingVASP, false, now, add)
	}
	if m.BeneficiaryVASP != nil {
		checkPerson("beneficiaryVASP.beneficiaryVASP", m.BeneficiaryVASP.BeneficiaryVASP, false, now, add)
	}
	if m.PayloadMetadata != nil && m.PayloadMetadata.PayloadVersion != "" && m.PayloadMetadata.PayloadVersion != PayloadVersion && m.PayloadMetadata.PayloadVersion != "101" {
		add("payloadMetadata.payloadVersion", "%q is not 101 or 101.2023", m.PayloadMetadata.PayloadVersion)
	}
	return errors.Join(errs...)
}

// ValidateOriginator checks one person as an originator (a payer's declaration).
func ValidateOriginator(p Person, now time.Time) error {
	var errs []error
	checkPerson("originator", p, true, now, func(path, format string, a ...any) { errs = append(errs, fmt.Errorf(path+": "+format, a...)) })
	return errors.Join(errs...)
}

func checkPerson(path string, p Person, originator bool, now time.Time, add func(string, string, ...any)) {
	switch {
	case (p.NaturalPerson == nil) == (p.LegalPerson == nil):
		add(path, "exactly one of naturalPerson and legalPerson is required")
	case p.NaturalPerson != nil:
		n := p.NaturalPerson
		path += ".naturalPerson"
		legal := false
		for i, id := range n.Name.NameIdentifier {
			if strings.TrimSpace(id.PrimaryIdentifier) == "" {
				add(fmt.Sprintf("%s.name.nameIdentifier[%d].primaryIdentifier", path, i), "required")
			}
			if !naturalNameTypes[id.NaturalPersonNameIdentifierType] {
				add(fmt.Sprintf("%s.name.nameIdentifier[%d].naturalPersonNameIdentifierType", path, i), "%q is not a name type", id.NaturalPersonNameIdentifierType)
			}
			legal = legal || id.NaturalPersonNameIdentifierType == "LEGL"
		}
		if !legal {
			add(path+".name", "a name of type LEGL is required (C6)")
		}
		addrs := checkAddresses(path, n.GeographicAddress, add)
		if n.NationalIdentification != nil {
			ni := n.NationalIdentification
			if ni.NationalIdentifier == "" || !NationalIdentifierTypes[ni.NationalIdentifierType] {
				add(path+".nationalIdentification", "an identifier and one of the identifier types are required")
			}
			if ni.CountryOfIssue != "" {
				country(path+".nationalIdentification.countryOfIssue", ni.CountryOfIssue, add)
			}
			if ni.NationalIdentifierType == "LEIX" && !ValidLEI(ni.NationalIdentifier) {
				add(path+".nationalIdentification.nationalIdentifier", "%q is not a valid LEI (C11)", ni.NationalIdentifier)
			}
		}
		if b := n.DateAndPlaceOfBirth; b != nil {
			d, err := time.Parse("2006-01-02", b.DateOfBirth)
			switch {
			case err != nil:
				add(path+".dateAndPlaceOfBirth.dateOfBirth", "use YYYY-MM-DD")
			case !d.Before(now):
				add(path+".dateAndPlaceOfBirth.dateOfBirth", "must be in the past (C2)")
			}
			if strings.TrimSpace(b.PlaceOfBirth) == "" {
				add(path+".dateAndPlaceOfBirth.placeOfBirth", "required")
			}
		}
		if n.CountryOfResidence != "" {
			country(path+".countryOfResidence", n.CountryOfResidence, add)
		}
		if originator && addrs == 0 && n.NationalIdentification == nil && n.CustomerIdentification == "" && n.DateAndPlaceOfBirth == nil {
			add(path, "an originator needs an address, a customer identification, a national identification or the date and place of birth (C1)")
		}
	default:
		l := p.LegalPerson
		path += ".legalPerson"
		legal := false
		for i, id := range l.Name.NameIdentifier {
			if strings.TrimSpace(id.LegalPersonName) == "" {
				add(fmt.Sprintf("%s.name.nameIdentifier[%d].legalPersonName", path, i), "required")
			}
			if !legalNameTypes[id.LegalPersonNameIdentifierType] {
				add(fmt.Sprintf("%s.name.nameIdentifier[%d].legalPersonNameIdentifierType", path, i), "%q is not a name type", id.LegalPersonNameIdentifierType)
			}
			legal = legal || id.LegalPersonNameIdentifierType == "LEGL"
		}
		if !legal {
			add(path+".name", "a name of type LEGL is required (C5)")
		}
		checkAddresses(path, l.GeographicAddress, add)
		geog := false
		for _, a := range l.GeographicAddress {
			geog = geog || a.AddressType == "GEOG"
		}
		if ni := l.NationalIdentification; ni != nil {
			p := path + ".nationalIdentification"
			if ni.NationalIdentifier == "" {
				add(p+".nationalIdentifier", "required")
			}
			if !legalIdentifierTypes[ni.NationalIdentifierType] {
				add(p+".nationalIdentifierType", "a legal person's identifier is RAID, MISC, LEIX or TXID (C7)")
			}
			if ni.CountryOfIssue != "" {
				add(p+".countryOfIssue", "a legal person's identifier has no country of issue (C9)")
			}
			switch {
			case ni.NationalIdentifierType == "LEIX" && ni.RegistrationAuthority != "":
				add(p+".registrationAuthority", "an LEI has no registration authority (C9)")
			case ni.NationalIdentifierType != "LEIX" && ni.RegistrationAuthority == "":
				add(p+".registrationAuthority", "required unless the identifier is an LEI (C9)")
			case ni.RegistrationAuthority != "" && !raCode.MatchString(ni.RegistrationAuthority):
				add(p+".registrationAuthority", "%q is not a GLEIF registration authority code (C10)", ni.RegistrationAuthority)
			}
			if ni.NationalIdentifierType == "LEIX" && !ValidLEI(ni.NationalIdentifier) {
				add(p+".nationalIdentifier", "%q is not a valid LEI (C11)", ni.NationalIdentifier)
			}
		}
		if l.CountryOfRegistration != "" {
			country(path+".countryOfRegistration", l.CountryOfRegistration, add)
		}
		if originator && !geog && l.CustomerIdentification == "" && l.NationalIdentification == nil {
			add(path, "an originator needs a GEOG address, a customer identification or a national identification (C4)")
		}
	}
}

func checkAddresses(path string, as []Address, add func(string, string, ...any)) int {
	for i, a := range as {
		p := fmt.Sprintf("%s.geographicAddress[%d]", path, i)
		if !addressTypes[a.AddressType] {
			add(p+".addressType", "%q is not HOME, BIZZ or GEOG", a.AddressType)
		}
		if strings.TrimSpace(a.TownName) == "" {
			add(p+".townName", "required")
		}
		if len(a.AddressLine) == 0 && (a.StreetName == "" || (a.BuildingName == "" && a.BuildingNumber == "")) {
			add(p, "an addressLine, or a streetName with a buildingName or buildingNumber, is required (C8)")
		}
		country(p+".country", a.Country, add)
	}
	return len(as)
}

func country(path, c string, add func(string, string, ...any)) {
	if c != "XX" && !Countries[c] {
		add(path, "%q is not an ISO 3166-1 alpha-2 code (C3)", c)
	}
}
