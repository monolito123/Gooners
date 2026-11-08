// Command relaysim runs the sandbox's Nostr relay (internal/relay): anyone publishes, gift
// wraps are read only by their NIP-42-authenticated recipient, and receipt claims are logged.
//
//	relaysim -listen :7447
package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/relay"
)

func main() {
	listen := flag.String("listen", ":7447", "address to listen on (ws://)")
	flag.Parse()
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	srv := &http.Server{Addr: *listen, Handler: &relay.Relay{Log: log}, ReadHeaderTimeout: 5 * time.Second}
	log.Info("relaysim: listening", "addr", *listen)
	if err := srv.ListenAndServe(); err != nil {
		log.Error("relaysim", "err", err)
		os.Exit(1)
	}
}
