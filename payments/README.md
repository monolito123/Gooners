# InfinityPay+ (working title): merchant acquiring and BaaS platform specification

Architecture and engineering specification (REA / PRD) for a Brazil-first merchant acquiring and Banking-as-a-Service platform with:

- **Visa and Mastercard acquiring**: indirect via a sponsor acquirer first, then direct principal membership. ISO 8583 switch, EMV 3DS, VTS/MDES network tokens, expected-margin routing, disputes and clearing.
- **A serverless and edge control plane** (Cloudflare Workers, AWS Lambda, Step Functions) around a **stateful core** that card networks require (ISO 8583 sessions, payment HSMs). The core sits on a **double-entry ledger spread across three cloud providers**.
- **Nostr as a trust plane**: signed, gift-wrapped receipts the customer owns, device-signed terminal journals, encrypted statements, and a public **Merkle transparency log** of daily settlements. Nostr never carries authorizations.
- **Mobile terminals**: Android tap-to-phone under PCI MPoC (Kotlin, Compose, Coroutines); iOS with Tap to Pay on iPhone, BLE mPOS readers and remote charge between devices (SwiftUI).
- A **design system** whose colour claims are computed, not asserted.
- Three re-scoped enhancements: a **risk-priced instant liquidity engine**, **zero-knowledge selective disclosure** for merchants, and an **on-device fraud shield**.

