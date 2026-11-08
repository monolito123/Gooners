package carddata

import (
	"context"
	"crypto/cipher"
	"crypto/des" // #nosec G502 -- TDES DUKPT (ANSI X9.24-1) is what certified readers still send
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/monolito123/Gooners/payments/platform/pkg/emv"
)

// The formats certified readers send: the card's EMV data objects (BER-TLV, padded with zeros
// to the block size) encrypted in CBC mode with a zero IV under the DUKPT data-encryption key
// of the transaction, identified by its key serial number (KSN). MPoC SDKs, Tap to Pay
// providers and PCI PTS readers each document which derivation they use; the payment HSM's
// adapter takes it from the format name.
const (
	// FormatDUKPTTDES is TDES DUKPT (ANSI X9.24-1:2009), a 10-byte KSN, the request data key.
	FormatDUKPTTDES = "dukpt-tdes-cbc-tlv-v1"
	// FormatDUKPTAES128 is AES DUKPT (ANSI X9.24-3:2017) with AES-128 working keys and a
	// 12-byte KSN. Only a payment HSM decrypts it here.
	FormatDUKPTAES128 = "dukpt-aes128-cbc-tlv-v1"
)

var (
	keyMask     = [16]byte{0xC0, 0xC0, 0xC0, 0xC0, 0, 0, 0, 0, 0xC0, 0xC0, 0xC0, 0xC0, 0, 0, 0, 0}
	pinVariant  = [16]byte{0, 0, 0, 0, 0, 0, 0, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0xFF}
	dataVariant = [16]byte{0, 0, 0, 0, 0, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0, 0}
)

// IPEK derives the initial key a reader is loaded with from the base derivation key (BDK, a
// double-length TDES key) and the reader's key serial number (10 bytes).
func IPEK(bdk, ksn []byte) ([]byte, error) {
	if len(bdk) != 16 || len(ksn) != 10 {
		return nil, errors.New("carddata: TDES DUKPT needs a 16-byte BDK and a 10-byte KSN")
	}
	base := make([]byte, 8)
	copy(base, ksn[:8])
	base[7] &= 0xE0 // the counter's high bits cleared
	left := tdesEncrypt(bdk, base)
	var masked [16]byte
	for i := range masked {
		masked[i] = bdk[i] ^ keyMask[i]
	}
	right := tdesEncrypt(masked[:], base)
	return append(left, right...), nil
}

// TransactionKey derives the key of the transaction the KSN's 21-bit counter names, walking
// the counter's set bits from the most significant (the non-reversible key generation process).
func TransactionKey(bdk, ksn []byte) ([]byte, error) {
	key, err := IPEK(bdk, ksn)
	if err != nil {
		return nil, err
	}
	counter := uint32(ksn[7]&0x1F)<<16 | uint32(ksn[8])<<8 | uint32(ksn[9])
	reg := make([]byte, 8)
	copy(reg, ksn[2:])
	reg[5] &= 0xE0
	reg[6], reg[7] = 0, 0
	for bit := uint32(1 << 20); bit > 0; bit >>= 1 {
		if counter&bit == 0 {
			continue
		}
		reg[5] |= byte((bit >> 16) & 0x1F) // #nosec G115 -- masked to the counter's 5 high bits
		reg[6] |= byte((bit >> 8) & 0xFF)  // #nosec G115 -- masked to one byte
		reg[7] |= byte(bit & 0xFF)         // #nosec G115 -- masked to one byte
		key = nonReversible(key, reg)
	}
	return key, nil
}

func nonReversible(key, data []byte) []byte {
	right := xor(desEncrypt(key[:8], xor(data, key[8:])), key[8:])
	var masked [16]byte
	for i := range masked {
		masked[i] = key[i] ^ keyMask[i]
	}
	left := xor(desEncrypt(masked[:8], xor(data, masked[8:])), masked[8:])
	return append(left, right...)
}

// PINKey is the transaction's PIN-encryption key.
func PINKey(bdk, ksn []byte) ([]byte, error) {
	k, err := TransactionKey(bdk, ksn)
	if err != nil {
		return nil, err
	}
	return xor(k, pinVariant[:]), nil
}

// DataKey is the transaction's request data-encryption key: the data variant, then encrypted
// with itself (X9.24-1:2009's one-way step).
func DataKey(bdk, ksn []byte) ([]byte, error) {
	k, err := TransactionKey(bdk, ksn)
	if err != nil {
		return nil, err
	}
	v := xor(k, dataVariant[:])
	return append(tdesEncrypt(v, v[:8]), tdesEncrypt(v, v[8:])...), nil
}

// SoftwareDUKPT decrypts FormatDUKPTTDES with the BDK in process memory: the sandbox's and
// certification's stand-in for a payment HSM, so readers' real format runs end to end.
// Production refuses it: a BDK must never leave an HSM.
type SoftwareDUKPT struct{ BDK []byte }

