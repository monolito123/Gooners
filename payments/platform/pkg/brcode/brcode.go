// Package brcode encodes and decodes Pix BR Codes (EMV QRCPS merchant-presented mode, as
// profiled by the Banco Central's "Manual de Padrões para Iniciação do Pix").
package brcode

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// GUI of the Pix arrangement in the merchant account information template (ID 26).
const GUI = "br.gov.bcb.pix"

// Field is one EMV MPM data object. Templates (26–51, 62, 80–99) carry sub-fields.
type Field struct {
	ID    string
	Value string
	Sub   []Field
}

// isTemplate reports IDs whose value is itself a TLV list.
func isTemplate(id string) bool {
	n, _ := strconv.Atoi(id)
	return (n >= 26 && n <= 51) || n == 62 || (n >= 80 && n <= 99)
}

// ParseTLV splits an EMV MPM string into fields (2-digit ID, 2-digit length, value).
func ParseTLV(s string) ([]Field, error) {
	var out []Field
	for i := 0; i < len(s); {
		if i+4 > len(s) {
			return nil, fmt.Errorf("brcode: truncated field header at %d", i)
		}
		id := s[i : i+2]
		l, err := strconv.Atoi(s[i+2 : i+4])
		if err != nil || l < 0 {
			return nil, fmt.Errorf("brcode: bad length for field %s", id)
		}
		if i+4+l > len(s) {
			return nil, fmt.Errorf("brcode: field %s overruns the payload", id)
		}
		f := Field{ID: id, Value: s[i+4 : i+4+l]}
		if isTemplate(id) {
			sub, err := ParseTLV(f.Value)
			if err != nil {
				return nil, fmt.Errorf("brcode: inside %s: %w", id, err)
			}
			f.Sub = sub
		}
		out = append(out, f)
		i += 4 + l
	}
	return out, nil
}

func tlv(id, v string) string { return fmt.Sprintf("%s%02d%s", id, len(v), v) }

