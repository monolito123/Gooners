// Command platform runs the goonersPAY platform: API, terminal and Pix webhook listeners,
// the authorization switch with its store-and-forward worker, webhook delivery, scheduled
// releases and payout reconciliation.
//
//	platform serve                          run everything (configuration from the environment)
//	platform migrate                        apply database migrations
//	platform apikey -tenant UUID -name N    create an API key (printed once)
//	platform verify-ledger                  check ledger invariants L1–L5 (exit 1 on violation)
//	platform release-due [-date YYYY-MM-DD] release receivables due on a date
//	platform settle -tenant UUID -brand visa -report ID -amount CENTS -actor A   record a scheme settlement by hand
//
// Operations (payments/integration/operations-runbook.md). Every command that changes
// access or money needs -actor, the operator's SSO identity, for the audit trail:
//
//	platform merchant-status -tenant UUID -merchant ID -status active|restricted|closed -reason R -actor A
//	platform terminal-revoke -tenant UUID -terminal ID -reason R -actor A
//	platform apikey-list -tenant UUID
//	platform apikey-revoke -tenant UUID -id ak_… -reason R -actor A
//	platform disputes-import -tenant UUID -file chargebacks.csv
//	platform disputes-list -tenant UUID [-status S]
//	platform write-off -tenant UUID -merchant ID -reason R -actor A
//	platform recon-card -tenant UUID -report ID -date YYYY-MM-DD -file report.csv
//	platform recon-pix -tenant UUID [-date YYYY-MM-DD]
//	platform recon-exceptions -tenant UUID
//	platform recon-resolve -tenant UUID -id N -resolution R -actor A
//	platform recon-allocate -tenant UUID -amount CENTS -to ACCOUNT -reason R -actor A
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/monolito123/Gooners/payments/platform/dialects"
	"github.com/monolito123/Gooners/payments/platform/internal/api"
	"github.com/monolito123/Gooners/payments/platform/internal/attest"
	"github.com/monolito123/Gooners/payments/platform/internal/authswitch"
	"github.com/monolito123/Gooners/payments/platform/internal/carddata"
	"github.com/monolito123/Gooners/payments/platform/internal/config"
	"github.com/monolito123/Gooners/payments/platform/internal/db"
	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/pixout"
	"github.com/monolito123/Gooners/payments/platform/internal/receipts"
	"github.com/monolito123/Gooners/payments/platform/internal/registrar"
	"github.com/monolito123/Gooners/payments/platform/internal/scheme"
	"github.com/monolito123/Gooners/payments/platform/internal/vault"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
	"github.com/monolito123/Gooners/payments/platform/pkg/apipix"
	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

var log = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: platform serve|migrate|apikey|verify-ledger|release-due|settle|close-day|merchant-status|terminal-revoke|apikey-list|apikey-revoke|disputes-import|disputes-list|write-off|recon-card|recon-pix|recon-exceptions|recon-resolve|recon-allocate")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	var err error
	switch os.Args[1] {
	case "serve":
		err = serve(ctx)
	case "migrate":
		err = withDB(ctx, func(pool *pgxpool.Pool) error { return db.Migrate(ctx, pool) })
	case "apikey":
		err = apikey(ctx, os.Args[2:])
	case "verify-ledger":
		err = verifyLedger(ctx)
	case "release-due":
		err = releaseDue(ctx, os.Args[2:])
	case "settle":
		err = settle(ctx, os.Args[2:])
	case "close-day":
		err = closeDay(ctx, os.Args[2:])
	default:
		if cmd, ok := opsCommands[os.Args[1]]; ok {
			err = cmd(ctx, os.Args[2:])
			break
		}
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		log.Error("platform", "err", err)
		os.Exit(1)
	}
}

func withDB(ctx context.Context, f func(*pgxpool.Pool) error) error {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return errors.New("DATABASE_URL is required")
	}
	pool, err := db.Open(ctx, url)
	if err != nil {
		return err
	}
	defer pool.Close()
	return f(pool)
}

func apikey(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("apikey", flag.ExitOnError)
	tenant := fs.String("tenant", "", "tenant UUID")
	name := fs.String("name", "default", "key name")
	scopes := fs.String("scopes", "*", "comma-separated scopes")
	live := fs.Bool("live", false, "issue a sk_live_ key")
	_ = fs.Parse(args)
	if *tenant == "" {
		return errors.New("-tenant is required")
	}
	return withDB(ctx, func(pool *pgxpool.Pool) error {
		key, err := api.NewAPIKey(ctx, pool, *tenant, *name, strings.Split(*scopes, ","), *live)
		if err == nil {
			fmt.Println(key)
		}
		return err
	})
}

