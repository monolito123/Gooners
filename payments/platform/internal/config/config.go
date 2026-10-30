// Package config loads the platform configuration from environment variables and a routes
// file, and enforces what each environment may run with.
//
// Environments:
//
//	sandbox        simulators, development keys and plain TCP are allowed
//	certification  real counterparties' test environments (scheme test hosts, the bank's
//	               Pix homologation): TLS everywhere and verified dialects only
//	production     additionally refuses every software-only key holder (local KEK, the
//	               development card decryptor, an in-process receipts key): those must be
//	               HSM / enclave adapters (docs/04 §4.2)
package config

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Environments.
const (
	Sandbox       = "sandbox"
	Certification = "certification"
	Production    = "production"
)

// TLSFiles names PEM files.
type TLSFiles struct {
	CA         string `json:"ca"`
	Cert       string `json:"cert"`
	Key        string `json:"key"`
	ServerName string `json:"server_name,omitempty"`
}

// Route is one scheme or sponsor connection (routes file).
type Route struct {
	Name          string    `json:"name"`
	Dialect       string    `json:"dialect,omitempty"`      // embedded dialect name
	DialectFile   string    `json:"dialect_file,omitempty"` // dialect JSON from the licensed spec
	Addrs         []string  `json:"addrs"`                  // one per site
	TLS           *TLSFiles `json:"tls,omitempty"`
	AcquirerID    string    `json:"acquirer_id"`
	Schemes       []string  `json:"schemes"`
	FeeBps        int64     `json:"fee_bps"`
	FixedCents    int64     `json:"fixed_cents"`
	PerAttempt    int64     `json:"per_attempt_cents"`
	ApprovalPrior float64   `json:"approval_prior"`
	SignOn        *bool     `json:"sign_on,omitempty"`
	EchoSeconds   int       `json:"echo_seconds,omitempty"`
}

// Config is the complete configuration.
type Config struct {
	Env         string
	DatabaseURL string
	AcquirerID  string

	HTTPAddr       string    // partner and merchant API
	HTTPTLS        *TLSFiles // optional; usually TLS ends at the edge
	TerminalAddr   string    // mutual-TLS listener for terminals
	TerminalTLS    *TLSFiles // CA = terminal CA
	PixWebhookAddr string    // mutual-TLS listener for the PSP's webhooks
	PixWebhookTLS  *TLSFiles // CA = the PSP's client CA
	MetricsAddr    string    // internal listener for GET /metrics (Prometheus); empty disables it

	Routes             []Route
	CardPresentTimeout time.Duration

	PixBaseURL, PixTokenURL, PixClientID, PixClientSecret, PixKey string
	PixTLS                                                        *TLSFiles
	PixWebhookPublicURL                                           string
	PayoutBaseURL                                                 string

	VaultKEK, VaultFingerprintKey, CardDataDevKey, ReceiptsSecret []byte
	TransparencySecret                                            []byte // signs the daily public roots (kind 7715)
	TransparencyPadTo                                             int    // log padding granularity; 0 = 4096

	// Device attestation (docs/05 §2.4, §3.6). Configuring either set of roots turns on strict
	// attestation: devices must prove they are the genuine app on genuine hardware.
	AppAttestRoots, AppAttestAppID          string // PEM file of Apple's App Attestation Root CA; TEAMID.bundle
	AppAttestProduction                     bool
	AndroidAttestationRoots, AndroidPackage string   // PEM file of Google's hardware attestation roots; application ID
	AndroidSigningDigests                   [][]byte // SHA-256 of the app signing certificates

	// Receivables registrar (docs/07 §1.6): an adapter speaking internal/registrar's JSON
	// contract. The sandbox runs an in-memory registrar when it is not set.
	RegistrarURL     string
	PlatformDocument string // the platform's CNPJ, beneficiary of its assignments
	Relays           []string
	ClaimBase        string

	BootstrapTenant  string
	BootstrapCapital int64

	RatePerSecond, RateBurst, AuthFailuresPerMinute float64 // per replica; 0 = defaults
	TrustProxy                                      bool    // behind the edge: client IP from X-Forwarded-For
	MaxPaymentAmount                                int64   // centavos per payment intent; 0 = default
	PublicURL                                       string  // the API's external base URL; NIP-98 and DPoP sign it
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func hexEnv(k string) ([]byte, error) {
	v := os.Getenv(k)
	if v == "" {
		return nil, nil
	}
	b, err := hex.DecodeString(v)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", k, err)
	}
	return b, nil
}

func tlsEnv(prefix string) *TLSFiles {
	t := &TLSFiles{CA: os.Getenv(prefix + "_CA"), Cert: os.Getenv(prefix + "_CERT"), Key: os.Getenv(prefix + "_KEY"), ServerName: os.Getenv(prefix + "_SERVER_NAME")}
	if t.CA == "" && t.Cert == "" {
		return nil
	}
	return t
}

