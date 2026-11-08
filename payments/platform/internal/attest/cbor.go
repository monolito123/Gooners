// Package attest verifies the platform attestation evidence the merchant apps send: Apple App
// Attest on iOS and Android hardware key attestation (docs/05 §2.4, §3.6). Both are offline
// checks against roots the operator configures; nothing here trusts the device's word.
package attest

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// cborDecode parses the subset of CBOR (RFC 8949) attestation objects use: definite-length
// integers, byte and text strings, arrays, maps, tags (dropped) and simple values. It
// refuses indefinite lengths, deep nesting and lengths beyond the input.
func cborDecode(b []byte) (any, error) {
	v, rest, err := cborItem(b, 0)
	if err != nil {
		return nil, err
	}
	if len(rest) != 0 {
		return nil, errors.New("cbor: trailing bytes")
	}
	return v, nil
}

const cborMaxDepth = 16

func cborItem(b []byte, depth int) (any, []byte, error) {
	if depth > cborMaxDepth {
		return nil, nil, errors.New("cbor: nested too deeply")
	}
	if len(b) == 0 {
		return nil, nil, errors.New("cbor: truncated")
	}
	major, info := b[0]>>5, b[0]&0x1f
	b = b[1:]
	var n uint64
	switch {
	case info < 24:
		n = uint64(info)
	case info == 24 && len(b) >= 1:
		n, b = uint64(b[0]), b[1:]
	case info == 25 && len(b) >= 2:
		n, b = uint64(binary.BigEndian.Uint16(b)), b[2:]
	case info == 26 && len(b) >= 4:
		n, b = uint64(binary.BigEndian.Uint32(b)), b[4:]
	case info == 27 && len(b) >= 8:
		n, b = binary.BigEndian.Uint64(b), b[8:]
	default:
		return nil, nil, fmt.Errorf("cbor: unsupported or truncated length (major %d, info %d)", major, info)
	}
	switch major {
	case 0:
		return n, b, nil
	case 1:
		return -1 - int64(n), b, nil // #nosec G115 -- attestation objects carry small integers; overflow only flips a value we never trust
	case 2, 3:
		if n > uint64(len(b)) {
			return nil, nil, errors.New("cbor: string runs past the end")
		}
		if major == 2 {
			return append([]byte(nil), b[:n]...), b[n:], nil
		}
		return string(b[:n]), b[n:], nil
	case 4:
		if n > uint64(len(b)) {
			return nil, nil, errors.New("cbor: array longer than the input")
		}
		out := make([]any, 0, n)
		for i := uint64(0); i < n; i++ {
			v, rest, err := cborItem(b, depth+1)
			if err != nil {
				return nil, nil, err
			}
			out, b = append(out, v), rest
		}
		return out, b, nil
	case 5:
		if n > uint64(len(b)) {
			return nil, nil, errors.New("cbor: map longer than the input")
		}
		out := make(map[string]any, n)
		for i := uint64(0); i < n; i++ {
			k, rest, err := cborItem(b, depth+1)
			if err != nil {
				return nil, nil, err
			}
			key, ok := k.(string)
			if !ok {
				return nil, nil, errors.New("cbor: map keys must be text")
			}
			v, rest, err := cborItem(rest, depth+1)
			if err != nil {
				return nil, nil, err
			}
			out[key], b = v, rest
		}
		return out, b, nil
	case 6:
		return cborItem(b, depth+1) // the tag's meaning does not matter here
	default: // 7: simple values
		switch info {
		case 20:
			return false, b, nil
		case 21:
			return true, b, nil
		case 22, 23:
			return nil, b, nil
		}
		return nil, nil, fmt.Errorf("cbor: unsupported simple value %d", info)
	}
}
