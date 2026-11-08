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
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/travelrule"
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

// OperatorSSO is how operators are identified (cmd/platform/operator.go): the identity
// provider's issuer and the operators' client (OPERATOR_OIDC_CLIENT_SECRET only for providers
// that want one even for the device grant), and who may operate: e-mail domains, a group.
type OperatorSSO struct {
	Issuer, ClientID, ClientSecret string
	Domains                        []string
	Group                          string
	Production                     bool
}

// ReadOperatorSSO reads the operator identity settings alone: operator commands need no other
// configuration.
func ReadOperatorSSO() OperatorSSO {
	var domains []string
	for _, d := range strings.Split(os.Getenv("OPERATOR_OIDC_DOMAINS"), ",") {
		if d = strings.ToLower(strings.TrimSpace(d)); d != "" {
			domains = append(domains, d)
		}
	}
	return OperatorSSO{Issuer: os.Getenv("OPERATOR_OIDC_ISSUER"), ClientID: os.Getenv("OPERATOR_OIDC_CLIENT_ID"), ClientSecret: os.Getenv("OPERATOR_OIDC_CLIENT_SECRET"),
		Domains: domains, Group: os.Getenv("OPERATOR_OIDC_GROUP"), Production: os.Getenv("PLATFORM_ENV") == Production}
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

	// Key custody (integration/hsm.md). KEKProvider is local (VAULT_KEK_HEX: the sandbox), aws-kms
	// or gcp-kms, with KEKKeyID. Card data from terminals: the phones' development format
	// (CARDDATA_DEV_KEY_HEX), readers' TDES DUKPT with the BDK in memory (CARDDATA_BDK_HEX: the
	// sandbox and certification), or DUKPT in AWS Payment Cryptography (CARDDATA_HSM_KEY_ARN).
	// SignerURL is the signer service that holds the receipts and transparency keys; SignerTLS
	// is the platform's client certificate and the signer's CA.
	KEKProvider, KEKKeyID, AWSRegion string
	CardDataBDK                      []byte
	CardDataHSMKeyARN                string
	SignerURL                        string
	SignerTLS                        *TLSFiles

	// Terminal CA (docs/05 §2.4): signs terminals' client certificates from their CSRs.
	// TerminalCACert is its certificate (also in TERMINAL_TLS_CA, so the terminal listener
	// accepts what it signs); its key is a PEM file outside production (TerminalCAKey) or an
	// AWS KMS ECC_NIST_P256 signing key (TerminalCAKMSKeyID). Unset: an external terminal PKI
	// issues certificates and terminals are registered by their SHA-256.
	TerminalCACert, TerminalCAKey, TerminalCAKMSKeyID string

	// Partner tokens (docs/02 §3.1): the public TLS listener asks clients for a certificate
	// (HTTP_TLS_CLIENT_CERTS=request) so certificate-bound tokens can be issued and checked;
	// behind a TLS-terminating proxy, ClientCertHeader carries it (with TRUST_PROXY).
	HTTPRequestClientCerts bool
	ClientCertHeader       string
	TransparencyPadTo      int // log padding granularity; 0 = 4096

	// Device attestation (docs/05 §2.4, §3.6). Configuring either set of roots turns on strict
	// attestation: devices must prove they are the genuine app on genuine hardware.
	AppAttestRoots, AppAttestAppID          string // PEM file of Apple's App Attestation Root CA; TEAMID.bundle
	AppAttestProduction                     bool
	AndroidAttestationRoots, AndroidPackage string   // PEM file of Google's hardware attestation roots; application ID
	AndroidSigningDigests                   [][]byte // SHA-256 of the app signing certificates
	// AndroidAttestationStatus is where Google's certificate status list is read (URL or
	// file); "off" skips the check (refused in production).
	AndroidAttestationStatus string

	// Receivables registrar (docs/07 §1.6): an adapter speaking internal/registrar's JSON
	// contract. The sandbox runs an in-memory registrar when it is not set.
	RegistrarURL     string
	PlatformDocument string // the platform's CNPJ, beneficiary of its assignments
	// Digital assets and international accounts (docs/09). Exchanges lists the crypto venues
	// (binance, kraken, coinbase; the sandbox runs its own). FXProvider is wise; the sandbox
	// runs its own. BrokerURL is a B3 broker adapter (the sandbox runs its own broker).
	Exchanges                                      []string
	BinanceKey, BinanceSecret                      string
	KrakenKey, KrakenSecret                        string
	KrakenWithdrawKeys                             map[string]string
	CoinbaseKeyName, CoinbaseKeyPEM                string
	FXProvider, WiseToken, WiseProfile, WiseURL    string
	BrokerURL, BrokerToken, BrokerName, BrapiToken string
	// CryptoAuthorization and FXAuthorization name what lets the platform offer them in
	// production: its own BCB authorization or the licensed partner it acts for.
	CryptoAuthorization, FXAuthorization                                      string
	CryptoFeeBps, CryptoSpreadBps, FXFeeBps, FXSpreadBps, IOFOutBps, IOFInBps int
	// SanctionsLists are sanctions lists (paths or https URLs: OFAC's SDN.CSV, which holds
	// names and addresses, or one address per line); ScreeningURL is a screening provider's
	// adapter. New merchants' names are screened at KYB (docs/04 §2.5), and crypto withdrawals,
	// deposit senders and travel-rule names against them (docs/09 §6.1).
	SanctionsLists               []string
	ScreeningURL, ScreeningToken string
	// KYB (docs/04 §2.5). KYBRegistry is where new merchants' CNPJ registrations are read:
	// brasilapi (BrasilAPI's open Receita Federal data, or the server at KYBRegistryURL with
	// the same answer, such as a self-hosted minhareceita) or sandbox (test companies).
	// KYBAutoApprove (KYB_AUTO_APPROVE=on) activates a merchant whose check comes back
	// approved; otherwise an operator does, with the result in hand.
	KYBRegistry, KYBRegistryURL string
	KYBAutoApprove              bool
	// Operators are identified through the company's identity provider (OpenID Connect).
	Operators OperatorSSO
	// TSAURLs are the RFC 3161 time-stamping authorities that date each daily transparency
	// root (an ICP-Brasil ACT, DigiCert, Sectigo...); TSARoots is a PEM bundle of their roots
	// (empty: the system's roots).
	TSAURLs  []string
	TSARoots string
	// The audit trail's daily copies (integration point 33): an S3 bucket created with Object
	// Lock (AWS_REGION), a key prefix, and an endpoint only for S3-compatible stores.
	AuditExportBucket, AuditExportPrefix, AuditExportEndpoint string
	// ReportingName and ReportingURL identify the platform in the DeCripto (record 0000).
	ReportingName, ReportingURL string
	// SenderLookups find who sent each crypto deposit, per network (docs/09 §6.5): an
	// Esplora URL for bitcoin, JSON-RPC nodes for ethereum and polygon, a full node's HTTP
	// API for tron. SenderLookupURL is a provider's adapter for the networks left (and
	// solana). Without a lookup for a network, its deposits are held for compliance.
	SenderLookups                      map[string]string
	TronAPIKey                         string
	SenderLookupURL, SenderLookupToken string
	// TravelRuleURL is the travel-rule network's adapter (docs/09 §6.6); TravelRuleSecret
	// ("whsec_…") verifies the messages it posts in. TravelRuleThreshold (centavos; 0 = every
	// withdrawal) and TravelRuleReview (deposits without originator data) set the values.
	TravelRuleURL, TravelRuleToken, TravelRuleSecret string
	TravelRuleThreshold, TravelRuleReview            int64
	// TravelRuleRetention is how long the travel rule's personal data is kept (default ten years).
	TravelRuleRetention time.Duration
	// PlatformLEI is the platform's Legal Entity Identifier, when it has one.
	PlatformLEI string
	// RiskMode is how the fraud shield acts (docs/07 §3): enforce, shadow or off.
	RiskMode string
	Relays   []string
	// RelaysPublic are the relay addresses customers' browsers use (NIP-05, the claim page),
	// when the platform publishes through private ones; the same as Relays by default.
	RelaysPublic []string
	ClaimBase    string

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

// Load reads the configuration from the environment and enforces the environment's rules.
func Load() (*Config, error) {
	c, err := Read()
	if err != nil {
		return nil, err
	}
	return c, c.Validate()
}

// Read reads the configuration from the environment without the environment's rules: what
// the integrations report needs to describe an incomplete setup.
func Read() (*Config, error) {
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
	c.KEKProvider, c.KEKKeyID = env("KEK_PROVIDER", "local"), os.Getenv("KEK_KEY_ID")
	if c.AWSRegion = os.Getenv("AWS_REGION"); c.AWSRegion == "" {
		c.AWSRegion = os.Getenv("AWS_DEFAULT_REGION")
	}
	if c.CardDataBDK, err = hexEnv("CARDDATA_BDK_HEX"); err != nil {
		return nil, err
	}
	c.CardDataHSMKeyARN = os.Getenv("CARDDATA_HSM_KEY_ARN")
	c.SignerURL, c.SignerTLS = os.Getenv("SIGNER_URL"), tlsEnv("SIGNER_TLS")
	c.TerminalCACert, c.TerminalCAKey, c.TerminalCAKMSKeyID = os.Getenv("TERMINAL_CA_CERT"), os.Getenv("TERMINAL_CA_KEY"), os.Getenv("TERMINAL_CA_KMS_KEY_ID")
	c.HTTPRequestClientCerts, c.ClientCertHeader = os.Getenv("HTTP_TLS_CLIENT_CERTS") == "request", os.Getenv("CLIENT_CERT_HEADER")
	if v := os.Getenv("TRANSPARENCY_PAD_TO"); v != "" {
		if c.TransparencyPadTo, err = strconv.Atoi(v); err != nil || c.TransparencyPadTo < 1 {
			return nil, fmt.Errorf("config: TRANSPARENCY_PAD_TO must be a positive number of leaves")
		}
	}
	c.AppAttestRoots, c.AppAttestAppID = os.Getenv("APPATTEST_ROOT_CA"), os.Getenv("APPATTEST_APP_ID")
	c.AppAttestProduction = os.Getenv("APPATTEST_ENVIRONMENT") == "production"
	c.AndroidAttestationRoots, c.AndroidPackage = os.Getenv("ANDROID_ATTESTATION_ROOTS"), env("ANDROID_PACKAGE", "br.com.gooners.pay")
	c.AndroidAttestationStatus = env("ANDROID_ATTESTATION_STATUS", "https://android.googleapis.com/attestation/status")
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
	for _, x := range strings.Split(os.Getenv("EXCHANGES"), ",") {
		if x = strings.TrimSpace(x); x != "" {
			c.Exchanges = append(c.Exchanges, x)
		}
	}
	c.BinanceKey, c.BinanceSecret = os.Getenv("BINANCE_API_KEY"), os.Getenv("BINANCE_SECRET_KEY")
	c.KrakenKey, c.KrakenSecret = os.Getenv("KRAKEN_API_KEY"), os.Getenv("KRAKEN_SECRET_KEY")
	c.KrakenWithdrawKeys = map[string]string{}
	for _, kv := range strings.Split(os.Getenv("KRAKEN_WITHDRAW_KEYS"), ";") { // address=key name;…
		if a, k, ok := strings.Cut(kv, "="); ok {
			c.KrakenWithdrawKeys[strings.TrimSpace(a)] = strings.TrimSpace(k)
		}
	}
	c.CoinbaseKeyName, c.CoinbaseKeyPEM = os.Getenv("COINBASE_KEY_NAME"), os.Getenv("COINBASE_PRIVATE_KEY")
	c.FXProvider, c.WiseToken, c.WiseProfile, c.WiseURL = os.Getenv("FX_PROVIDER"), os.Getenv("WISE_TOKEN"), os.Getenv("WISE_PROFILE_ID"), os.Getenv("WISE_BASE_URL")
	c.BrokerURL, c.BrokerToken, c.BrokerName, c.BrapiToken = os.Getenv("BROKER_URL"), os.Getenv("BROKER_TOKEN"), env("BROKER_NAME", "broker"), os.Getenv("BRAPI_TOKEN")
	c.CryptoAuthorization, c.FXAuthorization = os.Getenv("CRYPTO_AUTHORIZATION"), os.Getenv("FX_AUTHORIZATION")
	for _, x := range strings.Split(os.Getenv("SANCTIONS_LISTS"), ",") {
		if x = strings.TrimSpace(x); x != "" {
			c.SanctionsLists = append(c.SanctionsLists, x)
		}
	}
	c.ScreeningURL, c.ScreeningToken = os.Getenv("SCREENING_URL"), os.Getenv("SCREENING_TOKEN")
	c.KYBRegistry, c.KYBRegistryURL, c.KYBAutoApprove = os.Getenv("KYB_REGISTRY"), os.Getenv("KYB_REGISTRY_URL"), os.Getenv("KYB_AUTO_APPROVE") == "on"
	c.Operators = ReadOperatorSSO()
	for _, u := range strings.Split(os.Getenv("TSA_URLS"), ",") {
		if u = strings.TrimSpace(u); u != "" {
			c.TSAURLs = append(c.TSAURLs, u)
		}
	}
	c.TSARoots = os.Getenv("TSA_ROOTS")
	c.AuditExportBucket, c.AuditExportPrefix, c.AuditExportEndpoint = os.Getenv("AUDIT_EXPORT_BUCKET"), os.Getenv("AUDIT_EXPORT_PREFIX"), os.Getenv("AUDIT_EXPORT_ENDPOINT")
	c.ReportingName, c.ReportingURL = env("REPORTING_NAME", "goonersPAY"), os.Getenv("REPORTING_URL")
	c.SenderLookups = map[string]string{}
	for network, k := range map[string]string{"bitcoin": "BITCOIN_ESPLORA_URL", "ethereum": "ETHEREUM_RPC_URL", "polygon": "POLYGON_RPC_URL", "tron": "TRON_API_URL"} {
		if v := os.Getenv(k); v != "" {
			c.SenderLookups[network] = v
		}
	}
	c.TronAPIKey, c.SenderLookupURL, c.SenderLookupToken = os.Getenv("TRON_API_KEY"), os.Getenv("SENDER_LOOKUP_URL"), os.Getenv("SENDER_LOOKUP_TOKEN")
	c.TravelRuleURL, c.TravelRuleToken, c.TravelRuleSecret = os.Getenv("TRAVEL_RULE_URL"), os.Getenv("TRAVEL_RULE_TOKEN"), os.Getenv("TRAVEL_RULE_INBOUND_SECRET")
	c.PlatformLEI = os.Getenv("PLATFORM_LEI")
	if v := os.Getenv("TRAVEL_RULE_RETENTION_YEARS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 5 || n > 30 {
			return nil, errors.New("config: TRAVEL_RULE_RETENTION_YEARS is between 5 (Law 9.613/1998, art. 10) and 30")
		}
		c.TravelRuleRetention = time.Duration(n) * 365 * 24 * time.Hour
	}
	for name, dst := range map[string]*int64{"TRAVEL_RULE_THRESHOLD_BRL": &c.TravelRuleThreshold, "TRAVEL_RULE_REVIEW_BRL": &c.TravelRuleReview} {
		if v := os.Getenv(name); v != "" {
			n, err := strconv.ParseFloat(v, 64)
			if err != nil || n < 0 || n > 1e9 {
				return nil, fmt.Errorf("config: %s is an amount in reais", name)
			}
			*dst = int64(n*100 + 0.5)
		}
	}
	for name, dst := range map[string]*int{"CRYPTO_FEE_BPS": &c.CryptoFeeBps, "CRYPTO_SPREAD_BPS": &c.CryptoSpreadBps, "FX_FEE_BPS": &c.FXFeeBps,
		"FX_SPREAD_BPS": &c.FXSpreadBps, "IOF_FX_OUT_BPS": &c.IOFOutBps, "IOF_FX_IN_BPS": &c.IOFInBps} {
		if v := os.Getenv(name); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 || n > 2000 {
				return nil, fmt.Errorf("config: %s is basis points between 0 and 2000", name)
			}
			*dst = n
		}
	}
	switch c.RiskMode = env("RISK_MODE", "enforce"); c.RiskMode {
	case "enforce", "shadow", "off":
	default:
		return nil, fmt.Errorf("config: RISK_MODE must be enforce, shadow or off")
	}
	if r := os.Getenv("RELAYS"); r != "" {
		c.Relays = strings.Split(r, ",")
	}
	c.RelaysPublic = c.Relays
	if r := os.Getenv("RELAYS_PUBLIC"); r != "" {
		c.RelaysPublic = strings.Split(r, ",")
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
	return c, nil
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
	// In every environment: a half-configured PSP connection fails at start, not at the first sale.
	if c.PixBaseURL != "" && (c.PixTLS == nil || c.PixClientID == "" || c.PixKey == "") {
		return errors.New("config: Pix needs PIX_TLS_CERT/KEY/CA, PIX_CLIENT_ID/SECRET and PIX_KEY (API Pix is mutual TLS)")
	}
	if c.PixWebhookAddr != "" && (c.PixWebhookTLS == nil || c.PixWebhookTLS.CA == "") {
		return errors.New("config: the Pix webhook listener needs PIX_WEBHOOK_TLS_CERT/KEY and the PSP's CA in PIX_WEBHOOK_TLS_CA")
	}
	switch c.KEKProvider {
	case "", "local":
	case "aws-kms":
		if c.KEKKeyID == "" || c.AWSRegion == "" {
			return errors.New("config: KEK_PROVIDER=aws-kms needs KEK_KEY_ID (the key's id, ARN or alias) and AWS_REGION")
		}
	case "gcp-kms":
		if !strings.HasPrefix(c.KEKKeyID, "projects/") {
			return errors.New("config: KEK_PROVIDER=gcp-kms needs KEK_KEY_ID, the key's resource name (projects/…/cryptoKeys/…)")
		}
	default:
		return fmt.Errorf("config: KEK_PROVIDER %q: use local, aws-kms or gcp-kms", c.KEKProvider)
	}
	switch {
	case len(c.CardDataBDK) != 0 && len(c.CardDataBDK) != 16:
		return errors.New("config: CARDDATA_BDK_HEX is a double-length TDES key (16 bytes)")
	case len(c.CardDataBDK) != 0 && c.CardDataHSMKeyARN != "":
		return errors.New("config: DUKPT data goes either to the payment HSM (CARDDATA_HSM_KEY_ARN) or to the in-memory BDK (CARDDATA_BDK_HEX), not both")
	case c.CardDataHSMKeyARN != "" && c.AWSRegion == "":
		return errors.New("config: CARDDATA_HSM_KEY_ARN needs AWS_REGION")
	case c.SignerURL != "" && (!strings.HasPrefix(c.SignerURL, "https://") || c.SignerTLS == nil || c.SignerTLS.Cert == "" || c.SignerTLS.CA == ""):
		return errors.New("config: the signer is reached over mutual TLS: SIGNER_URL (https) and SIGNER_TLS_CERT/KEY/CA")
	case c.SignerURL != "" && (len(c.ReceiptsSecret) > 0 || len(c.TransparencySecret) > 0):
		return errors.New("config: with SIGNER_URL the receipts and transparency keys live in the signer: unset RECEIPTS_SECRET_HEX and TRANSPARENCY_SECRET_HEX")
	case (c.TerminalCAKey != "" || c.TerminalCAKMSKeyID != "") && c.TerminalCACert == "":
		return errors.New("config: the terminal CA needs its certificate: set TERMINAL_CA_CERT")
	case c.TerminalCACert != "" && (c.TerminalCAKey == "") == (c.TerminalCAKMSKeyID == ""):
		return errors.New("config: the terminal CA's key is either a PEM file (TERMINAL_CA_KEY) or a KMS key (TERMINAL_CA_KMS_KEY_ID): set one")
	case c.TerminalCAKMSKeyID != "" && c.AWSRegion == "":
		return errors.New("config: TERMINAL_CA_KMS_KEY_ID needs AWS_REGION")
	case c.KYBRegistry != "" && c.KYBRegistry != "brasilapi" && c.KYBRegistry != "sandbox":
		return fmt.Errorf("config: KYB_REGISTRY %q: use brasilapi (with KYB_REGISTRY_URL for a self-hosted server) or sandbox", c.KYBRegistry)
	case c.KYBRegistryURL != "" && !strings.HasPrefix(c.KYBRegistryURL, "https://") && c.Env != Sandbox:
		return errors.New("config: KYB_REGISTRY_URL must be an https address outside the sandbox")
	case c.Operators.Issuer != "" && (c.Operators.ClientID == "" || !strings.HasPrefix(c.Operators.Issuer, "https://")):
		return errors.New("config: operator SSO needs OPERATOR_OIDC_ISSUER (https) and OPERATOR_OIDC_CLIENT_ID")
	}
	if c.AuditExportBucket != "" && c.AWSRegion == "" {
		return errors.New("config: AUDIT_EXPORT_BUCKET needs AWS_REGION")
	}
	for _, u := range c.TSAURLs {
		// Time-stamp tokens are signed: plain http (as DigiCert serves it) loses nothing.
		if !strings.HasPrefix(u, "https://") && !strings.HasPrefix(u, "http://") {
			return fmt.Errorf("config: TSA_URLS: %q is not an http(s) URL", u)
		}
	}
	if c.BootstrapCapital > 0 && c.Env != Sandbox {
		return errors.New("config: BOOTSTRAP_CAPITAL is a sandbox convenience; fund the settlement account through treasury")
	}
	if c.Env == Production {
		switch {
		case c.KEKProvider == "" || c.KEKProvider == "local" || len(c.VaultKEK) > 0:
			return errors.New("config: production keeps the KEK in a KMS: set KEK_PROVIDER (aws-kms or gcp-kms) and KEK_KEY_ID, and unset VAULT_KEK_HEX (a software KEK)")
		case len(c.CardDataDevKey) > 0 || len(c.CardDataBDK) > 0:
			return errors.New("config: production decrypts card data only in the payment HSM: unset the development card decryptor (CARDDATA_DEV_KEY_HEX) and the in-memory BDK (CARDDATA_BDK_HEX)")
		case c.CardDataHSMKeyARN == "":
			return errors.New("config: production decrypts readers' DUKPT data in the payment HSM: set CARDDATA_HSM_KEY_ARN (AWS Payment Cryptography) and AWS_REGION")
		case len(c.ReceiptsSecret) > 0 || len(c.TransparencySecret) > 0:
			return errors.New("config: production cannot hold the receipts key or the transparency key in process memory: use the signer service (SIGNER_URL)")
		case c.SignerURL == "":
			return errors.New("config: production signs receipts and roots through the signer service: set SIGNER_URL and SIGNER_TLS_CERT/KEY/CA")
		case c.TerminalCAKey != "":
			return errors.New("config: production keeps the terminal CA key in a KMS: set TERMINAL_CA_KMS_KEY_ID and unset TERMINAL_CA_KEY")
		case c.Operators.Issuer == "":
			return errors.New("config: production identifies operators through the company's identity provider: set OPERATOR_OIDC_ISSUER, OPERATOR_OIDC_CLIENT_ID and OPERATOR_OIDC_DOMAINS")
		case len(c.Operators.Domains) == 0 && c.Operators.Group == "":
			return errors.New("config: OPERATOR_OIDC_DOMAINS or OPERATOR_OIDC_GROUP must limit who operates production; any account the identity provider knows would do otherwise")
		case c.AuditExportBucket == "":
			return errors.New("config: production copies the audit trail to WORM storage every day: set AUDIT_EXPORT_BUCKET (an S3 bucket created with Object Lock) and AWS_REGION")
		case c.KYBRegistry != "brasilapi":
			return errors.New("config: production checks every new merchant's CNPJ at the Receita Federal before it sells: set KYB_REGISTRY=brasilapi (KYB_REGISTRY_URL for a self-hosted minhareceita)")
		case len(c.SanctionsLists) == 0:
			return errors.New("config: production screens merchants' names at onboarding (and, with crypto, addresses, senders and travel-rule names): set SANCTIONS_LISTS with OFAC's SDN.CSV and the UN Security Council list")
		case c.RegistrarURL == "" || c.PlatformDocument == "":
			return errors.New("config: production registers receivables before any advance: set REGISTRAR_URL and PLATFORM_DOCUMENT")
		case c.AppAttestRoots == "" || c.AndroidAttestationRoots == "":
			return errors.New("config: production verifies device attestation: set APPATTEST_ROOT_CA/APPATTEST_APP_ID and ANDROID_ATTESTATION_ROOTS/ANDROID_SIGNING_DIGESTS")
		case c.AndroidAttestationStatus == "off":
			return errors.New("config: production checks Google's attestation status list: unset ANDROID_ATTESTATION_STATUS or point it at a mirror")
		case c.PixBaseURL == "" || c.PixWebhookAddr == "":
			return errors.New("config: production takes Pix through the PSP's API Pix and hears of payments through its webhook: set PIX_BASE_URL with its credentials, and PIX_WEBHOOK_ADDR")
		case c.PayoutBaseURL == "":
			return errors.New("config: production pays merchants out by Pix: set PAYOUT_BASE_URL (the bank's transfer API, through the pixout contract)")
		case len(c.Relays) == 0:
			return errors.New("config: production publishes every receipt for the customer's QR: set RELAYS")
		case !strings.HasPrefix(c.ClaimBase, "https://") || strings.Contains(c.ClaimBase, "goonerspay.example"):
			return errors.New("config: production prints a receipt QR on every sale: host the claim page (docs/03 §3.2) and set RECEIPT_CLAIM_BASE to its https address")
		case slices.Contains(c.Exchanges, "sandbox") || c.FXProvider == "sandbox":
			return errors.New("config: the sandbox exchange and FX provider do not run in production")
		case len(c.Exchanges) > 0 && c.CryptoAuthorization == "":
			return errors.New("config: crypto in production needs CRYPTO_AUTHORIZATION: the BCB authorization (Res. BCB 519/2025) or the authorized provider the platform acts for")
		case len(c.Exchanges) > 0 && len(c.SanctionsLists) == 0:
			// A screening provider's contract answers for addresses only; the names in
			// travel-rule data are screened against a list that holds names (docs/09 §6.6).
			return errors.New("config: crypto in production screens withdrawal addresses and the names in travel-rule data: set SANCTIONS_LISTS with OFAC's SDN.CSV (SCREENING_URL may add a provider for addresses)")
		case len(c.Exchanges) > 0 && (c.PlatformDocument == "" || c.ReportingURL == ""):
			return errors.New("config: crypto in production files the DeCripto, whose record 0000 names the platform: set PLATFORM_DOCUMENT (the CNPJ) and REPORTING_URL (its website)")
		case len(c.Exchanges) > 0 && c.SenderLookupURL == "" && len(c.SenderLookups) < 4:
			return errors.New("config: crypto in production screens who sends each deposit: set BITCOIN_ESPLORA_URL, ETHEREUM_RPC_URL, POLYGON_RPC_URL and TRON_API_URL, or SENDER_LOOKUP_URL (which also covers solana)")
		case len(c.Exchanges) > 0 && (c.TravelRuleURL == "" || c.TravelRuleSecret == ""):
			return errors.New("config: crypto in production carries the travel rule (Res. BCB 520/2025): set TRAVEL_RULE_URL and TRAVEL_RULE_INBOUND_SECRET")
		case c.PlatformLEI != "" && !travelrule.ValidLEI(c.PlatformLEI):
			return errors.New("config: PLATFORM_LEI is not a valid LEI")
		case c.FXProvider != "" && c.FXAuthorization == "":
			return errors.New("config: foreign exchange in production needs FX_AUTHORIZATION: the institution authorized for câmbio that carries the operations")
		case c.RiskMode == "off":
			return errors.New("config: production keeps the fraud shield on: RISK_MODE enforce, or shadow while a new policy is trialled")
		}
	}
	if (c.KEKProvider == "" || c.KEKProvider == "local") && len(c.VaultKEK) != 32 {
		return errors.New("config: VAULT_KEK_HEX (32 bytes) is required with the local KEK (KEK_PROVIDER=local)")
	}
	if len(c.VaultFingerprintKey) < 32 {
		return errors.New("config: VAULT_FINGERPRINT_KEY_HEX (≥ 32 bytes) is required")
	}
	if len(c.CardDataDevKey) != 0 && len(c.CardDataDevKey) != 32 {
		return errors.New("config: CARDDATA_DEV_KEY_HEX is 32 bytes")
	}
	if len(c.CardDataDevKey) == 0 && len(c.CardDataBDK) == 0 && c.CardDataHSMKeyARN == "" {
		return errors.New("config: terminal data needs a decryptor: CARDDATA_DEV_KEY_HEX, CARDDATA_BDK_HEX or CARDDATA_HSM_KEY_ARN")
	}
	return nil
}
