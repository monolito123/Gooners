# Integration points: every server, technology and API the system needs

This is the complete list of places where goonersPAY meets something outside this repository. It covers the servers it runs on, the counterparties' APIs, the hardware and SDKs, the phones' platform services, and the work people do with files. For each point it gives:

- what it is for;
- the exact place in the code where it plugs in;
- the settings;
- what exists here.

The sandbox runs every point on a simulator or a stand-in, which is why the whole system works end to end today. To make it work for real, each point needs the real counterparty.

`platform integrations` reads the settings and reports each point as live, simulated, partly configured or off. `-strict` exits 1 while a point production requires is not live. Production's startup check (`config.Validate`) refuses to run without each of those points. A test (`TestProductionRequiresWhatTheReportRequires`) keeps the report and the check from drifting apart.

**What exists here**, in the tables below:

| Mark | Meaning | What remains |
|------|---------|--------------|
| **Built** | The code speaks the provider's real API | Credentials, a contract with the provider, and a test against their sandbox |
| **Contract** | The platform speaks a small, documented JSON contract. Each provider's API differs, or is licensed | A thin translator: a service in front of the provider, or a Go type that implements the same interface |
| **Interface** | Only a Go interface (or Kotlin/Swift protocol) and a development implementation exist | The adapter |
| **Missing** | Specified in the docs, no code yet | Building it |
| **Manual** | People do it, with files | Optionally automating it |

## 1. At a glance

| # | Integration | For | Exists | Production |
|---|-------------|-----|--------|------------|
| 1 | PostgreSQL 16 | Ledger, payments, everything | Built | Required |
| 2 | Public HTTPS endpoint | Partners, console, apps | Built | Required |
| 3 | Terminal mTLS listener | Dedicated terminals with certificates | Built | When such terminals exist |
| 4 | Card scheme host (sponsor acquirer, then Visa, Mastercard) | Card authorizations | Built transport; dialect to transcribe | Required |
| 5 | Sponsor's settlement report and chargeback files | Card reconciliation, disputes | Manual (CSV import) | Required |
| 6 | Pix PSP (API Pix) and its webhook | Pix charges, refunds, daily reconciliation | Built | Required |
| 7 | Pix payouts (bank transfer API) | Paying merchants out | Contract | Required |
| 8 | Receivables registrar (CERC, Núclea, B3, TAG) | Registering receivables before advances | Contract | Required |
| 9 | KMS key-encryption key (AWS KMS, Google Cloud KMS) | The vault's data keys | Built | Required |
| 10 | Payment HSM (AWS Payment Cryptography) | Decrypting readers' DUKPT card data | Built; key ceremony with the reader vendor | Required |
| 11 | Signer service (`cmd/signer`) in an enclave or confidential VM | Receipt and transparency signatures | Built; to deploy | Required |
| 12 | Apple App Attest | Trusting iPhones | Built | Required |
| 13 | Android key attestation and Google's status list | Trusting Android phones | Built | Required |
| 14 | Play Integrity | A second Android signal | Missing | Optional |
| 15 | Android card reading (licensed MPoC SDK) | Tap on Android | Interface | Required for cards on Android |
| 16 | iPhone card reading (Tap to Pay on iPhone, or a BLE PCI PTS reader) | Tap on iPhone | Interface | Required for cards on iPhone |
| 17 | App release settings (API URL, pins, platform keys) and the stores | Shipping the apps | Built | Required |
| 18 | Nostr relays | Customer receipts, merchant copies, the public root | Built (client, and `relaysim` for the sandbox); production relays to run or contract | Required |
| 19 | Receipt claim page and NIP-05 file | Opening the receipt QR | Built (served by the platform at `/c` and `/.well-known/nostr.json`) | Required |
| 20 | Timestamp anchoring (ICP-Brasil TSA, OpenTimestamps) | Dating the daily roots independently | Missing | Optional |
| 21 | Partners' webhook endpoints | Event delivery | Built | Per partner |
| 22 | Partner token service (`/oauth2/token`, mTLS) | Certificate-bound partner tokens | Built | Optional (API keys remain) |
| 23 | Prometheus and alerting | The runbook's alerts | Built (metrics) | Operationally required |
| 24 | Operator identity (SSO) | Who ran each operator command | Missing | Required by the runbook |
| 25 | KYB/KYC provider | Clearing merchants before they sell | Missing (operators decide) | Required by regulation |
| 26 | Crypto exchanges (Binance, Kraken, Coinbase) | Crypto payments, conversions, withdrawals | Built | With crypto |
| 27 | Sanctions lists (OFAC SDN) and a screening provider | Addresses, senders, names | Built (lists); Contract (provider) | With crypto |
| 28 | Chain data (Esplora, EVM JSON-RPC, Tron) or an analytics provider | Who sent each deposit | Built (nodes); Contract (provider) | With crypto |
| 29 | Travel-rule network | IVMS101 data with other providers | Contract | With crypto |
| 30 | DeCripto at the Receita Federal | The monthly crypto report | Manual (file built) | With crypto |
| 31 | Wise | Accounts abroad, international payouts | Built | With câmbio |
| 32 | A B3 broker, and brapi.dev quotes | Shares and positions | Contract (broker); Built (brapi) | With B3 |

