# Security assessment of the platform

An internal assessment of the Go platform ([`../platform`](../platform)), made with its source code at hand (white box). It does not replace the independent penetration test and the ASV scans PCI DSS requires (requirement 11), and it does not cover the cloud infrastructure, which is not in this repository. Each finding below has a fix in the code and a test that fails without the fix.

## 1. Method

| Technique | Tool or test | Scope |
|-----------|--------------|-------|
| Manual code review | Every handler, the switch, the ledger journals, the vault, webhooks, Pix and the operator commands | Authentication, authorization and tenancy, input handling, money movement, outbound calls, secrets, logging |
| Static analysis | gosec v2.29.0, staticcheck v0.8.2, `go vet` | Production code. Simulators and test tools are excluded from gosec |
| Dependency vulnerabilities | govulncheck v1.8.0 | Reachable call paths only |
| Dynamic tests | `internal/e2e/security_test.go`, against the real API, PostgreSQL and the simulators | Tenancy, scopes, input, headers, rate limits, SSRF, secrets at rest, card data in logs and columns, STAN reuse |
| Fuzzing | `FuzzUnpack` (ISO 8583), `FuzzParse` (EMV TLV), `FuzzDecode` (BR Code), `FuzzVerify` (Nostr), `FuzzParseSettlementCSV`, `FuzzParseDisputeCSV`, `FuzzCBOR` (App Attest objects) | 40 s each during the assessment; short runs in CI |
| Concurrency | `go test -race` over the whole suite; the ledger's concurrent-payout test | Data races, double spending |

## 2. Findings

| ID | Severity | Finding | Fix | Test |
|----|----------|---------|-----|------|
| F-01 | **Critical** | Reusing a terminal STAN for a *different* payment returned the stored result of the first one. A terminal that sent a R$ 999,99 Mastercard sale with the STAN of an approved R$ 10,00 Visa sale got "approved" without any message reaching an issuer, and the merchant was credited R$ 956,28 at once (instant settlement). A compromised terminal could do this on purpose | The switch answers from the stored result only when the request is the same (payment, kind, amount, card, processing code, merchant); anything else is `409` and nothing is sent. The payment is released so the terminal can retry with a new STAN | `TestSTANReuseIsNotAnApproval`, `TestSTANReuseWithAnotherRequestIsRefused` |
| F-02 | High | Card refunds took "highest STAN on the terminal today + 1", which the terminal then used for its next sale. That sale was either refused or, before F-01 was fixed, answered with the refund's approval | Platform-initiated messages take their idempotency key from a namespace terminals cannot use (`R` and five base-32 characters derived from the refund ID). Terminal STANs must be six digits | `TestSTANReuseIsNotAnApproval` (sale after a refund) |
| F-03 | High | Server-side request forgery: a partner could register a webhook URL pointing at internal services (`http://169.254.169.254/…`, the metrics port, the database host) and the dispatcher would POST to it, following redirects | `internal/netguard`: URLs are validated at registration (https, no credentials, no private or loopback literal, names resolving only to public addresses), and the dialer refuses non-public addresses after resolution, which also stops DNS rebinding. Redirects are not followed; environment proxies are ignored. The sandbox may still use private receivers | `TestWebhookSSRFAndSecrets`, `internal/netguard` tests |
| F-16 | High | Under contention, valid debits were refused as "insufficient funds". The ledger's balance check reads with `SELECT … FOR UPDATE`; when that read failed to serialize, the error surfaced only through `rows.Err()`, which was not checked, so the account looked empty. In CI 3 of 10 valid payouts were refused; at 200 concurrent debits about 40% were. Found by CI, after this assessment's first pass | The error is checked and retried like any serialization failure; retries are bounded by time (5 s, capped jittered backoff) rather than by count. Every other row loop now checks `rows.Err()` too | `TestContendedDebitsAreRetriedNotRefused`, `TestConcurrentDebitsNeverOverdraw` |
| F-04 | Medium | The listeners had a header timeout only: slow clients could hold connections open (slowloris) | Read, write and idle timeouts and a 32 KiB header limit on every listener | Review |
| F-05 | Medium | No rate limit: one credential could take all of a replica's capacity, and failed authentications were unlimited | Token bucket per credential (default 50/s, burst 100) and a throttle on *failed* authentications per client address (default 30/min). Only failures count, so a merchant behind the same carrier-grade NAT as an attacker is never locked out | `TestRateLimits` |
| F-06 | Medium | Webhook signing secrets were stored in the clear: anyone reading the database could forge webhooks to partners | Sealed under the vault's KEK with a per-record data key, bound to the endpoint ID. Secrets created before this change stay readable; reissue them | `TestWebhookSSRFAndSecrets` |
| F-07 | Medium | Bodies over 1 MiB were silently truncated (and then failed as malformed JSON); data after the first JSON object was ignored | `413` above 1 MiB; one JSON object per request | `TestInputHardening` |
| F-08 | Low | A NUL byte or invalid UTF-8 in an ID, a filter or a JSON string reached PostgreSQL, which refused it: `500` and error logs on demand | Refused with `400` at the API boundary | `TestInputHardening` |
| F-09 | Low | A payment whose authorization was refused as "STAN in flight" stayed in `processing` for good | Released back to `requires_payment_method` | `TestSTANReuseIsNotAnApproval` |
| F-10 | Low | Each tap of the same card stored another encrypted copy of its PAN | One vault record per card and tenant, found by its HMAC fingerprint | `TestCardDataNeverLeaks` |
| F-11 | Low | `/readyz` (unauthenticated) returned the database error text | Generic message; the cause goes to the logs | `TestInputHardening` |
| F-12 | Low | No security headers | `nosniff`, `no-store`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, HSTS over TLS | `TestInputHardening` |
| F-13 | Low | No upper bound on payment amounts | R$ 1.000.000,00 per payment intent by default (`MAX_PAYMENT_AMOUNT`), never above what the rails carry (R$ 9.999.999.999,99) | `TestInputHardening` |
| F-14 | Low | Near midnight UTC, the daily Pix reconciliation took the calendar day in UTC and reconciled the wrong Brasília day (found when the test ran at 21:05 in Brasília) | A business day is always the Brasília date, in the service and the commands | `TestBusinessDayIsTheBrasiliaDate`, `TestOperations` |
| F-17 | Low | Payout destinations took any `key_type` and any key, so a typo became a refused transfer at the PSP (and a fee) instead of a `422`; merchant documents were checked only for length | Pix keys are checked and normalized as DICT stores them: CPF and CNPJ with check digits, e-mail, E.164 phone, EVP UUID; `key_type` is case-insensitive and stored lowercase. Merchant CPF/CNPJ must have valid check digits | `TestNormalizePixKey`, `TestInputHardening` |
| F-15 | Info | The routing round-robin counter was converted to `int` before the modulo, which would go negative on a 32-bit build | Reduced first | gosec |

