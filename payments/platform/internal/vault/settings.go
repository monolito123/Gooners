package vault

import (
	"errors"
	"fmt"
	"strings"
)

// FromSettings builds the KEK a deployment configures, for the platform and the signer alike:
// "local" holds localKey (32 bytes) in memory and is for the sandbox only; "aws-kms" uses the
// key keyID (id, ARN or alias) in region; "gcp-kms" uses the key whose resource name is keyID.
func FromSettings(provider, keyID string, localKey []byte, region string) (KEK, error) {
	switch provider {
	case "", "local":
		return NewLocalKEK("local-dev", localKey)
	case "aws-kms":
		if keyID == "" || region == "" {
			return nil, errors.New("vault: aws-kms needs KEK_KEY_ID and AWS_REGION")
		}
		return NewAWSKMS(keyID, region), nil
	case "gcp-kms":
		if !strings.HasPrefix(keyID, "projects/") {
			return nil, errors.New("vault: gcp-kms needs KEK_KEY_ID, the key's resource name (projects/…/cryptoKeys/…)")
		}
		return NewGCPKMS(keyID)
	}
	return nil, fmt.Errorf("vault: unknown KEK_PROVIDER %q (local, aws-kms or gcp-kms)", provider)
}
