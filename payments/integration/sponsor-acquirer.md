# Connecting to a sponsor acquirer (Phase 1)

In Phase 1 the platform is a sub-acquirer (*subcredenciador*): card transactions go to a licensed acquirer (the sponsor), which holds the Visa and Mastercard memberships, clears and settles with the schemes, and pays the platform. This is the fastest path to card acceptance ([01 §1](../docs/01-acquiring-engine.md#1-integration-models)).

## What to obtain from the sponsor

| Item | Why | Where it goes |
|------|-----|---------------|
| Host interface specification (ISO 8583 version, encodings, field table, private fields, framing, header) | The dialect | `dialects/<sponsor>.json` (kept outside the repository if confidential) |
| Test host addresses (two sites, if offered), TLS or VPN details, client certificate procedure | Connectivity | Routes file: `addrs`, `tls` |
| Acquirer / institution ID for DE 32, and how merchants are identified (one MID per sub-merchant, or the sponsor's MID plus sub-merchant fields) | DE 32, DE 42, sub-merchant data | Routes `acquirer_id`. The merchant's `scheme_mid` is either the sponsor-assigned MID or a platform-assigned sub-merchant ID |
| Network-management rules (sign-on required? echo interval? key exchange?) | Session behaviour | Routes `sign_on`, `echo_seconds` |
| Response timeout and reversal rules (resend 0400 with the same STAN, as the switch does, or a 0401 repeat? an advice after how long?) | Reversal behaviour | `authswitch.Config` (`CardPresentTimeout`, `MaxReversalAge`). A 0401 repeat is a one-line change in `ProcessReversals` |
| Certification test scripts | Proof | [certification-test-plan.md](certification-test-plan.md) |
| Settlement report format and schedule | Reconciliation | A report parser that calls `platform settle` per report |
| Pricing: markup, per-attempt fees | Routing economics | Routes `fee_bps`, `per_attempt_cents` |
| Who files DIMP for sub-merchants (Convênio ICMS 134/2016 allows transferring the obligation) | Tax reporting | Contract ([08 §4](../docs/08-roadmap-risks.md#4-questions-for-counsel-and-partners)) |

## Step 1: transcribe the dialect

Start from `dialects/generic-1987-ascii.json` and change only what the sponsor's specification says:

```json
{
  "name": "sponsor-x-v3",
  "description": "Sponsor X host interface v3.2, ISO 8583:1987 ASCII",
  "status": "template-unverified",
  "source": "Sponsor X Host Interface Specification v3.2 (2026-05), sections 4-7",
  "mti_enc": "ascii",
  "bitmap_enc": "ascii",
  "framing": { "type": "binary", "bytes": 2 },
  "defaults": { "enc": "ascii", "len_enc": "ascii" },
  "fields": {
    "2": { "name": "PAN", "type": "llvar", "class": "n", "max": 19, "sensitive": true },
    "4": { "name": "Amount", "type": "fixed", "class": "n", "length": 12 },
    "48": { "name": "Sponsor private data", "type": "lllvar", "class": "ans", "max": 999 }
  }
}
```

Checklist for each field: type (`fixed`, `llvar`, `lllvar`, `llllvar`), class (`n`, `a`, `an`, `ans`, `b`, `z`), length or max, content encoding (`ascii`, `ebcdic`, `bcd`, `binary`), length-prefix encoding, BCD padding side (`bcd_pad`), and whether it carries card data (`sensitive`). Then, for the message as a whole, check the MTI and bitmap encodings, the header length, and the framing (prefix width, and whether it counts itself).

Prove the transcription against the sponsor's sample messages. Each spec's hex examples should unpack and repack byte for byte:

```go
spec, _ := iso8583.LoadSpecFile("dialects/sponsor-x-v3.json")
codec := iso8583.NewCodec(spec)
msg, err := codec.Unpack(sampleFromSpec)   // must succeed
again, _ := codec.Pack(msg)                // must equal sampleFromSpec
```

When every sample round-trips and the test host accepts sign-on, set `"status": "verified"`. The platform only loads verified dialects outside the sandbox.

## Step 2: map private fields

The switch fills the standard fields ([01 §3.5](../docs/01-acquiring-engine.md#35-data-elements)). Sponsors usually add private ones: installments (*parcelado*), sub-merchant data, terminal capabilities, DE 48 sub-elements. Extend `authswitch.BuildAuthorization` with a per-route hook that sets them from `Request`, and `completeFromResponse` to read sponsor-specific response data. Keep each sponsor's mapping in its own file, so the canonical model stays the same for every route.

## Step 3: connect to the test host

```json
[
  {
    "name": "sponsor",
    "dialect_file": "/etc/platform/dialects/sponsor-x-v3.json",
    "addrs": ["sponsor-test-a.example:7001", "sponsor-test-b.example:7001"],
    "tls": { "ca": "/etc/platform/pki/sponsor-ca.pem", "cert": "/etc/platform/pki/platform.pem", "key": "/etc/platform/pki/platform.key" },
    "acquirer_id": "00012345",
    "schemes": ["visa", "mastercard", "elo"],
    "fee_bps": 35,
    "per_attempt_cents": 5,
    "approval_prior": 0.9,
    "echo_seconds": 30
  }
]
```

Run with `PLATFORM_ENV=certification`. The platform refuses plain TCP and unverified dialects in that mode. Watch the logs for `signed on`. Every message the switch logs goes through `Message.Dump`, which masks the PAN, track data, PIN block and EMV data.

## Step 4: run the certification scripts

Go through [certification-test-plan.md](certification-test-plan.md) with the sponsor's test cards. Every scenario there already runs against `schemesim`, so differences seen on the test host point to a dialect or field-mapping difference, not to switch logic.

## Step 5: settlement, chargebacks and reconciliation

The sponsor pays the platform per its schedule (credit D+30 per installment, debit D+1) and reports chargebacks as they arrive. Write one converter per sponsor from its report and chargeback formats to the platform's two import formats ([operations runbook §2](operations-runbook.md#2-import-formats)). That converter is the only sponsor-specific code. Then:

1. **Settlement report:** `platform recon-card -tenant … -report <report id> -date … -file report.csv`. Each line is matched to an authorization by RRN and authorization code, to a refund, or to a dispute by case ID. One journal per report posts the cash received, clears the scheme receivables and payables, and trues up interchange and scheme fees against the estimates booked at capture. The report ID is the idempotency key, so a report is never posted twice. Unmatched lines wait in `liability.recon_suspense` as exceptions, and captures no report has settled after two days are flagged too ([runbook §5](operations-runbook.md#5-reconciliation-exceptions)).
2. **Chargebacks:** `platform disputes-import -tenant … -file chargebacks.csv` opens disputes (debiting the merchant at once) and applies outcomes (`won`, `lost`, `pre_arbitration`). Merchants answer through `POST /v1/disputes/{id}/evidence`. Operations files the representments with the sponsor ([runbook §4.6](operations-runbook.md#46-chargebacks)).
3. Investigate any difference between the report's net and the ledger's `scheme_receivable` balance for that date (invariant 3 of [01 §8.3](../docs/01-acquiring-engine.md#83-reconciliation-invariants)).

`platform settle` still posts a settlement total by hand (audited) for a report that cannot be imported line by line. Receivables not advanced instantly are released to merchants on their settlement date by the scheduler (`platform release-due` does the same on demand).