The other gosec results were reviewed and are false positives (conversions bounded by spec validation, retry jitter that is not a secret, file paths given by the operator). Each is annotated in the code with `#nosec` and the reason, and `make sec` now runs in CI with zero findings. govulncheck finds no vulnerability on a reachable path.

## 3. Controls verified, no finding

- **Tenant isolation.** A second tenant's key gets `404` on every route that names another tenant's merchant, payment, refund, account, quote, terminal or dispute, and moves no money. Idempotency keys are per tenant (`TestTenantIsolation`).
- **Authentication and scopes.** Malformed, wrong-scheme and revoked credentials get `401`, missing scopes `403`. In production a terminal authorization needs the terminal certificate (`TestAuthenticationAndScopes`).
- **SQL injection.** Every query is parameterized; the only concatenated SQL joins constants. Injection strings in paths and filters find nothing and change nothing (`TestInputHardening`).
- **Card data.** During a sale, a refund and a timed-out sale with its reversal, the PAN and track data appear in no log line (message dumps captured at debug level are masked) and in no text, JSON or binary column (`TestCardDataNeverLeaks`). Vault ciphertexts are bound to their token.
- **Money movement.** Ledger journals are idempotent and serializable, the no-negative rule holds under 40 concurrent payouts, and invariants L1–L5 hold after every end-to-end test.
- **Webhooks and Pix.** Webhook signatures compare in constant time. The Pix webhook requires the PSP's client certificate, and every Pix is re-read from the PSP before any credit.
- **Configuration.** Production refuses software keys, plain TCP to card hosts, unverified ISO 8583 dialects and opening capital. The image is distroless and runs as a non-root user.

## 4. Residual risks and next steps

