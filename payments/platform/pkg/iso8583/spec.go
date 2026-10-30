// Package iso8583 packs and unpacks ISO 8583 messages from a declarative dialect spec.
//
// A dialect (field table, encodings, bitmap and framing) is plain JSON, so the
// field definitions from a scheme's licensed interface specification (Visa
// V.I.P./BASE I, Mastercard Customer Interface Specification, a sponsor
// acquirer's host spec) can be dropped in without code changes.
//
// Values are strings at the API boundary. Binary fields (class "b") are
// uppercase hexadecimal strings.
package iso8583

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
)

// Encoding of field content, length prefixes, the MTI or the bitmap.
type Encoding string

const (
	ASCII  Encoding = "ascii"
	EBCDIC Encoding = "ebcdic"
	BCD    Encoding = "bcd"
	Binary Encoding = "binary"
)

// Field types.
const (
	Fixed   = "fixed"
	LLVar   = "llvar"
	LLLVar  = "lllvar"
	LLLLVar = "llllvar"
)

// Content classes, as in ISO 8583:1987.
const (
	ClassN   = "n"   // numeric digits
	ClassA   = "a"   // alphabetic
	ClassAN  = "an"  // alphanumeric
	ClassANS = "ans" // alphanumeric and special
	ClassB   = "b"   // binary, hex at the API boundary
	ClassZ   = "z"   // track 2/3 code set: digits, '=' or 'D' separator
)

// Spec status values. A template dialect is refused in production unless explicitly allowed.
const (
	StatusVerified = "verified"
	StatusTemplate = "template-unverified"
)

// FieldSpec defines one data element.
type FieldSpec struct {
	Name   string   `json:"name"`
	Type   string   `json:"type"`
	Class  string   `json:"class"`
	Length int      `json:"length,omitempty"` // fixed length: digits/characters for text, bytes for binary
	Max    int      `json:"max,omitempty"`    // maximum length for variable fields, same unit as Length
	Enc    Encoding `json:"enc,omitempty"`
	LenEnc Encoding `json:"len_enc,omitempty"`
	// BCDPad selects where an odd-length BCD value is padded: "left" (leading 0 nibble,
	// the usual choice for numeric fields) or "right" (trailing F nibble, usual for track 2).
	BCDPad string `json:"bcd_pad,omitempty"`
	// Sensitive fields are masked by Message.Dump (PAN, track data, PIN block, EMV data).
	Sensitive bool `json:"sensitive,omitempty"`
}

// Framing describes the length prefix in front of each message on a TCP stream.
type Framing struct {
	Type         string `json:"type"`  // "binary", "ascii" or "none"
	Bytes        int    `json:"bytes"` // width of the prefix
	IncludesSelf bool   `json:"includes_self,omitempty"`
}

// Spec is a complete dialect.
type Spec struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Status      string   `json:"status"`
	Source      string   `json:"source,omitempty"`
	MTIEnc      Encoding `json:"mti_enc"`
	BitmapEnc   Encoding `json:"bitmap_enc"` // binary, ascii (hex characters) or ebcdic (hex characters)
	HeaderLen   int      `json:"header_len,omitempty"`
	Framing     Framing  `json:"framing"`
	Defaults    struct {
		Enc    Encoding `json:"enc"`
		LenEnc Encoding `json:"len_enc"`
	} `json:"defaults"`
	Fields map[string]FieldSpec `json:"fields"`

	table [129]*FieldSpec
}

// ParseSpec reads and validates a dialect.
func ParseSpec(data []byte) (*Spec, error) {
	var s Spec
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("iso8583: dialect json: %w", err)
	}
	if err := s.validate(); err != nil {
		return nil, err
	}
	return &s, nil
}

// LoadSpec reads a dialect from r.
func LoadSpec(r io.Reader) (*Spec, error) {
	b, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	return ParseSpec(b)
}

// LoadSpecFile reads a dialect from a file.
func LoadSpecFile(path string) (*Spec, error) {
	b, err := os.ReadFile(path) // #nosec G304 -- dialect files are named by the operator
	if err != nil {
		return nil, err
	}
	return ParseSpec(b)
}

// Field returns the definition of field n, or nil.
func (s *Spec) Field(n int) *FieldSpec {
	if n < 1 || n > 128 {
		return nil
	}
	return s.table[n]
}

// FieldNumbers lists the defined fields in ascending order.
func (s *Spec) FieldNumbers() []int {
	var out []int
	for n := 2; n <= 128; n++ {
		if s.table[n] != nil {
			out = append(out, n)
		}
	}
	return out
}

