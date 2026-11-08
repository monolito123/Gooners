// Package ids issues prefixed ULIDs (pi_01JBK…): sortable by time, 26 Crockford base32 characters.
package ids

import (
	"crypto/rand"
	"crypto/sha256"
	"time"
)

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// ULID returns a new ULID string.
func ULID() string { return ULIDAt(time.Now()) }

// ULIDAt returns a ULID for a given time (48-bit milliseconds + 80 random bits).
func ULIDAt(t time.Time) string {
	var b [16]byte
	ms := uint64(t.UnixMilli())
	for i := 5; i >= 0; i-- {
		b[i] = byte(ms)
		ms >>= 8
	}
	_, _ = rand.Read(b[6:])
	return encode(b)
}

// FromSeed returns prefix_ID where the ID is the first 128 bits of SHA-256(seed), in the
// ULID alphabet: the same seed always gives the same ID (an operation identified by its
// tenant and Idempotency-Key, say), so a retry finds what the first attempt did. Such IDs do
// not sort by time.
func FromSeed(prefix string, seed []byte) string {
	sum := sha256.Sum256(seed)
	var b [16]byte
	copy(b[:], sum[:16])
	return prefix + "_" + encode(b)
}

// encode writes 128 bits as 26 base32 characters (the first carries 3 bits).
func encode(b [16]byte) string {
	out := make([]byte, 26)
	var acc uint64
	bits := 0
	idx := 25
	for i := 15; i >= 0; i-- {
		acc |= uint64(b[i]) << uint(bits)
		bits += 8
		for bits >= 5 && idx >= 0 {
			out[idx] = crockford[acc&31]
			acc >>= 5
			bits -= 5
			idx--
		}
	}
	if idx >= 0 {
		out[idx] = crockford[acc&31]
	}
	return string(out)
}

// New returns prefix_ULID.
func New(prefix string) string { return prefix + "_" + ULID() }

// Valid reports whether s is a 26-character Crockford ULID.
func Valid(s string) bool {
	if len(s) != 26 {
		return false
	}
	for i := 0; i < len(s); i++ {
		ok := false
		for j := 0; j < len(crockford); j++ {
			if s[i] == crockford[j] {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return s[0] <= '7'
}
