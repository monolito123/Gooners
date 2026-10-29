// Command pixsim runs the PSP simulator (API Pix + partner-bank transfers) over mutual TLS.
//
//	pixsim -listen :8443 -cert psp.pem -key psp.key -client-ca ca.pem -webhook-cert psp-client.pem -webhook-key psp-client.key \
//	       -client-id platform -client-secret dev -keys 12345678000195
package main

import (
	"crypto/tls"
	"crypto/x509"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/pixsim"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:8443", "address to listen on")
	certFile := flag.String("cert", "", "server certificate (PEM)")
	keyFile := flag.String("key", "", "server key (PEM)")
	clientCA := flag.String("client-ca", "", "CA that issued API clients' certificates (mutual TLS)")
	hookCert := flag.String("webhook-cert", "", "client certificate used to call webhooks")
	hookKey := flag.String("webhook-key", "", "client key used to call webhooks")
	hookCA := flag.String("webhook-ca", "", "CA to trust for webhook servers (defaults to -client-ca)")
	clientID := flag.String("client-id", "platform", "OAuth client id")
	clientSecret := flag.String("client-secret", "dev-secret", "OAuth client secret")
	keys := flag.String("keys", "12345678000195", "comma-separated Pix keys of the receiving user")
	flag.Parse()
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	must := func(err error) {
		if err != nil {
			log.Error("pixsim", "err", err)
			os.Exit(1)
		}
	}
	readPool := func(path string) *x509.CertPool {
		b, err := os.ReadFile(path)
		must(err)
		p := x509.NewCertPool()
		p.AppendCertsFromPEM(b)
		return p
	}
	if *certFile == "" || *clientCA == "" {
		log.Error("pixsim needs -cert, -key and -client-ca: API Pix is mutual TLS only")
		os.Exit(2)
	}
	server, err := tls.LoadX509KeyPair(*certFile, *keyFile)
	must(err)
	var hookTLS *tls.Config
	if *hookCert != "" {
		c, err := tls.LoadX509KeyPair(*hookCert, *hookKey)
		must(err)
		ca := *hookCA
		if ca == "" {
			ca = *clientCA
		}
		hookTLS = &tls.Config{Certificates: []tls.Certificate{c}, RootCAs: readPool(ca), MinVersion: tls.VersionTLS12}
	}
	sim := pixsim.New(pixsim.Config{ClientID: *clientID, ClientSecret: *clientSecret, Keys: strings.Split(*keys, ","), FailKey: "fail@example.com", WebhookTLS: hookTLS, Logger: log})
	srv := &http.Server{
		Addr:              *listen,
		Handler:           sim.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{server}, ClientCAs: readPool(*clientCA),
			ClientAuth: tls.RequireAndVerifyClientCert, MinVersion: tls.VersionTLS12},
	}
	log.Info("pixsim listening", "addr", *listen)
	must(srv.ListenAndServeTLS("", ""))
}