// Load reads the configuration from the environment.
func Load() (*Config, error) {
	c := &Config{
		Env: env("PLATFORM_ENV", Sandbox), DatabaseURL: os.Getenv("DATABASE_URL"), AcquirerID: env("ACQUIRER_ID", "12345678"),
		HTTPAddr: env("HTTP_ADDR", ":8080"), HTTPTLS: tlsEnv("HTTP_TLS"),
		TerminalAddr: os.Getenv("TERMINAL_ADDR"), TerminalTLS: tlsEnv("TERMINAL_TLS"),
		PixWebhookAddr: os.Getenv("PIX_WEBHOOK_ADDR"), PixWebhookTLS: tlsEnv("PIX_WEBHOOK_TLS"), MetricsAddr: os.Getenv("METRICS_ADDR"),
		PixBaseURL: os.Getenv("PIX_BASE_URL"), PixTokenURL: os.Getenv("PIX_TOKEN_URL"), PixClientID: os.Getenv("PIX_CLIENT_ID"),
		PixClientSecret: os.Getenv("PIX_CLIENT_SECRET"), PixKey: os.Getenv("PIX_KEY"), PixTLS: tlsEnv("PIX_TLS"),
		PixWebhookPublicURL: os.Getenv("PIX_WEBHOOK_PUBLIC_URL"), PayoutBaseURL: os.Getenv("PAYOUT_BASE_URL"),
		ClaimBase: env("RECEIPT_CLAIM_BASE", "https://r.goonerspay.example/c"), BootstrapTenant: os.Getenv("BOOTSTRAP_TENANT"),
	}
	if c.DatabaseURL == "" {
		return nil, errors.New("config: DATABASE_URL is required")
	}
	var err error
	if c.VaultKEK, err = hexEnv("VAULT_KEK_HEX"); err != nil {
		return nil, err
	}
	if c.VaultFingerprintKey, err = hexEnv("VAULT_FINGERPRINT_KEY_HEX"); err != nil {
		return nil, err
	}
	if c.CardDataDevKey, err = hexEnv("CARDDATA_DEV_KEY_HEX"); err != nil {
		return nil, err
	}
	if c.ReceiptsSecret, err = hexEnv("RECEIPTS_SECRET_HEX"); err != nil {
		return nil, err
	}
	if c.TransparencySecret, err = hexEnv("TRANSPARENCY_SECRET_HEX"); err != nil {
		return nil, err
	}
	if v := os.Getenv("TRANSPARENCY_PAD_TO"); v != "" {
		if c.TransparencyPadTo, err = strconv.Atoi(v); err != nil || c.TransparencyPadTo < 1 {
			return nil, fmt.Errorf("config: TRANSPARENCY_PAD_TO must be a positive number of leaves")
		}
	}
	c.AppAttestRoots, c.AppAttestAppID = os.Getenv("APPATTEST_ROOT_CA"), os.Getenv("APPATTEST_APP_ID")
	c.AppAttestProduction = os.Getenv("APPATTEST_ENVIRONMENT") == "production"
	c.AndroidAttestationRoots, c.AndroidPackage = os.Getenv("ANDROID_ATTESTATION_ROOTS"), env("ANDROID_PACKAGE", "br.com.gooners.pay")
	for _, d := range strings.Split(os.Getenv("ANDROID_SIGNING_DIGESTS"), ",") {
		if d = strings.TrimSpace(d); d == "" {
			continue
		}
		b, err := hex.DecodeString(strings.ReplaceAll(d, ":", "")) // keytool prints AA:BB:…
		if err != nil || len(b) != 32 {
			return nil, fmt.Errorf("config: ANDROID_SIGNING_DIGESTS are SHA-256 digests in hex, comma-separated")
		}
		c.AndroidSigningDigests = append(c.AndroidSigningDigests, b)
	}
	if (c.AppAttestRoots != "") != (c.AppAttestAppID != "") {
		return nil, fmt.Errorf("config: APPATTEST_ROOT_CA and APPATTEST_APP_ID go together")
	}
	if c.AndroidAttestationRoots != "" && len(c.AndroidSigningDigests) == 0 {
		return nil, fmt.Errorf("config: ANDROID_ATTESTATION_ROOTS needs ANDROID_SIGNING_DIGESTS")
	}
	c.RegistrarURL, c.PlatformDocument = os.Getenv("REGISTRAR_URL"), os.Getenv("PLATFORM_DOCUMENT")
	if r := os.Getenv("RELAYS"); r != "" {
		c.Relays = strings.Split(r, ",")
	}
	for name, dst := range map[string]*float64{"RATE_LIMIT_PER_SECOND": &c.RatePerSecond, "RATE_LIMIT_BURST": &c.RateBurst, "AUTH_FAILURES_PER_MINUTE": &c.AuthFailuresPerMinute} {
		if v := os.Getenv(name); v != "" {
			if *dst, err = strconv.ParseFloat(v, 64); err != nil || *dst <= 0 {
				return nil, fmt.Errorf("config: %s must be a positive number", name)
			}
		}
	}
	c.TrustProxy = os.Getenv("TRUST_PROXY") == "true"
	c.PublicURL = os.Getenv("PUBLIC_API_URL")
	if v := os.Getenv("MAX_PAYMENT_AMOUNT"); v != "" {
		if c.MaxPaymentAmount, err = strconv.ParseInt(v, 10, 64); err != nil || c.MaxPaymentAmount <= 0 {
			return nil, fmt.Errorf("config: MAX_PAYMENT_AMOUNT must be a positive number of centavos")
		}
	}
	if v := os.Getenv("BOOTSTRAP_CAPITAL"); v != "" {
		if c.BootstrapCapital, err = strconv.ParseInt(v, 10, 64); err != nil {
			return nil, fmt.Errorf("config: BOOTSTRAP_CAPITAL: %w", err)
		}
	}
	c.CardPresentTimeout = 10 * time.Second
	if v := os.Getenv("CARD_PRESENT_TIMEOUT"); v != "" {
		if c.CardPresentTimeout, err = time.ParseDuration(v); err != nil {
			return nil, fmt.Errorf("config: CARD_PRESENT_TIMEOUT: %w", err)
		}
	}
	if f := os.Getenv("ROUTES_FILE"); f != "" {
		b, err := os.ReadFile(f) // #nosec G304 G703 -- ROUTES_FILE is set by the operator
		if err != nil {
			return nil, fmt.Errorf("config: ROUTES_FILE: %w", err)
		}
		if err := json.Unmarshal(b, &c.Routes); err != nil {
			return nil, fmt.Errorf("config: ROUTES_FILE: %w", err)
		}
	}
	return c, c.Validate()
}

