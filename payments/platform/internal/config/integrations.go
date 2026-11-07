package config

import (
	"slices"
	"strings"
)

// Integration is one external API the platform talks to, and how ready its connection is.
type Integration struct {
	Name string `json:"name"`
	// For says what it serves (cards, Pix, crypto...).
	For string `json:"for"`
	// State is live (a real provider is configured), simulated (the sandbox's simulator or a
	// software stand-in), partial (configured but something it needs is missing) or off.
	State string `json:"state"`
	// Detail names the provider, or what is missing.
	Detail string `json:"detail"`
	// Settings are the environment variables that configure it.
	Settings []string `json:"settings"`
	// Production is whether a production platform must have it live.
	Production bool `json:"required_in_production"`
}

const (
	Live      = "live"
	Simulated = "simulated"
	Partial   = "partial"
	Off       = "off"
)

// Integrations reports every external connection: the readiness checklist to go from the
// sandbox to production (payments/integration/README.md). Production's own startup check
// (Validate) refuses to run without the ones marked Production.
func (c *Config) Integrations() []Integration {
	usesCrypto := len(c.Exchanges) > 0
	out := []Integration{}
	add := func(i Integration) { out = append(out, i) }

	// Card schemes: the authorization switch's routes to the acquirer or the schemes.
	{
		i := Integration{Name: "Scheme host (ISO 8583)", For: "card authorizations", Settings: []string{"ROUTES_FILE"}, Production: true}
		switch {
		case len(c.Routes) == 0:
			i.State, i.Detail = Off, "no route"
		case slices.ContainsFunc(c.Routes, func(r Route) bool { return r.TLS == nil || (r.DialectFile == "" && r.Dialect != "generic-1987-ascii") }):
			i.State, i.Detail = Simulated, "a route without TLS or a verified dialect file: the scheme simulator"
		default:
			names := []string{}
			for _, r := range c.Routes {
				names = append(names, r.Name)
			}
			i.State, i.Detail = Live, strings.Join(names, ", ")
		}
		add(i)
	}
	// Pix: collections (API Pix, mutual TLS) and the PSP's webhooks, then payouts.
	{
		i := Integration{Name: "Pix PSP (API Pix)", For: "Pix charges and refunds", Settings: []string{"PIX_BASE_URL", "PIX_TOKEN_URL", "PIX_CLIENT_ID", "PIX_CLIENT_SECRET", "PIX_KEY", "PIX_TLS_CERT/KEY/CA", "PIX_WEBHOOK_ADDR", "PIX_WEBHOOK_TLS_CERT/KEY/CA"}, Production: true}
		switch {
		case c.PixBaseURL == "":
			i.State, i.Detail = Off, "PIX_BASE_URL not set"
		case c.PixTLS == nil || c.PixClientID == "" || c.PixKey == "":
			i.State, i.Detail = Partial, "needs PIX_TLS_*, PIX_CLIENT_ID and PIX_KEY"
		case c.PixWebhookAddr == "" || c.PixWebhookTLS == nil:
			i.State, i.Detail = Partial, "no webhook listener (PIX_WEBHOOK_ADDR, PIX_WEBHOOK_TLS_*): payments are only seen when polled"
		default:
			i.State, i.Detail = Live, c.PixBaseURL
		}
		add(i)
		p := Integration{Name: "Pix payouts", For: "payouts to Pix keys", Settings: []string{"PAYOUT_BASE_URL"}, Production: true}
		if c.PayoutBaseURL == "" {
			p.State, p.Detail = Off, "PAYOUT_BASE_URL not set"
		} else {
			p.State, p.Detail = Live, c.PayoutBaseURL
		}
		add(p)
	}
	add(state(Integration{Name: "Receivables registrar", For: "registering receivables before an advance (Res. CMN 4.734)", Settings: []string{"REGISTRAR_URL", "PLATFORM_DOCUMENT"}, Production: true},
		c.RegistrarURL != "" && c.PlatformDocument != "", c.RegistrarURL, "REGISTRAR_URL and PLATFORM_DOCUMENT"))
	{
		i := Integration{Name: "Device attestation", For: "trusting merchant phones (App Attest, Android key attestation)",
			Settings: []string{"APPATTEST_ROOT_CA", "APPATTEST_APP_ID", "ANDROID_ATTESTATION_ROOTS", "ANDROID_SIGNING_DIGESTS", "ANDROID_ATTESTATION_STATUS"}, Production: true}
		apple, android := c.AppAttestRoots != "", c.AndroidAttestationRoots != ""
		switch {
		case apple && android:
			i.State, i.Detail = Live, "iOS and Android"
		case apple || android:
			i.State, i.Detail = Partial, map[bool]string{true: "iOS only", false: "Android only"}[apple]
		default:
			i.State, i.Detail = Off, "phones are trusted without attestation (sandbox)"
		}
		add(i)
	}
	{
		i := Integration{Name: "Key custody (HSM/KMS)", For: "the vault's KEK, card data, receipt and transparency keys", Settings: []string{"VAULT_KEK_HEX", "CARDDATA_DEV_KEY_HEX", "RECEIPTS_SECRET_HEX", "TRANSPARENCY_SECRET_HEX"}, Production: true}
		if len(c.VaultKEK) > 0 || len(c.CardDataDevKey) > 0 {
			i.State, i.Detail = Simulated, "software keys; production wires the HSM, payment-HSM and enclave adapters (integration/hsm.md)"
		} else {
			i.State, i.Detail = Off, "no keys configured"
		}
		add(i)
	}

	// Digital assets: exchanges, then the compliance services crypto needs.
	{
		i := Integration{Name: "Crypto exchanges", For: "crypto payments, conversions and withdrawals", Settings: []string{"EXCHANGES", "BINANCE_API_KEY/SECRET_KEY", "KRAKEN_API_KEY/SECRET_KEY", "COINBASE_KEY_NAME/PRIVATE_KEY", "CRYPTO_AUTHORIZATION"}}
		missing := []string{}
		for _, x := range c.Exchanges {
			switch x {
			case "binance":
				if c.BinanceKey == "" || c.BinanceSecret == "" {
					missing = append(missing, "BINANCE_API_KEY/SECRET_KEY")
				}
			case "kraken":
				if c.KrakenKey == "" || c.KrakenSecret == "" {
					missing = append(missing, "KRAKEN_API_KEY/SECRET_KEY")
				}
			case "coinbase":
				if c.CoinbaseKeyName == "" || c.CoinbaseKeyPEM == "" {
					missing = append(missing, "COINBASE_KEY_NAME/PRIVATE_KEY")
				}
			}
		}
		switch {
		case !usesCrypto:
			i.State, i.Detail = Off, "crypto disabled"
		case slices.Contains(c.Exchanges, "sandbox"):
			i.State, i.Detail = Simulated, "the sandbox exchange"
		case len(missing) > 0:
			i.State, i.Detail = Partial, "needs "+strings.Join(missing, ", ")
		case c.CryptoAuthorization == "":
			i.State, i.Detail = Partial, "needs CRYPTO_AUTHORIZATION (Res. BCB 519/2025)"
		default:
			i.State, i.Detail = Live, strings.Join(c.Exchanges, ", ")
		}
		add(i)
	}
	if usesCrypto {
		add(state(Integration{Name: "Sanctions screening", For: "withdrawal addresses and deposit senders", Settings: []string{"SANCTIONS_LISTS", "SCREENING_URL", "SCREENING_TOKEN"}, Production: true},
			len(c.SanctionsLists) > 0 || c.ScreeningURL != "", strings.TrimSpace(strings.Join(c.SanctionsLists, ", ")+" "+c.ScreeningURL), "SANCTIONS_LISTS or SCREENING_URL"))
		{
			i := Integration{Name: "Deposit sender lookups", For: "who sent each crypto deposit", Settings: []string{"BITCOIN_ESPLORA_URL", "ETHEREUM_RPC_URL", "POLYGON_RPC_URL", "TRON_API_URL", "TRON_API_KEY", "SENDER_LOOKUP_URL"}, Production: true}
			networks := []string{}
			for n := range c.SenderLookups {
				networks = append(networks, n)
			}
			slices.Sort(networks)
			switch {
			case c.SenderLookupURL != "" || len(networks) == 4:
				i.State, i.Detail = Live, strings.TrimSpace(strings.Join(networks, ", ")+" "+c.SenderLookupURL)
			case len(networks) > 0:
				i.State, i.Detail = Partial, "only "+strings.Join(networks, ", ")+": every network needs a source"
			default:
				i.State, i.Detail = Off, "no chain source"
			}
			add(i)
		}
		add(state(Integration{Name: "Travel rule network", For: "IVMS101 data to and from other providers (Res. BCB 520/2025)", Settings: []string{"TRAVEL_RULE_URL", "TRAVEL_RULE_TOKEN", "TRAVEL_RULE_INBOUND_SECRET", "PLATFORM_LEI"}, Production: true},
			c.TravelRuleURL != "" && c.TravelRuleSecret != "", c.TravelRuleURL, "TRAVEL_RULE_URL and TRAVEL_RULE_INBOUND_SECRET"))
		add(state(Integration{Name: "DeCripto filing", For: "the monthly report to the Receita Federal (IN RFB 2.291/2025)", Settings: []string{"REPORTING_URL", "PLATFORM_DOCUMENT"}, Production: true},
			c.ReportingURL != "" && c.PlatformDocument != "", c.ReportingURL, "REPORTING_URL and PLATFORM_DOCUMENT"))
	}
	{
		i := Integration{Name: "FX provider", For: "accounts abroad and international payouts", Settings: []string{"FX_PROVIDER", "WISE_TOKEN", "WISE_PROFILE_ID", "WISE_BASE_URL", "FX_AUTHORIZATION"}}
		switch {
		case c.FXProvider == "":
			i.State, i.Detail = Off, "foreign exchange disabled"
		case c.FXProvider == "sandbox":
			i.State, i.Detail = Simulated, "the sandbox FX provider"
		case c.WiseToken == "" || c.WiseProfile == "":
			i.State, i.Detail = Partial, "needs WISE_TOKEN and WISE_PROFILE_ID"
		case c.FXAuthorization == "":
			i.State, i.Detail = Partial, "needs FX_AUTHORIZATION (the authorized câmbio institution)"
		default:
			i.State, i.Detail = Live, c.FXProvider
		}
		add(i)
	}
	{
		i := Integration{Name: "Broker (B3)", For: "share orders and positions", Settings: []string{"BROKER_URL", "BROKER_TOKEN", "BROKER_NAME"}}
		if c.BrokerURL == "" {
			i.State, i.Detail = Simulated, "the broker simulator"
		} else {
			i.State, i.Detail = Live, c.BrokerName+" at "+c.BrokerURL
		}
		add(i)
		q := Integration{Name: "Market data (brapi.dev)", For: "B3 quotes", Settings: []string{"BRAPI_TOKEN"}}
		if c.BrapiToken == "" {
			q.State, q.Detail = Simulated, "simulated quotes"
		} else {
			q.State, q.Detail = Live, "brapi.dev"
		}
		add(q)
	}
	{
		i := Integration{Name: "Nostr relays", For: "receipts, statements and the public transparency root", Settings: []string{"RELAYS"}}
		if len(c.Relays) == 0 {
			i.State, i.Detail = Off, "nothing is published to relays"
		} else {
			i.State, i.Detail = Live, strings.Join(c.Relays, ", ")
		}
		add(i)
	}
	return out
}

func state(i Integration, ok bool, detail, missing string) Integration {
	if ok {
		i.State, i.Detail = Live, detail
	} else {
		i.State, i.Detail = Off, "needs "+missing
	}
	return i
}

// Ready is whether every integration production requires is live.
func Ready(is []Integration) bool {
	for _, i := range is {
		if i.Production && i.State != Live {
			return false
		}
	}
	return true
}
