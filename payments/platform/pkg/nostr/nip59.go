package nostr

import (
	"encoding/json"
	"errors"
	"fmt"
)

// WrapOptions control a gift wrap. Zero values mean: kind 1059, real timestamps, random
// nonces and a random one-time key.
type WrapOptions struct {
	WrapKind   int   // 1059, or 21059 for ephemeral events
	SealAt     int64 // seal created_at (defaults to inner created_at)
	WrapAt     int64 // wrap created_at (defaults to inner created_at)
	WrapTags   [][]string
	SealNonce  []byte    // fixed NIP-44 nonce (test vectors only)
	WrapNonce  []byte    // fixed NIP-44 nonce (test vectors only)
	SealAux    *[32]byte // fixed BIP-340 aux (test vectors only)
	WrapAux    *[32]byte
	OneTimeKey *Keys // fixed wrap key (test vectors only)
}

// Author is a key that can sign and derive NIP-44 conversation keys. Keys implements it;
// production signers (an attested enclave) implement it without exposing the secret.
type Author interface {
	Public() string
	SignEvent(e *Event, aux *[32]byte) error
	SharedKey(pubHex string) ([]byte, error)
}

// Public returns the x-only public key.
func (k Keys) Public() string { return k.PubHex }

// SignEvent signs e with k.
func (k Keys) SignEvent(e *Event, aux *[32]byte) error { return e.Sign(k, aux) }

// SharedKey returns the NIP-44 conversation key with pubHex.
func (k Keys) SharedKey(pubHex string) ([]byte, error) { return ConversationKey(k.Secret, pubHex) }

// Wrap seals a signed inner event for one recipient (kind 13, signed by the author) and
// gift-wraps the seal (kind 1059, signed by a one-time key, tagged with the recipient).
func Wrap(inner *Event, author Author, recipientPub string, o WrapOptions) (seal, wrap *Event, err error) {
	if err := inner.Verify(); err != nil {
		return nil, nil, fmt.Errorf("nip59: inner event: %w", err)
	}
	if inner.PubKey != author.Public() {
		return nil, nil, errors.New("nip59: inner event author differs from the sealing key")
	}
	innerJSON, err := marshalNoEscape(inner)
	if err != nil {
		return nil, nil, err
	}
	ck, err := author.SharedKey(recipientPub)
	if err != nil {
		return nil, nil, err
	}
	sealContent, err := Encrypt(string(innerJSON), ck, o.SealNonce)
	if err != nil {
		return nil, nil, err
	}
	at := func(v int64) int64 {
		if v == 0 {
			return inner.CreatedAt
		}
		return v
	}
	seal = &Event{Kind: 13, CreatedAt: at(o.SealAt), Tags: [][]string{}, Content: sealContent}
	if err := author.SignEvent(seal, o.SealAux); err != nil {
		return nil, nil, err
	}
	eph := o.OneTimeKey
	if eph == nil {
		k, err := GenerateKeys()
		if err != nil {
			return nil, nil, err
		}
		eph = &k
	}
	sealJSON, err := marshalNoEscape(seal)
	if err != nil {
		return nil, nil, err
	}
	wk, err := ConversationKey(eph.Secret, recipientPub)
	if err != nil {
		return nil, nil, err
	}
	wrapContent, err := Encrypt(string(sealJSON), wk, o.WrapNonce)
	if err != nil {
		return nil, nil, err
	}
	kind := o.WrapKind
	if kind == 0 {
		kind = 1059
	}
	tags := append([][]string{{"p", recipientPub}}, o.WrapTags...)
	wrap = &Event{Kind: kind, CreatedAt: at(o.WrapAt), Tags: tags, Content: wrapContent}
	if err := wrap.Sign(*eph, o.WrapAux); err != nil {
		return nil, nil, err
	}
	return seal, wrap, nil
}

// Unwrap opens a gift wrap with the recipient's key and verifies every layer, including
// that the inner event's author is the seal's signer (no impersonation).
func Unwrap(wrap *Event, recipient Keys) (inner, seal *Event, err error) {
	if err := wrap.Verify(); err != nil {
		return nil, nil, fmt.Errorf("nip59: wrap: %w", err)
	}
	wk, err := ConversationKey(recipient.Secret, wrap.PubKey)
	if err != nil {
		return nil, nil, err
	}
	sj, err := Decrypt(wrap.Content, wk)
	if err != nil {
		return nil, nil, fmt.Errorf("nip59: wrap: %w", err)
	}
	seal = &Event{}
	if err := json.Unmarshal([]byte(sj), seal); err != nil {
		return nil, nil, fmt.Errorf("nip59: seal json: %w", err)
	}
	if seal.Kind != 13 || len(seal.Tags) != 0 {
		return nil, nil, errors.New("nip59: seal must be kind 13 without tags")
	}
	if err := seal.Verify(); err != nil {
		return nil, nil, fmt.Errorf("nip59: seal: %w", err)
	}
	sk, err := ConversationKey(recipient.Secret, seal.PubKey)
	if err != nil {
		return nil, nil, err
	}
	ij, err := Decrypt(seal.Content, sk)
	if err != nil {
		return nil, nil, fmt.Errorf("nip59: seal: %w", err)
	}
	inner = &Event{}
	if err := json.Unmarshal([]byte(ij), inner); err != nil {
		return nil, nil, fmt.Errorf("nip59: inner json: %w", err)
	}
	if err := inner.Verify(); err != nil {
		return nil, nil, fmt.Errorf("nip59: inner: %w", err)
	}
	if inner.PubKey != seal.PubKey {
		return nil, nil, errors.New("nip59: inner author differs from seal author")
	}
	return inner, seal, nil
}