## 2. Infrastructure

**1. PostgreSQL 16.** Set `DATABASE_URL`. `serve` runs the migrations in `internal/db/migrations/` at start. Plan backups and point-in-time recovery, since the ledger is the system of record.

**2. Public HTTPS endpoint.** Set `PUBLIC_API_URL` to the https base, because phones sign the exact URL in every NIP-98 login and DPoP proof. Terminate TLS in one of two ways:

- In the platform: `HTTP_ADDR`, `HTTP_TLS_CERT`, `HTTP_TLS_KEY`.
- In a proxy in front of it: set `TRUST_PROXY=true`, so rate limits use the client address that proxy appends.

The startup check refuses to run outside the sandbox without an https `PUBLIC_API_URL`.

**3. Terminal mTLS listener.** Set `TERMINAL_ADDR` and `TERMINAL_TLS_CERT/KEY/CA`. It is for dedicated terminals that hold the certificate `POST /v1/terminals` issues. Merchant phones do not need it: they authenticate with attested DPoP sessions on the public endpoint. In production a terminal's API key alone is refused (`terminal-certificate-required`).

**23. Prometheus.** Set `METRICS_ADDR` on the internal network only. The alerts to configure are in [operations-runbook.md §3](operations-runbook.md#3-alerts).

**Network.** Every connection this document lists:

| Direction | Connection | Address |
|-----------|------------|---------|
| Inbound | Public API | `HTTP_ADDR`, default `:8080` |
| Inbound | Terminals | `TERMINAL_ADDR` |
| Inbound | The PSP's Pix webhook, mutual TLS | `PIX_WEBHOOK_ADDR` |
| Inbound | Metrics | `METRICS_ADDR`, internal only |
| Outbound | Scheme hosts | `ROUTES_FILE` addresses |
| Outbound | PSP and payout bank | `PIX_BASE_URL`, `PIX_TOKEN_URL`, `PAYOUT_BASE_URL` |
| Outbound | Registrar | `REGISTRAR_URL` |
| Outbound | Google's attestation status list | `android.googleapis.com` |
| Outbound | Relays | `RELAYS`, `wss://` |
| Outbound | Partners' webhook URLs | Anywhere public; private addresses are refused |
| Outbound, with crypto | Exchanges | `api.binance.com`, `api.kraken.com`, `api.coinbase.com` |
| Outbound, with crypto | Chain nodes and lists | `*_ESPLORA_URL`, `*_RPC_URL`, `TRON_API_URL`, `SANCTIONS_LISTS` URLs, `SCREENING_URL`, `SENDER_LOOKUP_URL` |
| Outbound, with crypto | Travel-rule network | `TRAVEL_RULE_URL` |
| Outbound, with câmbio | Wise | `api.wise.com` (`WISE_BASE_URL`) |
| Outbound, with B3 | Broker and quotes | `BROKER_URL`, `brapi.dev` |

**Secrets.** Every secret above arrives as an environment variable. In production they come from a secret manager, never from files in the image. With the KMS, payment-HSM and signer adapters (§4), the software-key variables (`VAULT_KEK_HEX`, `CARDDATA_DEV_KEY_HEX`, `CARDDATA_BDK_HEX`, `RECEIPTS_SECRET_HEX`, `TRANSPARENCY_SECRET_HEX`) disappear, and production refuses them.

## 3. Money movement

**4. Card scheme host.**

- **Transport.** `ROUTES_FILE` is JSON in the shape of `deploy/routes.certification.example.json`. Each route names its addresses, TLS files and a dialect. The dialects are JSON field layouts in `dialects/`, read by `pkg/iso8583`.
- **Built.** Sessions (sign-on, echo, reconnect), the switch with timeout reversals and store-and-forward, and routing (`internal/scheme`, `internal/authswitch`).
- **To do.** Transcribe the sponsor's host specification into a dialect file. Visa and Mastercard ship as `*.template.json`, because their layouts are licensed.
- **Production.** Refuses a route without TLS or without a verified dialect file.
- **Guides.** [sponsor-acquirer.md](sponsor-acquirer.md), [visa.md](visa.md), [mastercard.md](mastercard.md).
- `ACQUIRER_ID` is the acquiring institution ID the sponsor assigns, sent in DE 32.

**5. Settlement reports and chargebacks.** Operators import the sponsor's files:

- `platform recon-card -file report.csv` reconciles settlement.
- `platform disputes-import -file chargebacks.csv` brings in chargebacks.

The CSV layouts are in the runbook. What remains is a converter from the sponsor's own report and chargeback formats to those CSVs, and optionally an automated pickup (SFTP or API) that runs the same commands.

**6. Pix PSP (API Pix).**

- **Code.** `pkg/apipix` speaks the Banco Central's standard API Pix:
  - OAuth2 client credentials over mutual TLS;
  - `PUT /cob/{txid}`, `GET /cob/{txid}`, `GET /pix`, `GET /pix/{e2eid}`;
  - `PUT /pix/{e2eid}/devolucao/{id}`;
  - `PUT /webhook/{chave}`.
- **Settings.** `PIX_BASE_URL` (including `/v2`), `PIX_TOKEN_URL`, `PIX_CLIENT_ID`, `PIX_CLIENT_SECRET`, `PIX_KEY`, `PIX_TLS_CERT/KEY/CA`.
- **Webhook.** The PSP's webhook arrives over mutual TLS on `PIX_WEBHOOK_ADDR` (`PIX_WEBHOOK_TLS_*`, with the PSP's CA). The platform registers `PIX_WEBHOOK_PUBLIC_URL` with the PSP at start. Every webhook is re-read with `GET /pix/{e2eid}` before crediting.
- **Production.** Requires the PSP and its webhook. A half-configured connection fails at start in every environment.
- **Guide.** [pix.md](pix.md).

