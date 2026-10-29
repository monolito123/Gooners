# Key custody adapters for production

In `sandbox` and `certification` the platform runs with software keys, so the whole flow works without hardware. In `production`, `internal/config` refuses those keys. Three adapters must exist first. Each is a small Go interface that already has a development implementation.

| Interface | Development implementation | Production implementation | Spec |
|-----------|----------------------------|---------------------------|------|
| `vault.KEK`: `Wrap` / `Unwrap` data keys | `vault.LocalKEK` (AES-256-GCM key in memory) | A KMS or general-purpose HSM (CloudHSM, Luna) holding one KEK per tenant. Wrap and unwrap are remote calls; the KEK never leaves the HSM | [04 §4.2](../docs/04-serverless-backend.md#42-key-management) |
| `carddata.Decryptor`: terminal blob → card data | `carddata.DevDecryptor` (`dev-aesgcm-v1`) | A payment HSM (Thales payShield, AWS Payment Cryptography) decrypting the MPoC SDK's or the PTS reader's DUKPT-encrypted data, and translating PIN blocks from the terminal zone to the acquirer working key | [04 §4.3](../docs/04-serverless-backend.md#43-end-to-end-encryption) |
| `nostr.Author`: sign events, derive NIP-44 keys | `nostr.Keys` (secret in memory) | A signer in an attested enclave (for example a Nitro Enclave with the key sealed by KMS under the enclave's measurements), exposing only `Public`, `SignEvent` and `SharedKey` | [03 §10](../docs/03-nostr-layer.md#10-security-considerations) |

## Payment HSM: what `Decrypt` must do

1. Identify the terminal's key from the KSN (DUKPT key serial number) and the format, which is vendor-specific: the MPoC SDK's blob layout or the reader's SRED layout.
2. Ask the HSM to derive the transaction key and decrypt the card data. The clear data exists only in the switch's memory, inside the CDE, for the duration of the authorization. `AuthorizeTerminal` zeroes its copy as soon as the switch has it.
3. If a PIN block is present, ask the HSM to **translate** it to the key agreed with the card host, and return the translated block. Never decrypt the PIN.
4. Return `carddata.Card`. Errors must not reveal key material or which step failed to the caller.

HSM command names differ by vendor (host command references for payShield; `DecryptData` and `TranslatePinData` in AWS Payment Cryptography). Keep each vendor in its own adapter.

## Rules that do not change with the adapter

- PANs at rest only as `card_vault` ciphertext. The switch and the reversal queue store vault tokens, never PANs.
- `Message.Dump` is the only way messages are logged. It masks DE 2, 14, 35, 36, 45, 52 and 55, plus any field marked `sensitive` in the dialect.
- Webhook secrets and API keys are stored hashed (API keys) or encrypted at rest by the database's storage encryption (webhook secrets). Rotate webhook secrets by keeping two active during rotation ([02 §10.1](../docs/02-api-reference.md#101-delivery-format)).
