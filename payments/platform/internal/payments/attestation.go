package payments

import (
	"context"
	"encoding/base64"
	"fmt"

	"github.com/monolito123/Gooners/payments/platform/internal/attest"
	"github.com/monolito123/Gooners/payments/platform/internal/mobileauth"
)

// StrictAttestor is an Attestor whose verdict is enforced: devices without verified
// evidence must attest at their first login, and their sessions use the attested key.
type StrictAttestor interface {
	Attestor
	Strict() bool
}

// VerifyingAttestor verifies Apple App Attest (iOS) and Android hardware key attestation
// offline, against the roots and app identities the operator configures.
type VerifyingAttestor struct {
	AppAttest      *attest.AppAttestConfig
	KeyAttestation *attest.KeyAttestationConfig
}

// Strict implements StrictAttestor.
func (VerifyingAttestor) Strict() bool { return true }

func evidenceString(e map[string]any, k string) string { s, _ := e[k].(string); return s }

// Verify implements Attestor.
func (a VerifyingAttestor) Verify(_ context.Context, platform, devicePubHex string, e map[string]any) (map[string]any, []string, error) {
	switch typ := evidenceString(e, "type"); {
	case typ == "app_attest" && platform == "ios" && a.AppAttest != nil:
		keyID, err1 := base64.StdEncoding.DecodeString(evidenceString(e, "key_id"))
		obj, err2 := base64.StdEncoding.DecodeString(evidenceString(e, "attestation"))
		if err1 != nil || err2 != nil {
			return nil, nil, fmt.Errorf("app_attest: key_id and attestation are base64")
		}
		if evidenceString(e, "client_data") != devicePubHex {
			return nil, nil, fmt.Errorf("app_attest: the client data must be the device key")
		}
		res, err := attest.VerifyAppAttest(*a.AppAttest, keyID, obj, []byte(devicePubHex))
		if err != nil {
			return nil, nil, err
		}
		return map[string]any{"verdict": "verified", "method": "app_attest", "environment": res.Environment,
			"app_attest_key": base64.StdEncoding.EncodeToString(res.PublicKey)}, []string{"tap_to_pay", "pix"}, nil
	case typ == "android_key_attestation" && platform == "android" && a.KeyAttestation != nil:
		raw, _ := e["certificate_chain"].([]any)
		chain := make([][]byte, 0, len(raw))
		for _, c := range raw {
			s, _ := c.(string)
			der, err := base64.StdEncoding.DecodeString(s)
			if err != nil {
				return nil, nil, fmt.Errorf("android_key_attestation: certificates are base64 DER")
			}
			chain = append(chain, der)
		}
		res, err := attest.VerifyKeyAttestation(*a.KeyAttestation, chain, attest.Challenge(devicePubHex))
		if err != nil {
			return nil, nil, err
		}
		jkt := mobileauth.JWK{Kty: "EC", Crv: "P-256", X: res.JWKX, Y: res.JWKY}.Thumbprint()
		// The attested key is the app's DPoP key: sessions of this device must use it.
		return map[string]any{"verdict": "verified", "method": "android_key_attestation", "security_level": res.SecurityLevel,
			"package": res.PackageName, "dpop_jkt": jkt}, []string{"tap_to_pay", "pix"}, nil
	case typ == "" || typ == "none":
		return nil, nil, fmt.Errorf("attestation is required")
	default:
		return nil, nil, fmt.Errorf("unsupported attestation %q for %s", typ, platform)
	}
}

func (s *Service) strictAttestation() bool {
	st, ok := s.attest.(StrictAttestor)
	return ok && st.Strict()
}
