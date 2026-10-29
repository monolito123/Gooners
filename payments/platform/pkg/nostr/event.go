// Package nostr implements what the platform needs from Nostr: NIP-01 events with BIP-340
// signatures, NIP-44 v2 encryption, NIP-59 gift wrap (with signed inner events, see
// docs/03-nostr-layer.md §2.3), canonical JSON content and bech32 npub encoding.
//
// The implementation is checked byte for byte against the JavaScript examples in
// payments/nostr/examples, which are produced with nostr-tools and @noble/curves.
package nostr

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// Event is a NIP-01 event.
type Event struct {
	ID        string     `json:"id"`
	PubKey    string     `json:"pubkey"`
	CreatedAt int64      `json:"created_at"`
	Kind      int        `json:"kind"`
	Tags      [][]string `json:"tags"`
	Content   string     `json:"content"`
	Sig       string     `json:"sig"`
}

// marshalNoEscape is json.Marshal without HTML escaping, as NIP-01 serialization requires.
func marshalNoEscape(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// Serialize returns the NIP-01 commitment [0, pubkey, created_at, kind, tags, content].
// Strings are escaped exactly as NIP-01 (and JavaScript's JSON.stringify) do: \n \" \\ \r
// \t \b \f as short escapes, other control characters as \u00xx, everything else raw UTF-8.
// encoding/json differs for \b, \f and U+2028/U+2029, which would change the event ID.
func (e *Event) Serialize() ([]byte, error) {
	var b bytes.Buffer
	b.WriteString(`[0,`)
	writeString(&b, e.PubKey)
	fmt.Fprintf(&b, ",%d,%d,[", e.CreatedAt, e.Kind)
	for i, t := range e.Tags {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('[')
		for j, v := range t {
			if j > 0 {
				b.WriteByte(',')
			}
			writeString(&b, v)
		}
		b.WriteByte(']')
	}
	b.WriteString("],")
	writeString(&b, e.Content)
	b.WriteByte(']')
	return b.Bytes(), nil
}

func writeString(b *bytes.Buffer, s string) {
	const hexd = "0123456789abcdef"
	b.WriteByte('"')
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		default:
			if c < 0x20 {
				b.WriteString(`\u00`)
				b.WriteByte(hexd[c>>4])
				b.WriteByte(hexd[c&0xF])
			} else {
				b.WriteByte(c)
			}
		}
	}
	b.WriteByte('"')
}

// ComputeID returns the event ID (SHA-256 of the serialization, hex).
func (e *Event) ComputeID() (string, error) {
	b, err := e.Serialize()
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), nil
}

// Keys is a secp256k1 key pair.
type Keys struct {
	Secret *btcec.PrivateKey
	PubHex string // x-only public key, hex
}

// KeysFromSecret builds keys from a 32-byte secret.
func KeysFromSecret(sk []byte) (Keys, error) {
	if len(sk) != 32 {
		return Keys{}, errors.New("nostr: secret key must be 32 bytes")
	}
	priv, _ := btcec.PrivKeyFromBytes(sk)
	if priv.Key.IsZero() {
		return Keys{}, errors.New("nostr: invalid secret key")
	}
	return Keys{Secret: priv, PubHex: hex.EncodeToString(schnorr.SerializePubKey(priv.PubKey()))}, nil
}

// KeysFromHex builds keys from a hex secret.
func KeysFromHex(s string) (Keys, error) {
	b, err := hex.DecodeString(s)
	if err != nil {
		return Keys{}, fmt.Errorf("nostr: %w", err)
	}
	return KeysFromSecret(b)
}

// GenerateKeys creates a random key pair.
func GenerateKeys() (Keys, error) {
	priv, err := btcec.NewPrivateKey()
	if err != nil {
		return Keys{}, err
	}
	return Keys{Secret: priv, PubHex: hex.EncodeToString(schnorr.SerializePubKey(priv.PubKey()))}, nil
}

// SecretHex returns the secret key as hex (only for test keys and claim keys shown in QR codes).
func (k Keys) SecretHex() string { return hex.EncodeToString(k.Secret.Serialize()) }

// Sign sets PubKey, ID and Sig. aux is the BIP-340 auxiliary randomness; nil uses fresh
// randomness from the library's RFC 6979-style derivation.
func (e *Event) Sign(k Keys, aux *[32]byte) error {
	e.PubKey = k.PubHex
	id, err := e.ComputeID()
	if err != nil {
		return err
	}
	e.ID = id
	h, _ := hex.DecodeString(id)
	var opts []schnorr.SignOption
	if aux != nil {
		opts = append(opts, schnorr.CustomNonce(*aux))
	}
	sig, err := schnorr.Sign(k.Secret, h, opts...)
	if err != nil {
		return err
	}
	e.Sig = hex.EncodeToString(sig.Serialize())
	return nil
}

// Verify checks the ID and the signature.
func (e *Event) Verify() error {
	id, err := e.ComputeID()
	if err != nil {
		return err
	}
	if id != e.ID {
		return fmt.Errorf("nostr: id mismatch (computed %s)", id)
	}
	pk, err := hex.DecodeString(e.PubKey)
	if err != nil || len(pk) != 32 {
		return errors.New("nostr: bad pubkey")
	}
	pub, err := schnorr.ParsePubKey(pk)
	if err != nil {
		return fmt.Errorf("nostr: %w", err)
	}
	sb, err := hex.DecodeString(e.Sig)
	if err != nil {
		return errors.New("nostr: bad signature hex")
	}
	sig, err := schnorr.ParseSignature(sb)
	if err != nil {
		return fmt.Errorf("nostr: %w", err)
	}
	h, _ := hex.DecodeString(id)
	if !sig.Verify(h, pub) {
		return errors.New("nostr: invalid signature")
	}
	return nil
}

// Tag returns the first tag with the given name.
func (e *Event) Tag(name string) []string {
	for _, t := range e.Tags {
		if len(t) > 0 && t[0] == name {
			return t
		}
	}
	return nil
}

// CanonicalJSON serializes v with sorted keys, no whitespace and no HTML escaping,
// matching the JavaScript canonicalJson used for event content (RFC 8785 for our data).
// Floats are rejected: amounts are integers.
func CanonicalJSON(v any) (string, error) {
	raw, err := marshalNoEscape(v)
	if err != nil {
		return "", err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var generic any
	if err := dec.Decode(&generic); err != nil {
		return "", err
	}
	if err := rejectFloats(generic); err != nil {
		return "", err
	}
	out, err := marshalNoEscape(generic) // maps marshal with sorted keys
	return string(out), err
}

func rejectFloats(v any) error {
	switch t := v.(type) {
	case json.Number:
		if _, err := t.Int64(); err != nil {
			return fmt.Errorf("nostr: non-integer number %s in canonical JSON", t)
		}
	case map[string]any:
		for _, x := range t {
			if err := rejectFloats(x); err != nil {
				return err
			}
		}
	case []any:
		for _, x := range t {
			if err := rejectFloats(x); err != nil {
				return err
			}
		}
	}
	return nil
}
