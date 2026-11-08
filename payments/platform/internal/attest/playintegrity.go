package attest

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/gcpauth"
)

// Play Integrity (docs/05 §2.4, integration point 14): a second Android signal beside key
// attestation. The app asks Google for a standard integrity token over the exact request it is
// about to send (its requestHash), and the platform has Google decrypt and decode it
// (decodeIntegrityToken) before a card sale: the app is the one Play distributes, signed with
// the platform's key, on a device that passes Google's integrity checks.

// PlayIntegrityScope is the OAuth scope of the decode API.
const PlayIntegrityScope = "https://www.googleapis.com/auth/playintegrity"

// PlayIntegrity decodes and checks tokens.
type PlayIntegrity struct {
	PackageName string
	// SigningDigests are the SHA-256 digests of the app's signing certificates.
	SigningDigests [][]byte
	// Strong requires MEETS_STRONG_INTEGRITY (hardware-backed, recent security patch).
	Strong   bool
	Tokens   gcpauth.TokenSource
	Endpoint string // https://playintegrity.googleapis.com
	HTTP     *http.Client
	Now      func() time.Time
}

// PlayVerdict is the decoded token's payload.
type PlayVerdict struct {
	RequestDetails struct {
		RequestPackageName string `json:"requestPackageName"`
		RequestHash        string `json:"requestHash"`
		TimestampMillis    string `json:"timestampMillis"`
	} `json:"requestDetails"`
	AppIntegrity struct {
		AppRecognitionVerdict   string   `json:"appRecognitionVerdict"`
		PackageName             string   `json:"packageName"`
		CertificateSha256Digest []string `json:"certificateSha256Digest"`
	} `json:"appIntegrity"`
	DeviceIntegrity struct {
		DeviceRecognitionVerdict []string `json:"deviceRecognitionVerdict"`
	} `json:"deviceIntegrity"`
	AccountDetails struct {
		AppLicensingVerdict string `json:"appLicensingVerdict"`
	} `json:"accountDetails"`
}

// RequestHash is what the app passes as the standard request's requestHash: the SHA-256 of the
// exact request body, in lowercase hex.
func RequestHash(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

// ErrIntegrity is a token whose verdict the policy refuses.
var ErrIntegrity = errors.New("play integrity")

// Check decodes token and applies the policy for a request whose body is body.
func (p *PlayIntegrity) Check(ctx context.Context, token string, body []byte) (*PlayVerdict, error) {
	v, err := p.decode(ctx, token)
	if err != nil {
		return nil, err
	}
	now := time.Now
	if p.Now != nil {
		now = p.Now
	}
	ms, _ := strconv.ParseInt(v.RequestDetails.TimestampMillis, 10, 64)
	at := time.UnixMilli(ms)
	digests := map[string]bool{}
	for _, d := range p.SigningDigests {
		digests[base64.RawURLEncoding.EncodeToString(d)] = true
	}
	signed := false
	for _, d := range v.AppIntegrity.CertificateSha256Digest {
		signed = signed || digests[d]
	}
	device := "MEETS_DEVICE_INTEGRITY"
	if p.Strong {
		device = "MEETS_STRONG_INTEGRITY"
	}
	switch {
	case v.RequestDetails.RequestPackageName != p.PackageName || v.AppIntegrity.PackageName != p.PackageName:
		return v, fmt.Errorf("%w: the token is for package %q", ErrIntegrity, v.RequestDetails.RequestPackageName)
	case v.RequestDetails.RequestHash != RequestHash(body):
		return v, fmt.Errorf("%w: the token was requested for another request (requestHash)", ErrIntegrity)
	case ms == 0 || now().Sub(at).Abs() > 10*time.Minute:
		return v, fmt.Errorf("%w: the token is not fresh (%s)", ErrIntegrity, at.UTC().Format(time.RFC3339))
	case v.AppIntegrity.AppRecognitionVerdict != "PLAY_RECOGNIZED":
		return v, fmt.Errorf("%w: the app is %s, not the one Play distributes", ErrIntegrity, v.AppIntegrity.AppRecognitionVerdict)
	case !signed:
		return v, fmt.Errorf("%w: the app is not signed with the platform's key", ErrIntegrity)
	case !slices.Contains(v.DeviceIntegrity.DeviceRecognitionVerdict, device):
		return v, fmt.Errorf("%w: the device does not meet %s (%v)", ErrIntegrity, device, v.DeviceIntegrity.DeviceRecognitionVerdict)
	case v.AccountDetails.AppLicensingVerdict == "UNLICENSED":
		return v, fmt.Errorf("%w: the app was not installed from Play", ErrIntegrity)
	}
	return v, nil
}

func (p *PlayIntegrity) decode(ctx context.Context, token string) (*PlayVerdict, error) {
	if token == "" {
		return nil, fmt.Errorf("%w: no token", ErrIntegrity)
	}
	base := p.Endpoint
	if base == "" {
		base = "https://playintegrity.googleapis.com"
	}
	bearer, err := p.Tokens.Token(ctx)
	if err != nil {
		return nil, fmt.Errorf("play integrity: credentials: %w", err)
	}
	body, _ := json.Marshal(map[string]string{"integrity_token": token})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/"+url.PathEscape(p.PackageName)+":decodeIntegrityToken", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	hc := p.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("play integrity: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	switch {
	case resp.StatusCode == http.StatusBadRequest:
		return nil, fmt.Errorf("%w: Google refused the token: %.200s", ErrIntegrity, raw)
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("play integrity: decode answered HTTP %d: %.200s", resp.StatusCode, raw)
	}
	var out struct {
		Payload PlayVerdict `json:"tokenPayloadExternal"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("play integrity: %w", err)
	}
	return &out.Payload, nil
}