func (s *Spec) validate() error {
	if s.Name == "" {
		return fmt.Errorf("iso8583: dialect has no name")
	}
	if s.Status != StatusVerified && s.Status != StatusTemplate {
		return fmt.Errorf("iso8583: dialect %s: status must be %q or %q", s.Name, StatusVerified, StatusTemplate)
	}
	switch s.MTIEnc {
	case ASCII, EBCDIC, BCD:
	default:
		return fmt.Errorf("iso8583: dialect %s: mti_enc %q", s.Name, s.MTIEnc)
	}
	switch s.BitmapEnc {
	case Binary, ASCII, EBCDIC:
	default:
		return fmt.Errorf("iso8583: dialect %s: bitmap_enc %q", s.Name, s.BitmapEnc)
	}
	switch s.Framing.Type {
	case "none":
	case "binary", "ascii":
		if s.Framing.Bytes < 1 || s.Framing.Bytes > 4 {
			return fmt.Errorf("iso8583: dialect %s: framing bytes must be 1..4", s.Name)
		}
	default:
		return fmt.Errorf("iso8583: dialect %s: framing type %q", s.Name, s.Framing.Type)
	}
	if s.HeaderLen < 0 || s.HeaderLen > 64 {
		return fmt.Errorf("iso8583: dialect %s: header_len out of range", s.Name)
	}
	keys := make([]string, 0, len(s.Fields))
	for k := range s.Fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		n, err := strconv.Atoi(k)
		if err != nil || n < 2 || n > 128 {
			return fmt.Errorf("iso8583: dialect %s: field key %q must be 2..128 (field 1 is the secondary bitmap)", s.Name, k)
		}
		f := s.Fields[k]
		if f.Enc == "" {
			f.Enc = s.Defaults.Enc
			if f.Class == ClassB {
				f.Enc = Binary
			}
		}
		if f.LenEnc == "" {
			f.LenEnc = s.Defaults.LenEnc
		}
		if f.BCDPad == "" {
			f.BCDPad = "left"
			if f.Class == ClassZ {
				f.BCDPad = "right"
			}
		}
		if err := f.check(); err != nil {
			return fmt.Errorf("iso8583: dialect %s field %d: %w", s.Name, n, err)
		}
		fc := f
		s.table[n] = &fc
	}
	return nil
}

func (f *FieldSpec) check() error {
	switch f.Class {
	case ClassN, ClassA, ClassAN, ClassANS, ClassB, ClassZ:
	default:
		return fmt.Errorf("class %q", f.Class)
	}
	switch f.Type {
	case Fixed:
		if f.Length < 1 {
			return fmt.Errorf("fixed field needs length")
		}
	case LLVar, LLLVar, LLLLVar:
		if f.Max < 1 {
			return fmt.Errorf("variable field needs max")
		}
		if f.Max > maxForPrefix(f.Type, f.LenEnc) {
			return fmt.Errorf("max %d does not fit a %s %s prefix", f.Max, f.LenEnc, f.Type)
		}
		switch f.LenEnc {
		case ASCII, EBCDIC, BCD, Binary:
		default:
			return fmt.Errorf("len_enc %q", f.LenEnc)
		}
	default:
		return fmt.Errorf("type %q", f.Type)
	}
	switch f.Enc {
	case ASCII, EBCDIC:
	case BCD:
		if f.Class != ClassN && f.Class != ClassZ {
			return fmt.Errorf("bcd encoding only applies to n and z fields")
		}
	case Binary:
		if f.Class != ClassB {
			return fmt.Errorf("binary encoding only applies to b fields")
		}
	default:
		return fmt.Errorf("enc %q", f.Enc)
	}
	if f.BCDPad != "left" && f.BCDPad != "right" {
		return fmt.Errorf("bcd_pad %q", f.BCDPad)
	}
	return nil
}

func prefixDigits(t string) int {
	switch t {
	case LLVar:
		return 2
	case LLLVar:
		return 3
	case LLLLVar:
		return 4
	}
	return 0
}

// prefixBytes is the width of a binary length prefix: 1 byte for LL, 2 bytes for LLL and LLLL.
func prefixBytes(t string) int {
	if t == LLVar {
		return 1
	}
	return 2
}

func maxForPrefix(t string, enc Encoding) int {
	if enc == Binary {
		if t == LLVar {
			return 255
		}
		return 65535
	}
	switch t {
	case LLVar:
		return 99
	case LLLVar:
		return 999
	case LLLLVar:
		return 9999
	}
	return 0
}
