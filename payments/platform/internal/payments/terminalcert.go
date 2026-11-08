package payments

import (
	"context"
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/attest"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
)

// Terminal certificates (docs/05 §2.4). A terminal generates its mutual-TLS key in its secure
// hardware and sends a CSR; the platform's terminal CA signs a client certificate for the
// terminal ID with that key, valid for 30 days, and binds its SHA-256 to the terminal. The
// terminal renews it over its current mutual-TLS connection; the certificate it replaces keeps
// working until the terminal first presents the new one. On an Android phone whose device
// attested with hardware key attestation, the terminal key must be attested too, with the
// terminal's challenge (attest.TerminalChallenge), or no certificate is issued.

// ErrNoTerminalCA is a CSR on a platform without a terminal CA: certificates then come from
// an external terminal PKI and are registered by their SHA-256.
var ErrNoTerminalCA = fmt.Errorf("%w: this platform has no terminal CA (TERMINAL_CA_CERT); register the SHA-256 of a certificate the terminal PKI issued",
	ErrDisabled)

// TerminalCertificateRequest is a terminal's CSR and, from Android, its key's attestation
// chain (DER certificates, leaf first).
type TerminalCertificateRequest struct {
	CSR            *x509.CertificateRequest
	KeyAttestation [][]byte
}

// TerminalKeyVerifier checks an Android hardware key attestation of a terminal's key.
type TerminalKeyVerifier interface {
	// VerifyTerminalKey verifies chain against attest.TerminalChallenge(terminalID) and
	// requires its leaf to attest key; it returns where the key lives.
	VerifyTerminalKey(chain [][]byte, terminalID string, key *ecdsa.PublicKey) (string, error)
}

// VerifyTerminalKey implements TerminalKeyVerifier.
func (a VerifyingAttestor) VerifyTerminalKey(chain [][]byte, terminalID string, key *ecdsa.PublicKey) (string, error) {
	if a.KeyAttestation == nil {
		return "", errors.New("android key attestation is not configured")
	}
	res, err := attest.VerifyKeyAttestation(*a.KeyAttestation, chain, attest.TerminalChallenge(terminalID))
	if err != nil {
		return "", err
	}
	point, err := key.Bytes() // 0x04 || X || Y
	if err != nil || len(point) != 65 {
		return "", errors.New("the CSR's key must be ECDSA P-256")
	}
	if res.JWKX != base64.RawURLEncoding.EncodeToString(point[1:33]) || res.JWKY != base64.RawURLEncoding.EncodeToString(point[33:]) {
		return "", errors.New("the attested key is not the CSR's key")
	}
	return res.SecurityLevel, nil
}

// IssuesTerminalCertificates reports whether the platform has a terminal CA.
func (s *Service) IssuesTerminalCertificates() bool { return s.terminalCA != nil }

// keyVerifier is the service's Android key attestation verifier, when it has one configured.
func (s *Service) keyVerifier() (TerminalKeyVerifier, bool) {
	if va, ok := s.attest.(VerifyingAttestor); ok && va.KeyAttestation == nil {
		return nil, false
	}
	kv, ok := s.attest.(TerminalKeyVerifier)
	return kv, ok
}

// RegisterTerminalCSR registers a terminal and issues its certificate from req, in one step.
func (s *Service) RegisterTerminalCSR(ctx context.Context, tenantID, merchantID, typ string, req TerminalCertificateRequest) (*Terminal, error) {
	return s.registerTerminal(ctx, tenantID, merchantID, typ, "", &req)
}

// CertifyTerminal issues a new certificate for an active terminal: its first one (a phone's
// terminal, created when the device registered) or a renewal. presented is the SHA-256 of the
// certificate a renewing terminal connected with: the one it surely holds, which keeps working
// until it presents the new one, even when an earlier renewal's response never reached it.
func (s *Service) CertifyTerminal(ctx context.Context, tenantID, terminalID string, req TerminalCertificateRequest, presented string) (*Terminal, error) {
	if s.terminalCA == nil {
		return nil, ErrNoTerminalCA
	}
	t := &Terminal{Object: "terminal"}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT id, merchant_id, type, status FROM terminals WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, tenantID, terminalID).
			Scan(&t.ID, &t.MerchantID, &t.Type, &t.Status)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if t.Status != "active" {
			return fmt.Errorf("%w: terminal is %s", ErrConflict, t.Status)
		}
		return s.certify(ctx, tx, tenantID, t, req, presented)
	})
	if err != nil {
		return nil, err
	}
	return t, nil
}

// certify checks req for terminal t, issues the certificate and binds it, in tx.
func (s *Service) certify(ctx context.Context, tx pgx.Tx, tenantID string, t *Terminal, req TerminalCertificateRequest, presented string) error {
	key, ok := req.CSR.PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return invalid("the CSR's key must be ECDSA P-256")
	}
	// A phone's terminal: does its device prove its keys with Android key attestation?
	var method string
	err := tx.QueryRow(ctx, `SELECT COALESCE(d.integrity->'verdict'->>'method', '') FROM terminals t JOIN devices d ON d.id = t.device_id WHERE t.id = $1`, t.ID).Scan(&method)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	kv, verifies := s.keyVerifier()
	switch {
	case len(req.KeyAttestation) > 0 && verifies:
		level, err := kv.VerifyTerminalKey(req.KeyAttestation, t.ID, key)
		if err != nil {
			return invalid("key attestation: %v", err)
		}
		t.KeySecurityLevel = level
	case method == "android_key_attestation" && verifies:
		return invalid("key_attestation is required: generate the terminal key in the Android Keystore with the challenge SHA-256(\"goonerspay/v1/terminal-key:%s\") and send its certificate chain", t.ID)
	}
	issued, err := s.terminalCA.Issue(req.CSR, t.ID, t.MerchantID)
	if err != nil {
		return fmt.Errorf("%w: terminal CA: %v", ErrUnavailable, err)
	}
	// The certificate the renewal was made over (or, without one, the current certificate)
	// keeps working until the terminal first presents the new one (TerminalByFingerprint).
	_, err = tx.Exec(ctx, `UPDATE terminals SET prev_cert_fingerprint = COALESCE(NULLIF($5, ''), cert_fingerprint), cert_fingerprint = $2,
		cert_expires_at = $3, key_security_level = NULLIF($4, '') WHERE id = $1`, t.ID, issued.SHA256, issued.ExpiresAt, t.KeySecurityLevel, presented)
	if err != nil {
		return err
	}
	expires := issued.ExpiresAt.UTC().Truncate(time.Second)
	t.Certificate, t.CertificateSHA256, t.CertificateExpiresAt = issued.PEM, issued.SHA256, &expires
	return webhooks.Enqueue(ctx, tx, tenantID, "terminal.certificate_issued", map[string]any{"terminal_id": t.ID, "merchant_id": t.MerchantID,
		"certificate_sha256": issued.SHA256, "expires_at": expires})
}
