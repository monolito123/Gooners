package attest

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// GoogleStatusURL serves Google's attestation certificate status list
// (https://developer.android.com/privacy-and-security/security-key-attestation#certificate_status).
const GoogleStatusURL = "https://android.googleapis.com/attestation/status"

// RevocationList is the attestation certificate status list: the serial numbers, in lowercase
// hexadecimal, of attestation keys and intermediates Google revoked or suspended (a leaked
// key, a compromised device line).
type RevocationList struct {
	Entries map[string]RevocationEntry `json:"entries"`
}

// RevocationEntry is one listed certificate.
type RevocationEntry struct {
	Status string `json:"status"` // REVOKED or SUSPENDED
	Reason string `json:"reason,omitempty"`
}

// ParseRevocationList reads the list's JSON.
func ParseRevocationList(b []byte) (*RevocationList, error) {
	var l RevocationList
	if err := json.Unmarshal(b, &l); err != nil {
		return nil, fmt.Errorf("revocation list: %w", err)
	}
	if l.Entries == nil {
		return nil, errors.New("revocation list: no entries object")
	}
	return &l, nil
}

// Check refuses a chain any of whose certificates the list names, revoked or suspended.
func (l *RevocationList) Check(chain []*x509.Certificate) error {
	for i, c := range chain {
		if e, ok := l.Entries[strings.ToLower(c.SerialNumber.Text(16))]; ok {
			return fmt.Errorf("certificate %d (serial %x) is %s: %s", i, c.SerialNumber, strings.ToLower(e.Status), e.Reason)
		}
	}
	return nil
}

// RevocationSource keeps the list current: fetched from Location (an https URL or a file
// path) at Refresh, and refused once older than MaxAge, so a platform cut off from the list
// stops accepting new attestations instead of trusting a list it cannot renew.
type RevocationSource struct {
	Location string
	MaxAge   time.Duration // default 72 h
	Client   *http.Client
	Now      func() time.Time

	mu      sync.Mutex
	list    *RevocationList
	fetched time.Time
}

func (s *RevocationSource) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Refresh fetches the list. On failure the previous list stays until it is too old.
func (s *RevocationSource) Refresh(ctx context.Context) error {
	var b []byte
	var err error
	if strings.HasPrefix(s.Location, "https://") || strings.HasPrefix(s.Location, "http://") {
		b, err = s.fetch(ctx)
	} else {
		b, err = os.ReadFile(s.Location)
	}
	if err != nil {
		return fmt.Errorf("revocation list: %w", err)
	}
	l, err := ParseRevocationList(b)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.list, s.fetched = l, s.now()
	s.mu.Unlock()
	return nil
}

func (s *RevocationSource) fetch(ctx context.Context) ([]byte, error) {
	c := s.Client
	if c == nil {
		c = &http.Client{Timeout: 30 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.Location, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: HTTP %d", s.Location, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 16<<20))
}

// Current returns the list, or an error when there is none or it is too old.
func (s *RevocationSource) Current() (*RevocationList, error) {
	maxAge := s.MaxAge
	if maxAge <= 0 {
		maxAge = 72 * time.Hour
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case s.list == nil:
		return nil, errors.New("revocation list not fetched yet")
	case s.now().Sub(s.fetched) > maxAge:
		return nil, fmt.Errorf("revocation list is stale (fetched %s)", s.fetched.UTC().Format(time.RFC3339))
	}
	return s.list, nil
}