// Decrypt implements Decryptor.
func (s SoftwareDUKPT) Decrypt(_ context.Context, format, ksnHex string, ct []byte) (Card, error) {
	if format != FormatDUKPTTDES {
		return Card{}, fmt.Errorf("carddata: format %q needs a payment HSM", format)
	}
	ksn, err := hex.DecodeString(ksnHex)
	if err != nil {
		return Card{}, errors.New("carddata: the KSN is not hex")
	}
	key, err := DataKey(s.BDK, ksn)
	if err != nil {
		return Card{}, err
	}
	if len(ct) == 0 || len(ct)%8 != 0 {
		return Card{}, errors.New("carddata: the ciphertext is not whole TDES blocks")
	}
	b, _ := des.NewTripleDESCipher(tdesKey(key)) // #nosec G405 -- TDES DUKPT (ANSI X9.24-1) is what certified readers send
	pt := make([]byte, len(ct))
	cipher.NewCBCDecrypter(b, make([]byte, 8)).CryptBlocks(pt, ct)
	defer clear(pt)
	return FromTLV(pt)
}

// EncryptDUKPT produces a FormatDUKPTTDES blob, as a reader would (terminal emulators and tests).
func EncryptDUKPT(bdk []byte, ksnHex string, tlv []byte) ([]byte, error) {
	ksn, err := hex.DecodeString(ksnHex)
	if err != nil {
		return nil, err
	}
	key, err := DataKey(bdk, ksn)
	if err != nil {
		return nil, err
	}
	pt := append([]byte(nil), tlv...)
	for len(pt)%8 != 0 {
		pt = append(pt, 0)
	}
	b, _ := des.NewTripleDESCipher(tdesKey(key)) // #nosec G405 -- TDES DUKPT (ANSI X9.24-1) is what certified readers send
	ct := make([]byte, len(pt))
	// The format's IV is zero: every transaction has its own DUKPT key, so no two messages share
	// a key and IV.
	cipher.NewCBCEncrypter(b, make([]byte, 8)).CryptBlocks(ct, pt) // #nosec G407 -- per-transaction keys (X9.24-1)
	return ct, nil
}

// FromTLV reads the card from the EMV data objects a reader encrypted: the PAN (5A), the
// expiry (5F24), track 2 equivalent data (57), the PAN sequence number (5F34) and the
// application (4F, or 84). Only the objects DE 55 may carry are kept as EMV data: account data
// never travels in it.
func FromTLV(b []byte) (Card, error) {
	objs, err := emv.Parse(b)
	if err != nil {
		return Card{}, fmt.Errorf("carddata: %w", err)
	}
	m := emv.Map(objs)
	var c Card
	c.PAN = strings.TrimRight(m["5A"], "F")
	if v := m["5F24"]; len(v) >= 4 {
		c.Expiry = v[:4]
	}
	if t := strings.TrimRight(m["57"], "F"); t != "" {
		pan, rest, ok := strings.Cut(t, "D")
		if !ok || len(rest) < 4 {
			return Card{}, errors.New("carddata: malformed track 2 equivalent data")
		}
		c.Track2 = pan + "=" + rest
		if c.PAN == "" {
			c.PAN = pan
		}
		if c.Expiry == "" {
			c.Expiry = rest[:4]
		}
	}
	c.PANSequence = m["5F34"]
	if c.AID = m["4F"]; c.AID == "" {
		c.AID = m["84"]
	}
	if len(c.PAN) < 12 || len(c.PAN) > 19 || strings.Trim(c.PAN, "0123456789") != "" {
		return Card{}, errors.New("carddata: no account number in the card data")
	}
	if len(c.Expiry) != 4 || strings.Trim(c.Expiry, "0123456789") != "" {
		return Card{}, errors.New("carddata: no expiry in the card data")
	}
	kept, _ := emv.FilterForDE55(objs)
	if c.EMVHex, err = emv.EncodeHex(kept); err != nil {
		return Card{}, err
	}
	return c, nil
}

// Formats sends each format to its decryptor: the sandbox runs the phones' development format
// beside readers' DUKPT, and production sends every DUKPT format to the payment HSM.
type Formats map[string]Decryptor

// Decrypt implements Decryptor.
func (f Formats) Decrypt(ctx context.Context, format, ksn string, ct []byte) (Card, error) {
	d, ok := f[format]
	if !ok {
		return Card{}, fmt.Errorf("carddata: format %q is not accepted here", format)
	}
	return d.Decrypt(ctx, format, ksn, ct)
}

func tdesKey(k16 []byte) []byte {
	return append(append(append([]byte{}, k16[:8]...), k16[8:16]...), k16[:8]...)
}

func tdesEncrypt(k16, block []byte) []byte {
	b, _ := des.NewTripleDESCipher(tdesKey(k16)) // #nosec G405 -- TDES DUKPT (ANSI X9.24-1) is what certified readers send
	out := make([]byte, 8)
	b.Encrypt(out, block)
	return out
}

func desEncrypt(k8, block []byte) []byte {
	b, _ := des.NewCipher(k8) // #nosec G405 -- TDES DUKPT (ANSI X9.24-1) is what certified readers send
	out := make([]byte, 8)
	b.Encrypt(out, block)
	return out
}

func xor(a, b []byte) []byte {
	out := make([]byte, len(a))
	for i := range a {
		out[i] = a[i] ^ b[i]
	}
	return out
}
