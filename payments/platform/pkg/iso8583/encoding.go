package iso8583

import (
	"encoding/hex"
	"fmt"
	"strings"
)

// IBM code page 037 for the printable ASCII range. Characters outside it are rejected:
// scheme text fields are uppercase Latin without diacritics (see ToSchemeText).
var asciiToEBCDIC = func() [128]byte {
	var t [128]byte
	for i := range t {
		t[i] = 0xFF // marker: not representable
	}
	set := func(c byte, e byte) { t[c] = e }
	set(' ', 0x40)
	for i := byte(0); i < 10; i++ {
		set('0'+i, 0xF0+i)
	}
	for i := byte(0); i < 9; i++ {
		set('A'+i, 0xC1+i)
		set('J'+i, 0xD1+i)
		set('a'+i, 0x81+i)
		set('j'+i, 0x91+i)
	}
	for i := byte(0); i < 8; i++ {
		set('S'+i, 0xE2+i)
		set('s'+i, 0xA2+i)
	}
	for c, e := range map[byte]byte{
		'.': 0x4B, '<': 0x4C, '(': 0x4D, '+': 0x4E, '|': 0x4F, '&': 0x50, '!': 0x5A, '$': 0x5B,
		'*': 0x5C, ')': 0x5D, ';': 0x5E, '-': 0x60, '/': 0x61, ',': 0x6B, '%': 0x6C, '_': 0x6D,
		'>': 0x6E, '?': 0x6F, '`': 0x79, ':': 0x7A, '#': 0x7B, '@': 0x7C, '\'': 0x7D, '=': 0x7E,
		'"': 0x7F, '~': 0xA1, '^': 0xB0, '[': 0xBA, ']': 0xBB, '{': 0xC0, '}': 0xD0, '\\': 0xE0,
	} {
		set(c, e)
	}
	return t
}()

var ebcdicToASCII = func() [256]byte {
	var t [256]byte
	for i := range t {
		t[i] = 0
	}
	for a, e := range asciiToEBCDIC {
		if e != 0xFF {
			t[e] = byte(a)
		}
	}
	return t
}()

func toEBCDIC(s string) ([]byte, error) {
	out := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 128 || asciiToEBCDIC[c] == 0xFF {
			return nil, fmt.Errorf("character %q has no EBCDIC (CP037) mapping", c)
		}
		out[i] = asciiToEBCDIC[c]
	}
	return out, nil
}

func fromEBCDIC(b []byte) (string, error) {
	out := make([]byte, len(b))
	for i, e := range b {
		a := ebcdicToASCII[e]
		if a == 0 {
			return "", fmt.Errorf("byte 0x%02X is not a mapped EBCDIC character", e)
		}
		out[i] = a
	}
	return string(out), nil
}

// encodeText writes s with an ASCII or EBCDIC character encoding.
func encodeText(s string, enc Encoding) ([]byte, error) {
	switch enc {
	case ASCII:
		for i := 0; i < len(s); i++ {
			if s[i] >= 128 {
				return nil, fmt.Errorf("non-ASCII byte 0x%02X (transliterate with ToSchemeText)", s[i])
			}
		}
		return []byte(s), nil
	case EBCDIC:
		return toEBCDIC(s)
	}
	return nil, fmt.Errorf("text encoding %q", enc)
}

func decodeText(b []byte, enc Encoding) (string, error) {
	switch enc {
	case ASCII:
		return string(b), nil
	case EBCDIC:
		return fromEBCDIC(b)
	}
	return "", fmt.Errorf("text encoding %q", enc)
}

// nibble maps a digit or a track-2 separator to its BCD nibble.
func nibble(c byte) (byte, error) {
	switch {
	case c >= '0' && c <= '9':
		return c - '0', nil
	case c == '=' || c == 'D' || c == 'd':
		return 0xD, nil
	case c == 'F' || c == 'f':
		return 0xF, nil
	}
	return 0, fmt.Errorf("character %q cannot be BCD-packed", c)
}

