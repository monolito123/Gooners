package iso8583

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// MaxFrame bounds a single message on the wire (protects the reader from bad length prefixes).
const MaxFrame = 16 * 1024

// ErrTruncated is returned when the input ends inside a message.
var ErrTruncated = errors.New("iso8583: message truncated")

// Codec packs and unpacks messages for one dialect. It is safe for concurrent use.
type Codec struct {
	spec *Spec
}

// NewCodec returns a codec for spec.
func NewCodec(spec *Spec) *Codec { return &Codec{spec: spec} }

// Spec returns the codec's dialect.
func (c *Codec) Spec() *Spec { return c.spec }

// Pack encodes m. Every present field must be defined by the dialect.
func (c *Codec) Pack(m *Message) ([]byte, error) {
	var out []byte
	if c.spec.HeaderLen > 0 {
		h, err := hex.DecodeString(m.Header)
		if err != nil || len(h) != c.spec.HeaderLen {
			return nil, fmt.Errorf("iso8583: header must be %d bytes of hex", c.spec.HeaderLen)
		}
		out = append(out, h...)
	}
	mti, err := c.packMTI(m.MTI)
	if err != nil {
		return nil, err
	}
	out = append(out, mti...)

	var bitmap [16]byte
	secondary := false
	for _, n := range m.Fields() {
		if n < 2 || n > 128 {
			return nil, fmt.Errorf("iso8583: field %d out of range", n)
		}
		if n > 64 {
			secondary = true
		}
		bitmap[(n-1)/8] |= 0x80 >> uint((n-1)%8)
	}
	if secondary {
		bitmap[0] |= 0x80
	}
	bm := bitmap[:8]
	if secondary {
		bm = bitmap[:16]
	}
	out = append(out, c.encodeBitmap(bm)...)

	for _, n := range m.Fields() {
		f := c.spec.Field(n)
		if f == nil {
			return nil, fmt.Errorf("iso8583: field %d is not defined in dialect %s", n, c.spec.Name)
		}
		b, err := packField(f, m.Get(n))
		if err != nil {
			return nil, fmt.Errorf("iso8583: field %d (%s): %w", n, f.Name, err)
		}
		out = append(out, b...)
	}
	return out, nil
}

// Unpack decodes one message. Trailing bytes are an error.
func (c *Codec) Unpack(b []byte) (*Message, error) {
	r := &reader{b: b}
	m := NewMessage("")
	if c.spec.HeaderLen > 0 {
		h, err := r.take(c.spec.HeaderLen)
		if err != nil {
			return nil, err
		}
		m.Header = strings.ToUpper(hex.EncodeToString(h))
	}
	mti, err := c.unpackMTI(r)
	if err != nil {
		return nil, err
	}
	m.MTI = mti
	bm, err := c.decodeBitmap(r)
	if err != nil {
		return nil, err
	}
	for n := 2; n <= len(bm)*8; n++ {
		if bm[(n-1)/8]&(0x80>>uint((n-1)%8)) == 0 {
			continue
		}
		f := c.spec.Field(n)
		if f == nil {
			return nil, fmt.Errorf("iso8583: message has field %d, not defined in dialect %s", n, c.spec.Name)
		}
		v, err := unpackField(f, r)
		if err != nil {
			return nil, fmt.Errorf("iso8583: field %d (%s): %w", n, f.Name, err)
		}
		m.fields[n] = v
	}
	if r.pos != len(r.b) {
		return nil, fmt.Errorf("iso8583: %d trailing bytes after message", len(r.b)-r.pos)
	}
	return m, nil
}

func (c *Codec) packMTI(mti string) ([]byte, error) {
	if len(mti) != 4 || validateClass(ClassN, mti) != nil {
		return nil, fmt.Errorf("iso8583: MTI %q must be 4 digits", mti)
	}
	if c.spec.MTIEnc == BCD {
		return packBCD(mti, "left")
	}
	return encodeText(mti, c.spec.MTIEnc)
}

func (c *Codec) unpackMTI(r *reader) (string, error) {
	if c.spec.MTIEnc == BCD {
		b, err := r.take(2)
		if err != nil {
			return "", err
		}
		return unpackBCD(b, 4, "left", false)
	}
	b, err := r.take(4)
	if err != nil {
		return "", err
	}
	s, err := decodeText(b, c.spec.MTIEnc)
	if err != nil {
		return "", err
	}
	if validateClass(ClassN, s) != nil {
		return "", fmt.Errorf("iso8583: MTI %q is not numeric", s)
	}
	return s, nil
}

