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
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestProductionRefusesSoftwareKeys(t *testing.T) {
	c := base()
	c.Env = Production
	c.Routes[0].TLS = &TLSFiles{CA: "ca.pem"}
	c.Routes[0].DialectFile = "/etc/platform/sponsor.json"
	for _, want := range []string{"VAULT_KEK_HEX", "card decryptor", "receipts key", "adapters"} {
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
		}
		if want == "card decryptor" {
			c.ReceiptsSecret = make([]byte, 32)
		}
	}
}
