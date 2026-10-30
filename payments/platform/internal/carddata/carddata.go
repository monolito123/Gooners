// Package carddata decrypts the card data a terminal sends (docs/04 §4.3: encrypted on the
// device, decryptable only in the CDE).
//
// In production the terminal is an MPoC SDK or a PCI PTS reader that encrypts under DUKPT,
// and decryption happens inside a payment HSM (Thales payShield, AWS Payment Cryptography):
// implement Decryptor with the HSM's "decrypt data" / "translate PIN" commands for the
// vendor's format. DevDecryptor implements a simple AES-GCM format so the whole flow can run
// end to end without hardware; it refuses to run in production.
package carddata

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Card is clear card data, kept in memory only and only inside the CDE.
type Card struct {
	PAN         string `json:"pan"`
	Expiry      string `json:"expiry"` // YYMM
	Track2      string `json:"track2,omitempty"`
	PANSequence string `json:"pan_sequence,omitempty"`
	EMVHex      string `json:"emv,omitempty"`
	AID         string `json:"aid,omitempty"`
	PINBlockHex string `json:"pin_block,omitempty"`
}

// Decryptor turns a terminal's encrypted blob into card data.
type Decryptor interface {
	Decrypt(ctx context.Context, format, ksn string, ciphertext []byte) (Card, error)
}

// DevFormat is the development format: nonce(12) ‖ AES-256-GCM(json(Card)), additional data = KSN.
const DevFormat = "dev-aesgcm-v1"

// DevDecryptor implements DevFormat with a shared key. Never use it in production.
type DevDecryptor struct{ aead cipher.AEAD }

// NewDev returns a development decryptor.
func NewDev(key []byte) (*DevDecryptor, error) {
	a, err := gcm(key)
	if err != nil {
		return nil, err
	}
	return &DevDecryptor{aead: a}, nil
}

func gcm(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, errors.New("carddata: dev key must be 32 bytes")
	}
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(b)
}

// Decrypt implements Decryptor.
func (d *DevDecryptor) Decrypt(_ context.Context, format, ksn string, ct []byte) (Card, error) {
	if format != DevFormat {
		return Card{}, fmt.Errorf("carddata: format %q is not supported by the development decryptor", format)
	}
	n := d.aead.NonceSize()
	if len(ct) < n {
		return Card{}, errors.New("carddata: ciphertext too short")
	}
	pt, err := d.aead.Open(nil, ct[:n], ct[n:], []byte(ksn))
	if err != nil {
		return Card{}, errors.New("carddata: decryption failed")
	}
	var c Card
	if err := json.Unmarshal(pt, &c); err != nil {
		return Card{}, err
	}
	clear(pt)
	return c, nil
}

// DevEncrypt produces a DevFormat blob (terminal emulators and tests).
func DevEncrypt(key []byte, ksn string, c Card) ([]byte, error) {
	a, err := gcm(key)
	if err != nil {
		return nil, err
	}
	pt, _ := json.Marshal(c)
	nonce := make([]byte, a.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return a.Seal(nonce, nonce, pt, []byte(ksn)), nil
}

// BrandFromAID maps the EMV application identifier's RID to a brand (the kernel selected
// it, so it is authoritative for card-present). Elo, which shares Visa and Mastercard BIN
// ranges, is only recognisable this way or through the scheme BIN tables.
func BrandFromAID(aid string) string {
	aid = strings.ToUpper(aid)
	switch {
	case strings.HasPrefix(aid, "A000000003"):
		return "visa"
	case strings.HasPrefix(aid, "A000000004"):
		return "mastercard"
	case strings.HasPrefix(aid, "A000000494"):
		return "elo"
	case strings.HasPrefix(aid, "A000000025"):
		return "amex"
	}
	return ""
}

// BrandFromPAN is a coarse fallback for card-not-present; production uses the schemes'
// account-range tables (Visa ARDEF, Mastercard MPE) loaded into the BIN service.
func BrandFromPAN(pan string) string {
	if pan == "" {
		return ""
	}
	if pan[0] == '4' {
		return "visa"
	}
	if len(pan) >= 4 {
		p2 := pan[:2]
		if p2 >= "51" && p2 <= "55" {
			return "mastercard"
		}
		if p4 := pan[:4]; p4 >= "2221" && p4 <= "2720" {
			return "mastercard"
		}
	}
	return ""
}
