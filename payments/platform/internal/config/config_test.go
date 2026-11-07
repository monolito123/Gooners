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
	for _, want := range []string{"VAULT_KEK_HEX", "card decryptor", "receipts key", "registers receivables", "device attestation", "status list", "fraud shield", "adapters"} {
		err := c.Validate()
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("want an error about %q, got %v", want, err)
		}
		switch want {
		case "VAULT_KEK_HEX":
			c.VaultKEK = nil
		case "card decryptor":
			c.CardDataDevKey = nil
		case "receipts key":
			c.ReceiptsSecret = nil
		case "registers receivables":
			c.RegistrarURL, c.PlatformDocument = "https://registrar-adapter.internal", "99999999000191"
		case "device attestation":
			c.AppAttestRoots, c.AppAttestAppID = "/etc/platform/apple-app-attest-root.pem", "ABCDE12345.br.com.gooners.pay"
			c.AndroidAttestationRoots = "/etc/platform/google-attestation-roots.pem"
			c.RiskMode, c.AndroidAttestationStatus = "off", "off"
		case "status list":
			c.AndroidAttestationStatus = "https://android.googleapis.com/attestation/status"
		case "fraud shield":
			c.RiskMode = "shadow"
		}
		if want == "card decryptor" {
			c.ReceiptsSecret = make([]byte, 32)
		}
	}
}

func TestProductionDigitalAssetsNeedAuthorization(t *testing.T) {
	prod := func() *Config {
		c := base()
		c.Env, c.PublicURL = Production, "https://api.goonerspay.example"
		c.Routes[0].TLS, c.Routes[0].DialectFile = &TLSFiles{CA: "ca.pem"}, "/etc/platform/sponsor.json"
		c.VaultKEK, c.CardDataDevKey, c.ReceiptsSecret = nil, nil, nil
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
	c.SenderLookups = map[string]string{"bitcoin": "https://esplora.internal", "ethereum": "https://eth.internal", "polygon": "https://polygon.internal", "tron": "https://tron.internal"}
	c.TravelRuleURL, c.TravelRuleSecret, c.PlatformLEI = "https://travel-rule.internal", "whsec_x", "506700GE1G29325QX363"
	if err := c.Validate(); err == nil || !strings.Contains(err.Error(), "adapters") {
		t.Errorf("with authorizations the remaining check is the HSM adapters: %v", err)
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
		state["Pix PSP (API Pix)"] != Off || state["Key custody (HSM/KMS)"] != Simulated || state["Travel rule network"] != Off {
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
		ReportingURL: "https://coleta.example"}
	is = p.Integrations()
	for _, i := range is {
		if i.Production && i.State != Live && i.Name != "Key custody (HSM/KMS)" {
			t.Fatalf("%s is %s: %s", i.Name, i.State, i.Detail)
		}
	}
	// Key custody stays the one gap the reference implementation leaves to the HSM adapters.
	if Ready(is) {
		t.Fatal("ready without the HSM adapters")
	}
}
