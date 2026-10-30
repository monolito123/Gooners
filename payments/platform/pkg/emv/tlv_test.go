package emv

import (
	"bytes"
	"testing"
)

// DE 55 example from docs/01-acquiring-engine.md §3.8.
const specExample = "9F2608A1B2C3D4E5F607089F2701809F3704C0FFEE119F360200429A032610299C0100"

func TestParseSpecExample(t *testing.T) {
	objs, err := ParseHex(specExample)
	if err != nil {
		t.Fatal(err)
	}
	m := Map(objs)
	want := map[string]string{"9F26": "A1B2C3D4E5F60708", "9F27": "80", "9F37": "C0FFEE11", "9F36": "0042", "9A": "261029", "9C": "00"}
	for k, v := range want {
		if m[k] != v {
			t.Errorf("%s = %q, want %q", k, m[k], v)
		}
	}
	back, err := EncodeHex(objs)
	if err != nil || back != specExample {
		t.Fatalf("re-encode: %s %v", back, err)
	}
}

func TestConstructedAndLongLengths(t *testing.T) {
	inner := []TLV{{Tag: "9F02", Value: []byte{0, 0, 0, 0, 0x12, 0x99}}, {Tag: "5F2A", Value: []byte{0x09, 0x86}}}
	long := bytes.Repeat([]byte{0xAB}, 300)
	objs := []TLV{{Tag: "70", Constructed: true, Children: inner}, {Tag: "9F10", Value: long}}
	b, err := Encode(objs)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(b, []byte{0x9F, 0x10, 0x82, 0x01, 0x2C}) {
		t.Fatalf("300-byte value should use the 0x82 length form: % X", b[:20])
	}
	back, err := Parse(b)
	if err != nil {
		t.Fatal(err)
	}
	if v, ok := Find(back, "5F2A"); !ok || !bytes.Equal(v.Value, []byte{0x09, 0x86}) {
		t.Fatal("nested tag not found")
	}
	if len(back[1].Value) != 300 {
		t.Fatal("long value length")
	}
}

func TestRejectsMalformed(t *testing.T) {
	for _, h := range []string{"9F", "9F26", "9F2608A1B2", "9F26FF", "9F268400000001AA", "DFFFFFFF7F0100"} {
		if _, err := ParseHex(h); err == nil {
			t.Errorf("%s accepted", h)
		}
	}
}

func TestFilterForDE55(t *testing.T) {
	objs, _ := ParseHex(specExample + "5A084111111111111111")
	kept, missing := FilterForDE55(objs)
	for _, o := range kept {
		if o.Tag == "5A" {
			t.Fatal("PAN tag 5A must never be forwarded in DE 55")
		}
	}
	if len(missing) == 0 {
		t.Fatal("expected missing mandatory tags for this partial example")
	}
}

func FuzzParse(f *testing.F) {
	f.Add([]byte{0x9F, 0x26, 0x01, 0x00})
	f.Fuzz(func(t *testing.T, b []byte) {
		objs, err := Parse(b)
		if err != nil {
			return
		}
		if _, err := Encode(objs); err != nil {
			t.Fatalf("parsed objects do not re-encode: %v", err)
		}
	})
}
