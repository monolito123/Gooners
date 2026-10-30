package iso8583

import (
	"fmt"
	"sort"
	"strings"
)

// Message is an ISO 8583 message. Field 1 (secondary bitmap) is managed by the codec.
type Message struct {
	MTI    string
	Header string // hex, HeaderLen bytes, when the dialect has a header
	fields map[int]string
}

// NewMessage returns an empty message with the given MTI.
func NewMessage(mti string) *Message {
	return &Message{MTI: mti, fields: map[int]string{}}
}

// Set assigns field n. Setting an empty string removes the field.
func (m *Message) Set(n int, v string) *Message {
	if m.fields == nil {
		m.fields = map[int]string{}
	}
	if v == "" {
		delete(m.fields, n)
		return m
	}
	m.fields[n] = v
	return m
}

// Get returns field n, or "" if absent.
func (m *Message) Get(n int) string { return m.fields[n] }

// Has reports whether field n is present.
func (m *Message) Has(n int) bool {
	_, ok := m.fields[n]
	return ok
}

// Unset removes field n.
func (m *Message) Unset(n int) { delete(m.fields, n) }

// Fields returns the present field numbers in ascending order.
func (m *Message) Fields() []int {
	out := make([]int, 0, len(m.fields))
	for n := range m.fields {
		out = append(out, n)
	}
	sort.Ints(out)
	return out
}

// Clone returns a deep copy.
func (m *Message) Clone() *Message {
	c := NewMessage(m.MTI)
	c.Header = m.Header
	for k, v := range m.fields {
		c.fields[k] = v
	}
	return c
}

// ResponseMTI returns the response MTI for a request: 0100→0110, 0400→0410, 0800→0810, 0420→0430.
func ResponseMTI(mti string) (string, error) {
	if len(mti) != 4 {
		return "", fmt.Errorf("iso8583: MTI %q", mti)
	}
	f := mti[2]
	if f != '0' && f != '2' && f != '4' {
		return "", fmt.Errorf("iso8583: MTI %s is not a request", mti)
	}
	return mti[:2] + string(f+1) + mti[3:], nil
}

// IsResponse reports whether an MTI is a response (third digit odd).
func IsResponse(mti string) bool {
	return len(mti) == 4 && (mti[2]-'0')%2 == 1
}

// Default sensitive fields, masked by Dump even if the dialect does not flag them.
var defaultSensitive = map[int]bool{2: true, 14: true, 35: true, 36: true, 45: true, 52: true, 55: true}

// Dump renders the message for logs with card data masked. Never log a message any other way.
func (m *Message) Dump(spec *Spec) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "MTI=%s", m.MTI)
	for _, n := range m.Fields() {
		v := m.fields[n]
		sensitive := defaultSensitive[n]
		if spec != nil {
			if f := spec.Field(n); f != nil && f.Sensitive {
				sensitive = true
			}
		}
		if sensitive {
			v = mask(n, v)
		}
		fmt.Fprintf(&sb, " DE%d=%s", n, v)
	}
	return sb.String()
}

func mask(n int, v string) string {
	switch n {
	case 2:
		if len(v) >= 10 {
			return v[:6] + strings.Repeat("*", len(v)-10) + v[len(v)-4:]
		}
		return strings.Repeat("*", len(v))
	case 14:
		return "****"
	case 55:
		return fmt.Sprintf("<%d bytes>", len(v)/2)
	default:
		return fmt.Sprintf("<redacted %d>", len(v))
	}
}
