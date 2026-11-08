// Package transparency builds the daily settlement statements and the public settlement
// transparency log of docs/03-nostr-layer.md §6: RFC 6962 Merkle trees over receipt event
// IDs, salted statement commitments, a padded daily log sorted by leaf hash, and a chain of
// signed kind 7715 roots.
package transparency

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
)

// LeafHash is RFC 6962's leaf hash, SHA-256(0x00 ‖ data).
func LeafHash(data []byte) []byte {
	h := sha256.New()
	h.Write([]byte{0})
	h.Write(data)
	return h.Sum(nil)
}

func nodeHash(l, r []byte) []byte {
	h := sha256.New()
	h.Write([]byte{1})
	h.Write(l)
	h.Write(r)
	return h.Sum(nil)
}

func largestPow2Below(n int) int {
	k := 1
	for k<<1 < n {
		k <<= 1
	}
	return k
}

// MTH is the Merkle Tree Hash of RFC 6962 §2.1 (SHA-256).
func MTH(leaves [][]byte) []byte {
	switch len(leaves) {
	case 0:
		s := sha256.Sum256(nil)
		return s[:]
	case 1:
		return LeafHash(leaves[0])
	}
	k := largestPow2Below(len(leaves))
	return nodeHash(MTH(leaves[:k]), MTH(leaves[k:]))
}

// AuditPath is the inclusion proof of leaf m (RFC 6962 §2.1.1).
func AuditPath(m int, leaves [][]byte) [][]byte {
	if len(leaves) <= 1 {
		return nil
	}
	k := largestPow2Below(len(leaves))
	if m < k {
		return append(AuditPath(m, leaves[:k]), MTH(leaves[k:]))
	}
	return append(AuditPath(m-k, leaves[k:]), MTH(leaves[:k]))
}

// VerifyInclusion checks an inclusion proof (RFC 9162 §2.1.3.2).
func VerifyInclusion(leaf []byte, index, size int, path [][]byte, root []byte) bool {
	if index < 0 || index >= size {
		return false
	}
	fn, sn := index, size-1
	r := LeafHash(leaf)
	for _, p := range path {
		if sn == 0 {
			return false
		}
		if fn%2 == 1 || fn == sn {
			r = nodeHash(p, r)
			if fn%2 == 0 {
				for fn%2 == 0 && fn != 0 {
					fn >>= 1
					sn >>= 1
				}
			}
		} else {
			r = nodeHash(r, p)
		}
		fn >>= 1
		sn >>= 1
	}
	return sn == 0 && bytes.Equal(r, root)
}

// HexPath encodes an audit path for the API and the statement.
func HexPath(path [][]byte) []string {
	out := make([]string, len(path))
	for i, p := range path {
		out[i] = hex.EncodeToString(p)
	}
	return out
}

// ParsePath decodes a hex audit path.
func ParsePath(path []string) ([][]byte, error) {
	out := make([][]byte, len(path))
	for i, p := range path {
		b, err := hex.DecodeString(p)
		if err != nil || len(b) != sha256.Size {
			return nil, errors.New("transparency: audit path entries are 32-byte hex")
		}
		out[i] = b
	}
	return out, nil
}
