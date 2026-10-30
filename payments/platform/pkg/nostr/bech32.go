package nostr

import (
	"encoding/hex"
	"errors"
	"strings"
)

const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

func polymod(values []byte) uint32 {
	gen := []uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
	chk := uint32(1)
	for _, v := range values {
		b := chk >> 25
		chk = (chk&0x1ffffff)<<5 ^ uint32(v)
		for i := 0; i < 5; i++ {
			if (b>>uint(i))&1 == 1 {
				chk ^= gen[i]
			}
		}
	}
	return chk
}

func hrpExpand(hrp string) []byte {
	out := make([]byte, 0, len(hrp)*2+1)
	for i := 0; i < len(hrp); i++ {
		out = append(out, hrp[i]>>5)
	}
	out = append(out, 0)
	for i := 0; i < len(hrp); i++ {
		out = append(out, hrp[i]&31)
	}
	return out
}

func convertBits(data []byte, from, to uint, pad bool) ([]byte, error) {
	acc, bitsN := uint(0), uint(0)
	maxv := uint(1)<<to - 1
	var out []byte
	for _, v := range data {
		acc = acc<<from | uint(v)
		bitsN += from
		for bitsN >= to {
			bitsN -= to
			out = append(out, byte(acc>>bitsN&maxv)) // #nosec G115 -- 5-bit bech32 values
		}
	}
	if pad {
		if bitsN > 0 {
			out = append(out, byte(acc<<(to-bitsN)&maxv)) // #nosec G115 -- 5-bit bech32 values
		}
	} else if bitsN >= from || acc<<(to-bitsN)&maxv != 0 {
		return nil, errors.New("bech32: invalid padding")
	}
	return out, nil
}

// EncodeNpub encodes an x-only public key (hex) as an npub (NIP-19, BIP-173 bech32).
func EncodeNpub(pubHex string) (string, error) {
	b, err := hex.DecodeString(pubHex)
	if err != nil || len(b) != 32 {
		return "", errors.New("bech32: public key must be 32 bytes of hex")
	}
	data, _ := convertBits(b, 8, 5, true)
	values := append(hrpExpand("npub"), data...)
	pm := polymod(append(values, 0, 0, 0, 0, 0, 0)) ^ 1
	var sb strings.Builder
	sb.WriteString("npub1")
	for _, d := range data {
		sb.WriteByte(charset[d])
	}
	for i := 0; i < 6; i++ {
		sb.WriteByte(charset[(pm>>uint(5*(5-i)))&31])
	}
	return sb.String(), nil
}

// DecodeNpub returns the hex public key of an npub, verifying the checksum.
func DecodeNpub(s string) (string, error) {
	s = strings.ToLower(s)
	if !strings.HasPrefix(s, "npub1") || len(s) != 63 {
		return "", errors.New("bech32: not an npub")
	}
	var data []byte
	for _, c := range s[5:] {
		i := strings.IndexRune(charset, c)
		if i < 0 {
			return "", errors.New("bech32: invalid character")
		}
		data = append(data, byte(i)) // #nosec G115 -- 5-bit bech32 values
	}
	if polymod(append(hrpExpand("npub"), data...)) != 1 {
		return "", errors.New("bech32: bad checksum")
	}
	b, err := convertBits(data[:len(data)-6], 5, 8, false)
	if err != nil || len(b) != 32 {
		return "", errors.New("bech32: bad payload")
	}
	return hex.EncodeToString(b), nil
}
