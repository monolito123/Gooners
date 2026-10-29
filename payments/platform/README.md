# InfinityPay+ platform: reference implementation

Go 1.26 implementation of the specification in [`../docs`](../docs). It contains everything needed to connect to a card host (sponsor acquirer, then Visa and Mastercard directly) and to a bank for Pix, plus simulators of both counterparties so the full flow runs locally and in CI before any contract is signed.

> **Status.** The integration layer (ISO 8583, scheme sessions, reversals, ledger, Pix, webhooks, receipts) is built to production standards and tested end to end. Three things need a counterparty or hardware before production, and the code leaves typed seams for each: the licensed field tables for each card host, an HSM / payment-HSM / enclave for keys, and the bank's payout API. The platform refuses to start in `production` until those are wired ([`../integration/hsm.md`](../integration/hsm.md)).

## What is here

| Package | What it does | Spec |
|---------|--------------|------|
| `pkg/iso8583` | Dialect-driven ISO 8583 codec: ASCII, BCD, EBCDIC, binary; LL/LLL prefixes; primary and secondary bitmaps; headers; TCP framing; masked dumps. Fuzzed | [01 §3](../docs/01-acquiring-engine.md#3-authorization-switch-and-iso-8583) |
| `dialects/` | `generic-1987-ascii` (verified reference dialect) and Visa / Mastercard **structural templates** marked `template-unverified` | [integration/visa.md](../integration/visa.md) |
| `pkg/emv` | BER-TLV for DE 55, with the forwarded-tag allow-list (the PAN tag is never forwarded) | [01 §3.6](../docs/01-acquiring-engine.md#36-emv-data-de-55) |
| `internal/scheme` | Persistent sessions: sign-on, idle echo, host-initiated echo, response correlation, timeouts, reconnect with backoff, route health breaker | [01 §2.2](../docs/01-acquiring-engine.md#22-session-management) |
| `internal/authswitch` | Canonical authorization → ISO 8583; response-code policy with Visa categories and Mastercard advice codes; timeout → reversal with store-and-forward (0400, then 0420 advices); partial reversals (DE 95); idempotent replays; expected-margin routing with cascade only when nothing reached the network | [01 §3–§6](../docs/01-acquiring-engine.md#6-smart-transaction-routing) |
| `internal/ledger` | Serializable, idempotent double-entry posting; shards for hot accounts; no-negative rule; outbox; invariant verifier L1–L5 | [04 §3](../docs/04-serverless-backend.md#3-ledger) |
| `pkg/brcode` | Pix BR Code encoder/decoder with CRC16, checked against the Banco Central's published examples | [02 §4.4](../docs/02-api-reference.md#44-pix) |
| `pkg/apipix` | Client for the Banco Central **API Pix** standard (v2): OAuth2 client credentials over mutual TLS, `cob`, `pix`, `devolucao`, `webhook`; mTLS webhook handler | [integration/pix.md](../integration/pix.md) |
| `internal/pixout` | Seam for outgoing Pix (not covered by API Pix), with a generic partner-bank adapter | [integration/pix.md](../integration/pix.md) |
| `pkg/nostr`, `internal/receipts` | NIP-01 / BIP-340 / NIP-44 v2 / NIP-59, reproducing the JavaScript examples byte for byte; receipt issuer (claim key, merchant copy, customer copy) and relay publisher | [03](../docs/03-nostr-layer.md) |
| `internal/vault` | PANs under per-record AES-256-GCM data keys wrapped by a KEK; HMAC fingerprints | [04 §4.2](../docs/04-serverless-backend.md#42-key-management) |
| `internal/carddata` | Seam for terminal data decryption (payment HSM), plus a development format | [04 §4.3](../docs/04-serverless-backend.md#43-end-to-end-encryption) |
| `internal/pricing` | MDR, cost estimates, ANBIMA national holidays, DU/252 advance fees | [07 §1.3](../docs/07-enhancements.md#13-pricing-an-advance) |
| `internal/payments`, `internal/api` | Business flows and the HTTP API: API keys with scopes, terminal certificates, idempotency keys, Problem Details | [02](../docs/02-api-reference.md) |
| `internal/webhooks` | Standard Webhooks delivery with retries; matches the spec's test vector | [02 §10](../docs/02-api-reference.md#10-webhooks) |
| `internal/schemesim`, `internal/pixsim` | Simulators of the card host (network + issuer) and of a Pix PSP | below |

Binaries (`cmd/`): `platform` (serve, migrate, apikey, verify-ledger, release-due, settle), `schemesim`, `pixsim`, `devpki`, `tapsim` (terminal emulator) and `smoke` (runs all of them together).

## Quick start

```bash
cd payments/platform
go test -race ./...         # unit, integration and end-to-end tests; starts a throwaway PostgreSQL if one is installed
docker compose up --build   # sandbox stack on http://localhost:8080
```

With PostgreSQL installed and no Docker, `DATABASE_URL=postgres://… go run ./cmd/smoke` builds every binary, starts them as separate processes with a fresh dev PKI, and drives a tap, a decline, a Pix payment over the PSP's mTLS webhook, and a payout. It then checks the ledger.

Talking to the sandbox:

```bash
docker compose exec platform platform apikey -tenant 00000000-0000-4000-8000-000000000001   # prints sk_test_…
export KEY=sk_test_…
curl -s localhost:8080/v1/merchants -H "Authorization: Bearer $KEY" -H "Idempotency-Key: $(uuidgen)" -d '{
  "legal": {"document": {"type": "cnpj", "number": "12345678000195"}, "legal_name": "Cafe Aurora Ltda",
            "trade_name": "Café Aurora", "mcc": "5812", "address": {"city": "São Paulo"}},
  "settlement": {"default_speed": "instant"}}'
curl -s localhost:8080/v1/terminals -H "Authorization: Bearer $KEY" -H "Idempotency-Key: $(uuidgen)" -d '{"merchant_id": "mer_…"}'
go run ./cmd/tapsim -key $KEY -merchant mer_… -terminal T… -amount 12990 \
  -dev-key 6361726464617461206465762d6b657920666f722073616e64626f78206f6e6c
```

## The simulators

**`schemesim`** plays the card network and the issuer, driven by the cents of the amount, the way scheme test scripts use magic amounts:

| Amount ends in | Response |
|----------------|----------|
| `05` `51` `54` `55` `57` `59` `61` `65` `91` `96` | That response code (65 comes with a Mastercard-style merchant advice code) |
| `98` | No answer: the switch times out and reverses |
| `99` | Answers after `-late-delay`: a late response after the timeout |
| anything else | `00` approved, 6-character authorization code, network transaction ID, issuer data in DE 55 |

It answers 0800 sign-on and echo, sends host-initiated echoes on request, and refuses financial messages before sign-on (`-require-sign-on`).

**`pixsim`** implements the PSP side of API Pix (OAuth2, `PUT/GET /cob/{txid}`, `GET /pix/{e2eid}`, `PUT/GET /pix/{e2eid}/devolucao/{id}`, `PUT/GET /webhook/{chave}`) with mutual TLS, the generic transfer contract of `internal/pixout`, and two control endpoints: `POST /sim/pagar/{txid}` (a payer pays) and `POST /sim/devolucao/{e2eid}/{id}/liquidar` (a refund settles). Both send the webhook to `{webhookUrl}/pix` over mutual TLS.

## Configuration

All configuration is environment variables plus a routes file (`deploy/routes.*.json`).

| Variable | Meaning |
|----------|---------|
| `PLATFORM_ENV` | `sandbox`, `certification` or `production` (guards below) |
| `DATABASE_URL` | PostgreSQL / CockroachDB. Migrations run at start |
| `ROUTES_FILE` | Card host routes: dialect (embedded name or licensed `dialect_file`), addresses per site, TLS files, acquirer ID, brands, fees, approval prior |
| `ACQUIRER_ID`, `CARD_PRESENT_TIMEOUT` | DE 32 and T_resp (default 10 s) |
| `HTTP_ADDR`, `HTTP_TLS_*` | Partner and merchant API |
| `TERMINAL_ADDR`, `TERMINAL_TLS_CA/CERT/KEY` | Mutual-TLS listener for terminals (CA = terminal CA) |
| `PIX_BASE_URL`, `PIX_TOKEN_URL`, `PIX_CLIENT_ID`, `PIX_CLIENT_SECRET`, `PIX_KEY`, `PIX_TLS_CA/CERT/KEY` | The PSP's API Pix (base URL includes `/v2`) |
| `PIX_WEBHOOK_ADDR`, `PIX_WEBHOOK_TLS_CA/CERT/KEY`, `PIX_WEBHOOK_PUBLIC_URL` | Listener for the PSP's webhooks (CA = the PSP's client CA). The public URL is registered with `PUT /webhook/{chave}` at start |
| `PAYOUT_BASE_URL` | Partner bank transfer API (generic adapter) |
| `VAULT_KEK_HEX`, `VAULT_FINGERPRINT_KEY_HEX` | Software KEK and fingerprint key: **sandbox and certification only** |
| `CARDDATA_DEV_KEY_HEX` | Development terminal format: **sandbox and certification only** |
| `RECEIPTS_SECRET_HEX`, `RELAYS`, `RECEIPT_CLAIM_BASE` | Receipt signing key (enclave in production), relays, claim page |
| `BOOTSTRAP_TENANT`, `BOOTSTRAP_CAPITAL` | Create a tenant's accounts at start; opening capital in the sandbox only |

| Guard | sandbox | certification | production |
|-------|:-------:|:-------------:|:----------:|
| Plain TCP to a card host | allowed | refused | refused |
| `template-unverified` dialects | allowed | refused | refused |
| Opening capital | allowed | refused | refused |
| Software KEK, development decryptor, in-process receipts key | allowed | allowed (test cards only) | refused |

## Implemented API surface

Implemented and covered by the end-to-end tests: `POST /v1/merchants`, `GET /v1/merchants/{id}`, `POST /v1/terminals`, `POST/GET /v1/payment-intents`, `…/confirm` (Pix), `…/capture`, `…/cancel`, `POST /v1/terminal/authorizations`, `POST/GET /v1/refunds`, `GET /v1/accounts/{id}/balance`, `GET /v1/accounts/{id}/entries`, `POST /v1/payouts/quotes`, `POST /v1/payouts`, `POST /v1/webhook-endpoints`, and the PSP webhook `POST {webhook}/pix`. The request examples in [02-api-reference.md](../docs/02-api-reference.md) are posted as written in `internal/e2e/spec_examples_test.go`.

Specified but not built yet. The API answers these explicitly rather than half-working:

| Spec feature | Today | Needs |
|--------------|-------|-------|
| Card-not-present (`confirm` with a card) | `501` | EMVCo-certified 3DS server, network tokens ([01 §4–§5](../docs/01-acquiring-engine.md#4-emv-3-d-secure-card-not-present)) |
| Split payments | `422 splits_not_supported` | Multi-recipient capture journals |
| `/oauth2/token` (mTLS-bound tokens), `/v1/auth/nostr` (NIP-98) | API keys with scopes | Token service at the edge |
| Disputes, `/v1/payment-methods`, `/v1/accounts` (sub-ledgers), `/v1/transfers`, settlement proofs, webhook replay | Not routed (`404`) | See [08](../docs/08-roadmap-risks.md) |
| CSR signing on `/v1/terminals` | `501` | Terminal PKI after attestation |

## Verification

`go test -race ./...` covers:

- the codec against known bytes, all three dialect encodings, fuzzing, and masking;
- scheme sessions against the simulator: sign-on, 200 concurrent correlated requests, timeouts, late responses, reconnect, and host echo;
- the switch: declines, timeout → SAF reversal with a correct DE 90, partial reversal DE 95, replay, cascade, and the routing example from the spec;
- the ledger on PostgreSQL: the spec's posting catalogue, idempotency conflicts, 40 concurrent payouts against one wallet (exactly 10 approved), shard sums, and the outbox;
- Pix over mutual TLS both ways: charge, payment, webhook, confirmation, idempotent devolução, its settlement webhook, transfers and problem details;
- Nostr cross-vectors with the JavaScript implementation;
- webhook signatures against the spec's vector;
- configuration guards;
- the full API flow, ending with L1–L5 and verified webhook signatures.

CI (`.github/workflows/payments-platform.yml`) adds staticcheck, short fuzzing, the multi-process smoke test, govulncheck, and the Docker image build.
