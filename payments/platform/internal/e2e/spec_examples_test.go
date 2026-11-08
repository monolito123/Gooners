package e2e

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

// The request examples published in docs/02-api-reference.md must be accepted by the
// implementation as written (only IDs of objects that do not exist yet are substituted).
func specExample(t *testing.T, mustContain ...string) map[string]any {
	t.Helper()
	doc, err := os.ReadFile("../../../docs/02-api-reference.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range regexp.MustCompile("(?s)```json\n(.*?)```").FindAllStringSubmatch(string(doc), -1) {
		ok := true
		for _, s := range mustContain {
			ok = ok && strings.Contains(m[1], s)
		}
		if ok {
			var v map[string]any
			if err := json.Unmarshal([]byte(m[1]), &v); err != nil {
				t.Fatal(err)
			}
			return v
		}
	}
	t.Fatalf("no example containing %v", mustContain)
	return nil
}

func TestSpecRequestExamplesAreAccepted(t *testing.T) {
	st := newStack(t)

	merchant := specExample(t, `"representatives"`, `"root_npub"`)
	_, m := st.call("POST", "/v1/merchants", merchant, 201)
	if m["account_id"] == "" || len(m["scheme_mid"].(string)) != 15 {
		t.Fatalf("merchant %v", m)
	}

	intent := specExample(t, `"payment_method_types"`, `"splits"`, `"statement_descriptor"`)
	intent["merchant_id"] = m["id"]
	// The example's split accounts are illustrative: another tenant's IDs are refused; with
	// two of this tenant's accounts the same request is accepted as written.
	if code, p := st.call("POST", "/v1/payment-intents", intent, 0); code != 422 || !strings.Contains(p["detail"].(string), "not one of the tenant's accounts") {
		t.Fatalf("unknown split accounts: %d %v", code, p)
	}
	seller, sellerAcc := st.merchant(st.key)
	_, marketAcc := st.merchant(st.key)
	splits := intent["splits"].([]any)
	splits[0].(map[string]any)["account_id"], splits[1].(map[string]any)["account_id"] = sellerAcc, marketAcc
	_, pi := st.call("POST", "/v1/payment-intents", intent, 201)
	if pi["installments"].(map[string]any)["count"].(float64) != 3 || pi["channel"] != "ecommerce" || len(pi["splits"].([]any)) != 2 || pi["split_reversal"] != "pro_rata" {
		t.Fatalf("intent %v", pi)
	}
	_ = seller

	terminal := specExample(t, `"device_id"`, `"certificate_sha256"`)
	terminal["merchant_id"] = m["id"]
	st.call("POST", "/v1/terminals", terminal, 201)
	delete(terminal, "certificate_sha256")
	terminal["csr"] = "MIIBNjCB3QIBADBbMQswCQYDVQQGEwJCUjEX"
	if code, _ := st.call("POST", "/v1/terminals", terminal, 0); code != 501 {
		t.Fatalf("CSR issuance needs the terminal PKI: got %d", code)
	}
}