func (c *Codec) encodeBitmap(bm []byte) []byte {
	if c.spec.BitmapEnc == Binary {
		return append([]byte(nil), bm...)
	}
	h := strings.ToUpper(hex.EncodeToString(bm))
	b, _ := encodeText(h, c.spec.BitmapEnc)
	return b
}

func (c *Codec) decodeBitmap(r *reader) ([]byte, error) {
	read := func() ([]byte, error) {
		if c.spec.BitmapEnc == Binary {
			return r.take(8)
		}
		raw, err := r.take(16)
		if err != nil {
			return nil, err
		}
		s, err := decodeText(raw, c.spec.BitmapEnc)
		if err != nil {
			return nil, err
		}
		return hex.DecodeString(s)
	}
	primary, err := read()
	if err != nil {
		return nil, fmt.Errorf("iso8583: bitmap: %w", err)
	}
	if primary[0]&0x80 == 0 {
		return primary, nil
	}
	sec, err := read()
	if err != nil {
		return nil, fmt.Errorf("iso8583: secondary bitmap: %w", err)
	}
	if bytes.Equal(sec, make([]byte, 8)) {
		return nil, fmt.Errorf("iso8583: secondary bitmap flagged but empty")
	}
	return append(primary, sec...), nil
}

// ---- fields ----

// valueUnits is the length of v in the field's length unit.
func valueUnits(f *FieldSpec, v string) int {
	if f.Class == ClassB && f.Enc == Binary {
		return len(v) / 2
	}
	return len(v)
}

func packField(f *FieldSpec, v string) ([]byte, error) {
	if f.Class == ClassB {
		v = strings.ToUpper(v)
	}
	if err := validateClass(f.Class, v); err != nil {
		return nil, err
	}
	if f.Class == ClassB && len(v)%2 != 0 {
		return nil, fmt.Errorf("binary value must have an even number of hex digits")
	}
	if f.Type == Fixed {
		units := valueUnits(f, v)
		if units > f.Length {
			return nil, fmt.Errorf("length %d exceeds fixed length %d", units, f.Length)
		}
		if units < f.Length {
			switch f.Class {
			case ClassN:
				v = strings.Repeat("0", f.Length-units) + v
			case ClassB:
				return nil, fmt.Errorf("binary fixed field needs exactly %d bytes", f.Length)
			case ClassZ:
				return nil, fmt.Errorf("track field needs exactly %d characters", f.Length)
			default:
				v = v + strings.Repeat(" ", f.Length-units)
			}
		}
		return encodeContent(f, v)
	}
	units := valueUnits(f, v)
	if units > f.Max {
		return nil, fmt.Errorf("length %d exceeds max %d", units, f.Max)
	}
	content, err := encodeContent(f, v)
	if err != nil {
		return nil, err
	}
	prefix, err := encodeLength(f, units)
	if err != nil {
		return nil, err
	}
	return append(prefix, content...), nil
}

func encodeContent(f *FieldSpec, v string) ([]byte, error) {
	switch f.Enc {
	case Binary:
		return decodeHex(v)
	case BCD:
		return packBCD(v, f.BCDPad)
	default:
		return encodeText(v, f.Enc)
	}
}

func encodeLength(f *FieldSpec, n int) ([]byte, error) {
	d := prefixDigits(f.Type)
	switch f.LenEnc {
	case Binary:
		w := prefixBytes(f.Type)
		b := make([]byte, w)
		if w == 1 {
			b[0] = byte(n)
		} else {
			binary.BigEndian.PutUint16(b, uint16(n))
		}
		return b, nil
	case BCD:
		return packBCD(fmt.Sprintf("%0*d", d, n), "left")
	default:
		return encodeText(fmt.Sprintf("%0*d", d, n), f.LenEnc)
	}
}

func decodeLength(f *FieldSpec, r *reader) (int, error) {
	d := prefixDigits(f.Type)
	switch f.LenEnc {
	case Binary:
		b, err := r.take(prefixBytes(f.Type))
		if err != nil {
			return 0, err
		}
		if len(b) == 1 {
			return int(b[0]), nil
		}
		return int(binary.BigEndian.Uint16(b)), nil
	case BCD:
		b, err := r.take((d + 1) / 2)
		if err != nil {
			return 0, err
		}
		s, err := unpackBCD(b, d, "left", false)
		if err != nil {
			return 0, err
		}
		return strconv.Atoi(s)
	default:
		b, err := r.take(d)
		if err != nil {
			return 0, err
		}
		s, err := decodeText(b, f.LenEnc)
		if err != nil {
			return 0, err
		}
		if validateClass(ClassN, s) != nil {
			return 0, fmt.Errorf("length prefix %q is not numeric", s)
		}
		return strconv.Atoi(s)
	}
}

