package decripto

import (
	"strings"
	"testing"
	"time"
)

func day(d, m, y int) time.Time { return time.Date(y, time.Month(m), d, 12, 0, 0, 0, brt) }

var (
	lojas  = Person{Document: "11111111000100", Country: "BR", Name: "Lojas Wavelet Stablecoin Ltda", Address: "Rua Aracaju, 3245678, São Paulo, SP"}
	marie  = Person{NI: "111111111", Country: "PT", Name: "Marie Sklodowska-Curie", Address: "Rua da Moqueca, 2074, Lisboa, 2790-444", Individual: true}
	agro   = Person{Document: "11111111000100", Country: "BR", Name: "Agro Café Arábica Asimov Export Ltda", Address: "Avenida Café com Queijo, 89615, Belo Horizonte, MG"}
	cafe   = Person{Document: "11111111000100", Country: "BR", Name: "Café Marie Curie Radius Ltda", Address: "Avenida do Cupuaçu Café, 56897, Belém, PA"}
	header = Report{CNPJ: "22222222000191", Name: "goonersPAY", URL: "https://goonerspay.example"}
)

// The records reproduce, byte for byte, the examples of the Manual de Orientação do Leiaute
// da DeCripto (version 1.01, §4.2.1, §4.2.3, §4.2.4 and §4.2.6).
func TestManualExamples(t *testing.T) {
	r := header
	r.Ops = []Op{
		{Record: "0110", Date: day(3, 7, 2026), ID: "XGLo46tXB1cfnKFRvfva7SesotJoN3wOyHx", Value: 10031545, Fees: 21015, Asset: "BTC", Quantity: "0.2034567890", Buyer: lojas, Seller: marie},
		{Record: "0350", Date: day(15, 7, 2026), ID: "ebe8c208f6470e4b751d91daf8d", TransferType: EntradaVendaBensServicos, Value: 78058064, Fees: 108987, Asset: "USDC", Quantity: "150000.00", Client: agro},
		{Record: "0450", Date: day(22, 7, 2026), ID: "d4dd1fc61c6f884f48641d02b", TransferType: 4, Value: 3056457, Fees: 9538, Asset: "DAI", Quantity: "6125.35", Client: cafe},
		{Record: "0650", Date: day(9, 7, 2026), ID: "c2b14cbf3fcb739683383b96157f", Value: 2304028, Fees: 5021, Asset: "USDT", Quantity: "4000.3897", Client: cafe},
	}
	out, totals, warnings, err := r.Encode()
	if err != nil || len(warnings) > 0 {
		t.Fatal(err, warnings)
	}
	want := []string{
		"0000|22222222000191|goonersPAY|https://goonerspay.example",
		"0110|03072026|XGLo46tXB1cfnKFRvfva7SesotJoN3wOyHx|I|100315,45|210,15|BTC|0,2034567890|2|BR|11111111000100||Lojas Wavelet Stablecoin Ltda|Rua Aracaju, 3245678, São Paulo, SP|3|PT||111111111|Marie Sklodowska-Curie|Rua da Moqueca, 2074, Lisboa, 2790-444",
		"0350|15072026|ebe8c208f6470e4b751d91daf8d|III|6|780580,64|1089,87|USDC|150000,00||2|BR|11111111000100||Agro Café Arábica Asimov Export Ltda|Avenida Café com Queijo, 89615, Belo Horizonte, MG",
		"0450|22072026|d4dd1fc61c6f884f48641d02b|IV|4|30564,57|95,38|DAI|6125,35||2|BR|11111111000100||Café Marie Curie Radius Ltda|Avenida do Cupuaçu Café, 56897, Belém, PA",
		"0650|09072026|c2b14cbf3fcb739683383b96157f|VI|23040,28|50,21|USDT|4000,3897||2|BR|11111111000100||Café Marie Curie Radius Ltda|Avenida do Cupuaçu Café, 56897, Belém, PA",
		"9999|1|100315,45|0|0,00|1|780580,64|1|30564,57|0|0,00|1|23040,28|0|0,00|0|0,00|0|0,00|0",
		"",
	}
	if got := string(out); got != strings.Join(want, "\r\n") {
		t.Errorf("file:\n%s\nwant:\n%s", got, strings.Join(want, "\r\n"))
	}
	if totals["0350"].Count != 1 || totals["0350"].Value != 78058064 {
		t.Errorf("totals %v", totals)
	}
}

