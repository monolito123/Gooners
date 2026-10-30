# Operations runbook

This is how goonersPAY is run day to day once merchants are live: what runs by itself, which files operations imports, what to alert on, and what to do when something goes wrong. Commands run in the platform's container, with the same environment as `platform serve`:

```bash
docker compose exec platform platform recon-exceptions -tenant 00000000-0000-4000-8000-000000000001
```

Every command that changes access or money needs `-actor` (the operator's SSO identity) and `-reason`. Both go to the `ops_audit` table, together with the partner API calls that change access (for example a terminal revoked through the API is recorded as `api:ak_…`).

## 1. Daily schedule (Brasília time)

| When | What | How |
|------|------|-----|
| Every minute | Scheduled receivable releases, unknown payout outcomes, dispute deadlines and 48-hour warnings, recovery of what merchants owe | `platform serve`. One replica runs them at a time (lease in `job_leases`) |
| 06:00 | Pix reconciliation of the previous day against `GET /pix` | Automatic. Re-run with `platform recon-pix -tenant … -date YYYY-MM-DD` |
| When the sponsor's settlement report arrives | Card settlement reconciliation | `platform recon-card -tenant … -report <report id> -date … -file report.csv` |
| When the sponsor's chargeback file arrives | Chargeback intake and outcomes | `platform disputes-import -tenant … -file chargebacks.csv` |
| 09:00 | Work the exception queue (§5) | `platform recon-exceptions -tenant …` |
| 10:00 | File the day's representments with the sponsor (§4.6) | `platform disputes-list -tenant … -status represented` |
| Daily | Safeguarding: reserve vs the CCME statement and Selic custody ([04 §3.6](../docs/04-serverless-backend.md#36-safeguarding-reconciliation)) | Treasury |
| Daily, and after any manual posting | Ledger invariants L1–L5 | `platform verify-ledger` (exit 1 on a violation) |

## 2. Import formats

Sponsors deliver settlement and chargeback data in their own formats (fixed-width files, EDI, a portal export or an API). Each sponsor gets a small converter to the two CSV formats below, which are the platform's contract. Amounts are integer centavos. Files are UTF-8 with a header line.

### 2.1 Settlement report

```csv
record_type,brand,rrn,auth_code,amount,interchange,scheme_fees,net,case_id
sale,visa,000000000123,A1B2C3,12990,210,16,12764,
refund,visa,000000000456,,990,,,-990,
chargeback,visa,000000000123,,12990,,,-12990,VCR-2026-11-0458812
chargeback_reversal,visa,000000000123,,12990,,,12990,VCR-2026-11-0458812
```

| Column | Meaning |
|--------|---------|
| `record_type` | `sale`, `refund`, `chargeback` or `chargeback_reversal` |
| `brand` | `visa`, `mastercard`, `elo` |
| `rrn`, `auth_code` | DE 37 and DE 38 of the original authorization, used to match |
| `amount` | Gross amount of the transaction |
| `interchange`, `scheme_fees` | Actual costs (sales). The differences with the estimates booked at capture are posted as true-ups |
| `net` | Signed effect on the cash settled: positive for sales and reversals, negative for refunds and chargebacks. For a sale, `net = amount − interchange − scheme_fees` |
| `case_id` | Network case ID of a chargeback or its reversal |

The report ID passed to `recon-card` must be unique per report: it is the idempotency key of the settlement journal, so the same report is never posted twice. One journal per report posts the cash received, clears the scheme receivables and payables it settles, and posts the interchange and scheme-fee true-ups. Anything that does not match waits in `liability.recon_suspense` with an exception (§5).

### 2.2 Chargeback notices

```csv
event,scheme,network_case_id,reason_code,category,amount,rrn,auth_code,evidence_due_at
opened,visa,VCR-2026-11-0458812,10.4,fraud,12990,000000000123,A1B2C3,2026-11-18T23:59:59Z
pre_arbitration,visa,VCR-2026-11-0458812,,,,,,
won,visa,VCR-2026-11-0458812,,,,,,
lost,mastercard,MC-2026-0002211,,,,,,
```

`category` is `fraud`, `authorization`, `processing_error` or `consumer_dispute`. `evidence_due_at` is the merchant's deadline (RFC 3339), set a few days before the sponsor's so operations has time to file. Each notice applies once: importing the same file again only applies the lines that failed the first time.

## 3. Alerts

The platform serves Prometheus metrics on `METRICS_ADDR` (internal network only).

| Metric | Alert when | First response |
|--------|------------|----------------|
| `goonerspay_safeguarding_headroom_centavos` | Below 3% of client liabilities; **page** at zero | Treasury tops up the reserve (`safeguard_topup`). At zero L5 is violated: an e-money incident for the BCB |
| `goonerspay_reversal_queue_depth` | Above 0 for 10 minutes | Card host unreachable or refusing reversals. Check route health in the logs and call the sponsor's NOC. Reversals keep retrying by themselves |
| `goonerspay_card_authorizations_total{outcome="timeout"}` | More than 1% of authorizations over 5 minutes | Same as above. The router moves traffic to a healthy route if there is one |
| `goonerspay_http_requests_total` with `code` 5xx | More than 1% of requests over 5 minutes | Incident. Check the database (`/readyz`) and the logs by `request_id` |
| `goonerspay_payouts_processing` | Above 0 for 30 minutes | The bank's transfer API is down or slow. Outcomes are re-read every minute; open a ticket with the bank |
| `goonerspay_webhook_backlog`, `goonerspay_webhook_abandoned` | Backlog growing for 15 minutes; any new abandoned delivery | A partner's endpoint is failing. Tell the partner; deliveries retry for 72 hours |
| `goonerspay_recon_exceptions_open` | Any, at 09:00 | Work the queue (§5) |
| `goonerspay_recon_suspense_centavos` | Not zero at the end of the day | Allocate it (§5) |
| `goonerspay_merchant_shortfall_centavos` | Growing day over day | Risk review of the merchants that owe money (§4.6, §4.7) |
| `goonerspay_disputes_open{status="represented"}` | Any representment older than one business day | File it with the sponsor (§4.6) |
| `goonerspay_pix_med_returns_total` | Any | Risk review of the merchant (§4.7) |
| `goonerspay_risk_reviews_open`, `goonerspay_terminals_frozen` | A review older than one business day; any frozen terminal | Work the review (§4.9): the merchant's money or till waits on it |
| `goonerspay_risk_assessments_total` by `action` | Declines or holds above their weekly baseline | A new attack, or a rule misfiring on honest sales: read `goonerspay_risk_signals_total` by `signal`, and move a misfiring rule to shadow (`RISK_MODE=shadow`) while it is fixed |

## 4. Procedures

### 4.1 KYB approval

In production a merchant is created as `kyb_in_review` and cannot take payments. When the KYB case closes:

```bash
platform merchant-status -tenant T -merchant mer_… -status active -reason "KYB case 2026-0042 approved" -actor ana@goonerspay.example
platform merchant-status -tenant T -merchant mer_… -status closed -reason "KYB case 2026-0043 rejected: UBO not verified" -actor ana@goonerspay.example
```

The partner receives `merchant.kyb.approved` or `merchant.kyb.rejected`.

### 4.2 Restricting and reactivating a merchant

| Status | New payments | Payouts | Refunds, disputes, MED | Terminals |
|--------|:------------:|:-------:|:----------------------:|:---------:|
| `kyb_in_review` | no | no | n/a | can be registered |
| `active` | yes | yes | yes | yes |
| `restricted` | no | no (the balance is held) | yes | kept, but authorizations are refused |
| `closed` | no | no | disputes and MED still debit (as owed) | revoked |

Restrict on risk signals (VAMP ratio, MED returns, a fraud report), then lift it once the review clears. Both send `merchant.status_changed`.

### 4.3 Closing a merchant

Closing needs a zero wallet, reserve and payable: pay the balance out and wait for the last receivables to settle first. Chargebacks can still arrive for months after closing. They are booked as owed by the merchant (`asset.merchant_recoverable.*`). When collection fails, write the amount off as a loss:

```bash
platform write-off -tenant T -merchant mer_… -reason "closed 2026-08; collection exhausted, case 77" -actor ana@goonerspay.example
```

### 4.4 Lost or stolen device

The partner revokes it through the API (`POST /v1/terminals/{id}/revoke` with a `reason`), or operations does:

```bash
platform terminal-revoke -tenant T -terminal T7Q2M9KX -reason "reported stolen, ticket 512" -actor ana@goonerspay.example
```

The terminal's certificate stops authenticating and its ID takes no authorizations. Register a new terminal for the replacement device.

### 4.5 Leaked API key

```bash
platform apikey-list -tenant T                                   # find the key's ak_ ID by name
platform apikey-revoke -tenant T -id ak_3f9a… -reason "key in a public log" -actor ana@goonerspay.example
platform apikey -tenant T -name integration -scopes payments:read,payments:write -live
```

Revocation takes effect on the next request.

### 4.6 Chargebacks

1. **Intake.** `disputes-import` opens the dispute and posts the `chargeback` journal at once: the scheme takes the money from the acquirer, so the platform takes it from the merchant's balance. Whatever the balance cannot cover is booked as owed and recovered automatically from the merchant's next credits. The partner receives `dispute.opened`. Refunds on the payment are refused while the dispute is open, because the cardholder already has the money back.
2. **Merchant response.** The partner answers through the API (`POST /v1/disputes/{id}/evidence` with `submit: true`, or `/accept`). `GET /v1/disputes/{id}` shows the evidence the platform already holds (EMV card-present data, the Nostr receipt, refunds) and a recommendation. A warning webhook goes out 48 hours before the deadline. At the deadline an unanswered dispute is accepted.
3. **Filing.** Every morning, file the `represented` disputes with the sponsor (its portal or API, which reaches Visa Resolve Online or Mastercom), attaching the stored evidence.
4. **Outcome.** The sponsor's file reports `won`, `lost` or `pre_arbitration`. A win credits the merchant (`chargeback_won`) and books the amount as owed back by the scheme, which the `chargeback_reversal` line of a later settlement report clears. A loss needs no posting: the money was already taken.

### 4.7 Pix returned under the MED

When the payer's PSP returns a Pix under the Mecanismo Especial de Devolução (fraud claim `MED_FRAUDE`, operational failure `MED_OPERACIONAL`), the devolução appears on the original Pix and reaches the platform through the webhook or the daily reconciliation. The platform debits the merchant (whatever the balance cannot cover is booked as owed), marks the payment refunded and sends `payment_intent.med_returned`. Operations then reviews the merchant: repeated MED fraud returns are a reason to restrict it (§4.2). The precautionary block (*bloqueio cautelar*) that precedes a MED return happens at the PSP and is not visible through API Pix.

### 4.8 Pix webhooks not arriving

Payments keep working at the PSP and show as `requires_action` on the platform. Check the listener's certificate and the URL registered with `PUT /webhook/{chave}` (it is re-registered at every start). In the meantime run the reconciliation for today as often as needed: it re-reads every Pix from the PSP and credits the missed ones.

```bash
platform recon-pix -tenant T -date $(TZ=America/Sao_Paulo date +%F)
```

### 4.9 Fraud shield reviews

The fraud shield ([07 §3](../docs/07-enhancements.md#3-autonomous-fraud-shield)) holds the money of a sale it doubts, or freezes a terminal it believes compromised, and opens a review. List them with `GET /v1/risk/reviews` (key with `risk:read`). Each shows the action, both scores and the signal codes; the payment, its journal entries (`GET /v1/payment-intents/{id}/journal`) and the merchant's history give the rest. Call the merchant when in doubt: a till that sold to the same card five times may be a regular customer.

- Genuine: `POST /v1/risk/reviews/{id}/resolve` with `{"resolution": "release", "note": "…"}`. The held money settles on its schedule; a terminal frozen by the review sells again.
- Fraud: `{"resolution": "fraud", "note": "…"}`. The money stays held to cover the chargeback; a terminal frozen by the review is revoked (the merchant re-enrolls the phone after a check, §4.4). Refund the cardholder when the issuer asks, and consider restricting the merchant (§4.2).

Both are audited. A step-up (the card asked for its PIN) and a plain decline need no review: no money moved.

## 5. Reconciliation exceptions

`platform recon-exceptions` lists the open ones. Close each with what was done:

```bash
platform recon-allocate -tenant T -amount 4912 -to liability.merchant_wallet.mer_… -reason "line 5: sale on a terminal registered late" -actor ana@goonerspay.example
platform recon-resolve -tenant T -id 17 -resolution "allocated to the merchant, ticket 881" -actor ana@goonerspay.example
```

`recon-allocate` moves cash out of suspense to the settlement bank (returned to the sponsor), a scheme receivable or payable, interchange, scheme fees, fraud loss or a merchant's wallet. A positive amount clears cash received, a negative one clears cash taken.

| Kind | Meaning | Usual resolution |
|------|---------|------------------|
| `unmatched_sale` | The network settled a sale the platform has no approval for | Ask the sponsor. Another acquirer's sale: return it, then allocate to `asset.settlement_bank`. An approval lost by the platform (it should not happen): rebuild it from the sponsor's authorization log and allocate to the merchant |
| `settled_after_reversal` | A canceled payment was settled: the reversal did not reach the issuer | File a reversal claim or a credit with the sponsor. Allocate when the money comes back |
| `duplicate_settlement` | A sale, refund or chargeback appears in a second report | Ask the sponsor to claw it back; allocate when it does |
| `amount_mismatch` | Settled amount differs from the platform's | Partial clearing or a sponsor error. Ask the sponsor, then allocate the difference |
| `brand_mismatch`, `inconsistent_line` | The line contradicts the platform's records or itself | Fix the converter or ask the sponsor for a corrected report |
| `unmatched_refund` | The network settled a refund the platform did not send | Ask the sponsor; a refund done in its portal must be debited from the merchant by allocation |
| `unmatched_chargeback` | A chargeback settled before its notice arrived | Import the notice, then allocate the suspense to `liability.scheme_payable.<brand>` |
| `unexpected_reversal` | The scheme reversed a chargeback the platform has not seen won | Import the `won` notice, then allocate to `asset.scheme_receivable.<brand>` |
| `unsettled_capture` | A capture two to seven days old is in no report | Ask the sponsor. Usually a late batch; it clears when the report arrives |
| `unidentified_pix` | A Pix arrived without a known `txid` (a transfer to the key, a static QR) | Return it with a devolução, or allocate it to the right merchant |
| `not_at_psp` | The ledger credited a Pix the PSP does not list for the day | Check the `horario` at the PSP (a different day near midnight); otherwise a P1 with the PSP |
| `replay_failed` | Replaying a Pix through the normal path failed | Read the detail; fix and re-run `recon-pix` |

## 6. Audit trail

```sql
SELECT at, actor, action, target, detail FROM ops_audit WHERE tenant_id = '…' ORDER BY at DESC LIMIT 50;
SELECT * FROM ops_audit WHERE target = 'mer_…' ORDER BY at;
```

Journals are never edited. A correction is a new journal, and every manual posting (`recon-allocate`, `write-off`, `settle`) has an audit row naming the operator.
