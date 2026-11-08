// Command devpki writes a throwaway PKI for the local stack: a CA and the server and client
// certificates for the platform and the simulators, and a terminal CA with its key and a test
// terminal's certificate. Never use in production.
//
//	devpki -out ./dev/pki
package main

import (
	"crypto/x509"
	"encoding/pem"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/monolito123/Gooners/payments/platform/internal/api"
	"github.com/monolito123/Gooners/payments/platform/internal/testpki"
)

func main() {
	out := flag.String("out", "dev/pki", "output directory")
	hosts := flag.String("hosts", "localhost,127.0.0.1,platform,pixsim,schemesim", "comma-separated names for server certificates")
	flag.Parse()
	must := func(err error) {
		if err != nil {
			fmt.Fprintln(os.Stderr, "devpki:", err)
			os.Exit(1)
		}
	}
	must(os.MkdirAll(*out, 0o750)) // every service runs as the same non-root user
	ca, err := testpki.NewCA("goonersPAY dev CA")
	must(err)
	must(os.WriteFile(filepath.Join(*out, "ca.pem"), ca.PEM, 0o644))
	hs := splitComma(*hosts)
	for _, s := range []string{"platform-server", "pixsim-server", "schemesim-server", "signer-server"} {
		l, err := ca.Server(s, hs...)
		must(err)
		must(l.WriteFiles(*out, s))
	}
	for _, c := range []string{"platform-client", "pixsim-client"} {
		l, err := ca.Client(c)
		must(err)
		must(l.WriteFiles(*out, c))
	}
	// The terminal CA: the terminal listener trusts it (TERMINAL_TLS_CA) and the platform signs
	// terminals' CSRs with it (TERMINAL_CA_CERT, TERMINAL_CA_KEY); terminal-TP000001 is a
	// certificate from an external PKI's point of view, registered by its SHA-256.
	tca, err := testpki.NewCA("goonersPAY dev terminal CA")
	must(err)
	must(os.WriteFile(filepath.Join(*out, "terminal-ca.pem"), tca.PEM, 0o644))
	keyDER, err := x509.MarshalPKCS8PrivateKey(tca.Key)
	must(err)
	must(os.WriteFile(filepath.Join(*out, "terminal-ca.key"), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0o600))
	l, err := tca.Client("terminal-TP000001")
	must(err)
	must(l.WriteFiles(*out, "terminal-TP000001"))
	fmt.Printf("terminal certificate sha256: %s\n", api.CertFingerprint(l.TLS.Certificate[0]))
	fmt.Println("wrote", *out)
}

func splitComma(s string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == ',' {
			if i > start {
				out = append(out, s[start:i])
			}
			start = i + 1
		}
	}
	return out
}