**7. Pix payouts.** `internal/pixout.HTTPSender` speaks a generic contract:

```
POST {PAYOUT_BASE_URL}/pagamentos/pix   {"idempotencia","valor":"123.45","tipoChave","chave","descricao"}
     → 200/201 {"id","endToEndId","status","motivo"}
GET  {PAYOUT_BASE_URL}/pagamentos/pix/{id}
```

It reuses the API Pix connection's OAuth token and mutual TLS (`pixClients` in `cmd/platform/main.go`). So it is never built without `PIX_BASE_URL`, and it assumes the PSP and the payout bank are the same institution.

What remains is to write a `pixout.Sender` for the bank's transfer API, which is one file. With a different bank, give it its own credentials.

Without a sender, `POST /v1/payouts` answers `disabled`, so production requires it.

**8. Receivables registrar.** `internal/registrar.Client` speaks:

```
POST {REGISTRAR_URL}/units              {"units":[…]}        → 204
POST {REGISTRAR_URL}/availability       {"keys":[…]}         → {"units":[…]}
POST {REGISTRAR_URL}/effects            Effect               → 201, or 409 when a unit is committed
POST {REGISTRAR_URL}/effects/cancel     {"id":"…"}           → 204
```

What remains is a translator to the registrar the platform joins (CERC, Núclea, B3 or TAG), plus participation in the arrangement. `PLATFORM_DOCUMENT` is the platform's CNPJ. Production requires both settings. See [07 §1.6](../docs/07-enhancements.md#16-registrar-interplay).

## 4. Keys and card data

All three adapters are built and wired in `serve` (`cmd/platform/main.go`); the settings choose them. [hsm.md](hsm.md) describes each, with the key ceremony and the deployment.

