package carddata

import (
	"context"
	"crypto/des"
	"encoding/hex"
	"strings"
	"testing"
)

func mustHex(s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}

// ANSI X9.24-1:2009 Annex A: the BDK 0123456789ABCDEFFEDCBA9876543210, the initial KSN
// FFFF9876543210E00000, and PIN 1234 for PAN 4012345678909 encrypted at each counter.
func TestDUKPTStandardExamples(t *testing.T) {
	bdk := mustHex("0123456789ABCDEFFEDCBA9876543210")
	ipek, _ := IPEK(bdk, mustHex("FFFF9876543210E00000"))
	if got := strings.ToUpper(hex.EncodeToString(ipek)); got != "6AC292FAA1315B4D858AB3A3D7D5933A" {
		t.Fatalf("IPEK %s", got)
	}
	k1, _ := TransactionKey(bdk, mustHex("FFFF9876543210E00001"))
	if got := strings.ToUpper(hex.EncodeToString(k1)); got != "042666B49184CFA368DE9628D0397BC9" {
		t.Fatalf("transaction key #1 %s", got)
	}
	p1, _ := PINKey(bdk, mustHex("FFFF9876543210E00001"))
	if got := strings.ToUpper(hex.EncodeToString(p1)); got != "042666B49184CF5C68DE9628D0397B36" {
		t.Fatalf("PIN key #1 %s", got)
	}
	// ISO 9564 format 0: 041234FFFFFFFFFF XOR 0000401234567890.
	clearBlock := xor(mustHex("041234FFFFFFFFFF"), mustHex("0000401234567890"))
	for ksn, want := range map[string]string{
		"FFFF9876543210E00001": "1B9C1845EB993A7A",
		"FFFF9876543210E00002": "10A01C8D02C69107",
		"FFFF9876543210E00003": "18DC07B94797B466",
	} {
		k, _ := PINKey(bdk, mustHex(ksn))
		b, _ := des.NewTripleDESCipher(tdesKey(k))
		out := make([]byte, 8)
		b.Encrypt(out, clearBlock)
		if got := strings.ToUpper(hex.EncodeToString(out)); got != want {
			t.Errorf("PIN block at %s: %s, want %s", ksn, got, want)
		}
	}
}

// A reader's TLV round-trips through the software HSM into the card the switch uses: account
// data in its fields, only DE 55's objects in the EMV data, track 2 with its separator.
func TestDUKPTCardData(t *testing.T) {
	bdk := mustHex("0123456789ABCDEFFEDCBA9876543210")
	tlv := mustHex("5A0847617390010101195F24032912315F340101" + "4F07A0000000031010" +
		"57114761739001010119D2912201114380448F" + // track 2 equivalent, F-padded
		"9F2608A1B2C3D4E5F607089F2701809F3704C0FFEE119F3602001C9A032611089C0100" + "5F2002544F") // 5F20: the name never reaches DE 55
	ksn := "FFFF9876543210E00007"
	ct, err := EncryptDUKPT(bdk, ksn, tlv)
	if err != nil {
		t.Fatal(err)
	}
	c, err := SoftwareDUKPT{BDK: bdk}.Decrypt(context.Background(), FormatDUKPTTDES, ksn, ct)
	if err != nil {
		t.Fatal(err)
	}
	if c.PAN != "4761739001010119" || c.Expiry != "2912" || c.PANSequence != "01" || c.AID != "A0000000031010" ||
		c.Track2 != "4761739001010119=2912201114380448" {
		t.Fatalf("%+v", c)
	}
	if strings.Contains(c.EMVHex, "4761739001010119") || strings.Contains(c.EMVHex, "5F20") || !strings.Contains(c.EMVHex, "9F2608A1B2C3D4E5F607") {
		t.Fatalf("DE 55 data %s", c.EMVHex)
	}
	// Another counter's key does not open it; another format is refused.
	if _, err := (SoftwareDUKPT{BDK: bdk}).Decrypt(context.Background(), FormatDUKPTTDES, "FFFF9876543210E00008", ct); err == nil {
		t.Fatal("decrypted under the wrong transaction key")
	}
	if _, err := (SoftwareDUKPT{BDK: bdk}).Decrypt(context.Background(), FormatDUKPTAES128, ksn, ct); err == nil {
		t.Fatal("AES DUKPT accepted without a payment HSM")
	}
	// Track 2 alone is enough (contactless magstripe mode).
	ct, _ = EncryptDUKPT(bdk, ksn, mustHex("57114761739001010119D2912201114380448F"))
	if c, err := (SoftwareDUKPT{BDK: bdk}).Decrypt(context.Background(), FormatDUKPTTDES, ksn, ct); err != nil || c.PAN != "4761739001010119" || c.Expiry != "2912" {
		t.Fatalf("track 2 only: %+v %v", c, err)
	}
	f := Formats{FormatDUKPTTDES: SoftwareDUKPT{BDK: bdk}}
	if _, err := f.Decrypt(context.Background(), DevFormat, ksn, ct); err == nil {
		t.Fatal("an unconfigured format accepted")
	}
}