// packBCD packs digits two per byte. Odd lengths are padded on the left with 0
// or on the right with F.
func packBCD(s string, pad string) ([]byte, error) {
	if len(s)%2 == 1 {
		if pad == "right" {
			s = s + "F"
		} else {
			s = "0" + s
		}
	}
	out := make([]byte, len(s)/2)
	for i := 0; i < len(s); i += 2 {
		hi, err := nibble(s[i])
		if err != nil {
			return nil, err
		}
		lo, err := nibble(s[i+1])
		if err != nil {
			return nil, err
		}
		out[i/2] = hi<<4 | lo
	}
	return out, nil
}

// unpackBCD reads `digits` digits from b (which holds ceil(digits/2) bytes).
func unpackBCD(b []byte, digits int, pad string, track bool) (string, error) {
	var sb strings.Builder
	for _, x := range b {
		for _, n := range []byte{x >> 4, x & 0x0F} {
			switch {
			case n <= 9:
				sb.WriteByte('0' + n)
			case n == 0xD && track:
				sb.WriteByte('D')
			case n == 0xF:
				sb.WriteByte('F')
			default:
				return "", fmt.Errorf("invalid BCD nibble 0x%X", n)
			}
		}
	}
	s := sb.String()
	if len(s) > digits {
		if pad == "right" {
			if s[len(s)-1] != 'F' && s[len(s)-1] != '0' {
				return "", fmt.Errorf("unexpected BCD right pad %q", s[len(s)-1])
			}
			s = s[:digits]
		} else {
			if s[0] != '0' {
				return "", fmt.Errorf("unexpected BCD left pad %q", s[0])
			}
			s = s[1:]
		}
	}
	if !track && strings.ContainsRune(s, 'F') {
		return "", fmt.Errorf("unexpected F nibble in numeric field")
	}
	return s, nil
}

func validateClass(class, v string) error {
	for i := 0; i < len(v); i++ {
		c := v[i]
		ok := false
		switch class {
		case ClassN:
			ok = c >= '0' && c <= '9'
		case ClassZ:
			ok = (c >= '0' && c <= '9') || c == '=' || c == 'D'
		case ClassA:
			ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == ' '
		case ClassAN:
			ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == ' '
		case ClassANS:
			ok = c >= 0x20 && c <= 0x7E
		case ClassB:
			ok = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'F')
		}
		if !ok {
			return fmt.Errorf("character %q not allowed in class %s", c, class)
		}
	}
	return nil
}

func decodeHex(v string) ([]byte, error) {
	if len(v)%2 != 0 {
		return nil, fmt.Errorf("binary field must have an even number of hex digits")
	}
	return hex.DecodeString(v)
}

// ToSchemeText transliterates Portuguese text to the uppercase ASCII that scheme
// text fields (DE 43 merchant name and city) accept: "Café Aurora" → "CAFE AURORA".
func ToSchemeText(s string) string {
	repl := strings.NewReplacer(
		"á", "a", "à", "a", "â", "a", "ã", "a", "ä", "a", "Á", "A", "À", "A", "Â", "A", "Ã", "A", "Ä", "A",
		"é", "e", "ê", "e", "è", "e", "É", "E", "Ê", "E", "È", "E",
		"í", "i", "î", "i", "Í", "I", "Î", "I",
		"ó", "o", "ô", "o", "õ", "o", "ö", "o", "Ó", "O", "Ô", "O", "Õ", "O", "Ö", "O",
		"ú", "u", "ü", "u", "Ú", "U", "Ü", "U",
		"ç", "c", "Ç", "C", "ñ", "n", "Ñ", "N",
	)
	s = strings.ToUpper(repl.Replace(s))
	var sb strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 0x20 && c <= 0x7E {
			sb.WriteByte(c)
		}
	}
	return sb.String()
}
