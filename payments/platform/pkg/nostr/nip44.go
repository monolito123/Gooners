package nostr

import (
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math/bits"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	"golang.org/x/crypto/chacha20"
)

// ConversationKey derives the NIP-44 v2 conversation key between a secret key and an
// x-only public key: HKDF-Extract(salt = "nip44-v2", IKM = shared x coordinate).
func ConversationKey(sk *btcec.PrivateKey, pubHex string) ([]byte, error) {
	pb, err := hex.DecodeString(pubHex)
	if err != nil || len(pb) != 32 {
		return nil, errors.New("nip44: bad public key")
	}
	pub, err := schnorr.ParsePubKey(pb)
	if err != nil {
		return nil, fmt.Errorf("nip44: %w", err)
	}
	shared := btcec.GenerateSharedSecret(sk, pub) // x coordinate, not hashed
	return hkdf.Extract(sha256.New, shared, []byte("nip44-v2"))
}

func messageKeys(convKey, nonce []byte) (key, cnonce, hmacKey []byte, err error) {
	out, err := hkdf.Expand(sha256.New, convKey, string(nonce), 76)
	if err != nil {
		return nil, nil, nil, err
	}
	return out[0:32], out[32:44], out[44:76], nil
}

func paddedLen(n int) int {
	if n <= 32 {
		return 32
	}
	nextPower := 1 << (bits.Len(uint(n - 1)))
	chunk := 32
	if nextPower > 256 {
		chunk = nextPower / 8
	}
	return chunk * ((n-1)/chunk + 1)
}

// Encrypt encrypts plaintext (1..65535 bytes). nonce must be 32 random bytes; pass nil to
// generate one (fixed nonces are only for reproducible test vectors).
func Encrypt(plaintext string, convKey, nonce []byte) (string, error) {
	n := len(plaintext)
	if n < 1 || n > 65535 {
		return "", errors.New("nip44: plaintext must be 1..65535 bytes")
	}
	if nonce == nil {
		nonce = make([]byte, 32)
		if _, err := rand.Read(nonce); err != nil {
			return "", err
		}
	}
	if len(nonce) != 32 {
		return "", errors.New("nip44: nonce must be 32 bytes")
	}
	key, cnonce, hk, err := messageKeys(convKey, nonce)
	if err != nil {
		return "", err
	}
	padded := make([]byte, 2+paddedLen(n))
	binary.BigEndian.PutUint16(padded, uint16(n))
	copy(padded[2:], plaintext)
	c, err := chacha20.NewUnauthenticatedCipher(key, cnonce)
	if err != nil {
		return "", err
	}
	ct := make([]byte, len(padded))
	c.XORKeyStream(ct, padded)
	mac := hmac.New(sha256.New, hk)
	mac.Write(nonce)
	mac.Write(ct)
	out := make([]byte, 0, 1+32+len(ct)+32)
	out = append(out, 2)
	out = append(out, nonce...)
	out = append(out, ct...)
	out = mac.Sum(out)
	return base64.StdEncoding.EncodeToString(out), nil
}

// Decrypt reverses Encrypt, checking the version, the MAC (constant time) and the padding.
func Decrypt(payload string, convKey []byte) (string, error) {
	if len(payload) == 0 || payload[0] == '#' {
		return "", errors.New("nip44: unknown encryption version")
	}
	if len(payload) < 132 || len(payload) > 87472 {
		return "", errors.New("nip44: invalid payload size")
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", fmt.Errorf("nip44: %w", err)
	}
	if len(data) < 99 || data[0] != 2 {
		return "", errors.New("nip44: unknown version or short payload")
	}
	nonce, ct, mac := data[1:33], data[33:len(data)-32], data[len(data)-32:]
	key, cnonce, hk, err := messageKeys(convKey, nonce)
	if err != nil {
		return "", err
	}
	m := hmac.New(sha256.New, hk)
	m.Write(nonce)
	m.Write(ct)
	if subtle.ConstantTimeCompare(m.Sum(nil), mac) != 1 {
		return "", errors.New("nip44: invalid MAC")
	}
	c, err := chacha20.NewUnauthenticatedCipher(key, cnonce)
	if err != nil {
		return "", err
	}
	padded := make([]byte, len(ct))
	c.XORKeyStream(padded, ct)
	n := int(binary.BigEndian.Uint16(padded))
	if n < 1 || 2+n > len(padded) || len(padded) != 2+paddedLen(n) {
		return "", errors.New("nip44: invalid padding")
	}
	return string(padded[2 : 2+n]), nil
}
