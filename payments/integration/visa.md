# Connecting directly to Visa (Phase 2)

A direct connection makes the platform a Visa principal acquirer: its own BIN, its own authorization and clearing connections to VisaNet, and its own certification. It removes the sponsor's markup and gives full control of routing, tokens and 3DS ([01 §1](../docs/01-acquiring-engine.md#1-integration-models)).

## Prerequisites (outside the code)

| Item | Notes |
|------|-------|
| BCB authorization as *credenciador* | Res. BCB 80/2021 ([00 §7](../docs/00-executive-summary.md#7-regulatory-posture-brazil-first)) |
| Visa principal membership and BIN | Capital, compliance programme, settlement bank arrangements |
| Licensed interface specifications | The V.I.P. System authorization (BASE I) and clearing (BASE II) specifications, plus the Brazil domestic supplements (installments, combo cards) |
| Connectivity | Visa's access equipment installed in both colocation sites, dual carrier circuits ([01 §2.1](../docs/01-acquiring-engine.md#21-physical-and-network-topology)) |
| Payment HSM | Zone keys exchanged with Visa under the key ceremony; PIN translation ([hsm.md](hsm.md)) |
| Certification | Visa's test environment and certification scripts for host, terminal, 3DS and tokens |

## What the code already does for a Visa connection

- **Encodings Visa uses**: BCD numerics with odd-length padding, EBCDIC text, binary bitmaps, 1-byte binary LLVAR prefixes, a fixed message header (`header_len`). The structural template `dialects/visa-base1.template.json` exercises all of them in the codec tests.
- **Sessions**: sign-on and echo, host-initiated echo, correlation by STAN, transmission time and terminal ID, two sites per route, and reconnect with backoff.
- **Reversals**: timeout reversal, store-and-forward with the same STAN and DE 7 on every retry, 0420 advices after `MaxReversalAge`, and partial reversals with DE 95.
- **Policy**: response-code categories for Visa's excessive-reattempt rules ([01 §3.7](../docs/01-acquiring-engine.md#37-response-codes-and-retry-policy)), and no cascade once a cryptogram may have reached an issuer.
- **Routing**: a `visa_direct` route next to the sponsor route, ranked by expected margin.

## Integration steps

1. **Transcribe the dialect** from the licensed V.I.P. specification into `visa-base1.json`. Start from the template. Replace the header layout (the 22-byte header carries station IDs and flags), the private fields (Visa uses fields such as 60, 62, 63 and 126 for POS information, the transaction ID, network data and authentication data), and the framing. Round-trip every example message in the specification, as in [sponsor-acquirer.md](sponsor-acquirer.md#step-1-transcribe-the-dialect).
2. **Fill Visa-specific fields** in a `visa` mapping hook: POS entry and condition details, the transaction ID returned for MIT linkage (stored as `network_txn_id`), the 3DS / token cryptogram fields for card-not-present, and the Brazil installment fields.
3. **Header handling.** Set `Message.Header` on every request according to the specification, and read the response header (for example to tell rejects from responses).
4. **Clearing (BASE II).** Not built yet. Add a clearing job that turns captured authorizations into BASE II draft records (and credit records for refunds), submits the file, and processes acknowledgements and rejects ([01 §8](../docs/01-acquiring-engine.md#8-clearing-settlement-and-receivables)). The ledger journals already exist (`card_capture`, `refund`, `scheme_settlement`).
5. **Settlement reports.** Parse Visa's settlement reports into `platform settle` postings and reconcile them.
6. **Tokens, 3DS, disputes.** VTS token requestor onboarding, an EMVCo-certified 3DS server, and dispute handling through Visa's dispute system are separate integrations, specified in [01 §4–§7](../docs/01-acquiring-engine.md#4-emv-3-d-secure-card-not-present).
7. **Certify**: run [certification-test-plan.md](certification-test-plan.md) on the Visa test environment, then Visa's own scripts.

## Configuration

```json
{
  "name": "visa_direct",
  "dialect_file": "/etc/platform/dialects/visa-base1.json",
  "addrs": ["visa-access-site-a:port", "visa-access-site-b:port"],
  "tls": { "ca": "/etc/platform/pki/visa-link-ca.pem", "cert": "/etc/platform/pki/visa-link.pem", "key": "/etc/platform/pki/visa-link.key" },
  "acquirer_id": "<Visa acquiring identifier>",
  "schemes": ["visa"],
  "fee_bps": 10,
  "fixed_cents": 0,
  "per_attempt_cents": 3,
  "approval_prior": 0.93
}
```

Field names, addresses and identifiers in this file are placeholders. Take the real ones from the licensed documentation and the connectivity agreement.