func unpackField(f *FieldSpec, r *reader) (string, error) {
	units := f.Length
	if f.Type != Fixed {
		n, err := decodeLength(f, r)
		if err != nil {
			return "", err
		}
		if n > f.Max {
			return "", fmt.Errorf("length %d exceeds max %d", n, f.Max)
		}
		units = n
	}
	var v string
	switch f.Enc {
	case Binary:
		b, err := r.take(units)
		if err != nil {
			return "", err
		}
		v = strings.ToUpper(hex.EncodeToString(b))
	case BCD:
		b, err := r.take((units + 1) / 2)
		if err != nil {
			return "", err
		}
		s, err := unpackBCD(b, units, f.BCDPad, f.Class == ClassZ)
		if err != nil {
			return "", err
		}
		v = s
	default:
		b, err := r.take(units)
		if err != nil {
			return "", err
		}
		s, err := decodeText(b, f.Enc)
		if err != nil {
			return "", err
		}
		v = s
	}
	if err := validateClass(f.Class, v); err != nil {
		return "", err
	}
	if f.Class == ClassB && len(v)%2 != 0 {
		// Hex-as-text binary fields must hold whole bytes, as Pack requires.
		return "", fmt.Errorf("binary value must have an even number of hex digits")
	}
	if f.Type == Fixed && f.Class != ClassN && f.Class != ClassB && f.Class != ClassZ {
		v = strings.TrimRight(v, " ")
	}
	return v, nil
}

type reader struct {
	b   []byte
	pos int
}

func (r *reader) take(n int) ([]byte, error) {
	if n < 0 || r.pos+n > len(r.b) {
		return nil, ErrTruncated
	}
	out := r.b[r.pos : r.pos+n]
	r.pos += n
	return out, nil
}

// ---- framing ----

// WriteFrame writes payload with the dialect's length prefix.
func (c *Codec) WriteFrame(w io.Writer, payload []byte) error {
	fr := c.spec.Framing
	if fr.Type == "none" {
		_, err := w.Write(payload)
		return err
	}
	n := len(payload)
	if fr.IncludesSelf {
		n += fr.Bytes
	}
	var prefix []byte
	switch fr.Type {
	case "binary":
		if n >= 1<<(8*uint(fr.Bytes)) {
			return fmt.Errorf("iso8583: frame of %d bytes does not fit a %d-byte prefix", n, fr.Bytes)
		}
		prefix = make([]byte, fr.Bytes)
		for i := fr.Bytes - 1; i >= 0; i-- {
			prefix[i] = byte(n)
			n >>= 8
		}
	case "ascii":
		s := fmt.Sprintf("%0*d", fr.Bytes, n)
		if len(s) != fr.Bytes {
			return fmt.Errorf("iso8583: frame of %d bytes does not fit a %d-digit prefix", n, fr.Bytes)
		}
		prefix = []byte(s)
	}
	buf := make([]byte, 0, len(prefix)+len(payload))
	buf = append(buf, prefix...)
	buf = append(buf, payload...)
	_, err := w.Write(buf)
	return err
}

// ReadFrame reads one length-prefixed message.
func (c *Codec) ReadFrame(r io.Reader) ([]byte, error) {
	fr := c.spec.Framing
	if fr.Type == "none" {
		return nil, fmt.Errorf("iso8583: dialect %s has no framing; cannot read from a stream", c.spec.Name)
	}
	prefix := make([]byte, fr.Bytes)
	if _, err := io.ReadFull(r, prefix); err != nil {
		return nil, err
	}
	n := 0
	switch fr.Type {
	case "binary":
		for _, b := range prefix {
			n = n<<8 | int(b)
		}
	case "ascii":
		v, err := strconv.Atoi(string(prefix))
		if err != nil {
			return nil, fmt.Errorf("iso8583: bad ascii length prefix %q", prefix)
		}
		n = v
	}
	if fr.IncludesSelf {
		n -= fr.Bytes
	}
	if n < 0 || n > MaxFrame {
		return nil, fmt.Errorf("iso8583: frame length %d out of range", n)
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}