> **Status: specification.** Not legal advice. The regulatory reading in [00 §7](docs/00-executive-summary.md#7-regulatory-posture-brazil-first) must be confirmed by counsel. "InfinityPay+" is a working title: it is close to *InfinitePay* (CloudWalk), so pick a distinct brand before public use. The platform's hosts use the reserved `.example` domain.

## What changed from the brief

Seven premises of the original brief would fail regulation, certification or physics as written. Each is kept in spirit and re-scoped. The details are in [00 §2](docs/00-executive-summary.md#2-what-this-specification-changes-from-the-brief):

1. Nostr carries receipts, statements and notifications, **not authorizations**.
2. "Zero single points of failure" comes from **multi-provider** placement, not from putting ISO 8583 sockets in edge functions.
3. Client funds stay in the BCB CCME account or federal securities. **No DeFi**. "Instant liquidity" is a funding engine over registered receivables.
4. Zero-knowledge proofs are for **third parties**. Tax and regulatory reporting stays complete.
5. Android tap-to-phone targets **PCI MPoC**. The CPoC sunset period ends on 31 October 2026.
6. "Least-cost routing" becomes **expected-margin routing** over the choices that really exist.
7. Nostr keys are a **phishing-resistant credential bound to a KYB'd account**, not a replacement for it.

## Contents

| | |
|---|---|
| [docs/00-executive-summary.md](docs/00-executive-summary.md) | **Module 1**: vision, corrections to the brief, positioning, ecosystem architecture (C4), planes, tenancy, regulatory posture, SLOs, ADRs |
| [docs/01-acquiring-engine.md](docs/01-acquiring-engine.md) | **Module 2a**: integration models, scheme connectivity, authorization switch, ISO 8583 messages and data elements, EMV 3DS, VTS/MDES, routing, disputes, clearing and settlement |
| [docs/02-api-reference.md](docs/02-api-reference.md) | **Module 2b**: REST API with full JSON payloads, TLS 1.3 mTLS profile and handshake, webhooks (with a real signature test vector), ISO 8583 mapping |
| [docs/03-nostr-layer.md](docs/03-nostr-layer.md) | **Module 3**: custom event kinds, gift-wrapped receipts with claim-by-QR, merchant key hierarchy, notifications, transparency log, terminal journal, relay architecture, reconciliation |
| [docs/04-serverless-backend.md](docs/04-serverless-backend.md) | **Module 4**: runtime placement, latency budget, event backbone, exactly-once effects, ledger schema and invariants, security, PCI DSS v4.0.1, multi-provider resilience |
| [docs/05-mobile.md](docs/05-mobile.md) | **Module 5**: Android MPoC terminal (Kotlin), attestation, offline-first outbox, iOS Tap to Pay / BLE / remote charge (SwiftUI), wireframes |
| [docs/06-design-system.md](docs/06-design-system.md) | **Module 6**: colour psychology in proportion, verified contrast, colour-vision simulation, themes (sunlight mode), two-tap checkout, dashboard |
| [docs/07-enhancements.md](docs/07-enhancements.md) | **Module 7**: Instant Liquidity Engine, Zero-Knowledge Compliance, Autonomous Fraud Shield |
| [docs/08-roadmap-risks.md](docs/08-roadmap-risks.md) | Phases, certification path, risk register, questions for counsel |
| [api/openapi.yaml](api/openapi.yaml) | OpenAPI 3.1 contract |
| [nostr/schemas/](nostr/schemas) | JSON Schema for each custom event kind |
| [nostr/examples/](nostr/examples) | Real signed events, gift wraps, a settlement statement and Merkle proofs, from public test keys |
| [design/tokens.json](design/tokens.json) | Design tokens (W3C DTCG format) |
| [tools/](tools) | Example generator and the specification checker |

## Verify the specification

Needs Node.js ≥ 22. PostgreSQL binaries and Playwright's Chromium are used when present.

```bash
cd payments/tools
npm ci
npm run check          # everything below
npm run check -- --fast   # skip Mermaid rendering, OpenAPI lint and PostgreSQL
npm run gen            # regenerate nostr/examples (deterministic: same bytes every run)
```

`npm run check` recomputes what the documents claim:

- every JSON block parses; every Nostr event ID and BIP-340 signature verifies; events embedded in documents are byte-identical to `nostr/examples`; gift wraps decrypt and their layers verify; contents validate against the kind schemas and are canonical JSON;
- the settlement statement totals, the statement commitment, both RFC 6962 inclusion proofs and the chain of transparency roots;
- every Pix BR Code's CRC16, the Standard Webhooks HMAC test vector, every advance fee from the pricing formula, and the routing example's expected margins;
- every contrast ratio and colour-vision ΔE in the design module, from `tokens.json`;
- every prefixed ID is a valid ULID, every npub decodes to a published test key, and every relative link and heading anchor resolves;
- the OpenAPI file lints clean (Redocly), all Mermaid diagrams render in Chromium, and the ledger DDL runs on PostgreSQL with the posting catalogue and invariants L1–L5.

The ledger check earned its keep while this spec was written: it caught a posting sequence that paid Pix out of an unfunded settlement account ([04 §3.4](docs/04-serverless-backend.md#34-posting-catalogue)).

## Relation to SMA

The SMA messenger in [`../messenger`](../messenger) is this repository's earlier serverless, post-quantum Nostr design. This specification reuses its stance on untrusted relays, its recovery-phrase key hierarchy for merchant root keys, and its hybrid post-quantum TLS posture.

## Sources consulted (October 2026)

Regulatory and market facts were checked against these. Confirm the current consolidated texts before relying on them.

- PCI SSC, [PCI SPoC and PCI CPoC Sunset Bulletin](https://www.pcisecuritystandards.org/wp-content/uploads/2026/05/PCI_SPoC_and_PCI_CPoC_Sunset_Bulletin.pdf)
- Nostr NIPs, [kind registry and NIP list](https://github.com/nostr-protocol/nips/blob/master/README.md) (checked 2026-10-29)
- Resolução BCB 80/2021 (payment institutions, e-money safeguarding): [summary](https://okai.com.br/documento/2021-03-25/resolucao-bcb-n-80); Resolução BCB 237/2022 (CCME): [text](https://www.normasbrasil.com.br/norma/resolucao-237-2022_435665.html)
- Resolução BCB 264/2022 (card receivables registration, replacing Circular 3.952/2019): [Compliasset alert](https://www.compliasset.com/alerta/resolucao-bcb-no-264-registra-recebiveis-em-arranjos-pos-pagos/)
- Resolução BCB 246/2022 (debit and prepaid interchange caps): [Mattos Filho](https://www.mattosfilho.com.br/unico/regras-tarifas-intercambio-prazos-liquidacao/)
- Resolução BCB 85/2021 (cyber security and cloud): [text](https://www.legisweb.com.br/legislacao/?id=412501)
- DIMP / Convênio ICMS 134/2016: [SEF/MG](https://www.fazenda.mg.gov.br/empresas/instituicoes-e-intermediadores-de-pagamentos-servicos-e-negocios/), [SP RC 28599/2023 (Pix included)](https://legislacao.fazenda.sp.gov.br/Paginas/RC28599_2023.aspx)
- Visa VAMP: [Equifax summary](https://www.equifax.com/business/blog/-/insight/article/the-visa-acquirer-monitoring-program-vamp-what-new-rules-mean-for-acquirers-and-merchants/); Visa excessive reattempts: [Payway](https://www.payway.com/visa-excessive-reattempts-rule-fees)
- EMVCo, [Contactless Kernel Specification](https://www.emvco.com/news/emvco-publishes-emv-contactless-kernel-specification/)
- Tap to Pay on iPhone in Brazil: [9to5Mac](https://9to5mac.com/2023/09/19/apple-tap-to-pay-brazil/)
- Market baseline (third-party, October 2026): [InfinitePay](https://www.infinitepay.io/blog/melhor-tap-to-pay), [Calculadora de Taxas](https://www.calculadoradetaxas.com.br/infinitepay)
- AWS Payment Cryptography, [PIN translation](https://docs.aws.amazon.com/payment-cryptography/latest/userguide/translate-pin-data.html)
