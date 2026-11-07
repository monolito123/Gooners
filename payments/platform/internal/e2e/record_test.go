package e2e

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
)

// With GOONERSPAY_RECORD set to a file, every API response the tests receive is appended to it
// as a JSON line (method, path, status, content type, body). payments/tools/check-responses.mjs
// then validates each against the OpenAPI contract: what an integrator gets is what the
// contract says, on every route the suite exercises.
func init() {
	file := os.Getenv("GOONERSPAY_RECORD")
	if file == "" {
		return
	}
	http.DefaultClient.Transport = &recorder{base: http.DefaultTransport, file: file}
}

type recorder struct {
	base http.RoundTripper
	file string
	mu   sync.Mutex
}

func (r *recorder) RoundTrip(req *http.Request) (*http.Response, error) {
	var sent []byte
	if req.Body != nil && req.Body != http.NoBody {
		b, err := io.ReadAll(req.Body)
		req.Body.Close()
		if err != nil {
			return nil, err
		}
		sent = b
		req.Body = io.NopCloser(bytes.NewReader(b))
	}
	resp, err := r.base.RoundTrip(req)
	if err != nil || !strings.HasPrefix(req.URL.Path, "/v1/") {
		return resp, err
	}
	raw, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return nil, err
	}
	resp.Body = io.NopCloser(bytes.NewReader(raw))
	line, _ := json.Marshal(map[string]any{"method": req.Method, "path": req.URL.Path, "status": resp.StatusCode,
		"content_type": resp.Header.Get("Content-Type"), "body": string(raw), "request": string(sent),
		"request_type": req.Header.Get("Content-Type"), "api_version": resp.Header.Get("Api-Version")})
	r.mu.Lock()
	defer r.mu.Unlock()
	if f, err := os.OpenFile(r.file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600); err == nil {
		_, _ = f.Write(append(line, '\n'))
		_ = f.Close()
	}
	return resp, nil
}
