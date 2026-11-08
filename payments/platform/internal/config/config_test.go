package config

import (
	"strings"
	"testing"
)

func base() *Config {
	k := make([]byte, 32)
	return &Config{Env: Sandbox, DatabaseURL: "postgres://x", VaultKEK: k, VaultFingerprintKey: k, CardDataDevKey: k,
		Routes: []Route{{Name: "sponsor", Addrs: []string{"127.0.0.1:8583"}, Dialect: "generic-1987-ascii"}}}
}

func TestSandboxAcceptsSimulators(t *testing.T) {
	if err := base().Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestCertificationNeedsTLSAndVerifiedDialects(t *testing.T) {
	c := base()
	c.Env = Certification
	if err := c.Validate(); err == nil || !strings.Contains(err.Error(), "TLS") {
		t.Fatalf("plain TCP accepted outside the sandbox: %v", err)
	}
	c.Routes[0].TLS = &TLSFiles{CA: "ca.pem"}
	c.Routes[0].Dialect = "visa-base1-template"
	if err := c.Validate(); err == nil || !strings.Contains(err.Error(), "dialect") {
		t.Fatalf("template dialect accepted: %v", err)
	}
	c.Routes[0].Dialect, c.Routes[0].DialectFile = "", "/etc/platform/visa-base1.json"
	c.BootstrapCapital = 1
	if err := c.Validate(); err == nil {
		t.Fatal("sandbox capital accepted in certification")
	}
	c.BootstrapCapital = 0
	if err := c.Validate(); err == nil || !strings.Contains(err.Error(), "PUBLIC_API_URL") {
		t.Fatalf("no public URL accepted outside the sandbox: %v", err)
	}
	c.PublicURL = "http://api.goonerspay.example"
	if err := c.Validate(); err == nil {
		t.Fatal("a plain-http public URL accepted outside the sandbox")
	}
	c.PublicURL = "https://api.goonerspay.example"
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestProductionRefusesSoftwareKeys(t *testing.T) {
	c := base()
	c.Env = Production
	c.PublicURL = "https://api.goonerspay.example"
	c.Routes[0].TLS = &TLSFiles{CA: "ca.pem"}
	c.Routes[0].DialectFile = "/etc/platform/sponsor.json"
	c.ReceiptsSecret = make([]byte, 32)
	for _, step := range []struct {
		want string
		fix  func(*Config)
	}{
		{"KEK_PROVIDER", func(c *Config) {
			c.KEKProvider, c.KEKKeyID, c.AWSRegion = "aws-kms", "alias/goonerspay-vault", "sa-east-1"
		}},
		{"VAULT_KEK_HEX", func(c *Config) { c.VaultKEK = nil }},
		{"development card decryptor", func(c *Config) { c.CardDataDevKey = nil }},
		{"CARDDATA_HSM_KEY_ARN", func(c *Config) { c.CardDataHSMKeyARN = "arn:aws:payment-cryptography:sa-east-1:111122223333:key/bdk" }},
		{"receipts key", func(c *Config) { c.ReceiptsSecret = nil }},
		{"SIGNER_URL", productionSigner},
		{"registers receivables", func(c *Config) {
			c.RegistrarURL, c.PlatformDocument = "https://registrar-adapter.internal", "99999999000191"
		}},
		{"device attestation", func(c *Config) {
			c.AppAttestRoots, c.AppAttestAppID = "/etc/platform/apple-app-attest-root.pem", "ABCDE12345.br.com.gooners.pay"
			c.AndroidAttestationRoots = "/etc/platform/google-attestation-roots.pem"
			c.RiskMode, c.AndroidAttestationStatus = "off", "off"
		}},
		{"status list", func(c *Config) { c.AndroidAttestationStatus = "https://android.googleapis.com/attestation/status" }},
		{"PIX_BASE_URL", func(c *Config) { productionPix(c); c.PayoutBaseURL, c.Relays, c.ClaimBase = "", nil, "" }},
		{"PAYOUT_BASE_URL", func(c *Config) { c.PayoutBaseURL = "https://psp.example/pagamentos" }},
		{"RELAYS", func(c *Config) { c.Relays = []string{"wss://relay.goonerspay.com.br"} }},
		{"RECEIPT_CLAIM_BASE", func(c *Config) { c.ClaimBase = "https://r.goonerspay.com.br/c" }},
		{"fraud shield", func(c *Config) { c.RiskMode = "shadow" }},
	} {
		if err := c.Validate(); err == nil || !strings.Contains(err.Error(), step.want) {
			t.Fatalf("want an error about %q, got %v", step.want, err)
		}
		step.fix(c)
	}
	// With the KMS, the payment HSM and the signer, production starts.
	if err := c.Validate(); err != nil {
		t.Fatalf("a complete production configuration refused: %v", err)
	}
}

// productionKeys sets the three key adapters production requires.
func productionKeys(c *Config) {
	c.KEKProvider, c.KEKKeyID, c.AWSRegion, c.VaultKEK = "aws-kms", "alias/goonerspay-vault", "sa-east-1", nil
	c.CardDataDevKey, c.CardDataHSMKeyARN = nil, "arn:aws:payment-cryptography:sa-east-1:111122223333:key/bdk"
	c.ReceiptsSecret, c.TransparencySecret = nil, nil
	productionSigner(c)
}

func productionSigner(c *Config) {
	c.SignerURL, c.SignerTLS = "https://signer.internal:8446", &TLSFiles{CA: "signer-ca.pem", Cert: "platform.pem", Key: "platform.key"}
}

// productionPix fills the PSP, payout, relay and claim-page settings production requires.
func productionPix(c *Config) {
	tls := &TLSFiles{CA: "psp-ca.pem", Cert: "c.pem", Key: "k.pem"}
	c.PixBaseURL, c.PixTLS, c.PixClientID, c.PixKey = "https://psp.example/api/v2", tls, "client", "12345678000195"
	c.PixWebhookAddr, c.PixWebhookTLS = ":8443", tls
	c.PayoutBaseURL, c.Relays, c.ClaimBase = "https://psp.example/pagamentos", []string{"wss://relay.goonerspay.com.br"}, "https://r.goonerspay.com.br/c"
}

func TestProductionDigitalAssetsNeedAuthorization(t *testing.T) {
	prod := func() *Config {
		c := base()
		productionPix(c)
		c.Env, c.PublicURL = Production, "https://api.goonerspay.example"
		c.Routes[0].TLS, c.Routes[0].DialectFile = &TLSFiles{CA: "ca.pem"}, "/etc/platform/sponsor.json"
		productionKeys(c)
		c.RegistrarURL, c.PlatformDocument = "https://registrar.internal", "99999999000191"
		c.AppAttestRoots, c.AppAttestAppID, c.AndroidAttestationRoots = "a.pem", "T.app", "g.pem"
		return c
	}
	for want, mod := range map[string]func(*Config){
		"do not run in production": func(c *Config) { c.Exchanges = []string{"sandbox"} },
		"CRYPTO_AUTHORIZATION":     func(c *Config) { c.Exchanges = []string{"binance"} },
		"FX_AUTHORIZATION":         func(c *Config) { c.FXProvider = "wise" },
		"SANCTIONS_LISTS":          func(c *Config) { c.Exchanges, c.CryptoAuthorization = []string{"binance"}, "SPSAV" },
		"REPORTING_URL": func(c *Config) {
			c.Exchanges, c.CryptoAuthorization, c.SanctionsLists = []string{"binance"}, "SPSAV", []string{"/etc/platform/sdn.csv"}
		},
		"SENDER_LOOKUP_URL": func(c *Config) {
			c.Exchanges, c.CryptoAuthorization, c.SanctionsLists, c.ReportingURL = []string{"binance"}, "SPSAV", []string{"/etc/platform/sdn.csv"}, "https://x.example"
			c.SenderLookups = map[string]string{"bitcoin": "https://esplora.internal"}
		},
		"TRAVEL_RULE_INBOUND_SECRET": func(c *Config) {
			c.Exchanges, c.CryptoAuthorization, c.SanctionsLists, c.ReportingURL = []string{"binance"}, "SPSAV", []string{"/etc/platform/sdn.csv"}, "https://x.example"
			c.SenderLookupURL, c.TravelRuleURL = "https://chain-analytics.internal/v1/senders", "https://travel-rule.internal"
		},
		"PLATFORM_LEI": func(c *Config) {
			c.Exchanges, c.CryptoAuthorization, c.SanctionsLists, c.ReportingURL = []string{"binance"}, "SPSAV", []string{"/etc/platform/sdn.csv"}, "https://x.example"
			c.SenderLookupURL, c.TravelRuleURL, c.TravelRuleSecret, c.PlatformLEI = "https://a.internal", "https://b.internal", "whsec_x", "506700GE1G29325QX364"
		},
	} {
		c := prod()
		mod(c)
		if err := c.Validate(); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("want %q, got %v", want, err)
		}
	}
	c := prod()
	c.Exchanges, c.CryptoAuthorization, c.FXProvider, c.FXAuthorization = []string{"binance"}, "SPSAV autorizada pelo BCB", "wise", "Banco parceiro de câmbio"
	c.ScreeningURL, c.ReportingURL = "https://screening.internal/v1/screen", "https://goonerspay.example"
	if err := c.Validate(); err == nil || !strings.Contains(err.Error(), "SANCTIONS_LISTS") {
		t.Errorf("a provider's address screening alone leaves names unscreened: %v", err)
	}
	c.SanctionsLists = []string{"/etc/platform/sdn.csv"}
	c.SenderLookups = map[string]string{"bitcoin": "https://esplora.internal", "ethereum": "https://eth.internal", "polygon": "https://polygon.internal", "tron": "https://tron.internal"}
	c.TravelRuleURL, c.TravelRuleSecret, c.PlatformLEI = "https://travel-rule.internal", "whsec_x", "506700GE1G29325QX363"
	if err := c.Validate(); err != nil {
		t.Errorf("with the authorizations and the providers, production starts: %v", err)
	}
}

// The integrations report: the sandbox runs on simulators and is not ready for production; a
// platform with every provider configured is.
func TestIntegrationsReport(t *testing.T) {
	c := base()
	c.Exchanges, c.FXProvider = []string{"sandbox"}, "sandbox"
	is := c.Integrations()
	state := map[string]string{}
	for _, i := range is {
		state[i.Name] = i.State
		if len(i.Settings) == 0 || i.For == "" {
			t.Fatalf("%s: no settings or purpose", i.Name)
		}
	}
	if state["Scheme host (ISO 8583)"] != Simulated || state["Crypto exchanges"] != Simulated || state["FX provider"] != Simulated ||
		state["Pix PSP (API Pix)"] != Off || state["KEK (KMS)"] != Simulated || state["Payment HSM (card data)"] != Simulated || state["Signer (receipts and transparency keys)"] != Off || state["Travel rule network"] != Off {
		t.Fatalf("the sandbox: %v", state)
	}
	if Ready(is) {
		t.Fatal("the sandbox reported ready for production")
	}

	tls := &TLSFiles{CA: "ca.pem", Cert: "c.pem", Key: "k.pem"}
	p := &Config{Env: Production, Routes: []Route{{Name: "sponsor-a", Addrs: []string{"10.0.0.1:8583"}, TLS: tls, DialectFile: "/etc/visa.json"}},
		PixBaseURL: "https://pix.psp.example/api", PixTLS: tls, PixClientID: "id", PixKey: "12345678000195", PixWebhookAddr: ":8443", PixWebhookTLS: tls,
		PayoutBaseURL: "https://pix.psp.example/pagamentos", RegistrarURL: "https://registradora.example", PlatformDocument: "12345678000195",
		AppAttestRoots: "apple.pem", AppAttestAppID: "TEAM.br.com.gooners.pay", AndroidAttestationRoots: "google.pem",
		Exchanges: []string{"binance"}, BinanceKey: "k", BinanceSecret: "s", CryptoAuthorization: "BCB 519",
		SanctionsLists: []string{"https://lists.example/sdn.csv"}, SenderLookupURL: "https://chain.example", TravelRuleURL: "https://tr.example", TravelRuleSecret: "whsec_x",
		ReportingURL: "https://goonerspay.com.br", PublicURL: "https://api.goonerspay.com.br",
		Relays: []string{"wss://relay.goonerspay.com.br"}, ClaimBase: "https://r.goonerspay.com.br/c"}
	productionKeys(p)
	is = p.Integrations()
	for _, i := range is {
		if i.Production && i.State != Live {
			t.Fatalf("%s is %s: %s", i.Name, i.State, i.Detail)
		}
	}
	if !Ready(is) {
		t.Fatal("a platform with every provider and key adapter configured is not ready")
	}
	q := *p
	q.CardDataHSMKeyARN, q.CardDataBDK = "", []byte("0123456789abcdef")
	if Ready(q.Integrations()) {
		t.Fatal("ready with the BDK in memory")
	}

	// What the report used to get wrong: payouts without the API Pix connection they ride on,
	// a receipt QR without relays or with the placeholder claim page.
	p.PixBaseURL, p.Relays, p.ClaimBase = "", nil, "https://r.goonerspay.example/c"
	got := map[string]string{}
	for _, i := range p.Integrations() {
		got[i.Name] = i.State
	}
	if got["Pix payouts"] != Partial || got["Nostr relays"] != Off || got["Receipt claim page"] != Off {
		t.Fatalf("payouts %s, relays %s, claim page %s", got["Pix payouts"], got["Nostr relays"], got["Receipt claim page"])
	}
}

// Production refuses to start without each connection the report marks required, so the
// report and the startup check cannot drift apart.
func TestProductionRequiresWhatTheReportRequires(t *testing.T) {
	tls := &TLSFiles{CA: "ca.pem", Cert: "c.pem", Key: "k.pem"}
	full := func() *Config {
		c := base()
		productionPix(c)
		c.Env, c.PublicURL = Production, "https://api.goonerspay.com.br"
		c.Routes[0].TLS, c.Routes[0].DialectFile = tls, "/etc/platform/sponsor.json"
		productionKeys(c)
		c.RegistrarURL, c.PlatformDocument = "https://registrar.internal", "99999999000191"
		c.AppAttestRoots, c.AppAttestAppID, c.AndroidAttestationRoots = "a.pem", "T.app", "g.pem"
		c.AndroidAttestationStatus = "https://android.googleapis.com/attestation/status"
		return c
	}
	if err := full().Validate(); err != nil {
		t.Fatalf("a complete configuration refused: %v", err)
	}
	if !Ready(full().Integrations()) {
		t.Fatal("a complete configuration reported not ready")
	}
	for name, unset := range map[string]func(*Config){
		"Pix PSP (API Pix)":  func(c *Config) { c.PixBaseURL = "" },
		"Pix payouts":        func(c *Config) { c.PayoutBaseURL = "" },
		"Nostr relays":       func(c *Config) { c.Relays = nil },
		"Receipt claim page": func(c *Config) { c.ClaimBase = "https://r.goonerspay.example/c" },
		"Public API (HTTPS)": func(c *Config) { c.PublicURL = "http://api.internal" },
		"KEK (KMS)":          func(c *Config) { c.KEKProvider, c.VaultKEK = "local", make([]byte, 32) },
		"Payment HSM (card data)": func(c *Config) {
			c.CardDataHSMKeyARN, c.CardDataBDK = "", make([]byte, 16)
		},
		"Signer (receipts and transparency keys)": func(c *Config) {
			c.SignerURL, c.SignerTLS, c.ReceiptsSecret = "", nil, make([]byte, 32)
		},
	} {
		c := full()
		unset(c)
		var required bool
		for _, i := range c.Integrations() {
			if i.Name == name {
				required = i.Production && i.State != Live
			}
		}
		if !required {
			t.Errorf("%s: the report does not flag it", name)
		}
		if err := c.Validate(); err == nil {
			t.Errorf("%s: production starts without it", name)
		}
	}
}
