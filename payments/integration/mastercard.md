# Connecting directly to Mastercard (Phase 2)

As with Visa ([visa.md](visa.md)), a direct connection makes the platform a principal acquirer, here on Banknet, with its own ICA, authorization and clearing, and certification.

## Prerequisites (outside the code)

| Item | Notes |
|------|-------|
| BCB authorization as *credenciador* | Same as for Visa |
| Mastercard principal membership and ICA | Settlement account arrangements |
| Licensed specifications | The Customer Interface Specification (authorization) and the IPM clearing formats (Global Clearing Management System), plus Brazil domestic rules |
| Connectivity | A Mastercard Interface Processor (MIP) in each colocation site, with dual circuits ([01 §2.1](../docs/01-acquiring-engine.md#21-physical-and-network-topology)) |
| Payment HSM | Zone keys under the key ceremony ([hsm.md](hsm.md)) |
| Testing | Mastercard's test facility and certification scripts for host, terminal, 3DS and MDES |

## What the code already does for a Mastercard connection

- **Encodings**: EBCDIC MTI, text and numerics, EBCDIC length prefixes, binary bitmap and PIN block. The structural template `dialects/mastercard-cis.template.json` exercises them in the codec tests.
- **Merchant advice codes**: DE 48 sub-element 84 is parsed and overrides the platform's retry policy (`01` update data, `02` retry later, `03` never, `21` cancel the mandate, `24`–`30` retry after an interval), as tested in `authswitch`.
- **Sessions, reversals and routing**: as for Visa.

## Integration steps

1. **Transcribe the dialect** from the Customer Interface Specification into `mastercard-cis.json`: DE 48 and its sub-elements (security level indicator, UCAF, advice code), DE 61 POS data, DE 63 network data (Banknet reference, used with the settlement date as the trace ID for MIT linkage), and the framing. Round-trip every example message.
2. **Fill Mastercard-specific fields** in a `mastercard` mapping hook: the DE 61 layout from the terminal capabilities, the DE 48 sub-elements for card-not-present and tokens, and the installment fields for Brazil.
3. **Clearing (IPM).** Not built yet. Add a job that builds IPM First Presentment records (and credits for refunds) and processes Mastercard's acknowledgement and reject files.
4. **MDES, 3DS, Mastercom.** Token requestor onboarding for MDES, the 3DS server, and dispute handling through Mastercom are separate integrations ([01 §4–§7](../docs/01-acquiring-engine.md#4-emv-3-d-secure-card-not-present)).
5. **Monitoring programmes.** Feed the excessive chargeback and excessive fraud metrics from the dispute data ([01 §7.3](../docs/01-acquiring-engine.md#73-monitoring-programmes)).
6. **Certify**: [certification-test-plan.md](certification-test-plan.md) on Mastercard's test facility, then Mastercard's own scripts.

The routes configuration has the same shape as Visa's, with `"schemes": ["mastercard"]` and the MIP addresses.
