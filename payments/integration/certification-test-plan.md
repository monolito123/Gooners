# Certification test plan

These are the scenarios card hosts and PSPs ask an acquirer or receiving user to demonstrate. Each one already runs locally: as an automated test (run it with `go test -run <Name> ./<package>` in `payments/platform`) and, for card scenarios, by hand with `tapsim` against `schemesim`, where the cents of the amount select the outcome. On the counterparty's test environment, run the same scenario with their test cards or test payers and keep the evidence listed.

## Card host (sponsor, Visa, Mastercard)

| # | Scenario | Expected behaviour | Automated test | By hand (`tapsim -amount`) | Evidence |
|---|----------|--------------------|----------------|----------------------------|----------|
| C1 | Sign-on at connect | 0800 / DE 70 = 001 before any financial message; refuse traffic until 0810 = 00 | `internal/scheme` `TestSignOnAndApprove` | start the platform; log `signed on` | 0800/0810 trace |
| C2 | Echo when idle; answer host echo | 0800 / 301 after the idle interval; reply 0810 to host-initiated 0800 | `TestEchoWhenIdleAndHostEcho` | leave idle | trace |
| C3 | Link drop and recovery | Reconnect with backoff, sign on again, no lost or duplicated requests | `TestReconnectAfterDrop` | restart the host | log timeline |
| C4 | Approved purchase, contactless chip | 0100 with DE 2, 3, 4, 7, 11, 12, 13, 14, 18, 19, 22=071, 25, 32, 37, 41, 42, 43, 49, 55; 0110 / 00 | `internal/authswitch` `TestApprovedAuthorization`; `internal/e2e` `TestEndToEnd` | `12990` | masked dump of 0100/0110 |
| C5 | Declines by response code | Each code classified (Visa category, retry policy); customer message generic | `TestDeclinesAreClassified` | `4551`, `4505`, `4554`, `4591`, `4565` | 0110 + API response |
| C6 | Merchant advice code | DE 48 SE 84 overrides retry policy | `TestMerchantAdvice` | `4565` | API `decline_code`, retry policy |
| C7 | Response timeout → reversal | No 0110 within T_resp: decline to terminal, 0400 with DE 90 (original MTI, STAN, DE 7, acquirer ID) | `TestTimeoutQueuesReversalAndSAFDeliversIt` | `1098` | 0400 trace, DE 90 |
| C8 | Late response after timeout | Ignored for the terminal; the reversal is still sent | `internal/scheme` `TestTimeoutAndLateResponse` | `1099` | log `late or unmatched response` |
| C9 | Store-and-forward | Undelivered reversals retried with the same STAN and DE 7; 0420 after the maximum age | `TestTimeoutQueuesReversalAndSAFDeliversIt`, `TestPgStoreScenarios` | stop the host during a `1098` tap, then restart | queue rows, final 0410 |
| C10 | Void before clearing | Full reversal 0400 and ledger reversal | `TestPartialAndFullReversal`, `TestEndToEnd` (cancel) | `POST /v1/payment-intents/{id}/cancel` | 0400/0410, journal |
| C11 | Partial reversal | 0400 with DE 95 = remaining amount | `TestPartialAndFullReversal` | n/a (API) | DE 95 |
| C12 | Refund authorization | 0100 with DE 3 = 200000 and the PAN from the vault | `TestEndToEnd` (card refund) | `POST /v1/refunds` | 0100/0110 |
| C13 | Duplicate request from the terminal | Same terminal STAN → original result, nothing sent twice | `TestIdempotentReplay` | resend the same body | single 0100 at the host |
| C14 | Concurrency | Correct correlation of interleaved responses | `internal/scheme` `TestConcurrentExchanges` | load test | n/a |
| C15 | Route unavailable | Cascade only when nothing was written to the network | `TestCascadeWhenFirstRouteDown`, `TestNotSignedOnIsNotSent` | stop route 1 | routing log |
| C16 | Message encoding | Every sample message of the specification unpacks and repacks byte for byte | `internal/iso8583` (`TestGenericKnownBytes`, `TestRoundTripAllDialects`, `TestBCDOddLengthsAndTrack2`, `TestEBCDICText`, `FuzzUnpack`) | n/a | round-trip report |
| C17 | No card data in logs | PAN, track 2, PIN block and EMV data masked in every dump | `TestDumpMasksCardData` | grep the logs | log sample |
| C18 | EMV data | Only allowed tags forwarded in DE 55; the PAN tag never | `internal/emv` `TestFilterForDE55` | n/a | DE 55 dump |
| C19 | Settlement report | Sales, refunds, chargebacks and reversals matched; interchange and scheme fees trued up; unmatched cash in suspense; a report posts once; a sale settles once | `internal/e2e` `TestOperations` (settlement report) | `platform recon-card` | recon run, journal |
| C20 | Chargeback lifecycle | Merchant debited at intake (shortfall booked as owed and recovered); refunds refused while open; evidence and representment; won credits back; deadline accepts | `TestOperations` (disputes) | `platform disputes-import` | dispute record, journals, webhooks |

