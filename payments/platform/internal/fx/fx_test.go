package fx

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

var ctx = context.Background()

func TestValidation(t *testing.T) {
	for iban, ok := range map[string]bool{"BE68 5390 0754 7034": true, "GB82WEST12345698765432": true, "GB82WEST12345698765433": false, "XX00": false} {
		if ValidIBAN(iban) != ok {
			t.Errorf("IBAN %s", iban)
		}
	}
	for rtn, ok := range map[string]bool{"026009593": true, "021000021": true, "026009594": false, "12345": false} {
		if ValidABA(rtn) != ok {
			t.Errorf("ABA %s", rtn)
		}
	}
	us := Beneficiary{Name: "Acme Inc", Type: "business", Country: "US", RoutingNumber: "026009593", AccountNumber: "12345678"}
	if err := us.Validate("USD"); err != nil {
		t.Fatal(err)
	}
	if err := us.Validate("EUR"); err == nil {
		t.Fatal("euros need an IBAN")
	}
	if err := (Beneficiary{Name: "x", Type: "other", Country: "US"}).Validate("USD"); err == nil {
		t.Fatal("type")
	}
	first, again := Reference("mer_1"), Reference("mer_1") // the same merchant always gets the same reference
	if first != again || first == Reference("mer_2") || len(first) != 12 {
		t.Fatal("reference")
	}
}

func TestMemory(t *testing.T) {
	m := NewMemory()
	if r, err := m.Rate(ctx, "USD", "BRL"); err != nil || !strings.HasPrefix(r, "5.4") {
		t.Fatalf("rate %s %v", r, err)
	}
	if r, _ := m.Rate(ctx, "EUR", "USD"); !strings.HasPrefix(r, "1.083") {
		t.Fatalf("cross rate %s", r)
	}
	c, err := m.Convert(ctx, Conversion{ClientID: "c1", From: "BRL", To: "USD", FromUnits: 540_00})
	if err != nil || c.ToUnits != 100_00 {
		t.Fatalf("convert %+v %v", c, err)
	}
	if again, _ := m.Convert(ctx, Conversion{ClientID: "c1", From: "BRL", To: "USD", FromUnits: 1}); again != c {
		t.Fatal("idempotent")
	}
	d, err := m.AccountDetails(ctx, "EUR", "GPABC")
	if err != nil || !ValidIBAN(d.IBAN) || d.Reference != "GPABC" {
		t.Fatalf("details %+v %v", d, err)
	}
	m.SimulateCredit("USD", "GPABC", "Client LLC", 250_00)
	if cs, _ := m.Credits(ctx, "USD", time.Now().Add(-time.Minute)); len(cs) != 1 || cs[0].Units != 250_00 {
		t.Fatalf("credits %+v", cs)
	}
	if _, err := m.Pay(ctx, Payment{ClientID: "p", Currency: "USD", Units: 1, Beneficiary: Beneficiary{Name: "x", Type: "private", Country: "US", RoutingNumber: "1"}}); err == nil {
		t.Fatal("a bad routing number is refused before anything moves")
	}
}

// The Wise fake checks the token, the idempotency key and the order of calls of a transfer.
func TestWise(t *testing.T) {
	var calls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"errors":[{"code":"unauthorized","message":"bad token"}]}`))
			return
		}
		calls = append(calls, r.Method+" "+r.URL.Path)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch {
		case r.URL.Path == "/v1/rates":
			_, _ = w.Write([]byte(`[{"rate":5.4123,"source":"USD","target":"BRL"}]`))
		case r.URL.Path == "/v3/profiles/42/quotes":
			_, _ = w.Write([]byte(`{"id":"q-1","rate":0.18476}`))
		case r.URL.Path == "/v2/profiles/42/balance-movements":
			if r.Header.Get("X-idempotence-uuid") != uuidFor("cv_1") || body["quoteId"] != "q-1" {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"id":77,"state":"COMPLETED","targetAmount":{"value":99.77,"currency":"USD"}}`))
		case r.URL.Path == "/v1/profiles/42/account-details":
			_, _ = w.Write([]byte(`[{"currency":{"code":"USD"},"receiveOptions":[{"type":"LOCAL","details":[{"type":"ACCOUNT_HOLDER","body":"goonerspay Ltda"},
				{"type":"ACCOUNT_NUMBER","body":"8310004421"},{"type":"ROUTING_NUMBER","body":"026073150"},{"type":"BANK_NAME_AND_ADDRESS","body":"Community Federal Savings Bank"}]}]}]`))
		case r.URL.Path == "/v4/profiles/42/balances":
			_, _ = w.Write([]byte(`[{"id":9,"currency":"USD"}]`))
		case strings.HasPrefix(r.URL.Path, "/v1/profiles/42/balance-statements/9/"):
			_, _ = w.Write([]byte(`{"transactions":[{"type":"CREDIT","date":"2026-10-30T12:00:00Z","referenceNumber":"TRANSFER-1","amount":{"value":250.5,"currency":"USD"},
				"details":{"senderName":"Client LLC","paymentReference":"GPABC"}},{"type":"DEBIT","amount":{"value":-1}}]}`))
		case r.URL.Path == "/v1/accounts":
			if body["type"] != "aba" {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"id":555}`))
		case r.URL.Path == "/v1/transfers":
			if body["customerTransactionId"] != uuidFor("ip_1") || body["quoteUuid"] != "q-1" {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"id":888}`))
		case r.URL.Path == "/v3/profiles/42/transfers/888/payments":
			_, _ = w.Write([]byte(`{"status":"COMPLETED"}`))
		}
	}))
	defer srv.Close()
	w := &Wise{BaseURL: srv.URL, Token: "tok", ProfileID: "42"}
	if r, err := w.Rate(ctx, "USD", "BRL"); err != nil || r != "5.4123" {
		t.Fatalf("rate %s %v", r, err)
	}
	if c, err := w.Convert(ctx, Conversion{ClientID: "cv_1", From: "BRL", To: "USD", FromUnits: 540_00}); err != nil || c.ToUnits != 99_77 || c.ID != "77" {
		t.Fatalf("convert %+v %v", c, err)
	}
	if d, err := w.AccountDetails(ctx, "USD", "GPABC"); err != nil || d.RoutingNumber != "026073150" || d.Holder != "goonerspay Ltda" {
		t.Fatalf("details %+v %v", d, err)
	}
	if cs, err := w.Credits(ctx, "USD", time.Now().Add(-time.Hour)); err != nil || len(cs) != 1 || cs[0].Units != 250_50 || cs[0].Reference != "GPABC" {
		t.Fatalf("credits %+v %v", cs, err)
	}
	calls = nil
	id, err := w.Pay(ctx, Payment{ClientID: "ip_1", Currency: "USD", Units: 100_00, Reference: "Invoice 7",
		Beneficiary: Beneficiary{Name: "Acme Inc", Type: "business", Country: "US", RoutingNumber: "026009593", AccountNumber: "12345678"}})
	if err != nil || id != "888" {
		t.Fatalf("pay %s %v", id, err)
	}
	if strings.Join(calls, ",") != "POST /v1/accounts,POST /v3/profiles/42/quotes,POST /v1/transfers,POST /v3/profiles/42/transfers/888/payments" {
		t.Fatalf("calls %v", calls)
	}
	if _, err := (&Wise{BaseURL: srv.URL, Token: "bad", ProfileID: "42"}).Rate(ctx, "USD", "BRL"); err == nil || !strings.Contains(err.Error(), "unauthorized") {
		t.Fatalf("bad token: %v", err)
	}
}
