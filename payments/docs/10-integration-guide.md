# Module 10: Integrating with goonersPAY

This module is for the developers who connect a partner's systems to the platform: a BaaS partner, a marketplace, an ERP, or the operator's own back office. It goes from an empty machine to a first Pix payment and its webhook, then sets out the rules every integration follows and the checklist to go live. The reference is [02](02-api-reference.md); the machine-readable contract is [`api/openapi.yaml`](../api/openapi.yaml), and [`api/goonerspay.postman_collection.json`](../api/goonerspay.postman_collection.json) has every operation ready to call.

---

## 1. Who calls what

| Client | Authenticates with | Calls |
|--------|--------------------|-------|
| A partner's server | An API key with scopes: `Authorization: Bearer sk_test_…` (sandbox) or `sk_live_…` ([02 §3.1](02-api-reference.md#31-post-oauth2token-partners)) | Every partner route: merchants, payments, refunds, payouts, lists, summaries, webhooks, compliance |
| The merchant apps | A 15-minute session from a NIP-98 login, bound to a DPoP key in the phone's hardware ([02 §3.2](02-api-reference.md#32-post-v1authnostr-merchant-apps)) | Their own merchant only |
| Terminals | A certificate issued after attestation | Card-present authorizations |
| The partner's webhook receiver | Verifies the platform's signature ([§4](#4-webhooks)) | Receives events |

Keys never go into an app or a browser that someone else controls: a merchant's phone logs in with its own key, and the web console asks for the key each session and keeps it in memory only.

---

## 2. A sandbox in five minutes

With Docker:

```bash
cd payments/platform
docker compose up --build                       # the API on http://localhost:8080, with every simulator
docker compose exec platform platform apikey -tenant 00000000-0000-4000-8000-000000000001 -name my-integration
```

`apikey` prints the key once (`sk_test_…`); `-scopes` narrows it (by default it holds every scope except the compliance officers' two). Without Docker, with PostgreSQL installed, `DATABASE_URL=postgres://… go run ./cmd/smoke -serve sandbox.json` starts the same stack and writes its URL, a key and a merchant to `sandbox.json`.

In Postman, import the collection and set two variables: `baseUrl` (`http://localhost:8080`) and `apiKey`. Every request already sends `Api-Version` and a fresh `Idempotency-Key`, and its body starts from the reference's example. The web console is at `http://localhost:8080/console/`.

---

## 3. A first Pix payment

```bash
export API=http://localhost:8080 KEY=sk_test_…
H=(-H "Authorization: Bearer $KEY" -H "Api-Version: 2026-10-01" -H "Content-Type: application/json")

# A merchant (the sandbox activates it at once; production starts it in KYB review).
curl -s "${H[@]}" -H "Idempotency-Key: $(uuidgen)" $API/v1/merchants -d '{
  "legal": {"document": {"type": "cnpj", "number": "12345678000195"}, "legal_name": "Cafe Aurora Ltda",
            "trade_name": "Café Aurora", "mcc": "5812", "address": {"city": "São Paulo"}}}'

# A charge of R$ 129,90 by Pix, then the QR code to show the customer (next_action.br_code).
curl -s "${H[@]}" -H "Idempotency-Key: $(uuidgen)" $API/v1/payment-intents -d '{"merchant_id": "mer_…", "amount": 12990, "channel": "pix"}'
curl -s "${H[@]}" -H "Idempotency-Key: $(uuidgen)" $API/v1/payment-intents/pi_…/confirm -d '{"payment_method_type": "pix"}'

# The sandbox pays it as a bank app would: the PSP's webhook captures it, and yours follows.
curl -s "${H[@]}" -X POST $API/v1/sandbox/pix/payments/pi_…

# What happened, as the merchant sees it.
curl -s "${H[@]}" "$API/v1/payment-intents?merchant_id=mer_…&status=captured"
curl -s "${H[@]}" $API/v1/merchants/mer_…/summary
```

Amounts are integers in centavos ([02 §1.6](02-api-reference.md#16-common-formats)). A card-present sale needs a terminal: `go run ./cmd/tapsim` emulates one against the sandbox ([platform README](../platform/README.md#quick-start)). Crypto charges are paid with `POST /v1/sandbox/crypto/payments/{id}`, and a credit from abroad arrives with `POST /v1/sandbox/international/credits`.

---

## 4. Webhooks

Register an endpoint with `POST /v1/webhook-endpoints` (`{"url": "https://…", "events": ["*"]}`). The answer carries the signing secret, `whsec_…`, once. `GET /v1/webhook-endpoints` lists them without secrets, and `DELETE /v1/webhook-endpoints/{id}` stops one for good. Deliveries follow Standard Webhooks ([02 §10](02-api-reference.md#10-webhooks)): verify every one before trusting it, on the raw body, before parsing it.

```js
// Verifies a goonersPAY webhook (Standard Webhooks, v1). secret is the endpoint's whsec_… value,
// headers the request's (lower-case names), body the raw body as received.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhook(secret, headers, body, now = Math.floor(Date.now() / 1000)) {
  const id = headers['webhook-id'], ts = headers['webhook-timestamp'], sigs = headers['webhook-signature'];
  if (!id || !ts || !sigs) return false;
  if (Math.abs(now - Number(ts)) > 300) return false; // more than five minutes off: a replay
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest();
  // While a secret rotates, a delivery carries one signature per secret: any valid one passes.
  return sigs.split(' ').some((s) => {
    const [version, value = ''] = s.split(',');
    const given = Buffer.from(value, 'base64');
    return version === 'v1' && given.length === expected.length && timingSafeEqual(given, expected);
  });
}
```

```python
# Verifies a goonersPAY webhook (Standard Webhooks, v1). body is the raw request body, bytes.
import base64, hashlib, hmac, time

def verify_webhook(secret, headers, body, now=None):
    msg_id, ts, sigs = headers.get("webhook-id"), headers.get("webhook-timestamp"), headers.get("webhook-signature")
    if not (msg_id and ts and sigs):
        return False
    if abs((now if now is not None else time.time()) - int(ts)) > 300:
        return False  # more than five minutes off: a replay
    key = base64.b64decode(secret[len("whsec_"):] if secret.startswith("whsec_") else secret)
    expected = hmac.new(key, msg_id.encode() + b"." + ts.encode() + b"." + body, hashlib.sha256).digest()
    for s in sigs.split(" "):
        version, _, value = s.partition(",")
        if version == "v1" and hmac.compare_digest(base64.b64decode(value or ""), expected):
            return True
    return False
```

Both are run by `npm run check` against the signed test vector of [02 §10.1](02-api-reference.md#101-delivery-format), with a tampered body, a stale timestamp and a rotation header. Then:

- **Answer fast.** Return `2xx` within 10 seconds and do the work afterwards; anything else is retried after 5 s, 30 s, 2 min, 10 min, 1 h and then every 3 h, for 72 hours.
- **Deduplicate** on `webhook-id`: delivery is at least once.
- **Recover** what you missed with `POST /v1/webhook-endpoints/{id}/replay` (up to 30 days), or read the lists ([§5](#5-the-rules-every-integration-follows)).
- **Rotate** the secret with `POST /v1/webhook-endpoints/{id}/rotate-secret`: both secrets sign during the overlap, so you can deploy the new one at your own pace.

---

## 5. The rules every integration follows

| Rule | What to do |
|------|-----------|
| Idempotency | Send an `Idempotency-Key` (a UUID) on every `POST` and keep it with your record until you have the answer: a retry with the same key and body returns the first answer with `Idempotent-Replayed: true`, never a second charge ([02 §1.4](02-api-reference.md#14-idempotency)) |
| Errors | Problem Details with a stable `code` and the `request_id` ([02 §1.5](02-api-reference.md#15-errors)). Retry `409 idempotency_in_progress`, `429` and `503` after `Retry-After`, with exponential backoff and the same idempotency key; do not retry other `4xx`: the request needs fixing |
| Lists | `?limit=` (up to 100) and `?starting_after=` the last `next_cursor`, newest first ([02 §8.7](02-api-reference.md#87-lists)) |
| Versions | Send `Api-Version: 2026-10-01`; each response names the version that answered it ([02 §1.3](02-api-reference.md#13-versioning)) |
| Rate limits | Read `RateLimit` (what is left) and slow down before a `429` ([02 §1.6](02-api-reference.md#16-common-formats)) |
| Money and time | Centavos as integers; times in RFC 3339 UTC; the summaries' days are Brasília days |
| Scopes | Give each integration the scopes it uses: a reporting job needs `payments:read`, `accounts:read` and `settlements:read`, never `payouts:write` |
| Support | Quote the `Request-Id` of the call in question |

Reconcile every day: `GET /v1/settlements` gives each merchant's signed daily statement, which the console and the apps check against the public transparency root ([03 §6](03-nostr-layer.md#6-verifiable-settlement-transparency-log)), and `GET /v1/accounts/{id}/entries` the ledger postings behind the balance.

---

## 6. How the contract stays true

The OpenAPI file is the contract, and CI holds the platform to it on every change:

- **Every route the platform serves is in the contract, and every operation the contract offers is served** (`npm run check`). Operations that are designed but not built yet are marked `x-goonerspay-availability: planned` and answer nothing: the OAuth 2.0 token exchange (API keys today), card tokenization in the vault, sub-ledger accounts and transfers.
- **Every response of the end-to-end suite is validated against its schema**, and every request the platform accepted against its request schema; every operation offered must be exercised (`check-responses.mjs --strict`, in the platform workflow). A success status the contract does not list fails the build.
- **The reference's examples validate against the contract**, and the summaries' figures add up as the platform computes them.
- **The Postman collection is generated** from the contract (`npm run postman`), and the check fails when it is stale.

---

## 7. Going live

The partner's side:

1. A live key (`platform apikey -live`, issued by the operator) with the narrowest scopes, kept in a secret manager. Keys expire after a year by default: issue the next one before (`goonerspay_api_keys_expiring_14d` warns the operator).
2. Webhook endpoints on public `https` (production refuses others), the secret in a secret manager, the verifier above.
3. Idempotency keys stored with every write, retries with backoff, `Request-Id` in your logs.
4. A daily reconciliation against settlements and entries.

The platform's side is the operator's: `platform integrations` lists every external API the platform talks to and how ready each is, and `-strict` exits non-zero until everything production needs is live. Production refuses to start without them anyway ([§8](#8-the-providers-behind-the-platform)).

---

## 8. The providers behind the platform

Every external dependency sits behind an interface with a simulator for the sandbox and an adapter for the real provider. [`integration/integration-points.md`](../integration/integration-points.md) lists each one with the exact place it plugs into the code, what exists and what remains to build. `platform integrations` reports each from the environment alone, and production refuses to start without the ones it marks required:

```
   INTEGRATION                              STATE      PRODUCTION  DETAIL
○  Public API (HTTPS)                       off        required    PUBLIC_API_URL is not an https address (the sandbox's plain HTTP)
○  Pix PSP (API Pix)                        off        required    PIX_BASE_URL not set
◐  KEK (KMS)                                simulated  required    a software KEK in memory (VAULT_KEK_HEX)
◐  Signer (receipts and transparency keys)  simulated  required    keys in the platform's memory (RECEIPTS_SECRET_HEX, TRANSPARENCY_SECRET_HEX)
◐  Crypto exchanges                         simulated              the sandbox exchange
○  Nostr relays                             off        required    nothing is published: the receipt QR leads nowhere
○  Receipt claim page                       off        required    RECEIPT_CLAIM_BASE is the placeholder https://r.goonerspay.example/c: host the page and set it
```

(An excerpt: ● live, ◐ simulated, ◑ partly configured, ○ off.) `-json` prints the same for tooling.

| Integration | Real provider | Settings | Production |
|-------------|---------------|----------|------------|
| Scheme host | The sponsor acquirer, then Visa and Mastercard ([integration](../integration/README.md)) | `ROUTES_FILE` (TLS, verified dialect files) | Required |
| Pix PSP | Any bank with the Banco Central's API Pix ([integration/pix.md](../integration/pix.md)) | `PIX_BASE_URL`, `PIX_CLIENT_ID/SECRET`, `PIX_KEY`, `PIX_TLS_*`, `PIX_WEBHOOK_*` | Required |
| Pix payouts | The bank's transfer API, through the generic contract (it reuses the API Pix connection's token and mutual TLS) | `PAYOUT_BASE_URL` | Required |
| Receivables registrar | CERC, Núclea, B3 or TAG, through the generic contract | `REGISTRAR_URL`, `PLATFORM_DOCUMENT` | Required |
| Device attestation | Apple App Attest, Android key attestation | `APPATTEST_*`, `ANDROID_ATTESTATION_*` | Required |
| Key custody | An HSM, a payment HSM and an enclave signer ([integration/hsm.md](../integration/hsm.md)) | Adapters to wire | Required |
| Crypto exchanges | Binance, Kraken, Coinbase (adapters built) | `EXCHANGES`, each exchange's keys, `CRYPTO_AUTHORIZATION` | With crypto |
| Sanctions screening | OFAC's `SDN.CSV` (names and addresses), address lists, and optionally a screening provider for addresses | `SANCTIONS_LISTS` (with the SDN file in production), `SCREENING_URL` | With crypto |
| Deposit sender lookups | Esplora, Ethereum and Polygon JSON-RPC, a Tron node, or a provider | `*_ESPLORA_URL`, `*_RPC_URL`, `TRON_API_URL`, `SENDER_LOOKUP_URL` | With crypto |
| Travel rule | A travel-rule network, through the generic contract | `TRAVEL_RULE_URL`, `TRAVEL_RULE_INBOUND_SECRET`, `PLATFORM_LEI` | With crypto |
| DeCripto | Not an API: the platform writes the file, and operations transmits it at the Receita Federal's Coleta Nacional with the e-CNPJ | `PLATFORM_DOCUMENT`, `REPORTING_NAME`, `REPORTING_URL` (record 0000) | With crypto |
| FX provider | Wise Platform (adapter built) | `FX_PROVIDER`, `WISE_*`, `FX_AUTHORIZATION` | With accounts abroad |
| Broker and market data | A B3 broker through the generic contract; brapi.dev quotes | `BROKER_*`, `BRAPI_TOKEN` | With B3 |
| Nostr relays | At least two relays with NIP-42 reads of gift wraps (operated or contracted) | `RELAYS` | Required: every sale's receipt QR |
| Receipt claim page | A static page (not built yet, [03 §3.2](03-nostr-layer.md#32-claim-by-qr)) and the NIP-05 file | `RECEIPT_CLAIM_BASE` | Required |

What each needs in contracts, certification and keys is in [`integration/README.md`](../integration/README.md); the regulatory side of crypto, câmbio and B3 in [09](09-digital-assets-international-b3.md).
