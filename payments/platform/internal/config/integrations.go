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

	// The platform's own front door: phones sign the exact URL in every login and DPoP proof.
	{
		i := Integration{Name: "Public API (HTTPS)", For: "partners, the console and the merchant apps", Settings: []string{"PUBLIC_API_URL", "HTTP_TLS_CERT/KEY (or a TLS proxy with TRUST_PROXY)"}, Production: true}
		if strings.HasPrefix(c.PublicURL, "https://") {
			i.State, i.Detail = Live, c.PublicURL
		} else {
			i.State, i.Detail = Off, "PUBLIC_API_URL is not an https address (the sandbox's plain HTTP)"
		}
		add(i)
		t := Integration{Name: "Terminal listener (mTLS)", For: "card sales from terminals presenting their certificate (in production, phones too)", Settings: []string{"TERMINAL_ADDR", "TERMINAL_TLS_CERT/KEY/CA"}}
		if c.TerminalAddr != "" && c.TerminalTLS != nil {
			t.State, t.Detail = Live, c.TerminalAddr
		} else {
			t.State, t.Detail = Off, "no TERMINAL_ADDR: terminals with certificates cannot connect"
		}
		add(t)
		ca := Integration{Name: "Terminal CA", For: "issuing terminals' certificates from their CSRs (POST /v1/terminals)", Settings: []string{"TERMINAL_CA_CERT", "TERMINAL_CA_KMS_KEY_ID (or TERMINAL_CA_KEY outside production)"}}
		switch {
		case c.TerminalCAKMSKeyID != "":
			ca.State, ca.Detail = Live, "AWS KMS key "+c.TerminalCAKMSKeyID
		case c.TerminalCAKey != "":
			ca.State, ca.Detail = Simulated, "the CA key in a file ("+c.TerminalCAKey+")"
		default:
			ca.State, ca.Detail = Off, "no terminal CA: certificates come from an external PKI, registered by SHA-256; a CSR answers 501"
		}
		add(ca)
	}

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
		// The payout sender reuses the API Pix connection's OAuth token and mutual TLS
		// (cmd/platform pixClients): without PIX_BASE_URL it is never built.
		p := Integration{Name: "Pix payouts", For: "payouts to Pix keys", Settings: []string{"PAYOUT_BASE_URL", "the API Pix credentials above"}, Production: true}
		switch {
		case c.PayoutBaseURL == "":
			p.State, p.Detail = Off, "PAYOUT_BASE_URL not set"
		case c.PixBaseURL == "":
			p.State, p.Detail = Partial, "needs PIX_BASE_URL: payouts use the API Pix connection's token and mutual TLS"
		default:
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
		case apple && android && c.AndroidAttestationStatus == "off":
			i.State, i.Detail = Partial, "Google's attestation status list is off (ANDROID_ATTESTATION_STATUS)"
		case apple && android:
			i.State, i.Detail = Live, "iOS and Android"
		case apple || android:
			i.State, i.Detail = Partial, map[bool]string{true: "iOS only", false: "Android only"}[apple]
		default:
			i.State, i.Detail = Off, "phones are trusted without attestation (sandbox)"
		}
		add(i)
	}
	// Key custody (integration/hsm.md): the vault's KEK, card data and the Nostr keys.
	{
		k := Integration{Name: "KEK (KMS)", For: "the vault's data keys: card numbers, webhook secrets, travel-rule data", Settings: []string{"KEK_PROVIDER", "KEK_KEY_ID", "AWS_REGION or GOOGLE_APPLICATION_CREDENTIALS"}, Production: true}
		switch {
		case c.KEKProvider == "aws-kms" || c.KEKProvider == "gcp-kms":
			k.State, k.Detail = Live, c.KEKProvider+" "+c.KEKKeyID
		case len(c.VaultKEK) > 0:
			k.State, k.Detail = Simulated, "a software KEK in memory (VAULT_KEK_HEX)"
		default:
			k.State, k.Detail = Off, "no KEK"
		}
		add(k)
		h := Integration{Name: "Payment HSM (card data)", For: "decrypting readers' DUKPT card data", Settings: []string{"CARDDATA_HSM_KEY_ARN", "AWS_REGION"}, Production: true}
		switch {
		case c.CardDataHSMKeyARN != "":
			h.State, h.Detail = Live, "AWS Payment Cryptography "+c.CardDataHSMKeyARN
		case len(c.CardDataBDK) > 0:
			h.State, h.Detail = Simulated, "TDES DUKPT with the BDK in memory (CARDDATA_BDK_HEX)"
		case len(c.CardDataDevKey) > 0:
			h.State, h.Detail = Simulated, "the phones' development format only (CARDDATA_DEV_KEY_HEX)"
		default:
			h.State, h.Detail = Off, "no card-data decryptor"
		}
		add(h)
		sg := Integration{Name: "Signer (receipts and transparency keys)", For: "signing receipts, statements and the daily root", Settings: []string{"SIGNER_URL", "SIGNER_TLS_CERT/KEY/CA"}, Production: true}
		switch {
		case c.SignerURL != "":
			sg.State, sg.Detail = Live, c.SignerURL
		case len(c.ReceiptsSecret) > 0 || len(c.TransparencySecret) > 0:
			sg.State, sg.Detail = Simulated, "keys in the platform's memory (RECEIPTS_SECRET_HEX, TRANSPARENCY_SECRET_HEX)"
		default:
			sg.State, sg.Detail = Off, "no receipts key: sales carry no receipt"
		}
		add(sg)
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
	// The audit trail's copies nobody can change or delete.
	{
		w := Integration{Name: "Audit copies (WORM)", For: "keeping the audit trail ten years beyond the database's reach", Settings: []string{"AUDIT_EXPORT_BUCKET", "AUDIT_EXPORT_PREFIX", "AWS_REGION"}, Production: true}
		if c.AuditExportBucket != "" {
			w.State, w.Detail = Live, "s3://"+c.AuditExportBucket+" (Object Lock, compliance mode)"
		} else {
			w.State, w.Detail = Off, "the audit trail lives only in the database"
		}
		add(w)
	}
	// Independent dates for the daily roots.
	{
		t := Integration{Name: "Timestamp anchoring (RFC 3161)", For: "dating each daily transparency root by independent authorities", Settings: []string{"TSA_URLS", "TSA_ROOTS"}}
		if len(c.TSAURLs) > 0 {
			t.State, t.Detail = Live, strings.Join(c.TSAURLs, ", ")
		} else {
			t.State, t.Detail = Off, "the roots are dated by the platform's signature alone"
		}
		add(t)
	}
	// Who runs the operator commands, as the company's identity provider says.
	{
		o := Integration{Name: "Operator identity (SSO)", For: "naming who ran each operator command in the audit trail", Settings: []string{"OPERATOR_OIDC_ISSUER", "OPERATOR_OIDC_CLIENT_ID", "OPERATOR_OIDC_DOMAINS", "OPERATOR_OIDC_GROUP"}, Production: true}
		switch {
		case c.Operators.Issuer != "" && c.Operators.ClientID != "" && (len(c.Operators.Domains) > 0 || c.Operators.Group != ""):
			o.State, o.Detail = Live, c.Operators.Issuer
		case c.Operators.Issuer != "":
			o.State, o.Detail = Partial, "no OPERATOR_OIDC_DOMAINS or OPERATOR_OIDC_GROUP: any account the provider knows could operate"
		default:
			o.State, o.Detail = Off, "-actor is taken as typed"
		}
		add(o)
	}
	// Onboarding: the KYB registry and the sanctions lists every merchant's names meet.
	{
		k := Integration{Name: "KYB registry (Receita Federal CNPJ data)", For: "clearing new merchants before they sell", Settings: []string{"KYB_REGISTRY", "KYB_REGISTRY_URL", "KYB_AUTO_APPROVE"}, Production: true}
		switch c.KYBRegistry {
		case "brasilapi":
			url := c.KYBRegistryURL
			if url == "" {
				url = "https://brasilapi.com.br/api/cnpj/v1"
			}
			k.State, k.Detail = Live, url
		case "sandbox":
			k.State, k.Detail = Simulated, "the sandbox's test companies"
		default:
			k.State, k.Detail = Off, "no registry: operators clear every merchant by hand"
		}
		add(k)
		i := Integration{Name: "Sanctions screening", For: "merchants' names at onboarding; with crypto, withdrawal addresses, deposit senders and travel-rule names", Settings: []string{"SANCTIONS_LISTS", "SCREENING_URL", "SCREENING_TOKEN"}, Production: true}
		switch {
		case len(c.SanctionsLists) > 0:
			i.State, i.Detail = Live, strings.TrimSpace(strings.Join(c.SanctionsLists, ", ")+" "+c.ScreeningURL)
		case c.ScreeningURL != "":
			i.State, i.Detail = Partial, "SCREENING_URL screens addresses only: names need SANCTIONS_LISTS (OFAC's SDN.CSV)"
		default:
			i.State, i.Detail = Off, "needs SANCTIONS_LISTS (OFAC's SDN.CSV): names go to people unscreened"
		}
		add(i)
	}
	if usesCrypto {
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
		// Not an API: the platform writes the file, and operations transmits it at the Coleta
		// Nacional with the company's e-CNPJ certificate (runbook §4.10).
		add(state(Integration{Name: "DeCripto (Receita Federal)", For: "the monthly crypto report (IN RFB 2.291/2025), transmitted by hand at the Coleta Nacional", Settings: []string{"PLATFORM_DOCUMENT", "REPORTING_NAME", "REPORTING_URL"}, Production: true},
			c.ReportingURL != "" && c.PlatformDocument != "", "the platform is named in record 0000; operations files it with the e-CNPJ", "PLATFORM_DOCUMENT and REPORTING_URL (the platform's CNPJ and website)"))
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
		// Every sale shows the customer a receipt QR: the wrap must be on a relay (NIP-42 reads)
		// and the claim page must exist to open it.
		i := Integration{Name: "Nostr relays", For: "customer receipts, the merchant's copies and the public transparency root", Settings: []string{"RELAYS"}, Production: true}
		if len(c.Relays) == 0 {
			i.State, i.Detail = Off, "nothing is published: the receipt QR leads nowhere"
		} else {
			i.State, i.Detail = Live, strings.Join(c.Relays, ", ")
		}
		add(i)
		cp := Integration{Name: "Receipt claim page", For: "the static page the receipt QR opens (docs/03 §3.2)", Settings: []string{"RECEIPT_CLAIM_BASE"}, Production: true}
		if strings.HasPrefix(c.ClaimBase, "https://") && !strings.Contains(c.ClaimBase, "goonerspay.example") {
			cp.State, cp.Detail = Live, c.ClaimBase
		} else {
			cp.State, cp.Detail = Off, "RECEIPT_CLAIM_BASE is the placeholder "+c.ClaimBase+": host the page and set it"
		}
		add(cp)
		m := Integration{Name: "Metrics (Prometheus)", For: "the alerts of the runbook (§3)", Settings: []string{"METRICS_ADDR"}}
		if c.MetricsAddr != "" {
			m.State, m.Detail = Live, c.MetricsAddr
		} else {
			m.State, m.Detail = Off, "no METRICS_ADDR: nothing for Prometheus to scrape"
		}
		add(m)
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
