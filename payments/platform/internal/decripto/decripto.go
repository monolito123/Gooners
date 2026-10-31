// Package decripto writes the DeCripto, the monthly report of crypto-asset operations a
// provider domiciled in Brazil files with the Receita Federal (IN RFB 2.291/2025), in the
// "Exchange" layout, version 1.0 (ADE COPES 2/2025; Manual de Orientação do Leiaute,
// version 1.01). The file is UTF-8 text, one record per line ending in CR LF, fields joined
// by "|", numbers with a decimal comma and no thousands separator, dates as DDMMAAAA.
package decripto

import (
	"bytes"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// OperacaoCodigo values (art. 6 of IN RFB 2.291/2025; manual §2.5.1).
const (
	CompraVenda      = "I"   // purchase and sale
	Permuta          = "II"  // swap between crypto-assets
	TransferEntrada  = "III" // into the user's account, not from I or II
	TransferSaida    = "IV"  // out of the user's account, not from I or II
	AquisicaoBens    = "V"   // goods or services above US$ 50,000
	CarteiraExterna  = "VI"  // to a wallet no provider keeps
	PerdaInvoluntary = "VII" // involuntary loss
)

// TipoTransferenciaEntrada (manual §2.5.3) and TipoTransferenciaSaida (§2.5.4) values used.
const (
	EntradaVendaBensServicos = 6 // CARF506: sale of goods or services
	EntradaOutras            = 8 // CARF508
	SaidaParaPrestadora      = 1 // CARF601: to a crypto-asset service provider
	SaidaOutras              = 5 // CARF605
)

// Brasília has kept UTC−3 all year since 2019; dates in the file are Brasília dates.
var brt = time.FixedZone("BRT", -3*3600)

// Person is a party to an operation: a client of the platform or a counterparty.
type Person struct {
	Document string // CPF (11 digits) or CNPJ (14) when Brazilian
	NI       string // tax ID when foreign
	Country  string // ISO 3166 alpha-2, "BR" for Brazil
	Name     string
	Address  string // required for foreigners
	// Individual tells a foreign person's tax ID (TipoNI 3) from a foreign entity's (4).
	Individual bool
}

func (p Person) tipoNI() string {
	switch {
	case p.Country == "BR" && len(p.Document) == 11:
		return "1"
	case p.Country == "BR" && len(p.Document) == 14:
		return "2"
	case p.NI != "" && p.Individual:
		return "3"
	case p.NI != "":
		return "4"
	default:
		return "6"
	}
}

// fields are TipoNI, Pais, CPFCNPJ, NI, Nome, Endereco.
func (p Person) fields() []string {
	doc := ""
	if p.Country == "BR" {
		doc = p.Document
	}
	return []string{p.tipoNI(), p.Country, doc, text(p.NI, 30), text(p.Name, 80), text(p.Address, 120)}
}

// Op is one operation. Record says which record carries it: "0110" (purchase and sale),
// "0350" (transfer in), "0450" (transfer out to a provider), "0650" (to a wallet no
// provider keeps). Amounts are centavos; Quantity is a decimal string with a point.
type Op struct {
	Record       string
	Date         time.Time
	ID           string
	Value        int64 // in reais, fees excluded
	Fees         int64
	Asset        string
	Quantity     string
	TransferType int    // 0350 and 0450
	Buyer        Person // 0110
	Seller       Person // 0110
	Client       Person // 0350, 0450, 0650
}

// Holding is a crypto-asset balance at the end of the year (record 1010).
type Holding struct {
	Asset    string
	Quantity string
}

// YearEnd is a client's balances on 31 December (records 1000 and 1010), reported in the
// file delivered in January.
type YearEnd struct {
	Client   Person
	BRL      int64
	Holdings []Holding
}

// Report is one month's file.
type Report struct {
	CNPJ, Name, URL string // the declarant (record 0000)
	Ops             []Op
	// YearEnd and CARF are reported in the file delivered in January (December's
	// operations): records 1000/1010, and 2000/2999 identifying the platform for the CARF.
	YearEnd     []YearEnd
	YearEndDate time.Time
	CARF        bool
}

// Totals is the count and sum of OperacaoValor per record type, as record 9999 carries them.
type Totals map[string]struct {
	Count int   `json:"count"`
	Value int64 `json:"value"`
}

var nineNineNineNine = []string{"0110", "0210", "0350", "0450", "0550", "0650", "0750", "0850", "0950"}

// Encode writes the file. It refuses what the layout forbids (a zero value or quantity, a
// record it does not know, a field over its size) and returns the totals of record 9999 and
// warnings for operations to review before filing.
func (r Report) Encode() ([]byte, Totals, []string, error) {
	var warnings []string
	if len(r.CNPJ) != 14 || !digits(r.CNPJ) {
		return nil, nil, nil, fmt.Errorf("decripto: the declarant's CNPJ must be 14 digits, got %q", r.CNPJ)
	}
	var b bytes.Buffer
	line := func(fields ...string) { b.WriteString(strings.Join(fields, "|")); b.WriteString("\r\n") }
	line("0000", r.CNPJ, text(r.Name, 80), text(r.URL, 80))

	ops := append([]Op(nil), r.Ops...)
	sort.SliceStable(ops, func(i, j int) bool {
		if ops[i].Record != ops[j].Record {
			return ops[i].Record < ops[j].Record
		}
		if !ops[i].Date.Equal(ops[j].Date) {
			return ops[i].Date.Before(ops[j].Date)
		}
		return ops[i].ID < ops[j].ID
	})
	totals := Totals{}
	for _, o := range ops {
		if o.Value <= 0 {
			return nil, nil, nil, fmt.Errorf("decripto: operation %s has no value in reais (the layout requires one)", o.ID)
		}
		qty, err := quantity(o.Quantity)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("decripto: operation %s: %w", o.ID, err)
		}
		head := []string{o.Record, date(o.Date), text(o.ID, 1024)}
		fees := ""
		if o.Fees > 0 {
			fees = money(o.Fees)
		}
		switch o.Record {
		case "0110":
			f := append(head, CompraVenda, money(o.Value), fees, symbol(o.Asset), qty)
			f = append(f, o.Buyer.fields()...)
			f = append(f, o.Seller.fields()...)
			line(f...)
		case "0350", "0450":
			code := TransferEntrada
			if o.Record == "0450" {
				code = TransferSaida
			}
			f := append(head, code, strconv.Itoa(o.TransferType), money(o.Value), fees, symbol(o.Asset), qty, "")
			f = append(f, o.Client.fields()...)
			line(f...)
		case "0650":
			f := append(head, CarteiraExterna, money(o.Value), fees, symbol(o.Asset), qty, "")
			f = append(f, o.Client.fields()...)
			line(f...)
		default:
			return nil, nil, nil, fmt.Errorf("decripto: record %s is not written by this platform", o.Record)
		}
		t := totals[o.Record]
		t.Count++
		t.Value += o.Value
		totals[o.Record] = t
	}

	n1000 := 0
	if len(r.YearEnd) > 0 {
		ye := append([]YearEnd(nil), r.YearEnd...)
		sort.Slice(ye, func(i, j int) bool { return ye[i].Client.Document < ye[j].Client.Document })
		for _, y := range ye {
			if y.BRL == 0 {
				warnings = append(warnings, fmt.Sprintf("record 1000 for %s: the balance in reais is zero, which the layout does not accept; check before filing", y.Client.Document))
			}
			c := y.Client.fields()
			// 1000: Data, ClienteTipoNI, ClientePais, ClienteCPFCNPJ, ClienteNI, ClienteNome, ClienteEndereco, MoedaSaldoValor.
			line(append(append([]string{"1000", date(r.YearEndDate)}, c...), money(y.BRL))...)
			n1000++
			for _, h := range y.Holdings {
				qty, err := quantity(h.Quantity)
				if err != nil {
					return nil, nil, nil, fmt.Errorf("decripto: year-end %s %s: %w", y.Client.Document, h.Asset, err)
				}
				line("1010", symbol(h.Asset), qty, "")
			}
		}
	}
	if r.CARF {
		// The platform's nexus for the CARF: constituted under Brazilian law. Its clients are
		// Brazilian businesses, not reportable persons, so no 2110–2650 records follow.
		line("2000", "CARF902", "BR")
		f := []string{"2999"}
		for range 8 {
			f = append(f, "0", money(0))
		}
		line(f...)
	}
	f := []string{"9999"}
	for _, rec := range nineNineNineNine {
		f = append(f, strconv.Itoa(totals[rec].Count), money(totals[rec].Value))
	}
	f = append(f, strconv.Itoa(n1000))
	line(f...)
	return b.Bytes(), totals, warnings, nil
}

