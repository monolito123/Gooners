package vault

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/monolito123/Gooners/payments/platform/internal/awsauth"
	"github.com/monolito123/Gooners/payments/platform/internal/gcpauth"
)

// fakeKMS seals with a local key and checks what the real services check: the operation, the
// key, the binding context, and that the request is signed (AWS) or carries a token (Google).
type fakeKMS struct {
	inner *LocalKEK
	t     *testing.T
}

func newFake(t *testing.T) *fakeKMS {
	k := make([]byte, 32)
	rand.Read(k)
	l, _ := NewLocalKEK("hsm", k)
	return &fakeKMS{inner: l, t: t}
}

func (f *fakeKMS) aws(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AKIA/") || !strings.Contains(r.Header.Get("Authorization"), "/sa-east-1/kms/aws4_request") {
		w.WriteHeader(403)
		return
	}
	var in struct {
		KeyID             string            `json:"KeyId"`
		Plaintext         []byte            `json:"Plaintext"`
		CiphertextBlob    []byte            `json:"CiphertextBlob"`
		EncryptionContext map[string]string `json:"EncryptionContext"`
	}
	json.NewDecoder(r.Body).Decode(&in)
	if in.KeyID != "alias/goonerspay-vault" {
		w.WriteHeader(400)
		w.Write([]byte(`{"__type":"NotFoundException","message":"no such key"}`))
		return
	}
	aad := []byte(in.EncryptionContext["purpose"])
	switch r.Header.Get("X-Amz-Target") {
	case "TrentService.Encrypt":
		ct, _ := seal(f.inner.aead, in.Plaintext, aad)
		json.NewEncoder(w).Encode(map[string]any{"CiphertextBlob": ct, "KeyId": "arn:aws:kms:sa-east-1:1:key/k"})
	case "TrentService.Decrypt":
		pt, err := open(f.inner.aead, in.CiphertextBlob, aad)
		if err != nil {
			w.WriteHeader(400)
			w.Write([]byte(`{"__type":"InvalidCiphertextException"}`))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"Plaintext": pt})
	default:
		w.WriteHeader(400)
	}
}

func (f *fakeKMS) gcp(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer ya29.t" || !strings.HasPrefix(r.URL.Path, "/v1/projects/p/locations/southamerica-east1/keyRings/r/cryptoKeys/vault:") {
		w.WriteHeader(403)
		return
	}
	var in struct {
		Plaintext  []byte `json:"plaintext"`
		Ciphertext []byte `json:"ciphertext"`
		AAD        []byte `json:"additionalAuthenticatedData"`
	}
	json.NewDecoder(r.Body).Decode(&in)
	switch {
	case strings.HasSuffix(r.URL.Path, ":encrypt"):
		ct, _ := seal(f.inner.aead, in.Plaintext, in.AAD)
		json.NewEncoder(w).Encode(map[string]any{"ciphertext": ct})
	case strings.HasSuffix(r.URL.Path, ":decrypt"):
		pt, err := open(f.inner.aead, in.Ciphertext, in.AAD)
		if err != nil {
			w.WriteHeader(400)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"plaintext": pt})
	}
}

func TestKMSKEKs(t *testing.T) {
	ctx := context.Background()
	f := newFake(t)
	awsSrv := httptest.NewServer(http.HandlerFunc(f.aws))
	defer awsSrv.Close()
	gcpSrv := httptest.NewServer(http.HandlerFunc(f.gcp))
	defer gcpSrv.Close()

	aws := NewAWSKMS("alias/goonerspay-vault", "sa-east-1")
	aws.Client.Endpoint, aws.Client.Credentials = awsSrv.URL, awsauth.Static{AccessKeyID: "AKIA", SecretAccessKey: "s"}
	gcp := &GCPKMS{Name: "projects/p/locations/southamerica-east1/keyRings/r/cryptoKeys/vault", AAD: []byte("goonerspay-vault"), Tokens: gcpauth.Static("ya29.t"), Endpoint: gcpSrv.URL}

	for _, k := range []KEK{aws, gcp} {
		dek := make([]byte, 32)
		rand.Read(dek)
		w, err := k.Wrap(ctx, dek)
		if err != nil {
			t.Fatalf("%s wrap: %v", k.ID(), err)
		}
		if bytes.Contains(w, dek) {
			t.Fatalf("%s: the wrapped key contains the key", k.ID())
		}
		got, err := k.Unwrap(ctx, w)
		if err != nil || !bytes.Equal(got, dek) {
			t.Fatalf("%s unwrap: %v", k.ID(), err)
		}
		w[len(w)-1] ^= 1
		if _, err := k.Unwrap(ctx, w); err == nil {
			t.Fatalf("%s: a tampered blob unwrapped", k.ID())
		}
	}

	// A different binding context is refused, and an unknown key is an error, not a fallback.
	dek := make([]byte, 32)
	w, _ := aws.Wrap(ctx, dek)
	other := *aws
	other.Context = map[string]string{"purpose": "another-system"}
	if _, err := other.Unwrap(ctx, w); err == nil {
		t.Fatal("unwrapped under another encryption context")
	}
	other.KeyID = "alias/unknown"
	if _, err := other.Wrap(ctx, dek); err == nil || !strings.Contains(err.Error(), "NotFoundException") {
		t.Fatalf("unknown key: %v", err)
	}
	if aws.ID() != "aws-kms:alias/goonerspay-vault" || !strings.HasPrefix(gcp.ID(), "gcp-kms:projects/") {
		t.Fatal(aws.ID(), gcp.ID())
	}
}