func verifyLedger(ctx context.Context) error {
	return withDB(ctx, func(pool *pgxpool.Pool) error {
		v, err := ledger.New(pool, log).Verify(ctx, ledger.DefaultVerifyOptions)
		if err != nil {
			return err
		}
		for _, x := range v {
			log.Error("ledger invariant violated", "invariant", x.Invariant, "detail", x.Detail)
		}
		if len(v) > 0 {
			return fmt.Errorf("%d violations", len(v))
		}
		log.Info("ledger invariants L1–L5 hold")
		return nil
	})
}

func loadTLS(f *config.TLSFiles, server bool) (*tls.Config, error) {
	if f == nil {
		return nil, nil
	}
	cfg := &tls.Config{MinVersion: tls.VersionTLS13}
	if f.Cert != "" {
		c, err := tls.LoadX509KeyPair(f.Cert, f.Key)
		if err != nil {
			return nil, err
		}
		cfg.Certificates = []tls.Certificate{c}
	}
	if f.CA != "" {
		b, err := os.ReadFile(f.CA)
		if err != nil {
			return nil, err
		}
		p := x509.NewCertPool()
		if !p.AppendCertsFromPEM(b) {
			return nil, fmt.Errorf("no certificates in %s", f.CA)
		}
		if server {
			cfg.ClientCAs, cfg.ClientAuth = p, tls.RequireAndVerifyClientCert
		} else {
			cfg.RootCAs = p
		}
	}
	cfg.ServerName = f.ServerName
	return cfg, nil
}

func buildRoutes(c *config.Config) ([]*authswitch.Route, []*scheme.Pool, error) {
	var routes []*authswitch.Route
	var pools []*scheme.Pool
	for _, rc := range c.Routes {
		var spec *iso8583.Spec
		var err error
		if rc.DialectFile != "" {
			spec, err = iso8583.LoadSpecFile(rc.DialectFile)
		} else {
			spec, err = dialects.Load(rc.Dialect)
		}
		if err != nil {
			return nil, nil, fmt.Errorf("route %s: %w", rc.Name, err)
		}
		if spec.Status != iso8583.StatusVerified && c.Env != config.Sandbox {
			return nil, nil, fmt.Errorf("route %s: dialect %s is %s; replace it with the licensed specification", rc.Name, spec.Name, spec.Status)
		}
		tlsCfg, err := loadTLS(rc.TLS, false)
		if err != nil {
			return nil, nil, fmt.Errorf("route %s: %w", rc.Name, err)
		}
		codec := iso8583.NewCodec(spec)
		stan := scheme.NewSTANSource()
		var sessions []*scheme.Session
		for i, addr := range rc.Addrs {
			signOn := true
			if rc.SignOn != nil {
				signOn = *rc.SignOn
			}
			sessions = append(sessions, scheme.NewSession(scheme.Config{
				Name: fmt.Sprintf("%s-%d", rc.Name, i), Addr: addr, TLS: tlsCfg, Codec: codec, AcquirerID: rc.AcquirerID, SignOn: signOn,
				EchoInterval: time.Duration(rc.EchoSeconds) * time.Second, STAN: stan, Logger: log,
			}))
		}
		pool := scheme.NewPool(rc.Name, sessions...)
		pools = append(pools, pool)
		schemes := map[string]bool{}
		for _, s := range rc.Schemes {
			schemes[s] = true
		}
		if len(schemes) == 0 {
			schemes = nil
		}
		routes = append(routes, &authswitch.Route{Name: rc.Name, Pool: pool, Codec: codec, Schemes: schemes, AcquirerID: rc.AcquirerID,
			ApprovalPrior: rc.ApprovalPrior, STAN: stan, Fees: authswitch.Fees{BasisPoints: rc.FeeBps, FixedCents: rc.FixedCents, PerAttemptCents: rc.PerAttempt}})
	}
	return routes, pools, nil
}

