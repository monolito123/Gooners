package e2e

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/exchange"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
)

// flakyLookup is a sender lookup that can be down.
type flakyLookup struct {
	inner payments.SenderLookup
	down  atomic.Bool
}

func (f *flakyLookup) Senders(ctx context.Context, network, asset, txid, to string) ([]string, error) {
	if f.down.Load() {
		return nil, errors.New("esplora: connection refused")
	}
	return f.inner.Senders(ctx, network, asset, txid, to)
}

func cryptoMerchant(t *testing.T, st *stack, base, name string) string {
	t.Helper()
	_, m := st.call("POST", "/v1/merchants", map[string]any{
		"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": cnpj(base)}, "legal_name": name, "trade_name": name, "mcc": "5812", "city": "Natal"},
		"plan":  map[string]any{"CreditBps": 319, "DebitBps": 137, "InstallmentBps": 499, "PixBps": 0, "Tier": "A", "Instant": true},
	}, 201)
	return m["id"].(string)
}

// charge opens a crypto charge and returns its intent and what the customer must send.
func charge(t *testing.T, st *stack, merchant string, amount int64, payer map[string]any) (string, map[string]any) {
	t.Helper()
	_, cp := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": amount, "channel": "crypto"}, 201)
	body := map[string]any{"payment_method_type": "crypto", "asset": "USDT", "network": "tron"}
	if payer != nil {
		body["payer"] = payer
	}
	_, pi := st.call("POST", "/v1/payment-intents/"+cp["id"].(string)+"/confirm", body, 200)
	return cp["id"].(string), pi["next_action"].(map[string]any)
}

func openCases(t *testing.T, st *stack) []map[string]any {
	t.Helper()
	_, cs := st.call("GET", "/v1/compliance/cases", nil, 200)
	var out []map[string]any
	for _, c := range cs["data"].([]any) {
		out = append(out, c.(map[string]any))
	}
	return out
}

