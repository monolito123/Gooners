package iso8583_test

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/monolito123/Gooners/payments/platform/dialects"
	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
)

func authRequest() *iso8583.Message {
	return iso8583.NewMessage("0100").
		Set(2, "4111111111111111").
		Set(3, "003000").
		Set(4, "12990").
		Set(7, "1029174208").
		Set(11, "4211").
		Set(12, "144208").
		Set(13, "1029").
		Set(14, "2911").
		Set(18, "5812").
		Set(19, "76").
		Set(22, "071").
		Set(23, "1").
		Set(25, "00").
		Set(32, "12345678").
		Set(35, "4111111111111111D29112011234567890").
		Set(37, "630217004211").
		Set(41, "TP000418").
		Set(42, "000000004127731").
		Set(43, "CAFE AURORA            SAO PAULO      BR").
		Set(49, "986").
		Set(55, "9F2608A1B2C3D4E5F607089F2701809F3704C0FFEE119F360200429A032610299C0100")
}

func TestGenericKnownBytes(t *testing.T) {
	codec := iso8583.NewCodec(dialects.MustLoad(dialects.Generic))
	m := iso8583.NewMessage("0800").Set(7, "1029174208").Set(11, "1").Set(70, "301")
	b, err := codec.Pack(m)
	if err != nil {
		t.Fatal(err)
	}
	// Bits 1 (secondary bitmap), 7 and 11 in the primary bitmap; bit 70 in the secondary.
	want := "0800" + "8220000000000000" + "0400000000000000" + "1029174208" + "000001" + "301"
	if string(b) != want {
		t.Fatalf("pack\n got %s\nwant %s", b, want)
	}
	back, err := codec.Unpack(b)
	if err != nil {
		t.Fatal(err)
	}
	if back.Get(11) != "000001" || back.Get(70) != "301" || back.MTI != "0800" {
		t.Fatalf("unpack: %s", back.Dump(nil))
	}
}

func TestRoundTripAllDialects(t *testing.T) {
	for _, name := range []string{dialects.Generic, dialects.VisaTemplate, dialects.MastercardTemplate} {
		t.Run(name, func(t *testing.T) {
			spec := dialects.MustLoad(name)
			codec := iso8583.NewCodec(spec)
			m := authRequest()
			if spec.HeaderLen > 0 {
				m.Header = strings.Repeat("00", spec.HeaderLen)
			}
			if spec.Field(52).Enc == iso8583.Binary {
				m.Set(52, "0123456789ABCDEF")
			} else {
				m.Set(52, "0123456789ABCDEF")
			}
			m.Set(90, "010000421110291742080000001234500000000000")
			b, err := codec.Pack(m)
			if err != nil {
				t.Fatal(err)
			}
			back, err := codec.Unpack(b)
			if err != nil {
				t.Fatalf("unpack: %v (hex %s)", err, hex.EncodeToString(b))
			}
			for _, n := range m.Fields() {
				want := m.Get(n)
				f := spec.Field(n)
				if f.Type == iso8583.Fixed && f.Class == iso8583.ClassN {
					want = strings.Repeat("0", f.Length-len(want)) + want
				}
				if back.Get(n) != want {
					t.Errorf("DE%d: got %q want %q", n, back.Get(n), want)
				}
			}
			if back.Header != m.Header {
				t.Errorf("header mismatch")
			}
		})
	}
}

func TestBCDOddLengthsAndTrack2(t *testing.T) {
	codec := iso8583.NewCodec(dialects.MustLoad(dialects.VisaTemplate))
	m := iso8583.NewMessage("0100").Set(2, "411111111111111").Set(19, "76").Set(35, "4111111111111111D2911201")
	m.Header = strings.Repeat("00", 22)
	b, err := codec.Pack(m)
	if err != nil {
		t.Fatal(err)
	}
	h := hex.EncodeToString(b[22:])
	// MTI 0100 is 2 BCD bytes; PAN of 15 digits: binary length 0x0F then 8 bytes, left-padded with a 0 nibble.
	if !strings.HasPrefix(h, "0100") || !strings.Contains(h, "0f0411111111111111") {
		t.Fatalf("unexpected encoding %s", h)
	}
	// Track 2 of 24 characters: separator D packs as a nibble.
	if !strings.Contains(h, "184111111111111111d2911201") {
		t.Fatalf("track 2 not packed as expected: %s", h)
	}
	back, err := codec.Unpack(b)
	if err != nil {
		t.Fatal(err)
	}
	if back.Get(2) != "411111111111111" || back.Get(19) != "076" || back.Get(35) != "4111111111111111D2911201" {
		t.Fatalf("round trip: %s", back.Dump(nil))
	}
}

