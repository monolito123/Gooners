// Command devpki writes a throwaway PKI for the local stack: a CA and the server and client
// certificates for the platform, the PSP simulator and a test terminal. Never use in production.
//
//	devpki -out ./dev/pki
package main

import (
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
	must(os.MkdirAll(*out, 0o755))
	ca, err := testpki.NewCA("goonersPAY dev CA")
	must(err)
	must(os.WriteFile(filepath.Join(*out, "ca.pem"), ca.PEM, 0o644))
	hs := splitComma(*hosts)
	for _, s := range []string{"platform-server", "pixsim-server", "schemesim-server"} {
		l, err := ca.Server(s, hs...)
		must(err)
		must(l.WriteFiles(*out, s))
	}
	for _, c := range []string{"platform-client", "pixsim-client", "terminal-TP000001"} {
		l, err := ca.Client(c)
		must(err)
		must(l.WriteFiles(*out, c))
		if c == "terminal-TP000001" {
			fmt.Printf("terminal certificate sha256: %s\n", api.CertFingerprint(l.TLS.Certificate[0]))
		}
	}
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