| # | Interface | Development | Production adapter | Settings |
|---|-----------|-------------|--------------------|----------|
| 9 | `vault.KEK` (`internal/vault`): `Wrap`, `Unwrap` | `vault.LocalKEK` (`VAULT_KEK_HEX`) | `vault.AWSKMS`, `vault.GCPKMS` | `KEK_PROVIDER`, `KEK_KEY_ID`, `AWS_REGION` |
| 10 | `carddata.Decryptor` (`internal/carddata`): `Decrypt(format, ksn, ciphertext)` | The phones' development format; TDES DUKPT with the BDK in memory (`CARDDATA_BDK_HEX`) | `carddata.AWSPaymentCryptography` (TDES and AES-128 DUKPT) | `CARDDATA_HSM_KEY_ARN`, `AWS_REGION` |
| 11 | `nostr.Author` (`pkg/nostr`): `SignEvent`, `SharedKey` | Keys in memory (`RECEIPTS_SECRET_HEX`, `TRANSPARENCY_SECRET_HEX`) | `signer.Remote`, over mutual TLS to `cmd/signer`, whose keys are sealed under the KMS key | `SIGNER_URL`, `SIGNER_TLS_CERT/KEY/CA` |

What remains is the counterparties' side:

- a KMS key;
- the BDK imported into AWS Payment Cryptography through the key ceremony with the reader vendor;
- the signer deployed in a Nitro Enclave or confidential VM that alone may use its KMS key.

Production refuses the development settings and starts once the three are configured. Two pieces are not built: PIN translation (`TranslatePinData`), and an on-premises payShield adapter.

## 5. Phones and apps

**12. Apple App Attest.** `internal/attest` verifies attestations and per-sale assertions offline. It needs:

- `APPATTEST_ROOT_CA`: Apple's App Attestation Root CA, a PEM file;
- `APPATTEST_APP_ID`: `TEAMID.br.com.gooners.pay`;
- `APPATTEST_ENVIRONMENT=production` for TestFlight and App Store builds.

The app's entitlement `com.apple.developer.devicecheck.appattest-environment` lives in `mobile/ios/App/project.yml`.

**13. Android key attestation.** It needs:

- `ANDROID_ATTESTATION_ROOTS`: Google's hardware attestation roots;
- `ANDROID_SIGNING_DIGESTS`: the SHA-256 of the release signing certificate, from the Play Console;
- `ANDROID_PACKAGE`.

The platform fetches Google's revocation list from `ANDROID_ATTESTATION_STATUS` (default `https://android.googleapis.com/attestation/status`), and production refuses to turn that off.

**14. Play Integrity** is not built. It needs Google's `decodeIntegrityToken` API with a service account. Key attestation already covers what production requires.

**15. Card reading on Android.** The seam is `CardReader` in `mobile/android/core/.../sandbox/CardReading.kt`, chosen in `AppContainer.reader()` (`GoonersPayApp.kt`). Only `SandboxCardReader` exists. What remains:

