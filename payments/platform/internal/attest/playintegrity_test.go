package attest

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/gcpauth"
)

// Google's decode API, faked: tokens map to the verdicts the test wants.
func TestPlayIntegrity(t *testing.T) {
	digest := sha256.Sum256([]byte("goonersPAY release signing certificate"))
	body := []byte(`{"payment_intent_id":"pi_1","stan":"000001"}`)
	good := func() map[string]any {
		return map[string]any{
			"requestDetails":  map[string]any{"requestPackageName": "br.com.gooners.pay", "requestHash": RequestHash(body), "timestampMillis": strconv.FormatInt(time.Now().UnixMilli(), 10)},
			"appIntegrity":    map[string]any{"appRecognitionVerdict": "PLAY_RECOGNIZED", "packageName": "br.com.gooners.pay", "certificateSha256Digest": []string{base64.RawURLEncoding.EncodeToString(digest[:])}},
			"deviceIntegrity": map[string]any{"deviceRecognitionVerdict": []string{"MEETS_BASIC_INTEGRITY", "MEETS_DEVICE_INTEGRITY"}},
			"accountDetails":  map[string]any{"appLicensingVerdict": "LICENSED"},
		}
	}
	verdicts := map[string]map[string]any{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Token string `json:"integrity_token"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		if r.URL.Path != "/v1/br.com.gooners.pay:decodeIntegrityToken" || r.Header.Get("Authorization") != "Bearer google-token" {
			w.WriteHeader(403)
			return
		}
		v, ok := verdicts[in.Token]
		if !ok {
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"error":{"code":400,"message":"Integrity token cannot be decrypted"}}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"tokenPayloadExternal": v})
	}))
	defer srv.Close()
	p := &PlayIntegrity{PackageName: "br.com.gooners.pay", SigningDigests: [][]byte{digest[:]}, Tokens: gcpauth.Static("google-token"), Endpoint: srv.URL}
	set := func(name string, mod func(map[string]any)) {
		v := good()
		if mod != nil {
			mod(v)
		}
		verdicts[name] = v
	}
	set("good", nil)
	if _, err := p.Check(context.Background(), "good", body); err != nil {
		t.Fatal(err)
	}
	set("another request", func(v map[string]any) {
		v["requestDetails"].(map[string]any)["requestHash"] = RequestHash([]byte("{}"))
	})
	set("stale", func(v map[string]any) {
		v["requestDetails"].(map[string]any)["timestampMillis"] = strconv.FormatInt(time.Now().Add(-time.Hour).UnixMilli(), 10)
	})
	set("sideloaded", func(v map[string]any) {
		v["appIntegrity"].(map[string]any)["appRecognitionVerdict"] = "UNRECOGNIZED_VERSION"
	})
	set("re-signed", func(v map[string]any) {
		v["appIntegrity"].(map[string]any)["certificateSha256Digest"] = []string{"AAAA"}
	})
	set("rooted", func(v map[string]any) {
		v["deviceIntegrity"].(map[string]any)["deviceRecognitionVerdict"] = []string{"MEETS_BASIC_INTEGRITY"}
	})
	set("unlicensed", func(v map[string]any) { v["accountDetails"].(map[string]any)["appLicensingVerdict"] = "UNLICENSED" })
	set("another app", func(v map[string]any) {
		v["requestDetails"].(map[string]any)["requestPackageName"] = "com.example.clone"
	})
	for _, name := range []string{"another request", "stale", "sideloaded", "re-signed", "rooted", "unlicensed", "another app", "garbage", ""} {
		if _, err := p.Check(context.Background(), name, body); !errors.Is(err, ErrIntegrity) {
			t.Errorf("%q: %v", name, err)
		}
	}
	// Strong integrity asks for more than MEETS_DEVICE_INTEGRITY.
	p.Strong = true
	if _, err := p.Check(context.Background(), "good", body); err == nil || !strings.Contains(err.Error(), "STRONG") {
		t.Fatalf("strong: %v", err)
	}
}
