# Key custody: the KMS, the payment HSM and the signer

In `sandbox` and `certification` the platform can run with software keys, so the whole flow works without hardware. In `production`, `internal/config` refuses them and requires the three adapters below, which are built and tested. `platform integrations` reports each one: KEK (KMS), Payment HSM (card data), and Signer.

| Interface | Development | Production adapter | Settings |
|-----------|-------------|--------------------|----------|
| `vault.KEK`: wrap and unwrap data keys | `vault.LocalKEK` (`VAULT_KEK_HEX`) | `vault.AWSKMS` (KMS `Encrypt` / `Decrypt` with an encryption context) or `vault.GCPKMS` (Cloud KMS `encrypt` / `decrypt` with additional authenticated data) | `KEK_PROVIDER` (`aws-kms`, `gcp-kms`), `KEK_KEY_ID`, `AWS_REGION` |
| `carddata.Decryptor`: a reader's blob → card data | `carddata.DevDecryptor` (the phones' `dev-aesgcm-v1`); `carddata.SoftwareDUKPT` (TDES DUKPT with the BDK in memory, `CARDDATA_BDK_HEX`) | `carddata.AWSPaymentCryptography`: `DecryptData` with DUKPT attributes, TDES or AES-128 | `CARDDATA_HSM_KEY_ARN`, `AWS_REGION` |
| `nostr.Author`: sign events, derive NIP-44 keys | `nostr.Keys` (`RECEIPTS_SECRET_HEX`, `TRANSPARENCY_SECRET_HEX`) | `signer.Remote`, a client of the `signer` service | `SIGNER_URL`, `SIGNER_TLS_CERT/KEY/CA` |

No SDK is involved:

- AWS requests are signed by `internal/awsauth`, tested against AWS's published Signature Version 4 examples. It finds credentials as the SDKs do: environment keys, EKS web identity, the ECS or EKS Pod Identity agent, or EC2 IMDSv2.
- Google tokens come from `internal/gcpauth`: a service-account key, or the metadata server.

## The KEK

One symmetric key in the KMS wraps every 32-byte data key the vault uses: card numbers, webhook secrets and travel-rule data. It never leaves the KMS's HSMs, and every use appears in CloudTrail or Cloud Audit Logs. Each wrap binds a context (`purpose=goonerspay-vault`), so a blob made for another purpose cannot be unwrapped here.

Rows record the KEK that wrapped them (`kek_id`). A deployment that starts in production with a KMS key has no rows wrapped by the software key. Migrating sandbox data is not supported.

`VAULT_FINGERPRINT_KEY_HEX`, the HMAC key behind card fingerprints, still comes from the environment. Inject it from the secret manager.

## The payment HSM

Readers send the card's EMV data objects encrypted under the transaction's DUKPT key:

| Format | Standard | KSN |
|--------|----------|-----|
| `dukpt-tdes-cbc-tlv-v1` | TDES DUKPT, ANSI X9.24-1:2009 | 20 hex digits |
| `dukpt-aes128-cbc-tlv-v1` | AES DUKPT, X9.24-3:2017 | 24 hex digits |

`carddata.FromTLV` then reads the card's fields. Only the objects DE 55 may carry stay as EMV data, so account data never travels in it.

The software implementation is tested against the standard's Annex A examples: the IPEK, the transaction and PIN keys, and the encrypted PIN blocks for PIN 1234. It also decrypts what `tapsim -bdk` sends, which the smoke test runs.

**Key ceremony.** The reader vendor (the MPoC SDK, the Tap to Pay provider or the PTS reader's) and the platform agree the base derivation key. Import it into AWS Payment Cryptography under TR-34 or TR-31, and set its ARN in `CARDDATA_HSM_KEY_ARN`. The BDK then never exists outside the two HSMs.

**Not built:**

- PIN translation (`TranslatePinData`), for readers that take an online PIN. Contactless with CDCVM or below the CVM limit needs none.
- An adapter for an on-premises payShield, whose host command reference is licensed to its customers. It would implement the same `Decryptor`.

## The signer

`cmd/signer` holds the receipts key and the transparency key.

- **Keys at rest.** They are sealed under the KMS key (`signer seal -generate receipts,transparency -out keys.json`) and decrypted only in the signer's memory at start.
- **Access.** It answers over mutual TLS only. `SIGNER_CLIENT_CA` is the platform's client CA, and `SIGNER_ALLOWED_CLIENTS` is an optional list of certificate fingerprints.
- **What it signs.** Each key signs only its kinds:
  - the receipts key: 7711, 13 and 7713;
  - the transparency key: 7715.
- **Times.** It refuses times more than 72 hours old or 10 minutes ahead, and logs every signature.
- **Client checks.** `signer.Remote` checks that what comes back is the event it sent, signed by that key.

Deploy the signer where only it can use the KMS key: a Nitro Enclave or a confidential VM whose role alone has `kms:Decrypt` on that key. With a Nitro Enclave, condition the key policy on the enclave's measurements (`kms:RecipientAttestation:ImageSha256`). A compromised platform host can then ask for signatures of the allowed kinds, which the signer logs, but can never take the keys.

## Rules that do not change with the adapter

- PANs are at rest only as `card_vault` ciphertext. The switch and the reversal queue store vault tokens, never PANs.
- `Message.Dump` is the only way messages are logged. It masks DE 2, 14, 35, 36, 45, 52 and 55, plus any field marked `sensitive` in the dialect.
- API keys are stored hashed. Webhook secrets are sealed under the vault's KEK and rotate with an overlap ([02 §10.1](../docs/02-api-reference.md#101-delivery-format)).