- An adapter from a licensed PCI MPoC SDK (EMV contactless kernels, PIN on glass) to `CardReader`, in its own module ([05 §2.2](../docs/05-mobile.md#22-module-graph)).
- The SDK vendor's attestation-and-monitoring backend.
- A `carddata.Decryptor` (#10) for the SDK's encrypted format.

**16. Card reading on iPhone.** The seam is `CardReader` in `mobile/ios/Sources/GoonersPayKit/CardReading.swift`, chosen in `AppModel` (`sandboxReader`). Only `SandboxCardReader` exists. What remains is one of two routes:

- **Tap to Pay on iPhone** through Apple's ProximityReader. It needs:
  - Apple's entitlement (`com.apple.developer.proximity-reader.payment.acceptance`);
  - a payment provider Apple has enabled, which issues the reader token the app passes to ProximityReader and decrypts the card data it returns;
  - the matching `carddata.Decryptor`.
- **A BLE PCI PTS reader**, with its vendor SDK.

See [05 §3.2](../docs/05-mobile.md#32-acceptance-modes-and-fallback).

**17. App release settings.**

| Setting | Android (`-P…`) | iOS (`xcodebuild …=`) | Default |
|---------|-----------------|-----------------------|---------|
| API the pairing screen starts with | `goonerspay.apiUrl` | `GOONERSPAY_API_URL` | Release: `https://api.goonerspay.com.br`. Debug: the sandbox |
| SPKI pins of the API host's current and backup keys | `goonerspay.pins` | `GOONERSPAY_PINS` | None, so no pinning |
| Pinned host | `goonerspay.pinnedHost` | `GOONERSPAY_PINNED_HOST` | `api.goonerspay.com.br` |
| The platform's published receipts and transparency keys | `goonerspay.platformKeys` | `GOONERSPAY_PLATFORM_KEYS` | None, so statements are checked without them |

Release builds pair only over https. Shipping also needs:

- Android: a Play Console app with Play App Signing, whose certificate digest goes into `ANDROID_SIGNING_DIGESTS`.
- iOS: an Apple Developer team, whose Team ID goes into `APPATTEST_APP_ID`.

## 6. Receipts and transparency

**18. Nostr relays.** Set `RELAYS` (`wss://…`, comma-separated). `internal/receipts.Publisher` publishes, for every sale:

- the customer's gift wrap;
- the merchant's copy;
- the daily statements;
- the public root.

The relays must:

- accept kind 1059;
- serve wraps only to a NIP-42-authenticated reader whose key the wrap names;
- honour NIP-40 expiration.

Run them yourself or contract them, at least two.

Without relays the customer's receipt QR leads nowhere, so production requires them.

**19. Receipt claim page.** Built. Every sale shows `RECEIPT_CLAIM_BASE#k=<claim key>`, and the platform serves the page at `/c`. The page:

- reads `/.well-known/nostr.json` (NIP-05) on the same host;
- authenticates to a relay as the claim key and opens the wrap and the seal;
- checks every signature against `receipts@<host>`;
- renders the receipt, printable and downloadable.

See [03 §3.2](../docs/03-nostr-layer.md#32-claim-by-qr).

What remains: route a public host to the platform and set `RECEIPT_CLAIM_BASE` to `https://<host>/c`. Production refuses the `goonerspay.example` placeholder. When the platform publishes to relays through private addresses, `RELAYS_PUBLIC` lists the addresses customers' browsers use.

**20. Anchoring the daily roots.** The roots are signed, chained and published today. RFC 3161 timestamps from an ICP-Brasil authority, and OpenTimestamps, are specified in [03 §6.6](../docs/03-nostr-layer.md#66-anchoring) and not built.

## 7. Partners

**21. Partner webhooks.** Partners register endpoints (`POST /v1/webhook-endpoints`). Outside the sandbox they must be `https` on a public address. Delivery is signed, retried for 72 hours, and follows no redirects. The platform needs outbound internet access for it.

**22. Partner authentication.** API keys: scoped, expiring, issued with `platform apikey`. Or certificate-bound tokens: the operator registers the partner's certificate (`platform oauth-client`), and `POST /oauth2/token` issues five-minute tokens accepted only with that certificate (RFC 8705). On the public listener set `HTTP_TLS_CLIENT_CERTS=request`; behind a TLS-terminating proxy, `CLIENT_CERT_HEADER` with `TRUST_PROXY`. [The integration guide](../docs/10-integration-guide.md) is the partners' side of everything here.

## 8. Operations

**24. Operator identity.** Every command that changes money or access takes `-actor` and writes it to the hash-chained audit trail. The platform does not verify that identity. Operators must reach the commands only through a bastion or job runner that authenticates them with the company's SSO and passes the authenticated identity as `-actor`. A back-office UI over the same commands, behind SSO, is not built.

**25. KYB and KYC.** In production a new merchant starts `kyb_in_review` and takes no payments until an operator runs `platform merchant-status` to activate it. No provider is connected. Operators clear merchants with outside checks:

- the CNPJ registry;
- the owners' identity documents;
- PEP lists;
- sanctions lists.

A provider integration would call the same command, or the API, once a merchant clears. The re-KYB that rebinds a merchant's root key follows the same path ([03](../docs/03-nostr-layer.md)).

## 9. Crypto, accounts abroad and B3

These run only when `EXCHANGES`, `FX_PROVIDER` or `BROKER_URL` are set. Production then also requires the authorizations: `CRYPTO_AUTHORIZATION` for crypto and `FX_AUTHORIZATION` for câmbio. These are regulatory, not technical; see [09 §6](../docs/09-digital-assets-international-b3.md).

**26. Exchanges.** Built:

- `internal/exchange.Binance`, `.Kraken` and `.Coinbase`, signed as each venue documents;
- a best-price router;
- balances for the nightly custody reconciliation.

The exchanges' settings:

- `EXCHANGES` names the venues;
- each venue's keys: `BINANCE_API_KEY/SECRET_KEY`, `KRAKEN_API_KEY/SECRET_KEY`, `KRAKEN_WITHDRAW_KEYS`, `COINBASE_KEY_NAME/PRIVATE_KEY`;
- Kraken withdraws only to addresses registered at the venue, each named in `KRAKEN_WITHDRAW_KEYS` (`address=key name;…`).

**27. Sanctions screening.**

- **Lists.** `SANCTIONS_LISTS` takes OFAC's `SDN.CSV` or address lists, refreshed every six hours.
- **Provider.** `SCREENING_URL` is a provider's contract: `GET {URL}?network=…&address=…` returns `{"sanctioned", "matches"}`.
- **What screens what.** The provider screens addresses only. Names in travel-rule data are screened against a list that holds names. So production with crypto requires `SANCTIONS_LISTS` with the SDN file.

**28. Who sent each deposit.**

- **Nodes.** Esplora (`BITCOIN_ESPLORA_URL`), EVM JSON-RPC (`ETHEREUM_RPC_URL`, `POLYGON_RPC_URL`) and Tron (`TRON_API_URL`, `TRON_API_KEY`). Several comma-separated URLs are independent sources asked together.
- **Provider.** `SENDER_LOOKUP_URL` is an analytics provider's contract: `GET {URL}?network&asset&txid&address`. It also covers Solana.
- **Production.** Requires every network covered.

**29. Travel-rule network.**

- **Outbound.** `internal/travelrule.Service` sends `POST {TRAVEL_RULE_URL}/transfers` (IVMS101.2023) and waits for the counterparty's answer.
- **Inbound.** Messages arrive at `POST /v1/travel-rule/inbound`, signed with `TRAVEL_RULE_INBOUND_SECRET`.
- **To do.** A translator to the network the platform joins.
- **Identity.** `PLATFORM_LEI` is the platform's own LEI.

**30. DeCripto.**

- **Settings.** `PLATFORM_DOCUMENT`, `REPORTING_NAME` and `REPORTING_URL`, the platform's CNPJ, name and website, fill record 0000 of the file.
- **Not an API.** `platform decripto` writes the month's file. Operations transmits it at the Coleta Nacional (e-CAC) with the company's e-CNPJ certificate, then records the receipt with `platform decripto-filed` ([runbook §4.10](operations-runbook.md)).

**31. Wise.** Built: `internal/fx.Wise`, against the Wise Platform API. It needs:

- `FX_PROVIDER=wise`;
- `WISE_TOKEN`, `WISE_PROFILE_ID`, `WISE_BASE_URL`;
- `FX_AUTHORIZATION`, the authorized câmbio institution that carries the operations.

**32. B3.** `internal/brokerage.Client` speaks a contract:

```
GET  {BROKER_URL}/quotes/{ticker}  → Quote
POST {BROKER_URL}/orders           → Execution   (idempotent by client_id)
```

- **To do.** A translator to the broker's API (B3 itself takes orders only from participants).
- **Settings.** `BROKER_TOKEN`, and `BROKER_NAME` as shown to merchants.
- **Quotes.** Come from brapi.dev (`BRAPI_TOKEN`) through `brokerage.Brapi`, which is built.

## 10. What to build, in order

The code to write, smallest first. Contracts and certifications run alongside ([README](README.md#recommended-order)).

1. **Translators for the contracts:**
   - payout bank (#7);
   - registrar (#8);
   - with crypto: travel-rule network (#29), and the screening and analytics providers if used (#27, #28);
   - with B3: broker (#32).
2. ~~The receipt claim page and the NIP-05 file~~ (#19): built. What remains is two production relays (#18) and the public host for `/c`.
3. ~~The three key adapters~~ (#9–#11): built. What remains is the payment HSM's key ceremony with the reader vendors and deploying the signer.
4. **The card readers:** the MPoC SDK adapter on Android (#15), Tap to Pay or a BLE reader on iPhone (#16).
5. **The sponsor's dialect file** (#4) and the converter for its report and chargeback files (#5).
6. **Operator SSO in front of the commands** (#24), and a KYB provider if operators should not clear merchants by hand (#25).
7. **Later:** Play Integrity (#14), timestamp anchoring (#20). ~~The partner token service (#22)~~: built.

`platform integrations -strict` passing in the production environment is the sign that everything the settings can show is in place; production's startup check enforces the same list.
