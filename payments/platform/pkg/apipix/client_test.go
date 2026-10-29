package apipix

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestValor(t *testing.T) {
	for cents, s := range map[int64]string{0: "0.00", 5: "0.05", 12990: "129.90", 100000000: "1000000.00"} {
		if FormatValor(cents) != s {
			t.Errorf("FormatValor(%d) = %s", cents, FormatValor(cents))
		}
		if v, err := ParseValor(s); err != nil || v != cents {
			t.Errorf("ParseValor(%s) = %d, %v", s, v, err)
		}
	}
	for _, bad := range []string{"1", "1.5", "1,50", "-1.00", "1.000"} {
		if _, err := ParseValor(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	if !ValidTxID(NewTxID()) {
		t.Fatal("NewTxID is not a valid txid")
	}
}

// Tokens are cached; a 503 is retried; a 401 refreshes the token once.
func TestTokenCacheRetryAndRefresh(t *testing.T) {
	var tokens, calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			if u, p, ok := r.BasicAuth(); !ok || u != "id" || p != "secret" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			n := tokens.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "t" + string(rune('0'+n)), "expires_in": 3600})
			return
		}
		switch calls.Add(1) {
		case 1:
			w.WriteHeader(http.StatusServiceUnavailable)
		case 2:
			w.WriteHeader(http.StatusUnauthorized)
		default:
			if r.Header.Get("Authorization") != "Bearer t2" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_ = json.NewEncoder(w).Encode(Cob{TxID: "x", Status: CobAtiva})
		}
	}))
	defer srv.Close()
	c := New(Config{BaseURL: srv.URL + "/api/v2", TokenURL: srv.URL + "/oauth/token", ClientID: "id", ClientSecret: "secret", HTTPClient: srv.Client()})
	cob, err := c.GetCob(context.Background(), "x")
	if err != nil || cob.Status != CobAtiva {
		t.Fatalf("%+v %v", cob, err)
	}
	if tokens.Load() != 2 || calls.Load() != 3 {
		t.Fatalf("tokens %d, calls %d", tokens.Load(), calls.Load())
	}
	if _, err := c.GetCob(context.Background(), "x"); err != nil || tokens.Load() != 2 {
		t.Fatal("token should be cached")
	}
}