func TestEBCDICText(t *testing.T) {
	codec := iso8583.NewCodec(dialects.MustLoad(dialects.MastercardTemplate))
	m := iso8583.NewMessage("0110").Set(39, "00").Set(41, "TP000418")
	b, err := codec.Pack(m)
	if err != nil {
		t.Fatal(err)
	}
	// "0110" in EBCDIC is F0 F1 F1 F0.
	if hex.EncodeToString(b[:4]) != "f0f1f1f0" {
		t.Fatalf("MTI not EBCDIC: %x", b[:4])
	}
	if !bytes.Contains(b, []byte{0xE3, 0xD7, 0xF0, 0xF0, 0xF0, 0xF4, 0xF1, 0xF8}) {
		t.Fatalf("DE41 not EBCDIC: %x", b)
	}
	back, err := codec.Unpack(b)
	if err != nil || back.Get(41) != "TP000418" {
		t.Fatalf("round trip: %v %v", back, err)
	}
}

func TestValidation(t *testing.T) {
	codec := iso8583.NewCodec(dialects.MustLoad(dialects.Generic))
	cases := map[string]*iso8583.Message{
		"letters in numeric": iso8583.NewMessage("0100").Set(4, "12A"),
		"too long fixed":     iso8583.NewMessage("0100").Set(39, "000"),
		"too long variable":  iso8583.NewMessage("0100").Set(2, strings.Repeat("4", 20)),
		"undefined field":    iso8583.NewMessage("0100").Set(5, "1"),
		"bad MTI":            iso8583.NewMessage("01X0").Set(4, "1"),
		"non-ASCII text":     iso8583.NewMessage("0100").Set(43, "CAFÉ"),
		"odd hex in binary":  iso8583.NewMessage("0100").Set(55, "9F2"),
	}
	for name, m := range cases {
		if _, err := codec.Pack(m); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestUnpackRejectsTruncatedAndTrailing(t *testing.T) {
	codec := iso8583.NewCodec(dialects.MustLoad(dialects.Generic))
	b, _ := codec.Pack(authRequest())
	for i := 0; i < len(b); i++ {
		if _, err := codec.Unpack(b[:i]); err == nil {
			t.Fatalf("truncated message of %d/%d bytes accepted", i, len(b))
		}
	}
	if _, err := codec.Unpack(append(b, '0')); err == nil {
		t.Fatal("trailing byte accepted")
	}
}

func TestFraming(t *testing.T) {
	codec := iso8583.NewCodec(dialects.MustLoad(dialects.Generic))
	var buf bytes.Buffer
	payload, _ := codec.Pack(authRequest())
	if err := codec.WriteFrame(&buf, payload); err != nil {
		t.Fatal(err)
	}
	if n := int(buf.Bytes()[0])<<8 | int(buf.Bytes()[1]); n != len(payload) {
		t.Fatalf("prefix %d, payload %d", n, len(payload))
	}
	got, err := codec.ReadFrame(&buf)
	if err != nil || !bytes.Equal(got, payload) {
		t.Fatalf("frame round trip: %v", err)
	}
}

func TestDumpMasksCardData(t *testing.T) {
	d := authRequest().Set(52, "0123456789ABCDEF").Dump(dialects.MustLoad(dialects.Generic))
	for _, leak := range []string{"4111111111111111", "D2911", "0123456789ABCDEF", "9F2608", "DE14=2911"} {
		if strings.Contains(d, leak) {
			t.Fatalf("dump leaks %q: %s", leak, d)
		}
	}
	if !strings.Contains(d, "DE2=411111******1111") {
		t.Fatalf("PAN not masked as BIN+last4: %s", d)
	}
}

func TestResponseMTI(t *testing.T) {
	for req, resp := range map[string]string{"0100": "0110", "0200": "0210", "0400": "0410", "0420": "0430", "0800": "0810"} {
		got, err := iso8583.ResponseMTI(req)
		if err != nil || got != resp {
			t.Errorf("%s → %s, %v", req, got, err)
		}
	}
	if _, err := iso8583.ResponseMTI("0110"); err == nil {
		t.Error("response MTI accepted as request")
	}
}

func TestToSchemeText(t *testing.T) {
	if got := iso8583.ToSchemeText("Café Aurora – São Paulo"); got != "CAFE AURORA  SAO PAULO" {
		t.Fatalf("got %q", got)
	}
}

func FuzzUnpack(f *testing.F) {
	codec := iso8583.NewCodec(dialects.MustLoad(dialects.Generic))
	seed, _ := codec.Pack(authRequest())
	f.Add(seed)
	f.Add([]byte("0800"))
	f.Fuzz(func(t *testing.T, b []byte) {
		m, err := codec.Unpack(b)
		if err != nil {
			return
		}
		// Anything that unpacks must pack again and unpack to the same fields.
		again, err := codec.Pack(m)
		if err != nil {
			t.Fatalf("repack failed: %v", err)
		}
		m2, err := codec.Unpack(again)
		if err != nil {
			t.Fatalf("unpack of repacked message failed: %v", err)
		}
		if m2.Dump(nil) != m.Dump(nil) || m2.MTI != m.MTI {
			t.Fatalf("round trip changed the message")
		}
		for _, n := range m.Fields() {
			if m.Get(n) != m2.Get(n) {
				t.Fatalf("DE%d changed: %q → %q", n, m.Get(n), m2.Get(n))
			}
		}
	})
}
