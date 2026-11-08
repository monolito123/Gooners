// Command signer holds the platform's Nostr keys (receipts, transparency) and signs for the
// platform over mutual TLS, so the platform process never holds them (internal/signer).
//
//	signer seal -out keys.json -generate receipts,transparency   new keys, sealed under the KEK
//	signer seal -out keys.json < secrets                          existing keys, "name=hex" per line
//	signer serve                                                  sign for the platform
//
// Settings, from the environment:
//
//	KEK_PROVIDER, KEK_KEY_ID, AWS_REGION   the KEK the key file is sealed under (aws-kms, gcp-kms;
//	                                       local with VAULT_KEK_HEX outside production)
//	SIGNER_KEYS_FILE                       the sealed key file
//	SIGNER_ADDR                            where to listen (default :8446)
//	SIGNER_TLS_CERT, SIGNER_TLS_KEY        the service's certificate
//	SIGNER_CLIENT_CA                       the CA of the platform's client certificate (required)
//	SIGNER_ALLOWED_CLIENTS                 optional: SHA-256 fingerprints of the allowed client certificates
//	SIGNER_KINDS                           what each key signs (default receipts=7711,13,7713;transparency=7715)
package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/awsauth"
	"github.com/monolito123/Gooners/payments/platform/internal/signer"
	"github.com/monolito123/Gooners/payments/platform/internal/vault"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

var log = slog.New(slog.NewJSONHandler(os.Stderr, nil))

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: signer seal|serve")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var err error
	switch os.Args[1] {
	case "seal":
		err = seal(ctx, os.Args[2:])
	case "serve":
		err = serve(ctx)
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "signer:", err)
		os.Exit(1)
	}
}

func kek() (vault.KEK, error) {
	provider := os.Getenv("KEK_PROVIDER")
	if (provider == "" || provider == "local") && os.Getenv("PLATFORM_ENV") == "production" {
		return nil, errors.New("production seals the signer's keys under a KMS key: set KEK_PROVIDER to aws-kms or gcp-kms")
	}
	local, _ := hex.DecodeString(os.Getenv("VAULT_KEK_HEX"))
	return vault.FromSettings(provider, os.Getenv("KEK_KEY_ID"), local, awsauth.Region())
}

func seal(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("seal", flag.ExitOnError)
	out := fs.String("out", "", "where to write the sealed key file (required)")
	generate := fs.String("generate", "", "names of new keys to generate, comma-separated; otherwise name=hex lines on stdin")
	_ = fs.Parse(args)
	if *out == "" {
		return errors.New("-out is required")
	}
	k, err := kek()
	if err != nil {
		return err
	}
	secrets := map[string][]byte{}
	if *generate != "" {
		for _, name := range strings.Split(*generate, ",") {
			s := make([]byte, 32)
			if _, err := rand.Read(s); err != nil {
				return err
			}
			secrets[strings.TrimSpace(name)] = s
		}
	} else {
		sc := bufio.NewScanner(os.Stdin)
		for sc.Scan() {
			name, h, ok := strings.Cut(strings.TrimSpace(sc.Text()), "=")
			if !ok {
				continue
			}
			s, err := hex.DecodeString(strings.TrimSpace(h))
			if err != nil || len(s) != 32 {
				return fmt.Errorf("%s: want 64 hex digits", name)
			}
			secrets[strings.TrimSpace(name)] = s
		}
	}
	if len(secrets) == 0 {
		return errors.New("no keys to seal")
	}
	f, err := signer.Seal(ctx, k, secrets)
	if err != nil {
		return err
	}
	b, _ := json.MarshalIndent(f, "", "  ")
	if err := os.WriteFile(*out, b, 0o600); err != nil {
		return err
	}
	for name, s := range secrets {
		keys, _ := nostr.KeysFromSecret(s)
		npub, _ := nostr.EncodeNpub(keys.PubHex)
		fmt.Printf("%s\t%s\t%s\n", name, keys.PubHex, npub)
		clear(s)
	}
	fmt.Fprintf(os.Stderr, "sealed under %s into %s\n", k.ID(), *out)
	return nil
}

func serve(ctx context.Context) error {
	k, err := kek()
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(os.Getenv("SIGNER_KEYS_FILE")) // #nosec G304 G703 -- set by the operator
	if err != nil {
		return fmt.Errorf("SIGNER_KEYS_FILE: %w", err)
	}
	var f signer.KeyFile
	if err := json.Unmarshal(raw, &f); err != nil {
		return fmt.Errorf("SIGNER_KEYS_FILE: %w", err)
	}
	keys, err := signer.Open(ctx, k, &f)
	if err != nil {
		return err
	}
	kindSpec := os.Getenv("SIGNER_KINDS")
	if kindSpec == "" {
		kindSpec = signer.DefaultKinds
	}
	kinds, err := signer.ParseKinds(kindSpec)
	if err != nil {
		return err
	}
	cert, err := tls.LoadX509KeyPair(os.Getenv("SIGNER_TLS_CERT"), os.Getenv("SIGNER_TLS_KEY"))
	if err != nil {
		return fmt.Errorf("SIGNER_TLS_CERT/KEY: %w", err)
	}
	caPEM, err := os.ReadFile(os.Getenv("SIGNER_CLIENT_CA")) // #nosec G304 G703 -- set by the operator
	if err != nil {
		return fmt.Errorf("SIGNER_CLIENT_CA (the platform's client CA) is required: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return errors.New("SIGNER_CLIENT_CA holds no certificate")
	}
	s := &signer.Server{Keys: keys, Kinds: kinds, Log: log}
	for _, fp := range strings.Split(os.Getenv("SIGNER_ALLOWED_CLIENTS"), ",") {
		if fp = strings.ToLower(strings.TrimSpace(fp)); fp != "" {
			s.AllowedClients = append(s.AllowedClients, fp)
		}
	}
	addr := os.Getenv("SIGNER_ADDR")
	if addr == "" {
		addr = ":8446"
	}
	srv := &http.Server{Addr: addr, Handler: s.Handler(), ReadHeaderTimeout: 5 * time.Second,
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}, ClientCAs: pool, ClientAuth: tls.RequireAndVerifyClientCert, MinVersion: tls.VersionTLS13}}
	for name, key := range keys {
		npub, _ := nostr.EncodeNpub(key.PubHex)
		log.Info("signer: key loaded", "key", name, "npub", npub)
	}
	log.Info("signer: listening", "addr", addr, "kek", k.ID())
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	if err := srv.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
