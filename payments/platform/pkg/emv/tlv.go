// Package emv parses and builds BER-TLV data as carried in ISO 8583 DE 55 (EMV ICC data).
package emv

import (
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// TLV is one data object. Tag is uppercase hex ("9F26"). Value holds raw bytes; constructed
// objects keep their encoded children in Value and expose them through Children.
type TLV struct {
	Tag         string
	Value       []byte
	Constructed bool
	Children    []TLV
}

var errTruncated = errors.New("emv: truncated TLV")

// Parse decodes a sequence of BER-TLV objects. Padding bytes 0x00 and 0xFF between
// objects are skipped, as EMV Book 3 allows.
func Parse(b []byte) ([]TLV, error) {
	var out []TLV
	for i := 0; i < len(b); {
		if b[i] == 0x00 || b[i] == 0xFF {
			i++
			continue
		}
		start := i
		first := b[i]
		i++
		if first&0x1F == 0x1F {
			for {
				if i >= len(b) {
					return nil, errTruncated
				}
				c := b[i]
				i++
				if i-start > 4 {
					return nil, fmt.Errorf("emv: tag longer than 4 bytes at offset %d", start)
				}
				if c&0x80 == 0 {
					break
				}
			}
		}
		tag := strings.ToUpper(hex.EncodeToString(b[start:i]))
		if i >= len(b) {
			return nil, errTruncated
		}
		l := int(b[i])
		i++
		if l&0x80 != 0 {
			n := l & 0x7F
			if n == 0 || n > 3 {
				return nil, fmt.Errorf("emv: unsupported length form 0x%02X for tag %s", l, tag)
			}
			if i+n > len(b) {
				return nil, errTruncated
			}
			l = 0
			for k := 0; k < n; k++ {
				l = l<<8 | int(b[i+k])
			}
			i += n
		}
		if i+l > len(b) {
			return nil, fmt.Errorf("emv: tag %s length %d exceeds data", tag, l)
		}
		v := b[i : i+l]
		i += l
		t := TLV{Tag: tag, Value: append([]byte(nil), v...), Constructed: first&0x20 != 0}
		if t.Constructed {
			kids, err := Parse(v)
			if err != nil {
				return nil, fmt.Errorf("emv: inside %s: %w", tag, err)
			}
			t.Children = kids
		}
		out = append(out, t)
	}
	return out, nil
}

// ParseHex decodes hex-encoded BER-TLV.
func ParseHex(s string) ([]TLV, error) {
	b, err := hex.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("emv: %w", err)
	}
	return Parse(b)
}

// Encode serializes objects in order.
func Encode(objs []TLV) ([]byte, error) {
	var out []byte
	for _, o := range objs {
		tag, err := hex.DecodeString(o.Tag)
		if err != nil || len(tag) == 0 {
			return nil, fmt.Errorf("emv: bad tag %q", o.Tag)
		}
		v := o.Value
		if o.Constructed && len(o.Children) > 0 {
			v, err = Encode(o.Children)
			if err != nil {
				return nil, err
			}
		}
		out = append(out, tag...)
		switch n := len(v); {
		case n < 0x80:
			out = append(out, byte(n))
		case n <= 0xFF:
			out = append(out, 0x81, byte(n))
		case n <= 0xFFFF:
			out = append(out, 0x82, byte(n>>8), byte(n)) // #nosec G115 -- the case guard bounds n
		default:
			return nil, fmt.Errorf("emv: value of tag %s too long", o.Tag)
		}
		out = append(out, v...)
	}
	return out, nil
}

// EncodeHex serializes objects to uppercase hex.
func EncodeHex(objs []TLV) (string, error) {
	b, err := Encode(objs)
	if err != nil {
		return "", err
	}
	return strings.ToUpper(hex.EncodeToString(b)), nil
}

// Find returns the first object with tag, searching constructed objects too.
func Find(objs []TLV, tag string) (TLV, bool) {
	tag = strings.ToUpper(tag)
	for _, o := range objs {
		if o.Tag == tag {
			return o, true
		}
		if o.Constructed {
			if c, ok := Find(o.Children, tag); ok {
				return c, true
			}
		}
	}
	return TLV{}, false
}

// Map flattens primitive objects into tag → hex value.
func Map(objs []TLV) map[string]string {
	out := map[string]string{}
	var walk func([]TLV)
	walk = func(os []TLV) {
		for _, o := range os {
			if o.Constructed {
				walk(o.Children)
				continue
			}
			if _, dup := out[o.Tag]; !dup {
				out[o.Tag] = strings.ToUpper(hex.EncodeToString(o.Value))
			}
		}
	}
	walk(objs)
	return out
}

// DE55AuthorizationTags are the tags an acquirer forwards in an authorization request
// (EMV Book 4 / scheme guidance). Tags outside the list are dropped by FilterForDE55.
var DE55AuthorizationTags = []string{
	"5F2A", "5F34", "82", "84", "95", "9A", "9C", "9F02", "9F03", "9F09", "9F10", "9F1A", "9F1E",
	"9F26", "9F27", "9F33", "9F34", "9F35", "9F36", "9F37", "9F41", "9F53", "9F6E", "9F7C",
}

// MandatoryForARQC must be present for the issuer to validate the cryptogram.
var MandatoryForARQC = []string{"9F26", "9F27", "9F10", "9F37", "9F36", "95", "9A", "9C", "9F02", "5F2A", "82", "9F1A"}

// FilterForDE55 keeps allowed tags, in canonical order, and reports missing mandatory ones.
func FilterForDE55(objs []TLV) (kept []TLV, missing []string) {
	m := Map(objs)
	allowed := append([]string(nil), DE55AuthorizationTags...)
	sort.Strings(allowed)
	for _, tag := range allowed {
		if v, ok := m[tag]; ok {
			b, _ := hex.DecodeString(v)
			kept = append(kept, TLV{Tag: tag, Value: b})
		}
	}
	for _, tag := range MandatoryForARQC {
		if _, ok := m[tag]; !ok {
			missing = append(missing, tag)
		}
	}
	return kept, missing
}
