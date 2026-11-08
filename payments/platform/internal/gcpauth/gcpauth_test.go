package gcpauth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The JWT bearer grant: the token endpoint checks the assertion's signature, audience and
// scopes, as Google's does, and the token is reused until near its expiry.
func TestServiceAccountToken(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	calls := 0
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		parts := strings.Split(r.Form.Get("assertion"), ".")
		if r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" || len(parts) != 3 {
			w.WriteHeader(400)
			return
		}
		sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
		d := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
		if rsa.VerifyPKCS1v15(&key.PublicKey, crypto.SHA256, d[:], sig) != nil {
			w.WriteHeader(401)
			return
		}
		var c map[string]any
		b, _ := base64.RawURLEncoding.DecodeString(parts[1])
		json.Unmarshal(b, &c)
		if c["aud"] != srv.URL+"/token" || c["scope"] != "https://www.googleapis.com/auth/cloudkms" || c["iss"] != "platform@p.iam.gserviceaccount.com" {
			w.WriteHeader(403)
			return
		}
		calls++
		w.Write([]byte(`{"access_token":"ya29.token","expires_in":3599,"token_type":"Bearer"}`))
	}))
	defer srv.Close()

	der, _ := x509.MarshalPKCS8PrivateKey(key)
	file, _ := json.Marshal(map[string]string{"type": "service_account", "client_email": "platform@p.iam.gserviceaccount.com", "private_key_id": "k1",
		"private_key": string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), "token_uri": srv.URL + "/token"})
	ts, err := ServiceAccountFromJSON(file, "https://www.googleapis.com/auth/cloudkms")
	if err != nil {
		t.Fatal(err)
	}
	for range 3 {
		if tok, err := ts.Token(context.Background()); err != nil || tok != "ya29.token" {
			t.Fatalf("%q %v", tok, err)
		}
	}
	if calls != 1 {
		t.Fatalf("token fetched %d times", calls)
	}
	if _, err := ServiceAccountFromJSON([]byte(`{"type":"authorized_user"}`)); err == nil {
		t.Fatal("a user credential accepted as a service account")
	}
}

func TestMetadataToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Metadata-Flavor") != "Google" || !strings.HasSuffix(r.URL.Path, "/service-accounts/default/token") {
			w.WriteHeader(403)
			return
		}
		w.Write([]byte(`{"access_token":"ya29.meta","expires_in":3599}`))
	}))
	defer srv.Close()
	ts := &cached{src: &Metadata{Endpoint: srv.URL, Scopes: []string{"https://www.googleapis.com/auth/cloudkms"}}}
	if tok, err := ts.Token(context.Background()); err != nil || tok != "ya29.meta" {
		t.Fatalf("%q %v", tok, err)
	}
}
