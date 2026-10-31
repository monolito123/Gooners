// Package console is the web console: a static app embedded in the platform and served at
// /console/ on the API's own origin, so it calls the API without CORS. It signs in with a
// partner API key held in the page's memory only, and covers every function of the API:
// merchants, terminals and phones, charges (Pix, crypto), refunds, disputes, balances,
// payouts, statements verified in the browser, risk reviews, crypto, international
// accounts, B3 investments and webhooks.
package console

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed static
var files embed.FS

// CSP lets the console run its own scripts and styles only: no inline code, no third
// party, images from itself or data: URLs, API calls to its own origin.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
	"base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

// Handler serves the console under /console/. It lists no directories.
func Handler() http.Handler {
	sub, err := fs.Sub(files, "static")
	if err != nil {
		panic(err) // the embedded tree is fixed at build time
	}
	static := http.StripPrefix("/console/", http.FileServer(http.FS(sub)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", CSP)
		h.Set("Cache-Control", "no-cache")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if strings.HasSuffix(r.URL.Path, "/") && r.URL.Path != "/console/" {
			http.NotFound(w, r)
			return
		}
		static.ServeHTTP(w, r)
	})
}
