// Command schemesim runs the ISO 8583 host simulator (scheme network + issuer) for local
// development, integration tests and rehearsing certification scripts.
//
//	schemesim -listen :8583 -dialect generic-1987-ascii
//	schemesim -listen :8583 -dialect-file ./licensed/visa-base1.json -tls-cert host.pem -tls-key host.key -client-ca acquirers.pem
package main

import (
	"crypto/tls"
	"crypto/x509"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/monolito123/Gooners/payments/platform/dialects"
	"github.com/monolito123/Gooners/payments/platform/internal/schemesim"
	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:8583", "address to listen on")
	dialect := flag.String("dialect", dialects.Generic, "embedded dialect name")
	dialectFile := flag.String("dialect-file", "", "dialect JSON file (overrides -dialect)")
	certFile := flag.String("tls-cert", "", "server certificate (PEM); enables TLS")
	keyFile := flag.String("tls-key", "", "server key (PEM)")
	clientCA := flag.String("client-ca", "", "CA bundle for client certificates; enables mutual TLS")
	late := flag.Duration("late-delay", 12*time.Second, "delay for amounts ending in 99 (late response)")
	requireSignOn := flag.Bool("require-sign-on", true, "refuse financial messages before 0800/001")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	var spec *iso8583.Spec
	var err error
	if *dialectFile != "" {
		spec, err = iso8583.LoadSpecFile(*dialectFile)
	} else {
		spec, err = dialects.Load(*dialect)
	}
	if err != nil {
		log.Error("load dialect", "err", err)
		os.Exit(1)
	}

	var tlsCfg *tls.Config
	if *certFile != "" {
		cert, err := tls.LoadX509KeyPair(*certFile, *keyFile)
		if err != nil {
			log.Error("load certificate", "err", err)
			os.Exit(1)
		}
		tlsCfg = &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{cert}}
		if *clientCA != "" {
			pem, err := os.ReadFile(*clientCA)
			if err != nil {
				log.Error("read client CA", "err", err)
				os.Exit(1)
			}
			pool := x509.NewCertPool()
			pool.AppendCertsFromPEM(pem)
			tlsCfg.ClientCAs = pool
			tlsCfg.ClientAuth = tls.RequireAndVerifyClientCert
		}
	}

	sim := schemesim.New(iso8583.NewCodec(spec))
	sim.LateDelay = *late
	sim.RequireSignOn = *requireSignOn
	sim.Logger = log
	addr, err := sim.Listen(*listen, tlsCfg)
	if err != nil {
		log.Error("listen", "err", err)
		os.Exit(1)
	}
	log.Info("schemesim listening", "addr", addr, "dialect", spec.Name, "status", spec.Status, "tls", tlsCfg != nil)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	sim.Close()
}
