// Package worm writes records nobody can change or delete before their retention ends: S3
// Object Lock in compliance mode (not even the account's root user can shorten it), signed
// with SigV4 and no SDK. The platform exports each day's audit rows to it (payments
// ExportAudit), so the hash-chained trail survives a database administrator's mistake or
// malice for the ten years records must be kept (Circular BCB 3.978/2020, art. 67).
package worm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/awsauth"
)

// Store keeps objects locked until a date.
type Store interface {
	// PutLocked writes key once; it cannot be changed or deleted until retainUntil. It returns
	// the object's version.
	PutLocked(ctx context.Context, key string, body []byte, contentType string, retainUntil time.Time) (string, error)
	// Checksum is the stored object's SHA-256 (base64) and version.
	Checksum(ctx context.Context, key string) (sha256B64, version string, err error)
	Name() string
}

// S3 is a bucket created with Object Lock enabled (it cannot be enabled on an existing bucket
// without AWS's help), versioning on.
type S3 struct {
	Bucket, Region string
	// Endpoint is an S3-compatible server's base URL (path-style requests): MinIO, a test.
	// Empty is AWS (virtual-hosted requests).
	Endpoint    string
	Credentials awsauth.Provider
	HTTP        *http.Client
	Now         func() time.Time
}

// Name implements Store.
func (s *S3) Name() string { return "s3://" + s.Bucket }

// PutLocked implements Store: a PUT with the object's retention in compliance mode and its
// SHA-256 checksum, which S3 requires for a locked object and checks against the body.
func (s *S3) PutLocked(ctx context.Context, key string, body []byte, contentType string, retainUntil time.Time) (string, error) {
	if s.Bucket == "" || s.Region == "" {
		return "", errors.New("worm: bucket and region are required")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, s.url(key), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(body)
	req.ContentLength = int64(len(body))
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Amz-Object-Lock-Mode", "COMPLIANCE")
	req.Header.Set("X-Amz-Object-Lock-Retain-Until-Date", retainUntil.UTC().Format(time.RFC3339))
	req.Header.Set("X-Amz-Sdk-Checksum-Algorithm", "SHA256")
	req.Header.Set("X-Amz-Checksum-Sha256", base64.StdEncoding.EncodeToString(sum[:]))
	// Never overwrite: a key already written is an export already done.
	req.Header.Set("If-None-Match", "*")
	resp, err := s.do(ctx, req, body)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	switch resp.StatusCode {
	case http.StatusOK:
		return resp.Header.Get("X-Amz-Version-Id"), nil
	case http.StatusPreconditionFailed:
		return "", ErrExists
	}
	var e struct {
		Code    string `xml:"Code"`
		Message string `xml:"Message"`
	}
	_ = xml.Unmarshal(raw, &e)
	return "", fmt.Errorf("worm: %s answered HTTP %d %s: %s", s.Name(), resp.StatusCode, e.Code, e.Message)
}

// Checksum implements Store: a HEAD asking for the checksum S3 kept with the object.
func (s *S3) Checksum(ctx context.Context, key string) (string, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, s.url(key), nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("X-Amz-Checksum-Mode", "ENABLED")
	resp, err := s.do(ctx, req, nil)
	if err != nil {
		return "", "", err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("worm: %s answered HTTP %d for %s", s.Name(), resp.StatusCode, key)
	}
	return resp.Header.Get("X-Amz-Checksum-Sha256"), resp.Header.Get("X-Amz-Version-Id"), nil
}

func (s *S3) url(key string) string {
	if s.Endpoint != "" {
		return strings.TrimSuffix(s.Endpoint, "/") + "/" + s.Bucket + "/" + escapeKey(key)
	}
	return "https://" + s.Bucket + ".s3." + s.Region + ".amazonaws.com/" + escapeKey(key)
}

func (s *S3) do(ctx context.Context, req *http.Request, body []byte) (*http.Response, error) {
	creds, err := s.Credentials.Retrieve(ctx)
	if err != nil {
		return nil, fmt.Errorf("worm: credentials: %w", err)
	}
	now := time.Now
	if s.Now != nil {
		now = s.Now
	}
	awsauth.Sign(req, body, creds, s.Region, "s3", now())
	hc := s.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 60 * time.Second}
	}
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("worm: %w", err)
	}
	return resp, nil
}

// ErrExists is a key already written: its content is whatever was written first.
var ErrExists = errors.New("worm: the object already exists")

func escapeKey(key string) string {
	parts := strings.Split(key, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return strings.Join(parts, "/")
}

// Memory is a store in memory with the same rules (tests): a key is written once.
type Memory struct {
	mu      sync.Mutex
	Objects map[string][]byte
}

// NewMemory returns an empty store.
func NewMemory() *Memory { return &Memory{Objects: map[string][]byte{}} }

// Name implements Store.
func (m *Memory) Name() string { return "memory" }

// PutLocked implements Store.
func (m *Memory) PutLocked(_ context.Context, key string, body []byte, _ string, retainUntil time.Time) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if retainUntil.Before(time.Now()) {
		return "", errors.New("worm: a retention in the past")
	}
	if _, ok := m.Objects[key]; ok {
		return "", ErrExists
	}
	m.Objects[key] = append([]byte{}, body...)
	return "v1", nil
}

// Checksum implements Store.
func (m *Memory) Checksum(_ context.Context, key string) (string, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.Objects[key]
	if !ok {
		return "", "", errors.New("worm: no such object")
	}
	sum := sha256.Sum256(b)
	return base64.StdEncoding.EncodeToString(sum[:]), "v1", nil
}