func TestYearEndAndCARF(t *testing.T) {
	r := header
	r.YearEndDate = day(31, 12, 2026)
	r.CARF = true
	r.YearEnd = []YearEnd{{Client: lojas, BRL: 123456, Holdings: []Holding{{Asset: "BTC", Quantity: "0.00099303"}, {Asset: "USDT", Quantity: "10.500000"}}}, {Client: cafe}}
	out, _, warnings, err := r.Encode()
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(string(out), "\r\n"), "\r\n")
	want := []string{
		"0000|22222222000191|goonersPAY|https://goonerspay.example",
		"1000|31122026|2|BR|11111111000100||Lojas Wavelet Stablecoin Ltda|Rua Aracaju, 3245678, São Paulo, SP|1234,56",
		"1010|BTC|0,00099303|",
		"1010|USDT|10,500000|",
		"1000|31122026|2|BR|11111111000100||Café Marie Curie Radius Ltda|Avenida do Cupuaçu Café, 56897, Belém, PA|0,00",
		"2000|CARF902|BR",
		"2999|0|0,00|0|0,00|0|0,00|0|0,00|0|0,00|0|0,00|0|0,00|0|0,00",
		"9999|0|0,00|0|0,00|0|0,00|0|0,00|0|0,00|0|0,00|0|0,00|0|0,00|0|0,00|2",
	}
	if strings.Join(lines, "\n") != strings.Join(want, "\n") {
		t.Errorf("file:\n%s", strings.Join(lines, "\n"))
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "zero") {
		t.Errorf("a zero balance in reais is flagged: %v", warnings)
	}
	if len(strings.Split(lines[6], "|")) != 17 || len(strings.Split(lines[7], "|")) != 20 {
		t.Error("2999 has 17 fields and 9999 has 20")
	}
}

func TestRefusesWhatTheLayoutForbids(t *testing.T) {
	bad := []Report{
		{CNPJ: "123", Name: "x"},
		{CNPJ: "22222222000191", Ops: []Op{{Record: "0110", Date: day(1, 7, 2026), Asset: "BTC", Quantity: "1", Value: 0}}},
		{CNPJ: "22222222000191", Ops: []Op{{Record: "0110", Date: day(1, 7, 2026), Asset: "BTC", Quantity: "0.000", Value: 1}}},
		{CNPJ: "22222222000191", Ops: []Op{{Record: "0650", Date: day(1, 7, 2026), Asset: "ETH", Quantity: "0.12345678901", Value: 1}}},
		{CNPJ: "22222222000191", Ops: []Op{{Record: "0550", Date: day(1, 7, 2026), Asset: "ETH", Quantity: "1", Value: 1}}},
	}
	for i, r := range bad {
		if _, _, _, err := r.Encode(); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
	// Text fields lose the delimiter and control characters, and stop at their size.
	r := header
	r.Name = "A|B\nC" + strings.Repeat("x", 100)
	out, _, _, _ := r.Encode()
	first := strings.SplitN(string(out), "\r\n", 2)[0]
	if f := strings.Split(first, "|"); len(f) != 4 || len([]rune(f[2])) != 80 || !strings.HasPrefix(f[2], "A B C") {
		t.Errorf("header %q", first)
	}
	// Dates are Brasília dates: 02:00 UTC on 1 August is still 31 July in Brasília.
	if d := date(time.Date(2026, 8, 1, 2, 0, 0, 0, time.UTC)); d != "31072026" {
		t.Errorf("date %s", d)
	}
}