// CRC16 is CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as uppercase hex.
func CRC16(s string) string {
	crc := uint16(0xFFFF)
	for i := 0; i < len(s); i++ {
		crc ^= uint16(s[i]) << 8
		for b := 0; b < 8; b++ {
			if crc&0x8000 != 0 {
				crc = crc<<1 ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return fmt.Sprintf("%04X", crc)
}

// Payload is a Pix BR Code.
type Payload struct {
	Dynamic      bool   // single-use code pointing to a payload location (field 01 = 12)
	Key          string // static: the receiver's Pix key (26-01)
	Description  string // static: free text for the payer (26-02)
	URL          string // dynamic: payload location without "https://" (26-25)
	Amount       string // field 54, "129.90"; optional for static codes
	MerchantName string // field 59, up to 25 characters
	MerchantCity string // field 60, up to 15 characters
	PostalCode   string // field 61, optional
	TxID         string // field 62-05: up to 25 alphanumerics for static codes, "***" when absent or dynamic
	MCC          string // field 52, "0000" when not informed
	// Extra preserves templates the package does not interpret (for example 80, Pix Automático).
	Extra []Field
}

var (
	reAmount = regexp.MustCompile(`^[0-9]{1,10}\.[0-9]{2}$`)
	reTxID   = regexp.MustCompile(`^[A-Za-z0-9]{1,25}$`)
)

func (p Payload) validate() error {
	if p.Dynamic {
		if p.URL == "" || strings.Contains(p.URL, "://") {
			return fmt.Errorf("brcode: dynamic code needs a location URL without scheme")
		}
	} else if p.Key == "" {
		return fmt.Errorf("brcode: static code needs a Pix key")
	}
	if p.Amount != "" && !reAmount.MatchString(p.Amount) {
		return fmt.Errorf("brcode: amount %q must look like 129.90", p.Amount)
	}
	if n := len(p.MerchantName); n == 0 || n > 25 {
		return fmt.Errorf("brcode: merchant name must have 1..25 characters")
	}
	if n := len(p.MerchantCity); n == 0 || n > 15 {
		return fmt.Errorf("brcode: merchant city must have 1..15 characters")
	}
	if p.TxID != "" && p.TxID != "***" && !reTxID.MatchString(p.TxID) {
		return fmt.Errorf("brcode: txid %q must be 1..25 alphanumerics", p.TxID)
	}
	if p.Dynamic && p.TxID != "" && p.TxID != "***" {
		return fmt.Errorf("brcode: dynamic codes carry the txid in the payload location, not in field 62")
	}
	return nil
}

// Encode builds the BR Code string, including the CRC.
func Encode(p Payload) (string, error) {
	if err := p.validate(); err != nil {
		return "", err
	}
	var sb strings.Builder
	sb.WriteString(tlv("00", "01"))
	if p.Dynamic {
		sb.WriteString(tlv("01", "12"))
	}
	mai := tlv("00", GUI)
	if p.Dynamic {
		mai += tlv("25", p.URL)
	} else {
		mai += tlv("01", p.Key)
		if p.Description != "" {
			mai += tlv("02", p.Description)
		}
	}
	if len(mai) > 99 {
		return "", fmt.Errorf("brcode: merchant account information exceeds 99 characters")
	}
	sb.WriteString(tlv("26", mai))
	mcc := p.MCC
	if mcc == "" {
		mcc = "0000"
	}
	sb.WriteString(tlv("52", mcc))
	sb.WriteString(tlv("53", "986"))
	if p.Amount != "" {
		sb.WriteString(tlv("54", p.Amount))
	}
	sb.WriteString(tlv("58", "BR"))
	sb.WriteString(tlv("59", p.MerchantName))
	sb.WriteString(tlv("60", p.MerchantCity))
	if p.PostalCode != "" {
		sb.WriteString(tlv("61", p.PostalCode))
	}
	txid := p.TxID
	if txid == "" {
		txid = "***"
	}
	sb.WriteString(tlv("62", tlv("05", txid)))
	for _, f := range p.Extra {
		sb.WriteString(tlv(f.ID, f.Value))
	}
	s := sb.String() + "6304"
	return s + CRC16(s), nil
}

func find(fs []Field, id string) (Field, bool) {
	for _, f := range fs {
		if f.ID == id {
			return f, true
		}
	}
	return Field{}, false
}

// Decode validates the CRC and structure and returns the payload.
func Decode(s string) (*Payload, error) {
	if len(s) < 8 || s[len(s)-8:len(s)-4] != "6304" {
		return nil, fmt.Errorf("brcode: missing CRC field 63")
	}
	if got, want := s[len(s)-4:], CRC16(s[:len(s)-4]); !strings.EqualFold(got, want) {
		return nil, fmt.Errorf("brcode: CRC %s does not match computed %s", got, want)
	}
	fields, err := ParseTLV(s[:len(s)-8])
	if err != nil {
		return nil, err
	}
	if f, ok := find(fields, "00"); !ok || f.Value != "01" {
		return nil, fmt.Errorf("brcode: payload format indicator must be 01")
	}
	mai, ok := find(fields, "26")
	if !ok {
		return nil, fmt.Errorf("brcode: no merchant account information (26)")
	}
	if g, ok := find(mai.Sub, "00"); !ok || !strings.EqualFold(g.Value, GUI) {
		return nil, fmt.Errorf("brcode: field 26 is not a Pix arrangement")
	}
	p := &Payload{}
	if f, ok := find(fields, "01"); ok && f.Value == "12" {
		p.Dynamic = true
	}
	if f, ok := find(mai.Sub, "01"); ok {
		p.Key = f.Value
	}
	if f, ok := find(mai.Sub, "02"); ok {
		p.Description = f.Value
	}
	if f, ok := find(mai.Sub, "25"); ok {
		p.URL = f.Value
		p.Dynamic = true
	}
	get := func(id string) string { f, _ := find(fields, id); return f.Value }
	if get("53") != "986" {
		return nil, fmt.Errorf("brcode: currency must be 986 (BRL)")
	}
	if get("58") != "BR" {
		return nil, fmt.Errorf("brcode: country must be BR")
	}
	p.MCC, p.Amount, p.MerchantName, p.MerchantCity, p.PostalCode = get("52"), get("54"), get("59"), get("60"), get("61")
	if add, ok := find(fields, "62"); ok {
		if t, ok := find(add.Sub, "05"); ok {
			p.TxID = t.Value
		}
	}
	for _, f := range fields {
		n, _ := strconv.Atoi(f.ID)
		if n >= 80 && n <= 99 {
			p.Extra = append(p.Extra, Field{ID: f.ID, Value: f.Value, Sub: f.Sub})
		}
	}
	if p.Key == "" && p.URL == "" && len(p.Extra) == 0 {
		return nil, fmt.Errorf("brcode: neither a Pix key nor a payload location")
	}
	return p, nil
}
