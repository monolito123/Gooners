package carddata

import (
	"context"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"

	"github.com/monolito123/Gooners/payments/platform/internal/awsauth"
)

// AWSPaymentCryptography decrypts readers' DUKPT data in AWS Payment Cryptography, a managed
// payment HSM (PCI PTS HSM certified): the base derivation key is imported once, through a
// key ceremony with the reader vendor, and never leaves it. The platform sends the KSN and
// the ciphertext and receives the card's TLV, inside the CDE only.
type AWSPaymentCryptography struct {
	// KeyARN names the BDK (or its alias).
	KeyARN string
	// Client calls the data plane (service "payment-cryptography").
	Client *awsauth.Client
}

// NewAWSPaymentCryptography returns the adapter for region with the environment's credentials.
func NewAWSPaymentCryptography(keyARN, region string) *AWSPaymentCryptography {
	return &AWSPaymentCryptography{KeyARN: keyARN, Client: &awsauth.Client{Service: "payment-cryptography", Region: region,
		Endpoint: "https://dataplane.payment-cryptography." + region + ".amazonaws.com", Credentials: awsauth.FromEnvironment()}}
}

// Decrypt implements Decryptor (DecryptData with DUKPT attributes).
func (a *AWSPaymentCryptography) Decrypt(ctx context.Context, format, ksn string, ct []byte) (Card, error) {
	derivation, ksnLen := "", 0
	switch format {
	case FormatDUKPTTDES:
		derivation, ksnLen = "TDES_2KEY", 20
	case FormatDUKPTAES128:
		derivation, ksnLen = "AES_128", 24
	default:
		return Card{}, fmt.Errorf("carddata: format %q is not a DUKPT format", format)
	}
	ksn = strings.ToUpper(ksn)
	if len(ksn) != ksnLen || strings.Trim(ksn, "0123456789ABCDEF") != "" {
		return Card{}, fmt.Errorf("carddata: a %s KSN is %d hex digits", derivation, ksnLen)
	}
	in := map[string]any{
		"CipherText": strings.ToUpper(hex.EncodeToString(ct)),
		"DecryptionAttributes": map[string]any{"Dukpt": map[string]any{
			"KeySerialNumber": ksn, "Mode": "CBC", "DukptKeyDerivationType": derivation, "DukptKeyVariant": "REQUEST",
		}},
	}
	var out struct {
		PlainText string `json:"PlainText"`
	}
	if err := a.Client.Do(ctx, "POST", "/keys/"+url.PathEscape(a.KeyARN)+"/decrypt", nil, in, &out); err != nil {
		return Card{}, fmt.Errorf("carddata: payment HSM: %w", err)
	}
	pt, err := hex.DecodeString(out.PlainText)
	if err != nil {
		return Card{}, fmt.Errorf("carddata: payment HSM answer: %w", err)
	}
	defer clear(pt)
	return FromTLV(pt)
}
