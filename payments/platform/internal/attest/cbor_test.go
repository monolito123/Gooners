package attest

import "testing"

func FuzzCBOR(f *testing.F) {
	f.Add([]byte{0xa1, 0x63, 'f', 'm', 't', 0x40})
	f.Add([]byte{0x9f}) // indefinite length: refused
	f.Fuzz(func(t *testing.T, b []byte) {
		_, _ = cborDecode(b) // must never panic or allocate beyond the input
	})
}

func TestCBORRefusesWhatAttestationsNeverUse(t *testing.T) {
	for name, b := range map[string][]byte{
		"indefinite array":  {0x9f, 0xff},
		"length past input": {0x5a, 0xff, 0xff, 0xff, 0xff},
		"integer map key":   {0xa1, 0x01, 0x01},
		"trailing bytes":    {0x01, 0x02},
		"half a length":     {0x19, 0x01},
	} {
		if _, err := cborDecode(b); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	deep := make([]byte, 0, 40)
	for i := 0; i < 40; i++ {
		deep = append(deep, 0x81)
	}
	if _, err := cborDecode(append(deep, 0x00)); err == nil {
		t.Error("deep nesting was accepted")
	}
}
