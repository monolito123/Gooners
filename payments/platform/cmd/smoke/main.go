// Command smoke starts the real binaries (schemesim, pixsim, platform) as separate processes
// with a fresh dev PKI, then drives a card tap, a decline, a Pix payment and a payout through
// the public API, the terminal path and the PSP's mutual-TLS webhook. Then it runs the
// operator commands (chargeback import, card and Pix reconciliation) and scrapes /metrics.
// It exits non-zero on any failure. Needs DATABASE_URL pointing to an empty database.
//
// With -serve FILE it only starts the stack, creates a sandbox API key and a merchant
// without a root key, writes the connection details to FILE as JSON and keeps running until
// interrupted: the Android and iOS integration tests enroll against it.
//
//	DATABASE_URL=postgres://… go run ./cmd/smoke
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/transparency"
)

var bin, pki string

func fail(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "SMOKE FAIL: "+format+"\n", a...)
	os.Exit(1)
}

func ok(format string, a ...any) { fmt.Printf("  ok   "+format+"\n", a...) }

func run(name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
	if err := cmd.Run(); err != nil {
		fail("%s %v: %v", name, args, err)
	}
}

func start(env []string, name string, args ...string) *exec.Cmd {
	cmd := exec.Command(filepath.Join(bin, name), args...)
	cmd.Env = append(os.Environ(), env...)
	logf, _ := os.Create(filepath.Join(bin, name+".log"))
	cmd.Stdout, cmd.Stderr = logf, logf
	if err := cmd.Start(); err != nil {
		fail("start %s: %v", name, err)
	}
	return cmd
}

func freePort() string {
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	defer l.Close()
	return l.Addr().String()
}

