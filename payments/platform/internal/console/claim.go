package console

import (
	"io/fs"
	"net/http"
	"net/url"
	"strings"
)

// ClaimHandler serves the receipt claim page (docs/03 §3.2) at /c: the page a sale's receipt
// QR opens (RECEIPT_CLAIM_BASE points here). It is static and talks only to this origin (the
// NIP-05 file) and to the receipts' relays, which its policy names one by one.
func ClaimHandler(relays []string) http.Handler {
	sub, err := fs.Sub(files, "static")
	if err != nil {
		panic(err) // the embedded tree is fixed at build time
	}
	connect := []string{"'self'"}
	for _, r := range relays {
		if u, err := url.Parse(strings.TrimSpace(r)); err == nil && (u.Scheme == "wss" || u.Scheme == "ws") && u.Host != "" {
			connect = append(connect, u.Scheme+"://"+u.Host)
		}
	}
	csp := "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src " + strings.Join(connect, " ") +
		"; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
	// Only these files: the page, its scripts and styles, and the shared verifier and tokens.
	assets := map[string]string{
		"/c": "claim/index.html", "/c/claim/claim.js": "claim/claim.js", "/c/claim/nostr.js": "claim/nostr.js",
		"/c/claim/claim.css": "claim/claim.css", "/c/verify.js": "verify.js", "/c/tokens.css": "tokens.css",
	}
	static := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name, ok := assets[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("Cache-Control", "no-cache")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		h.Set("Referrer-Policy", "no-referrer")
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/" + name
		if name == "claim/index.html" {
			// FileServer redirects …/index.html to …/; serve the bytes directly.
			b, err := fs.ReadFile(sub, name)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			h.Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(b)
			return
		}
		static.ServeHTTP(w, r2)
	})
}
