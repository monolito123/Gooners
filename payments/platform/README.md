# goonersPAY platform: reference implementation

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
| `internal/ledger` | Serializable, idempotent double-entry posting in any asset (one currency per journal); shards for hot accounts; no-negative rule; outbox; invariant verifier L1–L6 | [04 §3](../docs/04-serverless-backend.md#3-ledger) |
| `pkg/brcode` | Pix BR Code encoder/decoder with CRC16, checked against the Banco Central's published examples | [02 §4.4](../docs/02-api-reference.md#44-pix) |
| `pkg/apipix` | Client for the Banco Central **API Pix** standard (v2): OAuth2 client credentials over mutual TLS, `cob`, `pix` (including the paged `GET /pix` list), `devolucao`, `webhook`; mTLS webhook handler | [integration/pix.md](../integration/pix.md) |
| `internal/pixout` | Seam for outgoing Pix (not covered by API Pix), with a generic partner-bank adapter | [integration/pix.md](../integration/pix.md) |
| `pkg/nostr`, `internal/receipts` | NIP-01 / BIP-340 / NIP-44 v2 / NIP-59, reproducing the JavaScript examples byte for byte; receipt issuer (claim key, merchant copy, customer copy) and relay publisher | [03](../docs/03-nostr-layer.md) |
| `internal/vault` | PANs under per-record AES-256-GCM data keys wrapped by a KEK; HMAC fingerprints | [04 §4.2](../docs/04-serverless-backend.md#42-key-management) |
| `internal/carddata` | Seam for terminal data decryption (payment HSM), plus a development format | [04 §4.3](../docs/04-serverless-backend.md#43-end-to-end-encryption) |
| `internal/pricing` | MDR, cost estimates, ANBIMA national holidays, DU/252 advance fees | [07 §1.3](../docs/07-enhancements.md#13-pricing-an-advance) |
| `internal/payments`, `internal/api` | Business flows and the HTTP API: API keys with scopes, terminal certificates, idempotency keys, Problem Details | [02](../docs/02-api-reference.md) |
| `internal/payments` (operations) | Merchant lifecycle, terminal and API key revocation with an audit trail; chargebacks (intake, evidence, outcomes, deadlines, shortfall recovery); settlement-report and daily Pix reconciliation with true-ups, suspense and an exception queue; MED returns; periodic jobs under a lease | [runbook](../integration/operations-runbook.md) |
| `internal/transparency` | Daily statements (kind 7713): RFC 6962 trees over receipt IDs, salted commitments, the padded daily log sorted by hash, and the chain of signed kind 7715 roots; reproduces the spec's statement and roots byte for byte | [03 §6](../docs/03-nostr-layer.md#6-verifiable-settlement-transparency-log) |
| `internal/payments` (journal) | The devices' hash-chained terminal journals (kind 7714): signature, merchant and chain checks, gaps reported back, forks kept as proof and the terminal frozen | [03 §7](../docs/03-nostr-layer.md#7-terminal-journal-and-offline-first-logging) |
| `internal/attest` | Offline verification of Apple App Attest and Android hardware key attestation against configured roots; `attest/attesttest` builds evidence under a throwaway CA for tests | [05 §2.4](../docs/05-mobile.md#24-attestation-and-device-integrity) |
| `internal/registrar` | Receivable units and contract effects at a receivables registrar: the interface, an in-memory registrar (sandbox, tests) and a generic JSON contract an adapter to CERC, Núclea, B3 or TAG translates | [07 §1.6](../docs/07-enhancements.md#16-registrar-interplay) |
| `internal/risk`, `internal/payments` (risk) | The fraud shield's server half: features from the platform's own history (card velocity across terminals and partners, card testing on a terminal, ATC replay and regression per physical card, merchant baseline), the phone's score recomputed from its signal codes, the decision policy, held receivables, frozen terminals and analyst reviews; `RISK_MODE=shadow` records without acting | [07 §3](../docs/07-enhancements.md#3-autonomous-fraud-shield) |
| `internal/mobileauth` | NIP-98 login verification, DPoP proofs (RFC 9449) and JWK thumbprints, kind 17710 device lists; checked against the spec's signed examples | [02 §3.2](../docs/02-api-reference.md#32-post-v1authnostr-merchant-apps) |
| `internal/metrics` | Prometheus text exposition: request, authorization and dispute counters; backlog, exception, safeguarding-headroom and shortfall gauges | [runbook §3](../integration/operations-runbook.md#3-alerts) |
| `internal/webhooks` | Standard Webhooks delivery with retries; matches the spec's test vector | [02 §10](../docs/02-api-reference.md#10-webhooks) |
| `internal/assets`, `internal/exchange`, `internal/payments` (crypto) | The asset registry (decimals, networks, exact conversions); Binance, Kraken and Coinbase adapters with a best-price router and an in-memory venue; crypto payments settled in reais, holdings, conversions with a slippage guard, withdrawals | [09 §3](../docs/09-digital-assets-international-b3.md#3-crypto) |
| `internal/fx`, `internal/payments` (international) | Wise Platform adapter and an in-memory provider; USD, EUR and GBP balances, bank details and references, credits by reference, conversions with IOF, payments abroad (IBAN, ABA, sort code) | [09 §4](../docs/09-digital-assets-international-b3.md#4-accounts-abroad) |
| `internal/brokerage`, `internal/payments` (investments) | B3 rules (tickers, lots and the fractional market, the session as it follows US daylight time, D+2, fees), suitability (CVM 30), a broker contract, brapi.dev prices and an in-memory broker | [09 §5](../docs/09-digital-assets-international-b3.md#5-b3) |
| `internal/screening` | Sanctions screening of withdrawal addresses: OFAC's `SDN.CSV` or address lists (files or URLs, refreshed, refused when stale), a screening provider's contract, and a set that fails closed | [09 §6.1](../docs/09-digital-assets-international-b3.md#61-crypto-the-central-banks-vasp-rules) |
| `internal/decripto`, `internal/payments` (decripto, custody) | The DeCripto file in the national-provider layout of ADE COPES 2/2025 (reproduces the manual's examples byte for byte), built monthly from payments, conversions and withdrawals; the nightly reconciliation of each exchange's balances against the ledger's custody | [09 §6.3, §8](../docs/09-digital-assets-international-b3.md#63-reporting-crypto-to-the-receita-federal) |
| `internal/chain`, `internal/payments` (compliance) | Who sent each crypto deposit, read from the chain (Esplora, Ethereum and Polygon JSON-RPC with ERC-20 logs, a Tron node, or a provider's contract); senders screened before the deposit settles, held in `liability.compliance_hold` on a hit or an error, re-screened, and compliance cases released, blocked or closed with a note | [09 §6.5, §6.7](../docs/09-digital-assets-international-b3.md#65-screening-who-sends-each-deposit) |
| `internal/travelrule`, `internal/payments` (travelrule) | The travel rule: IVMS101.2023 with its constraints C1–C11 (LEI check digits, GLEIF codes, ISO countries), sent through a travel-rule network before a withdrawal to another provider (refused without an acceptance), the owner's declaration for self-hosted wallets, and signed inbound messages matched to deposits | [09 §6.6](../docs/09-digital-assets-international-b3.md#66-the-travel-rule) |
| `internal/console` | The web console at `/console/`: every API function in the browser, statements checked client-side; static, embedded, strict CSP | below |
| `internal/schemesim`, `internal/pixsim` | Simulators of the card host (network + issuer) and of a Pix PSP | below |

Binaries (`cmd/`): `platform` (serve, migrate, apikey, verify-ledger, release-due, settle, and the operator commands below), `schemesim`, `pixsim`, `devpki`, `tapsim` (terminal emulator), `smoke` (runs all of them together) and `conformance` (writes the merchant apps' test vectors, [`../mobile/conformance/vectors.json`](../mobile/conformance/vectors.json)).

## Quick start

```bash
cd payments/platform
go test -race ./...         # unit, integration and end-to-end tests; starts a throwaway PostgreSQL if one is installed
docker compose up --build   # sandbox stack on http://localhost:8080
```

With PostgreSQL installed and no Docker, `DATABASE_URL=postgres://… go run ./cmd/smoke` builds every binary, starts them as separate processes with a fresh dev PKI, and drives a tap, a decline, a Pix payment over the PSP's mTLS webhook, and a payout. It then checks the ledger. With `-serve FILE` it keeps the whole stack running after the checks and writes the API URL, a partner API key, a merchant and the sandbox's card key to `FILE`, for the mobile apps' integration tests ([`../mobile`](../mobile)).

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

**`pixsim`** implements the PSP side of API Pix (OAuth2, `PUT/GET /cob/{txid}`, `GET /pix` with paging, `GET /pix/{e2eid}`, `PUT/GET /pix/{e2eid}/devolucao/{id}`, `PUT/GET /webhook/{chave}`) with mutual TLS, the generic transfer contract of `internal/pixout`, and three control endpoints: `POST /sim/pagar/{txid}` (a payer pays; `?webhook=false` loses the notification), `POST /sim/devolucao/{e2eid}/{id}/liquidar` (a refund settles) and `POST /sim/med/{e2eid}` (the payer's PSP returns the Pix under the MED). They send the webhook to `{webhookUrl}/pix` over mutual TLS.

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
| `TRANSPARENCY_SECRET_HEX`, `TRANSPARENCY_PAD_TO` | Signs the daily public roots (enclave in production); log padding (default 4096 leaves). With the receipts key, turns on daily statements |
| `APPATTEST_ROOT_CA`, `APPATTEST_APP_ID`, `APPATTEST_ENVIRONMENT` | Apple App Attestation Root CA (PEM file), `TEAMID.bundle`, `production` or development |
| `ANDROID_ATTESTATION_STATUS` | Google's attestation certificate status list (default its URL; a file or a mirror also work), refreshed hourly; attestations are refused while it is missing or older than three days. `off` skips it, outside production only |
| `ANDROID_ATTESTATION_ROOTS`, `ANDROID_PACKAGE`, `ANDROID_SIGNING_DIGESTS` | Google's hardware attestation roots (PEM file), application ID, SHA-256 of the signing certificates (comma-separated). Either set of roots makes attestation strict |
| `REGISTRAR_URL`, `PLATFORM_DOCUMENT` | Receivables registrar adapter and the platform's CNPJ (the beneficiary of its assignments). The sandbox uses an in-memory registrar without them |
| `RISK_MODE` | The fraud shield: `enforce` (default), `shadow` (assess and record, act on nothing) or `off` (refused in production) |
| `BOOTSTRAP_TENANT`, `BOOTSTRAP_CAPITAL` | Create a tenant's accounts at start; opening capital in the sandbox only |
| `METRICS_ADDR` | Internal listener for `GET /metrics` (Prometheus). Keep it off the public network |
| `RATE_LIMIT_PER_SECOND`, `RATE_LIMIT_BURST`, `AUTH_FAILURES_PER_MINUTE` | Per-replica limits (defaults 50/s, 100, 30/min); the edge enforces the global ones |
| `TRUST_PROXY` | `true` behind the edge: the client address is the last `X-Forwarded-For` entry |
| `PUBLIC_API_URL` | The API's external base URL. App logins and DPoP proofs sign the exact URL; required (https) outside the sandbox |
| `MAX_PAYMENT_AMOUNT` | Ceiling per payment intent in centavos (default 100000000, R$ 1.000.000,00) |
| `EXCHANGES`, `BINANCE_*`, `KRAKEN_*`, `COINBASE_*`, `CRYPTO_AUTHORIZATION`, `CRYPTO_FEE_BPS`, `CRYPTO_SPREAD_BPS` | Crypto venues and pricing ([09 §7](../docs/09-digital-assets-international-b3.md#7-configuration)) |
| `FX_PROVIDER`, `WISE_*`, `FX_AUTHORIZATION`, `FX_FEE_BPS`, `FX_SPREAD_BPS`, `IOF_FX_OUT_BPS`, `IOF_FX_IN_BPS` | Accounts abroad, câmbio pricing and IOF |
| `BROKER_URL`, `BROKER_TOKEN`, `BROKER_NAME`, `BRAPI_TOKEN` | The B3 broker and display prices |
| `SANCTIONS_LISTS`, `SCREENING_URL`, `SCREENING_TOKEN` | Sanctions screening of withdrawal addresses ([09 §6.1](../docs/09-digital-assets-international-b3.md#61-crypto-the-central-banks-vasp-rules)); the sandbox refuses its own test addresses without them |
| `REPORTING_NAME`, `REPORTING_URL` | The platform's name and URL in the DeCripto, beside `PLATFORM_DOCUMENT` |
| `BITCOIN_ESPLORA_URL`, `ETHEREUM_RPC_URL`, `POLYGON_RPC_URL`, `TRON_API_URL`, `TRON_API_KEY`, `SENDER_LOOKUP_URL`, `SENDER_LOOKUP_TOKEN` | Where the senders of deposits are read ([09 §6.5](../docs/09-digital-assets-international-b3.md#65-screening-who-sends-each-deposit)); comma-separated URLs are independent sources asked together; the sandbox's exchange answers for its own deposits |
| `TRAVEL_RULE_URL`, `TRAVEL_RULE_TOKEN`, `TRAVEL_RULE_INBOUND_SECRET`, `TRAVEL_RULE_THRESHOLD_BRL`, `TRAVEL_RULE_REVIEW_BRL`, `TRAVEL_RULE_RETENTION_YEARS`, `PLATFORM_LEI` | The travel-rule network and its values ([09 §6.6](../docs/09-digital-assets-international-b3.md#66-the-travel-rule)); the sandbox uses an in-memory network |

| Guard | sandbox | certification | production |
|-------|:-------:|:-------------:|:----------:|
| Plain TCP to a card host | allowed | refused | refused |
| `template-unverified` dialects | allowed | refused | refused |
| Opening capital | allowed | refused | refused |
| Software KEK, development decryptor, in-process receipts and transparency keys | allowed | allowed (test cards only) | refused |
| No receivables registrar, no attestation roots | allowed (in-memory registrar, attestation recorded) | allowed | refused |
| In-memory exchange, FX provider and broker | allowed (the default) | allowed | refused |
| Crypto or câmbio without `CRYPTO_AUTHORIZATION` / `FX_AUTHORIZATION` | allowed | allowed | refused |
| Crypto without sanctions screening sources, or without the DeCripto's CNPJ and URL | allowed (sandbox test list) | allowed | refused |
| Crypto without a sender lookup for every network, or without a travel-rule network and its inbound secret | allowed (the sandbox exchange and travel-rule network) | allowed | refused |

## Implemented API surface

Implemented and covered by the end-to-end tests: the merchant app protocol (`POST /v1/merchants/{id}/enrollment-codes`, `GET/POST /v1/enrollment`, `POST /v1/merchants/{id}/devices` with the root-signed kind 17710, `POST /v1/auth/nostr` with NIP-98, and DPoP-bound sessions held to their merchant and terminal), `POST /v1/merchants`, `GET /v1/merchants/{id}`, `POST /v1/terminals`, `POST /v1/terminals/{id}/revoke`, `POST/GET /v1/payment-intents`, `…/confirm` (Pix), `…/capture`, `…/cancel`, `POST /v1/terminal/authorizations`, `POST/GET /v1/refunds`, `GET /v1/accounts/{id}/balance`, `GET /v1/accounts/{id}/entries`, `POST /v1/payouts/quotes`, `POST /v1/payouts`, `GET /v1/disputes`, `GET /v1/disputes/{id}`, `POST /v1/disputes/{id}/evidence`, `POST /v1/disputes/{id}/accept`, `POST /v1/webhook-endpoints`, `POST /v1/webhook-endpoints/{id}/replay`, the statements and proofs (`GET /v1/settlements`, `…/{id}`, `…/{id}/statement`, `…/{id}/proofs/{receipt_event_id}`, and the public `GET /v1/transparency/{date}`), the terminal journal (`POST/GET /v1/terminal/journal`, `GET /v1/payment-intents/{id}/journal`), crypto, accounts abroad and B3 (`/v1/crypto/*`, `/v1/holdings`, `/v1/conversions`, `/v1/international/*`, `/v1/investments/*`, [02 §11](../docs/02-api-reference.md#11-crypto-accounts-abroad-and-b3)), and the PSP webhook `POST {webhook}/pix`. The web console is served at `/console/`: sign in with an API key and every function above has a screen. `platform close-day -date` closes a business day by hand; `serve` does it every night after 01:00 in Brasília. The request examples in [02-api-reference.md](../docs/02-api-reference.md) are posted as written in `internal/e2e/spec_examples_test.go`.

Specified but not built yet. The API answers these explicitly rather than half-working:

| Spec feature | Today | Needs |
|--------------|-------|-------|
| Card-not-present (`confirm` with a card) | `501` | EMVCo-certified 3DS server, network tokens ([01 §4–§5](../docs/01-acquiring-engine.md#4-emv-3-d-secure-card-not-present)) |
| Split payments | `422 splits_not_supported` | Multi-recipient capture journals |
| `/oauth2/token` (mTLS-bound partner tokens) | API keys with scopes | Token service at the edge |
| Play Integrity verdicts | App Attest (with an assertion over every card authorization) and Android key attestation (checked against Google's revocation list) are verified; Play Integrity is not | Google's `decodeIntegrityToken` API with a service account |
| RFC 3161 and OpenTimestamps anchoring of the daily roots ([03 §6.6](../docs/03-nostr-layer.md#66-anchoring)) | Roots are signed, chained and published | An ICP-Brasil TSA contract |
| Pre-dispute alerts (Visa RDR, Ethoca), arbitration | Handled by operations at the sponsor | Alert feeds through the sponsor |
| `/v1/payment-methods`, `/v1/accounts` (sub-ledgers), `/v1/transfers` | Not routed (`404`) | See [08](../docs/08-roadmap-risks.md) |
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
- the full API flow, ending with L1–L6 and verified webhook signatures;
- crypto, accounts abroad and B3 end to end: a USDT payment settled in reais, unique amounts, conversions both ways, a withdrawal, a credit from abroad by reference, IOF, a payment abroad, suitability, lots and the fractional market, D+2 settlement; the exchange adapters' signatures and balances against fake venues;
- compliance for crypto: sanctions screening (a hit refused before anything moves, every attempt recorded, fail closed without a source or when one errors), the custody reconciliation (balanced after the flows, an unmatched deposit found at a quiet time, a coin that leaves without a journal), and the DeCripto (records from real operations, filing, no rewrite after filing, December's balances), whose encoder reproduces the manual's examples;
- deposit senders and the travel rule: a sanctioned sender's payment held, booked to the compliance hold, kept out of the custody difference and blocked; a lookup outage held, re-screened and released by the job; a frozen deposit nobody can match; withdrawals refused without a provider, on a rejection and without an answer, and accepted with IVMS101 that carries the merchant's CNPJ and the platform's LEI; inbound messages signed, idempotent, refused for invalid data or a foreign address, matched before and after the coins, a beneficiary that is not the merchant reviewed, a payer's declaration, and a missing originator's review closed when the data arrives; payloads and declarations sealed at rest, kept out of lists, read only with `travel_rule:read` and redacted after the retention period; names screened against the SDN list (a listed beneficiary refused, a listed payer or originator held, a late name reviewed);
- keys and secrets: an expired API key refused, webhook secrets rotated with an overlap in which both signatures verify, and at once;
- operations: merchant lifecycle and revocations with their audit rows, a chargeback larger than the balance (booked as owed, recovered after the win), merchant acceptance and deadline expiry, a settlement report with true-ups, suspense, duplicate and replay protection, a lost Pix webhook healed by reconciliation, a MED return applied once, the jobs lease and the metrics.

- security: tenant isolation on every route, scopes, input hardening, headers, rate limits, webhook SSRF and redirects, sealed webhook secrets, card data in no log or clear column, and STAN reuse ([security assessment](../integration/security-assessment.md)).

CI (`.github/workflows/payments-platform.yml`) adds staticcheck, gosec, short fuzzing, the multi-process smoke test (which also runs the operator commands and scrapes `/metrics`), govulncheck, and the Docker image build.

## Operations

Operators run the platform with subcommands of the same binary, in the same environment as `serve`. Commands that change access or money take `-actor` (the operator's SSO identity) and `-reason`, recorded in `ops_audit`. [The runbook](../integration/operations-runbook.md) has the daily schedule, the import formats, the alerts and the procedures.

| Command | Does |
|---------|------|
| `merchant-status` | KYB approval or rejection, restriction, reactivation, closure |
| `terminal-revoke`, `apikey-list`, `apikey-revoke` | Lost devices and leaked keys |
| `disputes-import`, `disputes-list`, `write-off` | Chargeback notices from the sponsor; what a closed merchant could not repay |
| `recon-card`, `recon-pix`, `recon-exceptions`, `recon-allocate`, `recon-resolve` | Settlement-report and daily Pix reconciliation, and the exception queue |
| `recon-custody` | Each exchange's balances against the ledger's custody, now (the job runs it every night) |
| `decripto`, `decripto-filed` | Write a month's DeCripto for filing; record the Coleta Nacional's receipt |
| `compliance-cases`, `compliance-decide` | List held deposits and travel-rule reviews; release, block or close one with a note ([runbook §4.12](../integration/operations-runbook.md#412-a-held-crypto-deposit)) |

`serve` runs the periodic jobs every minute on one replica at a time (scheduled releases, payout outcomes, dispute deadlines, shortfall recovery, the previous day's Pix reconciliation after 06:00 Brasília time, crypto deposits and expiries, credits from abroad, B3 settlement, the custody reconciliation after 02:00, and last month's DeCripto on the first days of the month).
