package payments

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
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

// AssertionVerifier checks App Attest assertions against the key a device attested.
type AssertionVerifier interface {
	VerifyAssertion(publicKey []byte, lastCounter uint32, assertion, clientData []byte) (uint32, error)
}

// VerifyAssertion implements AssertionVerifier.
func (a VerifyingAttestor) VerifyAssertion(publicKey []byte, lastCounter uint32, assertion, clientData []byte) (uint32, error) {
	if a.AppAttest == nil {
		return 0, errors.New("app attest is not configured")
	}
	return attest.VerifyAppAttestAssertion(*a.AppAttest, publicKey, lastCounter, assertion, clientData)
}

// ErrAssertion is a card authorization from an App Attest device without a valid assertion.
var ErrAssertion = errors.New("app attest assertion")

// CheckAssertion verifies the App Attest assertion over a card authorization's exact request
// body, for a device whose attestation was App Attest: every sale is signed by the Secure
// Enclave key Apple attested, so a device key copied to another phone, or a captured
// attestation replayed, cannot sell; the counter only goes up, so a request cannot be
// replayed either. Devices attested otherwise (Android's DPoP key is the attested key) pass.
func (s *Service) CheckAssertion(ctx context.Context, tenantID, deviceID string, body, assertion []byte) error {
	var integrityJSON []byte
	var last int64
	if err := s.pool.QueryRow(ctx, `SELECT integrity, COALESCE(app_attest_counter, 0) FROM devices WHERE tenant_id = $1 AND id = $2`, tenantID, deviceID).
		Scan(&integrityJSON, &last); err != nil {
		return fmt.Errorf("%w: device", ErrNotFound)
	}
	var stored struct {
		Verdict map[string]any `json:"verdict"`
	}
	_ = json.Unmarshal(integrityJSON, &stored)
	key, _ := stored.Verdict["app_attest_key"].(string)
	av, ok := s.attest.(AssertionVerifier)
	if stored.Verdict["method"] != "app_attest" || key == "" || !ok {
		return nil
	}
	if len(assertion) == 0 {
		return fmt.Errorf("%w: required: sign the request body with the App Attest key", ErrAssertion)
	}
	pub, err := base64.StdEncoding.DecodeString(key)
	if err != nil {
		return err
	}
	n, err := av.VerifyAssertion(pub, uint32(last), assertion, body) // #nosec G115 -- the column only holds uint32 counters
	if err != nil {
		return fmt.Errorf("%w: %v", ErrAssertion, err)
	}
	tag, err := s.pool.Exec(ctx, `UPDATE devices SET app_attest_counter = $3 WHERE tenant_id = $1 AND id = $2 AND COALESCE(app_attest_counter, 0) < $3`, tenantID, deviceID, int64(n))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: counter %d already used (replayed)", ErrAssertion, n)
	}
	return nil
}

func (s *Service) strictAttestation() bool {
	st, ok := s.attest.(StrictAttestor)
	return ok && st.Strict()
}