func waitTCP(addr string) {
	for i := 0; i < 100; i++ {
		if c, err := net.Dial("tcp", addr); err == nil {
			c.Close()
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	fail("nothing listening on %s", addr)
}

func hexKey() string { b := make([]byte, 32); _, _ = rand.Read(b); return hex.EncodeToString(b) }

func main() {
	serve := flag.String("serve", "", "write the sandbox connection details to this file and keep running")
	flag.Parse()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		fail("DATABASE_URL is required")
	}
	dir, _ := os.MkdirTemp("", "smoke-")
	defer os.RemoveAll(dir)
	bin, pki = dir, filepath.Join(dir, "pki")
	for _, c := range []string{"platform", "schemesim", "pixsim", "devpki", "tapsim"} {
		run("go", "build", "-o", filepath.Join(bin, c), "./cmd/"+c)
	}
	run(filepath.Join(bin, "devpki"), "-out", pki)
	p := func(f string) string { return filepath.Join(pki, f) }

	schemeAddr, pixAddr, apiAddr, hookAddr, metricsAddr := freePort(), freePort(), freePort(), freePort(), freePort()
	var procs []*exec.Cmd
	defer func() {
		for _, c := range procs {
			_ = c.Process.Kill()
		}
	}()
	procs = append(procs, start(nil, "schemesim", "-listen", schemeAddr, "-late-delay", "1s"))
	procs = append(procs, start(nil, "pixsim", "-listen", pixAddr, "-cert", p("pixsim-server.pem"), "-key", p("pixsim-server.key"),
		"-client-ca", p("ca.pem"), "-webhook-cert", p("pixsim-client.pem"), "-webhook-key", p("pixsim-client.key"),
		"-client-id", "platform", "-client-secret", "dev-secret", "-keys", "12345678000195"))
	waitTCP(schemeAddr)
	waitTCP(pixAddr)

	routes := filepath.Join(dir, "routes.json")
	_ = os.WriteFile(routes, []byte(fmt.Sprintf(`[{"name":"sponsor","dialect":"generic-1987-ascii","addrs":[%q],"acquirer_id":"12345678","approval_prior":0.9}]`, schemeAddr)), 0o644)
	tenant := "00000000-0000-4000-8000-000000000001"
	devKey := hexKey()
	env := []string{
		"PLATFORM_ENV=sandbox", "DATABASE_URL=" + dsn, "HTTP_ADDR=" + apiAddr, "ROUTES_FILE=" + routes, "CARD_PRESENT_TIMEOUT=2s",
		"VAULT_KEK_HEX=" + hexKey(), "VAULT_FINGERPRINT_KEY_HEX=" + hexKey(), "CARDDATA_DEV_KEY_HEX=" + devKey, "RECEIPTS_SECRET_HEX=" + hexKey(), "TRANSPARENCY_SECRET_HEX=" + hexKey(),
		"PIX_BASE_URL=https://" + pixAddr + "/api/v2", "PIX_TOKEN_URL=https://" + pixAddr + "/oauth/token", "PIX_CLIENT_ID=platform",
		"PIX_CLIENT_SECRET=dev-secret", "PIX_KEY=12345678000195", "PIX_TLS_CA=" + p("ca.pem"), "PIX_TLS_CERT=" + p("platform-client.pem"),
		"PIX_TLS_KEY=" + p("platform-client.key"), "PAYOUT_BASE_URL=https://" + pixAddr + "/api/v2",
		"PIX_WEBHOOK_ADDR=" + hookAddr, "PIX_WEBHOOK_TLS_CA=" + p("ca.pem"), "PIX_WEBHOOK_TLS_CERT=" + p("platform-server.pem"),
		"PIX_WEBHOOK_TLS_KEY=" + p("platform-server.key"), "PIX_WEBHOOK_PUBLIC_URL=https://" + hookAddr,
		"BOOTSTRAP_TENANT=" + tenant, "BOOTSTRAP_CAPITAL=100000000", "METRICS_ADDR=" + metricsAddr,
		"PLATFORM_DOCUMENT=22222222000191", "REPORTING_URL=https://goonerspay.example",
	}
	procs = append(procs, start(env, "platform", "serve"))
	waitTCP(apiAddr)
	waitTCP(hookAddr)
	ok("schemesim, pixsim and platform are listening (API, Pix webhook over mTLS)")

	keyOut, err := exec.Command(filepath.Join(bin, "platform"), "apikey", "-tenant", tenant, "-name", "smoke", "-scopes", "*,compliance:write").Output()
	if err != nil {
		fail("apikey: %v", err)
	}
	key := strings.TrimSpace(string(keyOut))
	api := "http://" + apiAddr
	call := func(method, path string, body any, want int) map[string]any {
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(method, api+path, bytes.NewReader(b))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Idempotency-Key", hexKey()[:32])
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			fail("%s %s: %v", method, path, err)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != want {
			fail("%s %s: HTTP %d: %s", method, path, resp.StatusCode, raw)
		}
		var out map[string]any
		_ = json.Unmarshal(raw, &out)
		return out
	}
	m := call("POST", "/v1/merchants", map[string]any{"legal": map[string]any{"document": map[string]any{"type": "cnpj", "number": "12345678000195"},
		"legal_name": "Cafe Aurora Ltda", "trade_name": "Café Aurora", "mcc": "5812", "city": "São Paulo"}, "scheme_mid": "000000004127731"}, 201)
	if *serve != "" {
		info, _ := json.MarshalIndent(map[string]any{"api_url": api, "api_key": key, "tenant": tenant, "merchant_id": m["id"], "account_id": m["account_id"],
			"dev_card_key": devKey, "metrics_url": "http://" + metricsAddr + "/metrics"}, "", "  ")
		if err := os.WriteFile(*serve, info, 0o600); err != nil {
			fail("write %s: %v", *serve, err)
		}
		ok("sandbox ready; connection details in %s (Ctrl-C to stop)", *serve)
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		return
	}
	term := call("POST", "/v1/terminals", map[string]any{"merchant_id": m["id"]}, 201)
	ok("merchant %s and terminal %s created", m["id"], term["terminal_id"])

	tap := func(amount string) map[string]any {
		out, err := exec.Command(filepath.Join(bin, "tapsim"), "-api", api, "-key", key, "-merchant", m["id"].(string),
			"-terminal", term["terminal_id"].(string), "-amount", amount, "-dev-key", devKey).Output()
		if err != nil {
			fail("tapsim %s: %v", amount, err)
		}
		var r map[string]any
		_ = json.Unmarshal(out, &r)
		return r
	}
	approved := tap("12990")
	if approved["status"] != "approved" {
		fail("tap approve: %v", approved)
	}
	ok("tap R$ 129,90 approved, code %s, settlement %v", approved["authorization_code"], approved["settlement"].(map[string]any)["mode"])
	if r := tap("4551"); r["status"] != "declined" || r["decline_code"] != "insufficient_funds" {
		fail("tap decline: %v", r)
	}
	ok("tap R$ 45,51 declined: insufficient_funds")

	pi := call("POST", "/v1/payment-intents", map[string]any{"merchant_id": m["id"], "amount": 2390, "channel": "pix"}, 201)
	conf := call("POST", "/v1/payment-intents/"+pi["id"].(string)+"/confirm", map[string]any{"payment_method_type": "pix"}, 200)
	txid := conf["next_action"].(map[string]any)["txid"].(string)
	ca, _ := os.ReadFile(p("ca.pem"))
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(ca)
	cert, _ := tls.LoadX509KeyPair(p("platform-client.pem"), p("platform-client.key"))
	psp := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, Certificates: []tls.Certificate{cert}}}}
	resp, err := psp.Post("https://"+pixAddr+"/sim/pagar/"+txid, "application/json", nil)
	if err != nil || resp.StatusCode != 200 {
		fail("pay pix: %v", err)
	}
	resp.Body.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		got := call("GET", "/v1/payment-intents/"+pi["id"].(string), nil, 200)
		if got["status"] == "captured" {
			break
		}
		if ctx.Err() != nil {
			fail("pix intent still %v", got["status"])
		}
		time.Sleep(100 * time.Millisecond)
	}
	ok("Pix R$ 23,90 paid at the PSP, webhook delivered over mTLS, intent captured")

	bal := call("GET", "/v1/accounts/"+m["account_id"].(string)+"/balance", nil, 200)
	avail := int64(bal["available"].(float64))
	q := call("POST", "/v1/payouts/quotes", map[string]any{"account_id": m["account_id"], "amount": avail, "speed": "instant",
		"destination": map[string]any{"type": "pix", "key_type": "CNPJ", "key": "12345678000195"}}, 201)
	po := call("POST", "/v1/payouts", map[string]any{"quote_id": q["id"]}, 201)
	if po["status"] != "paid" {
		fail("payout %v", po)
	}
	ok("payout of R$ %d,%02d paid via Pix, E2E %s", avail/100, avail%100, po["end_to_end_id"])

	// ---- operations, through the operator commands ----
	cli := func(args ...string) []byte {
		cmd := exec.Command(filepath.Join(bin, "platform"), args...)
		cmd.Env = append(os.Environ(), env...)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		if err != nil {
			fail("platform %s: %v\n%s", strings.Join(args, " "), err, stderr.String())
		}
		return out
	}
	rrn, code := approved["rrn"].(string), approved["authorization_code"].(string)
	cb := filepath.Join(dir, "chargebacks.csv")
	_ = os.WriteFile(cb, []byte("event,scheme,network_case_id,reason_code,category,amount,rrn,auth_code,evidence_due_at\n"+
		"opened,visa,SMOKE-CASE-1,10.4,fraud,12990,"+rrn+","+code+","+time.Now().Add(20*24*time.Hour).UTC().Format(time.RFC3339)+"\n"), 0o644)
	cli("disputes-import", "-tenant", tenant, "-file", cb)
	cli("disputes-import", "-tenant", tenant, "-file", cb) // applied once
	var disputes []map[string]any
	_ = json.Unmarshal(cli("disputes-list", "-tenant", tenant), &disputes)
	if len(disputes) != 1 || disputes[0]["status"] != "evidence_required" || disputes[0]["ledger"].(map[string]any)["owed_by_merchant"].(float64) != 12990 {
		fail("disputes after import: %v", disputes)
	}
	ok("chargeback imported once; the merchant was paid out, so R$ 129,90 is booked as owed")

	report := filepath.Join(dir, "settlement.csv")
	_ = os.WriteFile(report, []byte("record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id\n"+
		"sale,visa,"+rrn+","+code+",12990,208,16,12766,\nchargeback,visa,"+rrn+",,12990,,,-12990,SMOKE-CASE-1\n"), 0o644)
	var run map[string]any
	_ = json.Unmarshal(cli("recon-card", "-tenant", tenant, "-report", "SMOKE-REPORT-1", "-file", report), &run)
	if run["status"] != "balanced" {
		fail("card reconciliation: %v", run)
	}
	ok("card settlement report reconciled: %v", run["summary"])
	brt := time.FixedZone("BRT", -3*3600)
	_ = json.Unmarshal(cli("recon-pix", "-tenant", tenant, "-date", time.Now().In(brt).Format("2006-01-02")), &run)
	if run["status"] != "balanced" || run["summary"].(map[string]any)["psp_pix"].(float64) != 1 {
		fail("pix reconciliation: %v", run)
	}
	ok("Pix day reconciled against GET /pix: %v", run["summary"])

	// The day closed into a signed statement and a public transparency root (docs/03 §6).
	today := time.Now().In(brt).Format("2006-01-02")
	cli("close-day", "-date", today)
	sts := call("GET", "/v1/settlements?merchant_id="+m["id"].(string), nil, 200)["data"].([]any)
	if len(sts) != 1 {
		fail("settlements after close-day: %v", sts)
	}
	set := sts[0].(map[string]any)
	stmt := call("GET", "/v1/settlements/"+set["id"].(string)+"/statement", nil, 200)
	var statement struct {
		Lines []struct {
			Receipt string `json:"receipt_event_id"`
		} `json:"lines"`
		Commitment   string `json:"statement_commitment"`
		Transparency struct {
			Salt string `json:"leaf_salt"`
		} `json:"transparency"`
	}
	_ = json.Unmarshal([]byte(stmt["content"].(string)), &statement)
	resp, err = http.Get("http://" + apiAddr + "/v1/transparency/" + today)
	if err != nil || resp.StatusCode != 200 {
		fail("public transparency root: %v %v", err, resp)
	}
	var root map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&root)
	resp.Body.Close()
	proof := call("GET", "/v1/settlements/"+set["id"].(string)+"/proofs/"+statement.Lines[0].Receipt, nil, 200)
	ti := proof["transparency_inclusion"].(map[string]any)
	var path []string
	for _, x := range ti["audit_path"].([]any) {
		path = append(path, x.(string))
	}
	leaf, _ := transparency.LeafData(statement.Transparency.Salt, statement.Commitment)
	hops, _ := transparency.ParsePath(path)
	logRoot, _ := hex.DecodeString(root["root"].(string))
	if !transparency.VerifyInclusion(leaf, int(ti["leaf_index"].(float64)), int(ti["tree_size"].(float64)), hops, logRoot) {
		fail("the statement's leaf is not proven in the public root: %v", proof)
	}
	ok("day closed: statement of %d receipts, net R$ %.2f, proven in a public root of %v leaves", len(statement.Lines), set["net"].(float64)/100, root["tree_size"])

	// Crypto, international accounts and B3 in the sandbox (docs/09).
	cpi := call("POST", "/v1/payment-intents", map[string]any{"merchant_id": m["id"], "amount": 5000, "channel": "crypto"}, 201)
	cq := call("POST", "/v1/payment-intents/"+cpi["id"].(string)+"/confirm", map[string]any{"payment_method_type": "crypto", "asset": "USDT", "network": "tron"}, 200)
	act, _ := cq["next_action"].(map[string]any)
	if paid := call("POST", "/v1/sandbox/crypto/payments/"+cpi["id"].(string), nil, 200); paid["status"] != "captured" {
		fail("crypto payment: %v", paid)
	}
	ok("R$ 50,00 paid in USDT on Tron (%v to %v), sold for reais, intent captured", act["amount"], act["address"])
	accts := call("GET", "/v1/international/accounts?merchant_id="+m["id"].(string), nil, 200)
	if n := len(accts["data"].([]any)); n != 3 {
		fail("international accounts: %v", accts)
	}
	quote := call("GET", "/v1/investments/quotes/PETR4", nil, 200)
	ok("international accounts in USD, EUR and GBP; B3 quote PETR4 R$ %v (lot %v)", quote["last"], quote["lot"])
	// A withdrawal to the sandbox's sanctioned test address is refused before anything moves.
	if r := call("POST", "/v1/crypto/withdrawals", map[string]any{"merchant_id": m["id"], "asset": "USDT", "network": "ethereum",
		"address": "0x0000000000000000000000000000000000000bad", "amount": "1"}, 403); r["code"] != "address_refused" {
		fail("sanctions screening: %v", r)
	}
	// A payment from the sandbox's sanctioned sender is held for compliance, not settled.
	hpi := call("POST", "/v1/payment-intents", map[string]any{"merchant_id": m["id"], "amount": 2000, "channel": "crypto"}, 201)
	call("POST", "/v1/payment-intents/"+hpi["id"].(string)+"/confirm", map[string]any{"payment_method_type": "crypto", "asset": "USDT", "network": "tron"}, 200)
	if held := call("POST", "/v1/sandbox/crypto/payments/"+hpi["id"].(string), map[string]any{"from": "TSanctionedTestAddressForSandbox12"}, 200); held["status"] != "processing" {
		fail("a sanctioned sender's payment: %v", held)
	}
	if cs, _ := call("GET", "/v1/compliance/cases", nil, 200)["data"].([]any); len(cs) != 1 || cs[0].(map[string]any)["reason"] != "sanctions_hit" {
		fail("the held payment's compliance case: %v", cs)
	}
	// This month's DeCripto, written by the operator command as it would be filed.
	dc := filepath.Join(dir, "decripto.txt")
	cli("decripto", "-month", time.Now().In(brt).Format("2006-01"), "-out", dc)
	file, _ := os.ReadFile(dc)
	if !strings.HasPrefix(string(file), "0000|22222222000191|") || !strings.Contains(string(file), "\r\n0350|") || !strings.Contains(string(file), "\r\n9999|1|50,00|") {
		fail("decripto:\n%s", file)
	}
	ok("sanctioned address refused; a sanctioned sender's payment held for compliance; DeCripto written (%d lines)", strings.Count(string(file), "\r\n"))

	resp, err = http.Get("http://" + metricsAddr + "/metrics")
	if err != nil {
		fail("metrics: %v", err)
	}
	scrape, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	for _, want := range []string{`goonerspay_card_authorizations_total{outcome="approved"} 1`, `goonerspay_disputes_open{status="evidence_required"} 1`, "goonerspay_safeguarding_headroom_centavos"} {
		if !strings.Contains(string(scrape), want) {
			fail("metrics lack %s:\n%s", want, scrape)
		}
	}
	ok("/metrics exposes authorizations, open disputes and safeguarding headroom")

	cli("verify-ledger")
	ok("ledger invariants L1–L6 hold")
	fmt.Println("SMOKE OK")
}