// money is centavos as "1234,56".
func money(c int64) string {
	neg := ""
	if c < 0 {
		neg, c = "-", -c
	}
	return fmt.Sprintf("%s%d,%02d", neg, c/100, c%100)
}

// quantity is "0.00099303" as "0,00099303": at most 10 decimals and not zero.
func quantity(q string) (string, error) {
	whole, frac, _ := strings.Cut(strings.TrimSpace(q), ".")
	if whole == "" || !digits(whole) || (frac != "" && !digits(frac)) {
		return "", fmt.Errorf("bad quantity %q", q)
	}
	if len(frac) > 10 {
		return "", fmt.Errorf("quantity %q has more than 10 decimals", q)
	}
	if strings.Trim(whole+frac, "0") == "" {
		return "", fmt.Errorf("quantity is zero")
	}
	if frac == "" {
		frac = "00"
	}
	if len(whole)+1+len(frac) > 26 {
		return "", fmt.Errorf("quantity %q is longer than 26 characters", q)
	}
	return whole + "," + frac, nil
}

func date(t time.Time) string { return t.In(brt).Format("02012006") }

func symbol(a string) string { return text(strings.ToUpper(a), 10) }

// text keeps what a C field may hold: no "|", no control characters, at most n characters.
func text(s string, n int) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(s) {
		if r == '|' || r < 32 || r == 127 {
			r = ' '
		}
		b.WriteRune(r)
	}
	out := b.String()
	if utf8.RuneCountInString(out) > n {
		out = string([]rune(out)[:n])
	}
	return strings.TrimSpace(out)
}

func digits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return s != ""
}