| Item | Why it matters | Next step |
|------|----------------|-----------|
| Independent penetration test, ASV scans | Required by PCI DSS 11.3 and 11.4, and an internal review is not independent | Before the production pilot |
| Rate limits are per replica | N replicas allow N times the limit | Global limits at the edge (API gateway or WAF) |
| API keys do not expire, and webhook secrets cannot be rotated through the API | A leaked secret stays valid until someone notices | Expiry and rotation endpoints |
| The audit trail lives in the platform database | A database administrator could alter it | Export it to write-once storage (WORM) |
| Operator commands need database credentials | Access to them is access to money | Run them only through a bastion with SSO and session recording |
| Secrets come from environment variables | They show up in process listings and crash dumps | A secrets manager, and the HSM adapters ([hsm.md](hsm.md)) |
| Play Integrity, App Attest assertions | Attestation is verified once (enrollment or first login); a phone that is compromised later keeps its session until the next check | Play Integrity at session start (Google's decode API) and App Attest assertions over each authorization ([05 §2.4](../docs/05-mobile.md#24-attestation-and-device-integrity)) |
| App Attest client data is the device key, not a server challenge | A captured attestation could be replayed with a stolen device key on another iPhone (Android is not affected: its sessions are pinned to the attested DPoP key) | A one-time server challenge in the client data |
| Attestation revocation | Google's attestation revocation list is not consulted | Fetch and check it at verification |
| Pins in release builds | Pinning is on only when the build carries the API host's SPKI hashes | Set `goonerspay.pins` / `GOONERSPAY_PINS` in the release pipeline, with a backup key |
| Transparency anchoring | Roots are signed and chained but not yet timestamped by a third party | RFC 3161 (ICP-Brasil TSA) and OpenTimestamps ([03 §6.6](../docs/03-nostr-layer.md#66-anchoring)) |

## 5. Merchant app protocol

Tested by `internal/e2e/mobile_test.go` against the real API and PostgreSQL, and by both app cores against a live sandbox ([mobile/README.md](../mobile/README.md)):

- **Enrollment codes** are single use, expire in 15 minutes, are stored hashed, and are given back only when the request was wrong. Two phones racing with one code cannot both enroll.
- **NIP-98 logins** must sign this exact URL, method and body hash within 60 s, and each event is accepted once across replicas (`auth_nonces`). A device the root key dropped from its list cannot log in.
- **DPoP.** A session is bound to the RFC 7638 thumbprint of the key it logged in with. A proof signed by another key, for another method or URL, without the token's hash, outside 60 s, or replayed is refused, so a stolen session token alone is useless.
- **Scope.** Sessions reach only the merchant-app routes, only their merchant's account, payments and devices, and only their own terminal ID.
- **Device lists** (kind 17710) must be signed by the merchant's root key, name the merchant, be newer than the last accepted list, and be dated no more than 10 minutes ahead. A list signed by a device key, or an older list replayed, is refused. Dropping a device ends its sessions and revokes its terminal in the same transaction.
- **Device attestation** (`internal/e2e/attestation_test.go`, `internal/attest`). With roots configured, App Attest and Android key attestation are verified offline: the chain, the nonce or challenge bound to the device's Nostr key, secure hardware, a locked bootloader with verified boot, and the app's identity and signing certificate. Rooted phones, cloned and re-signed apps, and evidence made for another device are refused. A phone the owner adds attests at its first login, and an Android device's sessions are pinned to its attested DPoP key, so a stolen device key opens nothing on another phone.
- **Terminal journal** (`internal/e2e/journal_test.go`). Entries must be signed by the session's own device key and name the merchant; a second entry at a stored `seq`, or a broken `prev` chain, is kept as signed proof of a fork and freezes the terminal. Tampered, foreign and future entries are refused.
- **Certificate pinning.** Both apps refuse a trusted chain that holds none of the pinned keys before any request leaves the phone (`PinningTest`, with a real TLS server); the iOS SPKI computation is held to Go's by conformance vectors.
- **Statements and the transparency log** (`internal/e2e/statements_test.go`). Every receipt proves its way to the day's public root from the API's answers alone; roots chain in order and a day cannot be closed behind a later one.
- **Receivables** (`internal/e2e/registrar_test.go`). Nothing is advanced, at capture or in a payout, without first registering the platform's assignment on the receivable unit, so the same receivable cannot be financed twice; another institution's lien, a lien between quote and payout, and a registrar outage all stop the advance, never the sale.
- **On the phones**, the DPoP key never leaves the Keystore or the Secure Enclave, and the Nostr keys are unwrapped only for a signature, behind biometrics. §4 lists what remains.

## 6. How to repeat it

```bash
cd payments/platform
make lint sec vuln                 # gofmt, vet, staticcheck, gosec, govulncheck
go test -race -count=1 ./...       # includes internal/e2e/security_test.go
go test -run '^$' -fuzz FuzzUnpack -fuzztime 60s ./pkg/iso8583/   # and the other fuzz targets in §1
```
