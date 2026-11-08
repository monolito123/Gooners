package vault

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/awsauth"
	"github.com/monolito123/Gooners/payments/platform/internal/gcpauth"
)

// The production KEKs: the key lives in a KMS's HSMs (FIPS 140-3 level 3) and never leaves
// them; the platform only asks the KMS to wrap and unwrap 32-byte data keys, and every use is
// logged by the cloud's audit trail (CloudTrail, Cloud Audit Logs). The context bound into
// each wrap means a blob from another purpose or another platform cannot be unwrapped here.
// Both APIs carry bytes as standard base64, which encoding/json produces for []byte.

// AWSKMS is a KEK in AWS KMS (a symmetric key).
type AWSKMS struct {
	// KeyID is the key's id, ARN or alias ("alias/goonerspay-vault").
	KeyID string
	// Client calls KMS (service "kms").
	Client *awsauth.Client
	// Context is the encryption context of every wrap; it must match to unwrap.
	Context map[string]string
}

// NewAWSKMS returns a KEK that calls KMS in region with the environment's credentials.
func NewAWSKMS(keyID, region string) *AWSKMS {
	return &AWSKMS{KeyID: keyID, Context: map[string]string{"purpose": "goonerspay-vault"},
		Client: &awsauth.Client{Service: "kms", Region: region, Endpoint: "https://kms." + region + ".amazonaws.com", Credentials: awsauth.FromEnvironment()}}
}

// ID implements KEK.
func (k *AWSKMS) ID() string { return "aws-kms:" + k.KeyID }

// Wrap implements KEK (KMS Encrypt).
func (k *AWSKMS) Wrap(ctx context.Context, dek []byte) ([]byte, error) {
	var out struct {
		CiphertextBlob []byte `json:"CiphertextBlob"`
	}
	err := k.Client.Do(ctx, "POST", "/", map[string]string{"X-Amz-Target": "TrentService.Encrypt", "Content-Type": "application/x-amz-json-1.1"},
		map[string]any{"KeyId": k.KeyID, "Plaintext": dek, "EncryptionContext": k.Context}, &out)
	if err != nil {
		return nil, fmt.Errorf("vault: kms encrypt: %w", err)
	}
	return out.CiphertextBlob, nil
}

// Unwrap implements KEK (KMS Decrypt, pinned to the key so another key's blob is refused).
func (k *AWSKMS) Unwrap(ctx context.Context, wrapped []byte) ([]byte, error) {
	var out struct {
		Plaintext []byte `json:"Plaintext"`
	}
	err := k.Client.Do(ctx, "POST", "/", map[string]string{"X-Amz-Target": "TrentService.Decrypt", "Content-Type": "application/x-amz-json-1.1"},
		map[string]any{"KeyId": k.KeyID, "CiphertextBlob": wrapped, "EncryptionContext": k.Context}, &out)
	if err != nil {
		return nil, fmt.Errorf("vault: kms decrypt: %w", err)
	}
	return out.Plaintext, nil
}

// GCPKMS is a KEK in Google Cloud KMS (a symmetric ENCRYPT_DECRYPT key, protection level HSM).
type GCPKMS struct {
	// Name is the key's resource name: projects/…/locations/…/keyRings/…/cryptoKeys/….
	Name string
	// AAD is bound into every wrap; it must match to unwrap.
	AAD      []byte
	Tokens   gcpauth.TokenSource
	Endpoint string // https://cloudkms.googleapis.com
	HTTP     *http.Client
}

// NewGCPKMS returns a KEK that calls Cloud KMS with the environment's credentials.
func NewGCPKMS(name string) (*GCPKMS, error) {
	ts, err := gcpauth.FromEnvironment("https://www.googleapis.com/auth/cloudkms")
	if err != nil {
		return nil, err
	}
	return &GCPKMS{Name: name, AAD: []byte("goonerspay-vault"), Tokens: ts, Endpoint: "https://cloudkms.googleapis.com"}, nil
}

// ID implements KEK.
func (k *GCPKMS) ID() string { return "gcp-kms:" + k.Name }

// Wrap implements KEK (cryptoKeys.encrypt).
func (k *GCPKMS) Wrap(ctx context.Context, dek []byte) ([]byte, error) {
	var out struct {
		Ciphertext []byte `json:"ciphertext"`
	}
	if err := k.call(ctx, "encrypt", map[string]any{"plaintext": dek, "additionalAuthenticatedData": k.AAD}, &out); err != nil {
		return nil, err
	}
	return out.Ciphertext, nil
}

// Unwrap implements KEK (cryptoKeys.decrypt).
func (k *GCPKMS) Unwrap(ctx context.Context, wrapped []byte) ([]byte, error) {
	var out struct {
		Plaintext []byte `json:"plaintext"`
	}
	if err := k.call(ctx, "decrypt", map[string]any{"ciphertext": wrapped, "additionalAuthenticatedData": k.AAD}, &out); err != nil {
		return nil, err
	}
	return out.Plaintext, nil
}

func (k *GCPKMS) call(ctx context.Context, verb string, in, out any) error {
	if !strings.HasPrefix(k.Name, "projects/") || strings.Contains(k.Name, "..") {
		return errors.New("vault: the Cloud KMS key name must be projects/…/cryptoKeys/…")
	}
	tok, err := k.Tokens.Token(ctx)
	if err != nil {
		return err
	}
	body, _ := json.Marshal(in)
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(k.Endpoint, "/")+"/v1/"+k.Name+":"+verb, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	hc := k.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := hc.Do(req)
	if err != nil {
		return fmt.Errorf("vault: cloud kms %s: %w", verb, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("vault: cloud kms %s: HTTP %d: %s", verb, resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return json.Unmarshal(b, out)
}