// pixClients builds the API Pix client and the payout sender, when configured.
func pixClients(c *config.Config) (*apipix.Client, pixout.Sender, error) {
	if c.PixBaseURL == "" {
		return nil, nil, nil
	}
	pixTLS, err := loadTLS(c.PixTLS, false)
	if err != nil {
		return nil, nil, fmt.Errorf("pix tls: %w", err)
	}
	pix := apipix.New(apipix.Config{BaseURL: c.PixBaseURL, TokenURL: c.PixTokenURL, ClientID: c.PixClientID, ClientSecret: c.PixClientSecret,
		Scopes: []string{"cob.write", "cob.read", "pix.write", "pix.read", "webhook.write", "webhook.read"}, TLS: pixTLS, Logger: log})
	var sender pixout.Sender
	if c.PayoutBaseURL != "" {
		sender = pixout.NewHTTPSender(pixout.HTTPConfig{BaseURL: c.PayoutBaseURL, Token: pix.Token, TLS: pixTLS})
	}
	return pix, sender, nil
}

func serve(ctx context.Context) error {
	c, err := config.Load()
	if err != nil {
		return err
	}
	pool, err := db.Open(ctx, c.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}
	routes, pools, err := buildRoutes(c)
	if err != nil {
		return err
	}
	for _, p := range pools {
		go p.Run(ctx)
	}
	kek, err := vault.NewLocalKEK("local-dev", c.VaultKEK)
	if err != nil {
		return err
	}
	v, err := vault.New(pool, kek, c.VaultFingerprintKey)
	if err != nil {
		return err
	}
	sw := authswitch.New(routes, authswitch.NewPgStore(pool), v, authswitch.Config{CardPresentTimeout: c.CardPresentTimeout, Logger: log})
	go sw.RunReversals(ctx, time.Second)

	dec, err := carddata.NewDev(c.CardDataDevKey)
	if err != nil {
		return err
	}
	deps := payments.Deps{Pool: pool, Ledger: ledger.New(pool, log), Switch: sw, Vault: v, Decryptor: dec, Logger: log}
	if deps.Pix, deps.Payout, err = pixClients(c); err != nil {
		return err
	}
	if len(c.ReceiptsSecret) == 32 {
		k, err := nostr.KeysFromSecret(c.ReceiptsSecret)
		if err != nil {
			return err
		}
		deps.Receipts = &receipts.Issuer{Author: k, ClaimBase: c.ClaimBase}
		if len(c.Relays) > 0 {
			deps.Publisher = &receipts.Publisher{Relays: c.Relays}
		}
		npub, _ := nostr.EncodeNpub(k.PubHex)
		log.Info("receipts signer", "npub", npub)
	}
	if deps.Attestor, err = attestor(ctx, c); err != nil {
		return err
	}
	switch {
	case c.RegistrarURL != "":
		deps.Registrar = &registrar.Client{BaseURL: c.RegistrarURL}
	case c.Env == config.Sandbox:
		deps.Registrar = registrar.NewMemory() // the sandbox's own registrar: advances still register first
	}
	if len(c.TransparencySecret) == 32 {
		k, err := nostr.KeysFromSecret(c.TransparencySecret)
		if err != nil {
			return err
		}
		deps.Transparency = k
		npub, _ := nostr.EncodeNpub(k.PubHex)
		log.Info("transparency signer", "npub", npub)
	}
	svc := payments.New(payments.Config{Env: c.Env, AcquirerID: c.AcquirerID, PixKey: c.PixKey, RelayURL: firstOr(c.Relays, ""), MaxPaymentAmount: c.MaxPaymentAmount, TransparencyPadTo: c.TransparencyPadTo, PlatformDocument: c.PlatformDocument, RiskMode: c.RiskMode}, deps)
	if c.BootstrapTenant != "" {
		if err := svc.BootstrapTenant(ctx, c.BootstrapTenant, c.BootstrapCapital); err != nil {
			return fmt.Errorf("bootstrap tenant: %w", err)
		}
	}
	if deps.Pix != nil && c.PixWebhookPublicURL != "" {
		if err := deps.Pix.ConfigureWebhook(ctx, c.PixKey, c.PixWebhookPublicURL); err != nil {
			log.Warn("could not register the Pix webhook (retry with the PSP)", "err", err)
		}
	}

	srv := api.New(api.Config{Env: c.Env, RatePerSecond: c.RatePerSecond, RateBurst: c.RateBurst, AuthFailuresPerMinute: c.AuthFailuresPerMinute, TrustProxy: c.TrustProxy, PublicURL: c.PublicURL}, svc, pool, log)
	disp := &webhooks.Dispatcher{Pool: pool, Logger: log, Policy: svc.WebhookPolicy(), Secrets: v}
	go disp.Run(ctx, time.Second)
	holder := fmt.Sprintf("%s-%d-%s", hostname(), os.Getpid(), ids.ULID()[20:])
	go every(ctx, time.Minute, func() { svc.RunPeriodic(ctx, holder) })
	svc.RegisterMetrics(metrics.Default)
	metrics.Default.Logger = log

	servers := []*http.Server{newServer(c.HTTPAddr, srv.Handler(), c.CardPresentTimeout)}
	if c.HTTPTLS != nil {
		if servers[0].TLSConfig, err = loadTLS(c.HTTPTLS, false); err != nil {
			return err
		}
		servers[0].TLSConfig.RootCAs = nil
	}
	if c.TerminalAddr != "" {
		t, err := loadTLS(c.TerminalTLS, true)
		if err != nil || t == nil {
			return fmt.Errorf("terminal listener needs TERMINAL_TLS_CERT/KEY/CA: %v", err)
		}
		ts := newServer(c.TerminalAddr, srv.Handler(), c.CardPresentTimeout)
		ts.TLSConfig = t
		servers = append(servers, ts)
	}
	if c.PixWebhookAddr != "" {
		t, err := loadTLS(c.PixWebhookTLS, true)
		if err != nil {
			return err
		}
		t.MinVersion = tls.VersionTLS12 // PSPs' webhook clients may still negotiate TLS 1.2
		ps := newServer(c.PixWebhookAddr, srv.PixWebhookHandler(), c.CardPresentTimeout)
		ps.TLSConfig = t
		servers = append(servers, ps)
	}
	if c.MetricsAddr != "" {
		mux := http.NewServeMux()
		mux.Handle("GET /metrics", metrics.Default.Handler())
		servers = append(servers, newServer(c.MetricsAddr, mux, c.CardPresentTimeout))
	}
	errc := make(chan error, len(servers))
	for _, s := range servers {
		go func(s *http.Server) {
			log.Info("listening", "addr", s.Addr, "tls", s.TLSConfig != nil)
			if s.TLSConfig != nil {
				errc <- s.ListenAndServeTLS("", "")
			} else {
				errc <- s.ListenAndServe()
			}
		}(s)
	}
	select {
	case <-ctx.Done():
	case err := <-errc:
		return err
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	for _, s := range servers {
		_ = s.Shutdown(shutdown)
	}
	return nil
}

// newServer sets every timeout, so slow or idle clients (slowloris) cannot hold connections.
// Writes may take as long as a card-present authorization plus a margin.
func newServer(addr string, h http.Handler, authTimeout time.Duration) *http.Server {
	return &http.Server{
		Addr: addr, Handler: h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      authTimeout + 20*time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}
}

func firstOr(xs []string, d string) string {
	if len(xs) > 0 {
		return xs[0]
	}
	return d
}

func every(ctx context.Context, d time.Duration, f func()) {
	t := time.NewTicker(d)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			f()
		}
	}
}

