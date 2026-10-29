// Command smoke starts the real binaries (schemesim, pixsim, platform) as separate processes
// with a fresh dev PKI, then drives a card tap, a decline, a Pix payment and a payout through
// the public API, the terminal path and the PSP's mutual-TLS webhook. It exits non-zero on
// any failure. Needs DATABASE_URL pointing to an empty database.
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
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
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

	schemeAddr, pixAddr, apiAddr, hookAddr := freePort(), freePort(), freePort(), freePort()
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
		"VAULT_KEK_HEX=" + hexKey(), "VAULT_FINGERPRINT_KEY_HEX=" + hexKey(), "CARDDATA_DEV_KEY_HEX=" + devKey, "RECEIPTS_SECRET_HEX=" + hexKey(),
		"PIX_BASE_URL=https://" + pixAddr + "/api/v2", "PIX_TOKEN_URL=https://" + pixAddr + "/oauth/token", "PIX_CLIENT_ID=platform",
		"PIX_CLIENT_SECRET=dev-secret", "PIX_KEY=12345678000195", "PIX_TLS_CA=" + p("ca.pem"), "PIX_TLS_CERT=" + p("platform-client.pem"),
		"PIX_TLS_KEY=" + p("platform-client.key"), "PAYOUT_BASE_URL=https://" + pixAddr + "/api/v2",
		"PIX_WEBHOOK_ADDR=" + hookAddr, "PIX_WEBHOOK_TLS_CA=" + p("ca.pem"), "PIX_WEBHOOK_TLS_CERT=" + p("platform-server.pem"),
		"PIX_WEBHOOK_TLS_KEY=" + p("platform-server.key"), "PIX_WEBHOOK_PUBLIC_URL=https://" + hookAddr,
		"BOOTSTRAP_TENANT=" + tenant, "BOOTSTRAP_CAPITAL=100000000",
	}
	procs = append(procs, start(env, "platform", "serve"))
	waitTCP(apiAddr)
	waitTCP(hookAddr)
	ok("schemesim, pixsim and platform are listening (API, Pix webhook over mTLS)")

	keyOut, err := exec.Command(filepath.Join(bin, "platform"), "apikey", "-tenant", tenant, "-name", "smoke").Output()
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
	if r := tap("12990"); r["status"] != "approved" {
		fail("tap approve: %v", r)
	} else {
		ok("tap R$ 129,90 approved, code %s, settlement %v", r["authorization_code"], r["settlement"].(map[string]any)["mode"])
	}
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

	if out, err := exec.Command(filepath.Join(bin, "platform"), "verify-ledger").CombinedOutput(); err != nil {
		fail("verify-ledger: %v %s", err, out)
	}
	ok("ledger invariants L1–L5 hold")
	fmt.Println("SMOKE OK")
}