// Validate enforces the environment rules.
func (c *Config) Validate() error {
	switch c.Env {
	case Sandbox, Certification, Production:
	default:
		return fmt.Errorf("config: PLATFORM_ENV must be sandbox, certification or production")
	}
	if len(c.Routes) == 0 {
		return errors.New("config: at least one scheme route is required (ROUTES_FILE)")
	}
	strict := c.Env != Sandbox
	for _, r := range c.Routes {
		if r.Name == "" || len(r.Addrs) == 0 {
			return fmt.Errorf("config: route %q needs a name and addresses", r.Name)
		}
		if strict && r.TLS == nil {
			return fmt.Errorf("config: route %s: TLS is required outside the sandbox", r.Name)
		}
		if strict && r.DialectFile == "" && r.Dialect != "generic-1987-ascii" {
			return fmt.Errorf("config: route %s: outside the sandbox use a verified dialect file", r.Name)
		}
	}
	if strict && !strings.HasPrefix(c.PublicURL, "https://") {
		return errors.New("config: PUBLIC_API_URL (https) is required outside the sandbox: app logins and DPoP proofs sign the exact URL")
	}
	if c.BootstrapCapital > 0 && c.Env != Sandbox {
		return errors.New("config: BOOTSTRAP_CAPITAL is a sandbox convenience; fund the settlement account through treasury")
	}
	if c.Env == Production {
		switch {
		case len(c.VaultKEK) > 0:
			return errors.New("config: production cannot use VAULT_KEK_HEX (a software KEK); wire the HSM/KMS KEK adapter")
		case len(c.CardDataDevKey) > 0:
			return errors.New("config: production cannot use the development card decryptor; wire the payment HSM adapter")
		case len(c.ReceiptsSecret) > 0:
			return errors.New("config: production cannot hold the receipts key in process memory; wire the enclave signer")
		case len(c.TransparencySecret) > 0:
			return errors.New("config: production cannot hold the transparency key in process memory; wire the enclave signer")
		case c.RegistrarURL == "" || c.PlatformDocument == "":
			return errors.New("config: production registers receivables before any advance: set REGISTRAR_URL and PLATFORM_DOCUMENT")
		case c.AppAttestRoots == "" || c.AndroidAttestationRoots == "":
			return errors.New("config: production verifies device attestation: set APPATTEST_ROOT_CA/APPATTEST_APP_ID and ANDROID_ATTESTATION_ROOTS/ANDROID_SIGNING_DIGESTS")
		}
		return errors.New("config: production needs the HSM, payment-HSM and enclave adapters described in payments/integration/README.md, which this reference implementation leaves as interfaces")
	}
	if len(c.VaultKEK) != 32 || len(c.VaultFingerprintKey) < 32 {
		return errors.New("config: VAULT_KEK_HEX (32 bytes) and VAULT_FINGERPRINT_KEY_HEX (≥ 32 bytes) are required")
	}
	if len(c.CardDataDevKey) != 32 {
		return errors.New("config: CARDDATA_DEV_KEY_HEX (32 bytes) is required for terminal data outside production")
	}
	if c.PixBaseURL != "" && (c.PixTLS == nil || c.PixClientID == "" || c.PixKey == "") {
		return errors.New("config: Pix needs PIX_TLS_CERT/KEY/CA, PIX_CLIENT_ID/SECRET and PIX_KEY (API Pix is mutual TLS)")
	}
	if c.PixWebhookAddr != "" && (c.PixWebhookTLS == nil || c.PixWebhookTLS.CA == "") {
		return errors.New("config: the Pix webhook listener needs PIX_WEBHOOK_TLS_CERT/KEY and the PSP's CA in PIX_WEBHOOK_TLS_CA")
	}
	return nil
}
