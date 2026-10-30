package payments

import (
	"strings"
	"testing"
	"time"
)

func TestParseSettlementCSV(t *testing.T) {
	ok := "record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id\n" +
		"sale,VISA,000000000123,A1B2C3,12990,210,16,12764,\n" +
		"chargeback,visa,000000000123,,12990,,,-12990,VCR-1\n"
	lines, err := ParseSettlementCSV(strings.NewReader(ok))
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 || lines[0].Brand != "visa" || lines[0].Line != 2 || lines[1].Net != -12990 || lines[1].CaseID != "VCR-1" {
		t.Fatalf("%+v", lines)
	}
	for name, body := range map[string]string{
		"header":        "type,brand\nsale,visa",
		"negative sale": "record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id\nsale,visa,1,,100,0,0,-100,\n",
		"positive cb":   "record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id\nchargeback,visa,1,,100,0,0,100,X\n",
		"decimal":       "record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id\nsale,visa,1,,1.00,0,0,100,\n",
		"no rrn":        "record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id\nsale,visa,,,100,0,0,100,\n",
		"unknown type":  "record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id\nfee,visa,1,,100,0,0,100,\n",
	} {
		if _, err := ParseSettlementCSV(strings.NewReader(body)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestParseDisputeCSV(t *testing.T) {
	body := "event,scheme,network_case_id,reason_code,category,amount,rrn,auth_code,evidence_due_at\n" +
		"opened,Visa,VCR-1,10.4,fraud,12990,000000000123,A1B2C3,2026-11-18T23:59:59Z\n" +
		"won,visa,VCR-1,,,,,,\n"
	ns, err := ParseDisputeCSV(strings.NewReader(body), "cb-2026-11-02.csv")
	if err != nil {
		t.Fatal(err)
	}
	if len(ns) != 2 || ns[0].Scheme != "visa" || ns[0].Amount != 12990 || ns[0].EvidenceDueAt.IsZero() || ns[1].Event != "won" || ns[1].Source != "cb-2026-11-02.csv:3" {
		t.Fatalf("%+v", ns)
	}
	if _, err := ParseDisputeCSV(strings.NewReader("event,scheme,network_case_id,reason_code,category,amount,rrn,auth_code,evidence_due_at\nopened,visa,X,1,fraud,1,2,3,18/11/2026\n"), "f"); err == nil {
		t.Error("a non-RFC 3339 deadline was accepted")
	}
}

func TestBusinessDayIsTheBrasiliaDate(t *testing.T) {
	for in, want := range map[string]string{
		"2026-10-30T00:30:00Z":      "2026-10-29", // 21:30 in Brasília
		"2026-10-30T03:00:00Z":      "2026-10-30",
		"2026-10-29T23:59:59-03:00": "2026-10-29",
	} {
		ts, _ := time.Parse(time.RFC3339, in)
		if got := businessDay(ts); got.Format("2006-01-02") != want || got.Hour() != 0 || got.Location() != BRT {
			t.Errorf("businessDay(%s) = %s", in, got)
		}
	}
}

func FuzzParseSettlementCSV(f *testing.F) {
	f.Add("record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id\nsale,visa,1,A,100,1,1,98,\n")
	f.Add("record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id\nchargeback,visa,1,,100,,,-100,X\n")
	f.Fuzz(func(t *testing.T, s string) {
		lines, err := ParseSettlementCSV(strings.NewReader(s))
		if err != nil {
			return
		}
		for _, l := range lines { // whatever parses obeys the sign rules
			if l.Amount <= 0 || l.RRN == "" || ((l.RecordType == "sale" || l.RecordType == "chargeback_reversal") && l.Net < 0) ||
				((l.RecordType == "refund" || l.RecordType == "chargeback") && l.Net > 0) {
				t.Fatalf("accepted %+v", l)
			}
		}
	})
}

func FuzzParseDisputeCSV(f *testing.F) {
	f.Add("event,scheme,network_case_id,reason_code,category,amount,rrn,auth_code,evidence_due_at\nopened,visa,X,10.4,fraud,100,1,A,2026-11-18T23:59:59Z\n")
	f.Fuzz(func(t *testing.T, s string) {
		_, _ = ParseDisputeCSV(strings.NewReader(s), "fuzz") // must never panic
	})
}