func releaseDue(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("release-due", flag.ExitOnError)
	date := fs.String("date", time.Now().Format("2006-01-02"), "release receivables due on or before this date")
	_ = fs.Parse(args)
	day, err := time.Parse("2006-01-02", *date)
	if err != nil {
		return err
	}
	return withDB(ctx, func(pool *pgxpool.Pool) error {
		svc := payments.New(payments.Config{}, payments.Deps{Pool: pool, Ledger: ledger.New(pool, log), Logger: log})
		n, err := svc.ReleaseDue(ctx, day.Add(12*time.Hour))
		log.Info("released", "count", n)
		return err
	})
}

func settle(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("settle", flag.ExitOnError)
	tenant := fs.String("tenant", "", "tenant UUID")
	brand := fs.String("brand", "visa", "scheme")
	report := fs.String("report", "", "settlement report ID (idempotency key)")
	amount := fs.Int64("amount", 0, "amount received, centavos")
	actor := fs.String("actor", "", "operator identity, kept in the audit trail")
	_ = fs.Parse(args)
	if *tenant == "" || *report == "" || *amount <= 0 || *actor == "" {
		return errors.New("-tenant, -report, -amount and -actor are required (recon-card is the normal path)")
	}
	return withDB(ctx, func(pool *pgxpool.Pool) error {
		svc := payments.New(payments.Config{}, payments.Deps{Pool: pool, Ledger: ledger.New(pool, log), Logger: log})
		return svc.RecordSchemeSettlement(ctx, *tenant, *brand, *report, *amount, *actor)
	})
}

