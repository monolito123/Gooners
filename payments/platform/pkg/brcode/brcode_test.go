package brcode

import (
	"strings"
	"testing"
)

// Examples published by the Banco Central in the API Pix specification (bacen/pix-api, openapi.yaml v2.11.0-rc1).
var bcbExamples = []struct {
	code    string
	dynamic bool
	url     string
}{
	{"00020126180014br.gov.bcb.pix5204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***80800014br.gov.bcb.pix2558pix.example.com/qr/v2/rec/2353c790eefb11eaadc10242ac120002630462C9", false, ""},
	{"00020101021226760014br.gov.bcb.pix2554pix.example.com/qr/v2/8b3da2f39a4140d1a91abd93113bd4415204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***80800014br.gov.bcb.pix2558pix.example.com/qr/v2/rec/94ed2badcbc04c15b0bb7fa35319489063047741", true, "pix.example.com/qr/v2/8b3da2f39a4140d1a91abd93113bd441"},
	{"00020101021226810014br.gov.bcb.pix2559pix.example.com/qr/v2/cobv/1e6c54d3ec9449b7a7fc53b6b0f998e75204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***80800014br.gov.bcb.pix2558pix.example.com/qr/v2/rec/3ffa640fa4f14080adccb949fa2dc0d06304A441", true, "pix.example.com/qr/v2/cobv/1e6c54d3ec9449b7a7fc53b6b0f998e7"},
}

func TestBCBExamplesDecode(t *testing.T) {
	for i, ex := range bcbExamples {
		p, err := Decode(ex.code)
		if err != nil {
			t.Fatalf("example %d: %v", i, err)
		}
		if p.Dynamic != ex.dynamic || p.URL != ex.url || p.MerchantName != "Fulano de Tal" || p.MerchantCity != "BRASILIA" {
			t.Errorf("example %d decoded as %+v", i, p)
		}
		if len(p.Extra) != 1 || p.Extra[0].ID != "80" {
			t.Errorf("example %d: Pix Automático template 80 not preserved", i)
		}
	}
}

func TestBCBDynamicExampleReencodes(t *testing.T) {
	p, err := Decode(bcbExamples[1].code)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Encode(*p)
	if err != nil {
		t.Fatal(err)
	}
	if got != bcbExamples[1].code {
		t.Fatalf("re-encoded\n got %s\nwant %s", got, bcbExamples[1].code)
	}
}

// The dynamic code used in docs/02-api-reference.md §4.4.
func TestSpecExample(t *testing.T) {
	code, err := Encode(Payload{Dynamic: true, URL: "pix.goonerspay.example/qr/v2/9d36b84fc70b478fb95c12729b90ca25", Amount: "129.90", MerchantName: "CAFE AURORA", MerchantCity: "SAO PAULO"})
	if err != nil {
		t.Fatal(err)
	}
	want := "00020101021226830014br.gov.bcb.pix2561pix.goonerspay.example/qr/v2/9d36b84fc70b478fb95c12729b90ca255204000053039865406129.905802BR5911CAFE AURORA6009SAO PAULO62070503***6304EC1C"
	if code != want {
		t.Fatalf("got %s", code)
	}
}

func TestStaticRoundTrip(t *testing.T) {
	in := Payload{Key: "12345678000195", Description: "Mesa 4", Amount: "23.90", MerchantName: "CAFE AURORA", MerchantCity: "SAO PAULO", TxID: "MESA4"}
	code, err := Encode(in)
	if err != nil {
		t.Fatal(err)
	}
	out, err := Decode(code)
	if err != nil {
		t.Fatal(err)
	}
	if out.Key != in.Key || out.Amount != in.Amount || out.TxID != in.TxID || out.Dynamic || out.MCC != "0000" {
		t.Fatalf("round trip %+v", out)
	}
}

func TestRejections(t *testing.T) {
	bad := bcbExamples[1].code[:len(bcbExamples[1].code)-4] + "0000"
	if _, err := Decode(bad); err == nil || !strings.Contains(err.Error(), "CRC") {
		t.Fatalf("bad CRC accepted: %v", err)
	}
	for name, p := range map[string]Payload{
		"no key":            {MerchantName: "A", MerchantCity: "B"},
		"long name":         {Key: "k", MerchantName: strings.Repeat("A", 26), MerchantCity: "B"},
		"long city":         {Key: "k", MerchantName: "A", MerchantCity: strings.Repeat("B", 16)},
		"comma amount":      {Key: "k", MerchantName: "A", MerchantCity: "B", Amount: "1,00"},
		"url with scheme":   {Dynamic: true, URL: "https://x.example/qr", MerchantName: "A", MerchantCity: "B"},
		"txid on dynamic":   {Dynamic: true, URL: "x.example/qr", MerchantName: "A", MerchantCity: "B", TxID: "ABC"},
		"txid with symbols": {Key: "k", MerchantName: "A", MerchantCity: "B", TxID: "A-B"},
	} {
		if _, err := Encode(p); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func FuzzDecode(f *testing.F) {
	for _, ex := range bcbExamples {
		f.Add(ex.code)
	}
	f.Fuzz(func(t *testing.T, s string) {
		_, _ = Decode(s) // must never panic
	})
}
