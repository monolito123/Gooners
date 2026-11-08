package e2e

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/monolito123/Gooners/payments/platform/internal/api"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
)

// Transfers between two merchants' accounts (docs/02 §6.5): one journal, posted or refused,
// and never twice for one Idempotency-Key, whatever happened to the first attempt.
func TestTransfers(t *testing.T) {
	st := newStack(t)
	ctx := context.Background()
	seller, sellerAcc := st.merchant(st.key)
	market, marketAcc := st.merchant(st.key)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": seller, "type": "mpoc_cots"}, 201)
	st.sale(seller, term["terminal_id"].(string), 50000) // instant: the net is available at once
	available := func(acc string) int64 { return num(st.balance(acc)["available"]) }
	before, marketBefore := available(sellerAcc), available(marketAcc)
	if before <= 0 {
		t.Fatalf("seller's available balance %d", before)
	}

	key := ids.ULID()
	post := func(idem string, body map[string]any, want int) map[string]any {
		t.Helper()
		_, out := st.callWithKey(idem, "POST", "/v1/transfers", body, want)
		return out
	}
	tr := post(key, map[string]any{"from_account": sellerAcc, "to_account": marketAcc, "amount": 1500, "description": "comissão de outubro"}, 201)
	if tr["status"] != "posted" || tr["amount"].(float64) != 1500 || !strings.HasPrefix(tr["id"].(string), "tr_") || !strings.HasPrefix(tr["journal_id"].(string), "jr_") {
		t.Fatalf("transfer %v", tr)
	}
	if available(sellerAcc) != before-1500 || available(marketAcc) != marketBefore+1500 {
		t.Fatalf("balances after: %d %d", available(sellerAcc), available(marketAcc))
	}
	_, got := st.call("GET", "/v1/transfers/"+tr["id"].(string), nil, 200)
	if got["journal_id"] != tr["journal_id"] || got["description"] != "comissão de outubro" {
		t.Fatalf("read back %v", got)
	}

	// The same key after the stored response is lost (a 5xx clears it): the same transfer,
	// one journal.
	if _, err := st.pool.Exec(ctx, `DELETE FROM idempotency_keys WHERE key = $1`, key); err != nil {
		t.Fatal(err)
	}
	again := post(key, map[string]any{"from_account": sellerAcc, "to_account": marketAcc, "amount": 1500, "description": "comissão de outubro"}, 201)
	var journals int
	_ = st.pool.QueryRow(ctx, `SELECT count(*) FROM journals WHERE reference = $1`, tr["id"]).Scan(&journals)
	if again["id"] != tr["id"] || journals != 1 || available(sellerAcc) != before-1500 {
		t.Fatalf("a retry moved money again: %v journals %d", again, journals)
	}
	// Even straight into the service, as a crash between the journal and the record would leave it.
	if _, err := st.pool.Exec(ctx, `DELETE FROM transfers WHERE id = $1`, tr["id"]); err != nil {
		t.Fatal(err)
	}
	if t2, err := st.svc.CreateTransfer(ctx, tenant, payments.TransferInput{FromAccount: sellerAcc, ToAccount: marketAcc, Amount: 1500, Description: "comissão de outubro"}, key, "api:test"); err != nil ||
		t2.ID != tr["id"] || t2.JournalID != tr["journal_id"] || available(sellerAcc) != before-1500 {
		t.Fatalf("recovering after a crash: %+v %v", t2, err)
	}

	// What is refused.
	for name, tc := range map[string]struct {
		body map[string]any
		want int
		code string
	}{
		"more than is available": {map[string]any{"from_account": sellerAcc, "to_account": marketAcc, "amount": before * 2}, 422, "insufficient_funds"},
		"to itself":              {map[string]any{"from_account": sellerAcc, "to_account": sellerAcc, "amount": 100}, 422, "invalid_request"},
		"nothing":                {map[string]any{"from_account": sellerAcc, "to_account": marketAcc, "amount": 0}, 422, "invalid_request"},
		"an unknown account":     {map[string]any{"from_account": "acc_" + ids.ULID(), "to_account": marketAcc, "amount": 100}, 404, "not_found"},
		"dollars":                {map[string]any{"from_account": sellerAcc, "to_account": marketAcc, "amount": 100, "currency": "USD"}, 422, "invalid_request"},
	} {
		if out := post(ids.ULID(), tc.body, 0); out["status"].(float64) != float64(tc.want) || out["code"] != tc.code {
			t.Errorf("%s: %v", name, out)
		}
	}
	// A restricted merchant's money is held: nothing leaves it.
	if _, err := st.svc.SetMerchantStatus(ctx, tenant, seller, payments.MerchantRestricted, "chargeback spike", "ops:alice"); err != nil {
		t.Fatal(err)
	}
	if out := post(ids.ULID(), map[string]any{"from_account": sellerAcc, "to_account": marketAcc, "amount": 100}, 409); out["code"] != "merchant_not_active" {
		t.Fatalf("from a restricted merchant: %v", out)
	}
	// Another tenant can neither read the transfer nor move these accounts' money.
	if err := st.svc.BootstrapTenant(ctx, tenantB, 0); err != nil {
		t.Fatal(err)
	}
	keyB, err := api.NewAPIKey(ctx, st.pool, tenantB, "tenant-b", []string{"*"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if c, _ := st.callAs(keyB, "GET", "/v1/transfers/"+tr["id"].(string), nil, 0); c != http.StatusNotFound {
		t.Errorf("another tenant read the transfer: %d", c)
	}
	if c, _ := st.callAs(keyB, "POST", "/v1/transfers", map[string]any{"from_account": marketAcc, "to_account": sellerAcc, "amount": 100}, 0); c != http.StatusNotFound {
		t.Errorf("another tenant moved the money: %d", c)
	}
	_ = market
}

// callWithKey is st.call with a chosen Idempotency-Key.
func (st *stack) callWithKey(key, method, path string, body any, want int) (int, map[string]any) {
	st.t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, st.api+path, bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+st.key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		st.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if want != 0 && resp.StatusCode != want {
		st.t.Fatalf("%s %s: HTTP %d, want %d: %v", method, path, resp.StatusCode, want, out)
	}
	return resp.StatusCode, out
}
