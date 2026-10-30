// Command tapsim emulates a terminal in the sandbox: it creates a card-present payment
// intent and sends a tap encrypted in the development format, like an MPoC SDK would.
//
//	tapsim -api http://localhost:8080 -key sk_test_… -merchant mer_… -terminal T… -amount 12990
//
// Amount cents drive the host simulator: ..51 insufficient funds, ..98 timeout (see schemesim).
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/carddata"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
)

func main() {
	apiURL := flag.String("api", "http://localhost:8080", "platform API")
	key := flag.String("key", os.Getenv("PLATFORM_API_KEY"), "API key")
	merchant := flag.String("merchant", "", "merchant ID")
	terminal := flag.String("terminal", "", "terminal ID")
	amount := flag.Int64("amount", 12990, "amount in centavos")
	pan := flag.String("pan", "4111111111111111", "test PAN")
	aid := flag.String("aid", "A0000000031010", "EMV AID (Visa credit A0000000031010, Mastercard A0000000041010, Elo A0000004942010)")
	app := flag.String("app", "credit", "credit or debit")
	devKey := flag.String("dev-key", os.Getenv("CARDDATA_DEV_KEY_HEX"), "development card-data key (hex)")
	atc := flag.Int("atc", -1, "the card's transaction counter (EMV 9F36, 0-65535); omitted when negative, since a shared test card has none")
	flag.Parse()
	k, err := hex.DecodeString(*devKey)
	if err != nil || len(k) != 32 || *merchant == "" || *terminal == "" || *key == "" {
		fmt.Fprintln(os.Stderr, "tapsim: -key, -merchant, -terminal and a 32-byte -dev-key are required")
		os.Exit(2)
	}
	post := func(path string, body any, idem bool) map[string]any {
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", *apiURL+path, bytes.NewReader(b))
		req.Header.Set("Authorization", "Bearer "+*key)
		req.Header.Set("Content-Type", "application/json")
		if idem {
			req.Header.Set("Idempotency-Key", ids.ULID())
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			fmt.Fprintln(os.Stderr, "tapsim:", err)
			os.Exit(1)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)
		var out map[string]any
		_ = json.Unmarshal(raw, &out)
		if resp.StatusCode >= 300 {
			fmt.Fprintf(os.Stderr, "tapsim: %s: HTTP %d %s\n", path, resp.StatusCode, raw)
			os.Exit(1)
		}
		return out
	}
	pi := post("/v1/payment-intents", map[string]any{"merchant_id": *merchant, "amount": *amount, "channel": "card_present"}, true)
	stan := fmt.Sprintf("%06d", rand.IntN(999999)+1)
	ksn := fmt.Sprintf("FFFF9876543210E%05d", rand.IntN(99999))
	emv := "9F2608A1B2C3D4E5F607089F2701809F3704C0FFEE11"
	if *atc >= 0 {
		emv += fmt.Sprintf("9F3602%04X", *atc&0xFFFF)
	}
	blob, err := carddata.DevEncrypt(k, ksn, carddata.Card{PAN: *pan, Expiry: "2911", AID: *aid, EMVHex: emv + "9A032610299C0100"})
	if err != nil {
		fmt.Fprintln(os.Stderr, "tapsim:", err)
		os.Exit(1)
	}
	res := post("/v1/terminal/authorizations", map[string]any{
		"payment_intent_id": pi["id"], "terminal_id": *terminal, "stan": stan, "emv_application": *app, "local_time": time.Now().Format(time.RFC3339),
		"sred": map[string]any{"format": carddata.DevFormat, "ksn": ksn, "ciphertext": base64.StdEncoding.EncodeToString(blob)},
	}, false)
	out, _ := json.MarshalIndent(res, "", "  ")
	fmt.Println(string(out))
}