## Pix (PSP homologation)

| # | Scenario | Expected behaviour | Automated test | Evidence |
|---|----------|--------------------|----------------|----------|
| P1 | OAuth over mutual TLS | Token obtained with the client certificate; cached; refreshed on 401 | `pkg/apipix` `TestTokenCacheRetryAndRefresh` | token request log |
| P2 | Webhook registration | `PUT /webhook/{chave}` with an https URL | `internal/pixsim` `TestChargePayWebhookRefund` | 200 response |
| P3 | Immediate charge | `PUT /cob/{txid}`: 26–35 alphanumeric txid, `valor.original` as `123.45`; `pixCopiaECola` decodes to the location | `TestChargePayWebhookRefund`, `pkg/brcode` `TestBCBExamplesDecode` | cob JSON, BR Code |
| P4 | Payment notification | POST `{webhookUrl}/pix` over mutual TLS; the platform re-reads `GET /pix/{e2eid}` before crediting; idempotent | `TestChargePayWebhookRefund`, `TestEndToEnd` | webhook log, ledger journal |
| P5 | Webhook without a valid client certificate | Refused | `TestWebhookRequiresMutualTLS` | 401 |
| P6 | Devolução | `PUT /pix/{e2eid}/devolucao/{id}` idempotent on `id`; over-refund refused; settles on the DEVOLVIDO webhook | `TestChargePayWebhookRefund`, `TestEndToEnd` | devolução JSON, journals |
| P7 | Error responses | Problem details with `violacoes` surfaced to the caller | `TestProblemDetails` | error log |
| P8 | Payout | Idempotent transfer; failed destination returns the money to the wallet | `TestTransfers`, `TestEndToEnd` | payout record, journals |
| P9 | Daily reconciliation | `GET /pix` for the day, paged; a Pix whose webhook was lost is credited once | `TestOperations` (Pix) | recon run |
| P10 | MED return | A devolução with `natureza` `MED_FRAUDE` debits the merchant once and marks the payment refunded | `TestOperations` (MED) | journal, webhook |

## Platform-wide

| # | Scenario | Automated test |
|---|----------|----------------|
| G1 | Ledger invariants L1–L5 after every flow | `internal/ledger` `TestSpecCatalogue`; `TestEndToEnd`; `platform verify-ledger` |
| G2 | Concurrent payouts cannot overdraw | `TestConcurrentDebitsNeverOverdraw` |
| G3 | API idempotency keys (replay, in flight, reuse) | `TestEndToEnd` (idempotency) |
| G4 | Webhook signatures (Standard Webhooks) | `internal/webhooks` `TestSpecVector`; `TestEndToEnd` |
| G5 | Environment guards (no plain TCP or template dialects outside the sandbox; no software keys in production) | `internal/config` tests |
| G6 | The real binaries together over sockets and mutual TLS | `go run ./cmd/smoke` (CI) |
| G7 | Merchant status enforced (no payments or payouts unless active); revoked terminals and API keys refused; every change audited | `TestOperations` (lifecycle, revocation) |
| G8 | Periodic jobs run on one replica at a time | `TestOperations` (jobs lease) |
| G9 | Operator commands and `/metrics` against the real binaries | `go run ./cmd/smoke` (chargeback import, card and Pix reconciliation, scrape) |