// attestor builds the device attestation verifier from the configured roots; nil keeps the
// sandbox behaviour (evidence recorded, not verified).
func attestor(ctx context.Context, c *config.Config) (payments.Attestor, error) {
	if c.AppAttestRoots == "" && c.AndroidAttestationRoots == "" {
		return nil, nil
	}
	pool := func(file string) (*x509.CertPool, error) {
		pem, err := os.ReadFile(file) // #nosec G304 -- a path the operator configures
		if err != nil {
			return nil, err
		}
		p := x509.NewCertPool()
		if !p.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("%s holds no PEM certificates", file)
		}
		return p, nil
	}
	var a payments.VerifyingAttestor
	if c.AppAttestRoots != "" {
		roots, err := pool(c.AppAttestRoots)
		if err != nil {
			return nil, err
		}
		a.AppAttest = &attest.AppAttestConfig{Roots: roots, AppID: c.AppAttestAppID, Production: c.AppAttestProduction}
	}
	if c.AndroidAttestationRoots != "" {
		roots, err := pool(c.AndroidAttestationRoots)
		if err != nil {
			return nil, err
		}
		a.KeyAttestation = &attest.KeyAttestationConfig{Roots: roots, PackageName: c.AndroidPackage, SigningDigests: c.AndroidSigningDigests}
		if c.AndroidAttestationStatus != "off" {
			// Google's certificate status list, refreshed hourly; attestations are refused
			// while it is missing or older than three days.
			src := &attest.RevocationSource{Location: c.AndroidAttestationStatus}
			if err := src.Refresh(ctx); err != nil {
				log.Error("attestation status list", "location", src.Location, "err", err)
			}
			go func() {
				t := time.NewTicker(time.Hour)
				defer t.Stop()
				for {
					select {
					case <-ctx.Done():
						return
					case <-t.C:
						if err := src.Refresh(ctx); err != nil {
							log.Error("attestation status list", "location", src.Location, "err", err)
						}
					}
				}
			}()
			a.KeyAttestation.Revocations = src.Current
		}
	}
	log.Info("device attestation", "app_attest", a.AppAttest != nil, "android_key_attestation", a.KeyAttestation != nil,
		"android_status_list", a.KeyAttestation != nil && a.KeyAttestation.Revocations != nil)
	return a, nil
}

// closeDay closes a Brasília business day into statements and a transparency root by hand
// (the serve process does it every night after StatementHour). Closing a day twice is a no-op.
func closeDay(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("close-day", flag.ExitOnError)
	date := fs.String("date", time.Now().In(payments.BRT).AddDate(0, 0, -1).Format("2006-01-02"), "Brasília business day to close")
	_ = fs.Parse(args)
	day, err := time.ParseInLocation("2006-01-02", *date, payments.BRT)
	if err != nil {
		return err
	}
	keys := map[string]nostr.Keys{}
	for _, name := range []string{"RECEIPTS_SECRET_HEX", "TRANSPARENCY_SECRET_HEX"} {
		raw, err := hex.DecodeString(os.Getenv(name))
		if err != nil || len(raw) != 32 {
			return fmt.Errorf("%s (32 bytes, hex) is required", name)
		}
		if keys[name], err = nostr.KeysFromSecret(raw); err != nil {
			return err
		}
	}
	padTo, _ := strconv.Atoi(os.Getenv("TRANSPARENCY_PAD_TO"))
	return withDB(ctx, func(pool *pgxpool.Pool) error {
		deps := payments.Deps{Pool: pool, Ledger: ledger.New(pool, log), Logger: log, Transparency: keys["TRANSPARENCY_SECRET_HEX"],
			Receipts: &receipts.Issuer{Author: keys["RECEIPTS_SECRET_HEX"]}}
		if r := os.Getenv("RELAYS"); r != "" {
			deps.Publisher = &receipts.Publisher{Relays: strings.Split(r, ",")}
		}
		root, err := payments.New(payments.Config{RelayURL: firstOr(strings.Split(os.Getenv("RELAYS"), ","), ""), TransparencyPadTo: padTo}, deps).CloseDay(ctx, day)
		if err != nil {
			return err
		}
		log.Info("day closed", "date", root.Date, "root", root.Root, "tree_size", root.TreeSize, "root_event", root.Event.ID)
		return nil
	})
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "platform"
	}
	return h
}
