// Package vault stores PANs encrypted (docs/04-serverless-backend.md §4.2): each PAN under its
// own AES-256-GCM data key, each data key wrapped by the tenant's key-encryption key (KEK),
// plus an HMAC fingerprint for duplicate detection without the PAN. It runs in the CDE.
package vault

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
)

// KEK wraps data keys. Production implementations call an HSM (CloudHSM, payShield) or a
// KMS; LocalKEK exists for development and tests only.
type KEK interface {
	ID() string
	Wrap(ctx context.Context, dek []byte) ([]byte, error)
	Unwrap(ctx context.Context, wrapped []byte) ([]byte, error)
}

// LocalKEK is an AES-256-GCM KEK held in process memory. Not for production.
type LocalKEK struct {
	id   string
	aead cipher.AEAD
}

// NewLocalKEK returns a local KEK from a 32-byte key.
func NewLocalKEK(id string, key []byte) (*LocalKEK, error) {
	a, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	return &LocalKEK{id: id, aead: a}, nil
}

func (k *LocalKEK) ID() string { return k.id }

func (k *LocalKEK) Wrap(_ context.Context, dek []byte) ([]byte, error) {
	return seal(k.aead, dek, []byte(k.id))
}

func (k *LocalKEK) Unwrap(_ context.Context, w []byte) ([]byte, error) {
	return open(k.aead, w, []byte(k.id))
}

func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, errors.New("vault: key must be 32 bytes")
	}
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(b)
}

func seal(a cipher.AEAD, pt, aad []byte) ([]byte, error) {
	nonce := make([]byte, a.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return a.Seal(nonce, nonce, pt, aad), nil
}

func open(a cipher.AEAD, ct, aad []byte) ([]byte, error) {
	if len(ct) < a.NonceSize() {
		return nil, errors.New("vault: ciphertext too short")
	}
	return a.Open(nil, ct[:a.NonceSize()], ct[a.NonceSize():], aad)
}

// Vault tokenizes and reveals PANs.
type Vault struct {
	pool           *pgxpool.Pool
	kek            KEK
	fingerprintKey []byte
}

// New returns a vault. fingerprintKey is a 32-byte HMAC key (kept in the HSM in production).
func New(pool *pgxpool.Pool, kek KEK, fingerprintKey []byte) (*Vault, error) {
	if len(fingerprintKey) < 32 {
		return nil, errors.New("vault: fingerprint key must be at least 32 bytes")
	}
	return &Vault{pool: pool, kek: kek, fingerprintKey: fingerprintKey}, nil
}

// Card is the non-sensitive view of a stored card.
type Card struct {
	Token       string
	Fingerprint string
	BIN         string
	Last4       string
}

// ErrNotFound is returned for unknown tokens.
var ErrNotFound = errors.New("vault: token not found")

// Luhn validates a PAN check digit.
func Luhn(pan string) bool {
	if len(pan) < 12 || len(pan) > 19 {
		return false
	}
	sum, alt := 0, false
	for i := len(pan) - 1; i >= 0; i-- {
		c := pan[i]
		if c < '0' || c > '9' {
			return false
		}
		d := int(c - '0')
		if alt {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
		alt = !alt
	}
	return sum%10 == 0
}

// Fingerprint is HMAC-SHA-256(PAN) under the fingerprint key.
func (v *Vault) Fingerprint(pan string) string {
	m := hmac.New(sha256.New, v.fingerprintKey)
	m.Write([]byte(pan))
	return "fp_" + hex.EncodeToString(m.Sum(nil))[:32]
}

// Store encrypts a PAN and returns its token.
func (v *Vault) Store(ctx context.Context, tenantID, pan string) (Card, error) {
	if !Luhn(pan) {
		return Card{}, errors.New("vault: PAN fails the Luhn check")
	}
	dek := make([]byte, 32)
	if _, err := rand.Read(dek); err != nil {
		return Card{}, err
	}
	defer clear(dek)
	a, err := newGCM(dek)
	if err != nil {
		return Card{}, err
	}
	token := ids.New("pm_card")
	ct, err := seal(a, []byte(pan), []byte(token))
	if err != nil {
		return Card{}, err
	}
	wrapped, err := v.kek.Wrap(ctx, dek)
	if err != nil {
		return Card{}, fmt.Errorf("vault: wrap: %w", err)
	}
	c := Card{Token: token, Fingerprint: v.Fingerprint(pan), BIN: pan[:6], Last4: pan[len(pan)-4:]}
	_, err = v.pool.Exec(ctx, `INSERT INTO card_vault (token, tenant_id, fingerprint, bin, last4, pan_ct, dek_wrapped, kek_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, c.Token, tenantID, c.Fingerprint, c.BIN, c.Last4, ct, wrapped, v.kek.ID())
	return c, err
}

// RevealPAN decrypts a PAN for the switch (reversals, refunds). Call it only inside the CDE.
func (v *Vault) RevealPAN(ctx context.Context, token string) (string, error) {
	var ct, wrapped []byte
	err := v.pool.QueryRow(ctx, `SELECT pan_ct, dek_wrapped FROM card_vault WHERE token = $1`, token).Scan(&ct, &wrapped)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	dek, err := v.kek.Unwrap(ctx, wrapped)
	if err != nil {
		return "", fmt.Errorf("vault: unwrap: %w", err)
	}
	defer clear(dek)
	a, err := newGCM(dek)
	if err != nil {
		return "", err
	}
	pan, err := open(a, ct, []byte(token))
	if err != nil {
		return "", fmt.Errorf("vault: decrypt: %w", err)
	}
	return string(pan), nil
}
