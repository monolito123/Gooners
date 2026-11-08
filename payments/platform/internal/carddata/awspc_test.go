package carddata

import (
	"context"
	"crypto/cipher"
	"crypto/des"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/monolito123/Gooners/payments/platform/internal/awsauth"
)

// A fake data plane that does what Payment Cryptography does for TDES DUKPT: derive the
// request data key from the BDK it holds and the KSN, and decrypt in CBC mode.
func TestAWSPaymentCryptography(t *testing.T) {
	bdk := mustHex("0123456789ABCDEFFEDCBA9876543210")
	const arn = "arn:aws:payment-cryptography:sa-east-1:111122223333:key/bdk1"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.Contains(auth, "/sa-east-1/payment-cryptography/aws4_request") || r.URL.EscapedPath() != "/keys/arn%3Aaws%3Apayment-cryptography%3Asa-east-1%3A111122223333%3Akey%2Fbdk1/decrypt" {
			w.WriteHeader(403)
			w.Write([]byte(`{"__type":"AccessDeniedException","message":"` + r.URL.EscapedPath() + `"}`))
			return
		}
		var in struct {
			CipherText           string
			DecryptionAttributes struct {
				Dukpt struct {
					KeySerialNumber, Mode, DukptKeyDerivationType, DukptKeyVariant string
				}
			}
		}
		json.NewDecoder(r.Body).Decode(&in)
		d := in.DecryptionAttributes.Dukpt
		if d.Mode != "CBC" || d.DukptKeyDerivationType != "TDES_2KEY" || d.DukptKeyVariant != "REQUEST" {
			w.WriteHeader(400)
			w.Write([]byte(`{"__type":"ValidationException","message":"attributes"}`))
			return
		}
		key, _ := DataKey(bdk, mustHex(d.KeySerialNumber))
		ct := mustHex(in.CipherText)
		b, _ := des.NewTripleDESCipher(tdesKey(key))
		pt := make([]byte, len(ct))
		cipher.NewCBCDecrypter(b, make([]byte, 8)).CryptBlocks(pt, ct)
		json.NewEncoder(w).Encode(map[string]string{"KeyArn": arn, "KeyCheckValue": "08D7B4", "PlainText": strings.ToUpper(hex.EncodeToString(pt))})
	}))
	defer srv.Close()

	hsm := NewAWSPaymentCryptography(arn, "sa-east-1")
	hsm.Client.Endpoint, hsm.Client.Credentials = srv.URL, awsauth.Static{AccessKeyID: "AKIA", SecretAccessKey: "s"}
	ksn := "FFFF9876543210E0000A"
	ct, _ := EncryptDUKPT(bdk, ksn, mustHex("5A0847617390010101195F2403291231"+"9F2608A1B2C3D4E5F60708"))
	c, err := hsm.Decrypt(context.Background(), FormatDUKPTTDES, strings.ToLower(ksn), ct)
	if err != nil || c.PAN != "4761739001010119" || c.Expiry != "2912" {
		t.Fatalf("%+v %v", c, err)
	}
	if _, err := hsm.Decrypt(context.Background(), FormatDUKPTAES128, ksn, ct); err == nil || !strings.Contains(err.Error(), "24 hex digits") {
		t.Fatalf("an AES DUKPT KSN of TDES length: %v", err)
	}
	if _, err := hsm.Decrypt(context.Background(), DevFormat, ksn, ct); err == nil {
		t.Fatal("the development format sent to the payment HSM")
	}
}