// Who sends each deposit is screened before it settles (docs/09 §6.5): a sanctioned sender's
// payment is held and frozen by compliance; one nobody could screen waits and is re-screened.
func TestDepositSenderScreening(t *testing.T) {
	venue := exchange.NewMemory("simex")
	lookup := &flakyLookup{inner: venue}
	st := newStack(t, func(c *payments.Config) { c.RiskMode = payments.RiskShadow },
		func(d *payments.Deps) {
			d.Exchanges, d.Senders = &exchange.Router{Venues: []exchange.Exchange{venue}}, lookup
		})
	ctx := t.Context()
	merchant := cryptoMerchant(t, st, "556677880001", "Café da Praia Ltda")
	wallet := ledger.MerchantWallet(merchant)

	// A clean customer: the payment settles, and the sender's screening is on record.
	pi, _ := charge(t, st, merchant, 300_00, nil)
	if _, out := st.call("POST", "/v1/sandbox/crypto/payments/"+pi, nil, 200); out["status"] != "captured" {
		t.Fatalf("a clean payment: %v", out)
	}
	_, scr := st.call("GET", "/v1/compliance/screenings?purpose=deposit_sender", nil, 200)
	if d := scr["data"].([]any); len(d) != 1 || d[0].(map[string]any)["address"] != exchange.SandboxSenders["tron"] || d[0].(map[string]any)["result"] != "clear" {
		t.Fatalf("the sender's screening: %v", scr)
	}
	credited := st.ledgerBalance(wallet)

	// A sanctioned sender: held, not settled; nothing reaches the merchant; a case says why.
	pi, _ = charge(t, st, merchant, 200_00, nil)
	_, out := st.call("POST", "/v1/sandbox/crypto/payments/"+pi, map[string]any{"from": "TSanctionedTestAddressForSandbox12"}, 200)
	if out["status"] != "processing" || out["latest_attempt"].(map[string]any)["status"] != "held" || out["next_action"] != nil {
		t.Fatalf("a sanctioned sender's payment: %v", out)
	}
	if st.ledgerBalance(wallet) != credited {
		t.Fatal("a held payment reached the merchant")
	}
	cs := openCases(t, st)
	if len(cs) != 1 || cs[0]["reason"] != "sanctions_hit" || cs[0]["holds_funds"] != true || cs[0]["payment_intent_id"] != pi || cs[0]["asset"] != "USDT" {
		t.Fatalf("the case: %v", cs)
	}
	hit := cs[0]["id"].(string)
	held := num(cs[0]["units"])
	if b := st.ledgerBalance(ledger.ComplianceHold("USDT")); b != held {
		t.Fatalf("the coins are booked to the compliance hold: %d, want %d", b, held)
	}
	// The night's custody run sees the held coins as booked, not as a difference.
	if run, err := st.svc.ReconcileCustody(ctx, time.Now()); err != nil || run.Status != "balanced" {
		t.Fatalf("custody with a held deposit: %v %+v", err, run)
	}
	// Decisions need a note and the right action; a hit is blocked: frozen, the sale canceled.
	// A partner's "*" key reads cases but does not decide them: compliance:write is granted by name.
	if _, out := st.call("POST", "/v1/compliance/cases/"+hit+"/decision", map[string]any{"action": "release", "note": "x"}, 403); out["code"] != "forbidden" {
		t.Fatalf("a partner key released a sanctions hold: %v", out)
	}
	st.callAs(st.complianceKey(), "POST", "/v1/compliance/cases/"+hit+"/decision", map[string]any{"action": "block"}, 422)
	st.callAs(st.complianceKey(), "POST", "/v1/compliance/cases/"+hit+"/decision", map[string]any{"action": "close", "note": "x"}, 422)
	_, c := st.callAs(st.complianceKey(), "POST", "/v1/compliance/cases/"+hit+"/decision", map[string]any{"action": "block", "note": "OFAC SDN match confirmed; reported to the MJSP and the COAF"}, 200)
	if c["status"] != "blocked" || c["decided_by"] == "" || c["decided_at"] == nil {
		t.Fatalf("blocked: %v", c)
	}
	st.callAs(st.complianceKey(), "POST", "/v1/compliance/cases/"+hit+"/decision", map[string]any{"action": "release", "note": "changed my mind"}, 409)
	if _, p := st.call("GET", "/v1/payment-intents/"+pi, nil, 200); p["status"] != "canceled" {
		t.Fatalf("a blocked payment's sale: %v", p)
	}
	if st.ledgerBalance(ledger.ComplianceHold("USDT")) != held || st.ledgerBalance(wallet) != credited {
		t.Fatal("blocked coins left the hold")
	}

	// The lookup is down: the payment waits (fail closed); once it is back, the job
	// re-screens, the sender is clear, and the payment settles for the intent's amount.
	lookup.down.Store(true)
	pi, _ = charge(t, st, merchant, 100_00, nil)
	if _, out := st.call("POST", "/v1/sandbox/crypto/payments/"+pi, nil, 200); out["status"] != "processing" {
		t.Fatalf("an unscreened payment: %v", out)
	}
	cs = openCases(t, st)
	if len(cs) != 1 || cs[0]["reason"] != "screening_failed" {
		t.Fatalf("%v", cs)
	}
	if n, err := st.svc.RescreenHeldDeposits(ctx); err != nil || n != 0 {
		t.Fatalf("too soon to re-screen: %d %v", n, err)
	}
	lookup.down.Store(false)
	if _, err := st.pool.Exec(ctx, `UPDATE compliance_cases SET updated_at = now() - interval '11 minutes' WHERE id = $1`, cs[0]["id"]); err != nil {
		t.Fatal(err)
	}
	if n, err := st.svc.RescreenHeldDeposits(ctx); err != nil || n != 1 {
		t.Fatalf("re-screened: %d %v", n, err)
	}
	if _, p := st.call("GET", "/v1/payment-intents/"+pi, nil, 200); p["status"] != "captured" {
		t.Fatalf("released by the re-screening, the payment settles: %v", p)
	}
	_, rc := st.call("GET", "/v1/compliance/cases/"+cs[0]["id"].(string), nil, 200)
	if rc["status"] != "released" || rc["decided_by"] != "system" {
		t.Fatalf("%v", rc)
	}
	if st.ledgerBalance(wallet) <= credited || st.ledgerBalance(ledger.ComplianceHold("USDT")) != held {
		t.Fatal("the released payment did not reach the merchant, or the blocked one left the hold")
	}
	// A deposit no charge matches, from a sanctioned wallet: frozen too, as the platform's.
	addr, _, _ := venue.DepositAddress(ctx, "USDT", "tron")
	stray := venue.SimulateDepositFrom("TSanctionedTestAddressForSandbox12", "USDT", "tron", addr, "", 3_000_000)
	if _, err := st.svc.ReconcileCustody(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	pcs, _, err := st.svc.ListCases(ctx, payments.PlatformTenant, "open", "", 10)
	if err != nil || len(pcs) != 1 || pcs[0].Subject != "deposit:simex/"+stray.ID || pcs[0].Reason != payments.ReasonSanctionsHit {
		t.Fatalf("the platform's case for an unmatched deposit: %v %+v", err, pcs)
	}
	if run, err := st.svc.ReconcileCustody(ctx, time.Now()); err != nil || run.Status != "balanced" {
		t.Fatalf("a frozen stray deposit is booked, not unapplied: %v %+v", err, run)
	}
}

// signed posts what the travel-rule adapter would.
func (st *stack) inbound(body any, secret string) (int, map[string]any) {
	st.t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", st.api+"/v1/travel-rule/inbound", bytes.NewReader(b))
	id, ts := "msg_"+ids.ULID(), time.Now().Unix()
	sig, _ := webhooks.Sign(secret, id, ts, b)
	req.Header.Set("webhook-id", id)
	req.Header.Set("webhook-timestamp", strconv.FormatInt(ts, 10))
	req.Header.Set("webhook-signature", sig)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		st.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out
}

func ivms(originator, beneficiaryDoc string) map[string]any {
	benef := map[string]any{"legalPerson": map[string]any{"name": map[string]any{"nameIdentifier": []any{map[string]any{"legalPersonName": "Loja Recebedora Ltda", "legalPersonNameIdentifierType": "LEGL"}}}}}
	if beneficiaryDoc != "" {
		benef["legalPerson"].(map[string]any)["nationalIdentification"] = map[string]any{"nationalIdentifier": beneficiaryDoc, "nationalIdentifierType": "RAID", "registrationAuthority": "RA000681"}
	}
	return map[string]any{
		"originator": map[string]any{"originatorPerson": []any{map[string]any{"naturalPerson": map[string]any{
			"name":                   map[string]any{"nameIdentifier": []any{map[string]any{"primaryIdentifier": originator, "naturalPersonNameIdentifierType": "LEGL"}}},
			"customerIdentification": "cust-778"}}}},
		"beneficiary":     map[string]any{"beneficiaryPerson": []any{benef}},
		"payloadMetadata": map[string]any{"payloadVersion": "101.2023"},
	}
}

// The travel rule (docs/09 §6.6): what goes with each withdrawal, and what other providers
// send with deposits.
func TestTravelRule(t *testing.T) {
	venue := exchange.NewMemory("simex")
	st := newStack(t, func(c *payments.Config) {
		c.RiskMode = payments.RiskShadow
		c.PlatformDocument, c.ReportingName = "22.222.222/0001-91", "goonersPAY Teste"
	}, func(d *payments.Deps) { d.Exchanges = &exchange.Router{Venues: []exchange.Exchange{venue}} })
	ctx := t.Context()
	merchant := cryptoMerchant(t, st, "667788990001", "Mercado Bom Preço Ltda")
	document := cnpj("667788990001")
	pi, _ := charge(t, st, merchant, 900_00, nil)
	st.call("POST", "/v1/sandbox/crypto/payments/"+pi, nil, 200)
	_, q := st.call("POST", "/v1/conversions", map[string]any{"merchant_id": merchant, "side": "buy", "asset": "USDT", "brl_amount": 300_00}, 201)
	st.call("POST", "/v1/conversions/"+q["id"].(string)+"/execute", nil, 200)
	before := holding(t, st, merchant, "USDT")
	send := func(body map[string]any, want int) map[string]any {
		t.Helper()
		b := map[string]any{"merchant_id": merchant, "asset": "USDT", "network": "tron", "address": "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8", "amount": "2"}
		for k, v := range body {
			b[k] = v
		}
		_, out := st.call("POST", "/v1/crypto/withdrawals", b, want)
		return out
	}

	// ---- outbound ----
	send(map[string]any{"destination_type": "exchange"}, 422)                                                                                 // to a provider, which one?
	send(map[string]any{"beneficiary_vasp": map[string]any{"name": "Exchange"}}, 422)                                                         // a wallet has no provider
	send(map[string]any{"beneficiary": map[string]any{"type": "robot", "name": "R2"}}, 422)                                                   // not IVMS101
	send(map[string]any{"destination_type": "exchange", "beneficiary_vasp": map[string]any{"name": "X", "lei": "506700GE1G29325QX364"}}, 422) // a bad LEI
	if out := send(map[string]any{"destination_type": "exchange", "beneficiary_vasp": map[string]any{"name": "Sandbox Rejects Ltd"}}, 422); out["code"] != "travel_rule_rejected" {
		t.Fatalf("a provider that refuses: %v", out)
	}
	send(map[string]any{"destination_type": "exchange", "beneficiary_vasp": map[string]any{"name": "Offline Exchange"}}, 503)
	if holding(t, st, merchant, "USDT") != before {
		t.Fatal("a refused withdrawal moved money")
	}
	accepted := send(map[string]any{"destination_type": "exchange", "beneficiary_vasp": map[string]any{"name": "Exchange Exemplo S.A.", "lei": "506700GE1G29325QX363", "country": "BR"}}, 201)
	tr := accepted["travel_rule"].(map[string]any)
	if tr["status"] != "accepted" || tr["reference"] == "" {
		t.Fatalf("the provider's acceptance: %v", accepted)
	}
	_, msg := st.call("GET", "/v1/travel-rule/messages/"+tr["id"].(string), nil, 200)
	payload, _ := json.Marshal(msg["ivms101"])
	for _, want := range []string{`"legalPersonName":"Mercado Bom Preço Ltda"`, `"nationalIdentifier":"` + document + `"`, `"registrationAuthority":"RA000681"`,
		`"customerIdentification":"` + merchant + `"`, `"legalPersonName":"goonersPAY Teste"`, `"nationalIdentifier":"506700GE1G29325QX363","nationalIdentifierType":"LEIX"`,
		`"accountNumber":["TJRabPrwbZy45sbavfcjinPJC18kjpRTv8"]`, `"payloadVersion":"101.2023"`} {
		if !bytes.Contains(payload, []byte(want)) {
			t.Errorf("%s missing from %s", want, payload)
		}
	}
	if msg["transfer_id"] != accepted["id"] || msg["direction"] != "outbound" {
		t.Fatalf("%v", msg)
	}
	// To a self-hosted wallet: the merchant declares who owns it.
	own := send(map[string]any{"beneficiary": map[string]any{"type": "natural", "name": "João Pereira", "document": "123.456.789-09", "country": "BR"}}, 201)
	if own["travel_rule"].(map[string]any)["status"] != "self_declared" {
		t.Fatalf("%v", own)
	}
	_, list := st.call("GET", "/v1/travel-rule/messages?direction=outbound", nil, 200)
	statuses := map[string]int{}
	for _, m := range list["data"].([]any) {
		statuses[m.(map[string]any)["status"].(string)]++
	}
	if statuses["accepted"] != 1 || statuses["rejected"] != 1 || statuses["unreachable"] != 1 || statuses["self_declared"] != 1 {
		t.Fatalf("every attempt is on record: %v", statuses)
	}

	// ---- inbound ----
	if code, _ := st.inbound(map[string]any{"reference": "trp-0"}, webhooks.NewSecret()); code != 401 {
		t.Fatalf("an unsigned message: %d", code)
	}
	// Data that arrives before the coins: kept, then matched to the deposit.
	pi, act := charge(t, st, merchant, 150_00, nil)
	code, ans := st.inbound(map[string]any{"reference": "trp-1", "asset": "USDT", "network": "tron", "address": act["address"], "amount": act["amount"],
		"originator_vasp": map[string]any{"name": "Outra Exchange S.A."}, "ivms101": ivms("Ana Souza", document)}, st.travelSecret)
	if code != 200 || ans["status"] != "accepted" {
		t.Fatalf("a valid message: %d %v", code, ans)
	}
	if code, again := st.inbound(map[string]any{"reference": "trp-1", "asset": "USDT"}, st.travelSecret); code != 200 || again["reference"] != ans["reference"] {
		t.Fatalf("a message delivered twice: %d %v", code, again)
	}
	st.call("POST", "/v1/sandbox/crypto/payments/"+pi, nil, 200)
	var matched, merchantOf string
	_ = st.pool.QueryRow(ctx, `SELECT status, COALESCE(merchant_id, '') FROM travel_rule_messages WHERE reference = 'trp-1'`).Scan(&matched, &merchantOf)
	var depositRule string
	_ = st.pool.QueryRow(ctx, `SELECT travel_rule FROM crypto_deposits WHERE matched_to = $1`, pi).Scan(&depositRule)
	if matched != "matched" || merchantOf != merchant || depositRule != "received" {
		t.Fatalf("matched: %s %s %s", matched, merchantOf, depositRule)
	}
	// Refused: invalid data, and an address that is not the platform's.
	if _, ans := st.inbound(map[string]any{"reference": "trp-2", "asset": "USDT", "network": "tron", "address": act["address"], "amount": "1",
		"originator_vasp": map[string]any{"name": "V"}, "ivms101": ivms("", "")}, st.travelSecret); ans["status"] != "rejected" {
		t.Fatalf("invalid data: %v", ans)
	}
	if _, ans := st.inbound(map[string]any{"reference": "trp-3", "asset": "USDT", "network": "tron", "address": "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8", "amount": "1",
		"originator_vasp": map[string]any{"name": "V"}, "ivms101": ivms("Ana", "")}, st.travelSecret); ans["status"] != "rejected" {
		t.Fatalf("someone else's address: %v", ans)
	}
	// A beneficiary that is not the merchant: a review, the payment settles.
	pi, act = charge(t, st, merchant, 120_00, nil)
	st.inbound(map[string]any{"reference": "trp-4", "asset": "USDT", "network": "tron", "address": act["address"], "amount": act["amount"],
		"originator_vasp": map[string]any{"name": "Outra Exchange S.A."}, "ivms101": ivms("Ana Souza", cnpj("111111110001"))}, st.travelSecret)
	if _, out := st.call("POST", "/v1/sandbox/crypto/payments/"+pi, nil, 200); out["status"] != "captured" {
		t.Fatalf("%v", out)
	}
	cs := openCases(t, st)
	if len(cs) != 1 || cs[0]["reason"] != "beneficiary_mismatch" || cs[0]["holds_funds"] != false {
		t.Fatalf("the review: %v", cs)
	}
	st.callAs(st.complianceKey(), "POST", "/v1/compliance/cases/"+cs[0]["id"].(string)+"/decision", map[string]any{"action": "release", "note": "x"}, 422)
	st.callAs(st.complianceKey(), "POST", "/v1/compliance/cases/"+cs[0]["id"].(string)+"/decision", map[string]any{"action": "close", "note": "the CNPJ is the merchant's holding company"}, 200)

	// The payer's declaration at the checkout; a declaration that identifies nobody is refused.
	_, ip := st.call("POST", "/v1/payment-intents", map[string]any{"merchant_id": merchant, "amount": 80_00, "channel": "crypto"}, 201)
	st.call("POST", "/v1/payment-intents/"+ip["id"].(string)+"/confirm", map[string]any{"payment_method_type": "crypto", "asset": "USDT", "network": "tron",
		"payer": map[string]any{"type": "natural", "name": "Ana Souza"}}, 422) // a name alone (C1)
	pi, _ = charge(t, st, merchant, 80_00, map[string]any{"type": "natural", "name": "Ana Souza", "document": "529.982.247-25", "country": "BR"})
	st.call("POST", "/v1/sandbox/crypto/payments/"+pi, nil, 200)
	_ = st.pool.QueryRow(ctx, `SELECT travel_rule FROM crypto_deposits WHERE matched_to = $1`, pi).Scan(&depositRule)
	if depositRule != "self_declared" {
		t.Fatalf("a payer's declaration: %s", depositRule)
	}

	// A large deposit with no data: a review; the data arrives later and closes it.
	pi, act = charge(t, st, merchant, 6_000_00, nil)
	st.call("POST", "/v1/sandbox/crypto/payments/"+pi, nil, 200)
	cs = openCases(t, st)
	if len(cs) != 1 || cs[0]["reason"] != "originator_missing" {
		t.Fatalf("a large deposit with no originator: %v", cs)
	}
	var txid string
	_ = st.pool.QueryRow(ctx, `SELECT txid FROM crypto_deposits WHERE matched_to = $1`, pi).Scan(&txid)
	st.inbound(map[string]any{"reference": "trp-5", "asset": "USDT", "network": "tron", "address": act["address"], "amount": act["amount"], "txid": txid,
		"originator_vasp": map[string]any{"name": "Outra Exchange S.A."}, "ivms101": ivms("Ana Souza", "")}, st.travelSecret)
	if cs := openCases(t, st); len(cs) != 0 {
		t.Fatalf("the data arrived: %v", cs)
	}
	// Late data that names someone else: the missing-data review closes, a mismatch review opens.
	pi, act = charge(t, st, merchant, 7_000_00, nil)
	st.call("POST", "/v1/sandbox/crypto/payments/"+pi, nil, 200)
	_ = st.pool.QueryRow(ctx, `SELECT txid FROM crypto_deposits WHERE matched_to = $1`, pi).Scan(&txid)
	st.inbound(map[string]any{"reference": "trp-6", "asset": "USDT", "network": "tron", "address": act["address"], "amount": act["amount"], "txid": txid,
		"originator_vasp": map[string]any{"name": "Outra Exchange S.A."}, "ivms101": ivms("Ana Souza", cnpj("222222220001"))}, st.travelSecret)
	if cs := openCases(t, st); len(cs) != 1 || cs[0]["reason"] != "beneficiary_mismatch" {
		t.Fatalf("late data naming another beneficiary: %v", cs)
	}
	_, all := st.call("GET", "/v1/compliance/cases?status=all", nil, 200)
	if len(all["data"].([]any)) != 4 {
		t.Fatalf("every case stays on record: %v", all)
	}
}
