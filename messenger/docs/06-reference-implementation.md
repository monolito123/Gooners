# Module 6: Reference Implementation

[`reference/`](../reference) is a TypeScript implementation of the protocol in 02–05. It runs on Node ≥ 22.18 (native type stripping, no build step) and uses only audited-style, dependency-light libraries:

| Dependency | Version | Used for |
|------------|---------|----------|
| `@noble/post-quantum` | 0.7.1 | ML-KEM-768, ML-DSA-65, X-Wing (`ml_kem768_x25519`) |
| `@noble/curves` | 2.4.0 | Ed25519, X25519 |
| `@noble/hashes` | 2.4.0 | SHA-2, SHA-3, HKDF, HMAC, Argon2id |
| `@noble/ciphers` | 2.4.0 | AES-256-GCM, XChaCha20-Poly1305 |
| `@scure/bip39` | 2.4.0 | Recovery phrase |
| `protobufjs` | 8.8.1 | Minimal runtime for the static code generated from `proto/sma.proto` (`protobufjs-cli`, dev only) |
| `@hpke/core`, `@hpke/hybridkem-x-wing` | 1.9.0 / 0.7.0 | **Tests only**: independent HPKE+X-Wing implementation for interop checks |

```bash
cd messenger/reference
npm ci
npm test            # 72 tests: KATs, interop, protocol, contact exchange and transport behaviour
npm run typecheck   # tsc --noEmit, strict
npm run example:keys      # 1. Argon2id + recovery phrase → keys
npm run example:encrypt   # 2. ML-KEM-768 + X25519 (X-Wing) + AES-256-GCM
npm run example:pack      # 3. frame + Telegram Bot API (offline fake, or real with env vars)
npm run demo              # Alice ↔ Bob over two transports with failover
npm run bench
```

## 1. Source map

| File | Module | Contents |
|------|--------|----------|
| [`src/kdf.ts`](../reference/src/kdf.ts) | 3 | Argon2id (`deriveKeyFromPassphrase`), vault (`sealVault`/`openVault`), BIP-39, HKDF key hierarchy |
| [`src/hpke.ts`](../reference/src/hpke.ts) | 2 | X-Wing wrappers, RFC 9180 key schedule, `hpkeSeal`/`hpkeOpen`, `sealBox`/`openBox` |
| [`src/sign.ts`](../reference/src/sign.ts) | 2 | Composite Ed25519 + ML-DSA-65, fingerprints, safety numbers |
| [`src/handshake.ts`](../reference/src/handshake.ts) | 2 | Identity from root, signed prekeys, bundle create/verify, `initiate`/`respond` |
| [`src/ratchet.ts`](../reference/src/ratchet.ts) | 2 | Hybrid KEM Double Ratchet with header encryption, (de)serialisation |
| [`src/envelope.ts`](../reference/src/envelope.ts) | 1, 5 | Buckets, ISO 7816-4 padding, routing tags, frame encode/decode, base64url armor |
| [`src/payload.ts`](../reference/src/payload.ts) | 5 | `Content` and signed-object protobuf encode/decode |
| [`src/session.ts`](../reference/src/session.ts) | all | `Endpoint`: handshake → ratchet → padding → frame, tag routing, replay cache |
| [`src/transport/telegram.ts`](../reference/src/transport/telegram.ts) | 1 | Bot API adapter: `sendDocument`, `getUpdates`, `getFile`, 429 handling |
| [`src/transport/failover.ts`](../reference/src/transport/failover.ts) | 1 | Circuit breakers, redundancy, dedupe |
| [`src/transport/memory.ts`](../reference/src/transport/memory.ts) | — | In-process relay for tests and demos |

---

## 2. Example 1: deriving keys with Argon2id

From [`src/kdf.ts`](../reference/src/kdf.ts) (abridged):

```ts
export const ARGON2 = {
  interactive:  { t: 3, m: 64 * 1024, p: 1 },    // device vault unlock (m in KiB)
  offDevice:    { t: 4, m: 256 * 1024, p: 1 },   // anything passphrase-protected that leaves the device
  insecureTest: { t: 1, m: 8 * 1024, p: 1 },
} as const satisfies Record<string, Argon2Params>;

export async function deriveKeyFromPassphrase(
  passphrase: string, salt: Uint8Array, params: Argon2Params = ARGON2.interactive, purpose = 'vault-kek',
): Promise<Uint8Array> {
  checkParams(params);                                        // bounds: a tampered header can't force a huge allocation
  if (salt.length < 16) throw new RangeError('salt must be at least 16 bytes');
  return argon2idAsync(utf8ToBytes(passphrase.normalize('NFKC')), salt, {
    ...params,
    dkLen: 32,
    personalization: utf8ToBytes(`SMA/v1/argon2id/${purpose}`),   // Argon2 "X": purpose separation
    maxmem: (MAX_PARAMS.m + 1024) * 1024,
  });
}

// vault = 0x01 ‖ t ‖ m ‖ p ‖ salt[16] ‖ nonce[24] ‖ XChaCha20-Poly1305(KEK, nonce, aad = header, secret)
export async function sealVault(secret: Uint8Array, passphrase: string, params = ARGON2.interactive) {
  const salt = randomBytes(16), nonce = randomBytes(24);
  const header = concatBytes(new Uint8Array([1]), u32be(params.t), u32be(params.m), new Uint8Array([params.p]), salt, nonce);
  const kek = await deriveKeyFromPassphrase(passphrase, salt, params);
  try { return concatBytes(header, xchacha20poly1305(kek, nonce, header).encrypt(secret)); }
  finally { kek.fill(0); }
}
```

And the recovery-phrase side, which is the identity root:

```ts
const seed = recoveryPhraseToSeed(phrase);        // BIP-39, 24 words
const root = deriveRootKey(seed);                 // HKDF-Extract(SHA-512, "SMA/v1/root")
const id   = identityFromRootKey(root);           // composite IK + X-Wing IKEM, deterministic
```

Output of `npm run example:keys`:

```
identity key      : Ed25519 ‖ ML-DSA-65, 1984 B public
identity KEM key  : X-Wing (ML-KEM-768 ‖ X25519), 1216 B public
fingerprint       : 2655a1b1a0328a8a69907b40a8bbdbfaac4cf22e9f14b153d75c73b6f8f83070
safety number     : 11081 32785 10699 50552 21455 82420 60795 81415 23633 14936 30239 38590
vault sealed      : 130 B in 1431 ms (Argon2id t=3 m=64MiB p=1)
vault opened      : seed matches in 1399 ms
wrong passphrase  : wrong passphrase or corrupted vault
```

---

## 3. Example 2: encrypting with Kyber (ML-KEM-768) + AES-256-GCM

HPKE base mode (RFC 9180) with the X-Wing KEM. From [`src/hpke.ts`](../reference/src/hpke.ts) (abridged):

```ts
const SUITE_ID = concatBytes(utf8ToBytes('HPKE'), u16be(0x647a), u16be(0x0001), u16be(0x0002)); // X-Wing, HKDF-SHA256, AES-256-GCM

function keySchedule(sharedSecret: Uint8Array, info: Uint8Array) {
  const pskIdHash = labeledExtract(EMPTY, 'psk_id_hash', EMPTY);
  const infoHash  = labeledExtract(EMPTY, 'info_hash', info);
  const context   = concatBytes(new Uint8Array([0x00]), pskIdHash, infoHash);   // mode_base
  const secret    = labeledExtract(sharedSecret, 'secret', EMPTY);
  return { key: labeledExpand(secret, 'key', context, 32), baseNonce: labeledExpand(secret, 'base_nonce', context, 12) };
}

export function hpkeSeal(recipientPublicKey: Uint8Array, plaintext: Uint8Array, info = EMPTY, aad = EMPTY) {
  // X-Wing: ss = SHA3-256(ss_MLKEM768 ‖ ss_X25519 ‖ ct_X25519 ‖ pk_X25519 ‖ "\.//^\")
  const { cipherText: enc, sharedSecret } = xwingEncapsulate(recipientPublicKey);
  const { key, baseNonce } = keySchedule(sharedSecret, info);
  try { return { enc, ct: gcm(key, baseNonce, aad).encrypt(plaintext) }; }
  finally { key.fill(0); sharedSecret.fill(0); }
}
```

Usage ([`examples/02-hybrid-encrypt.ts`](../reference/examples/02-hybrid-encrypt.ts)):

```ts
const bob = xwingKeygen();                                       // pk 1216 B, sk = 32-byte seed
const plaintext = encodeContent({ text: { body: 'Meet at the usual place, 19:00.' } });
const { enc, ct } = hpkeSeal(bob.publicKey, plaintext, utf8ToBytes('SMA/v1/example'), aad);
const opened = hpkeOpen(bob.secretKey, { enc, ct }, utf8ToBytes('SMA/v1/example'), aad);
```

```
recipient public key: 1216 B  (ML-KEM-768 1184 + X25519 32)
enc (KEM ciphertext): 1120 B
  ML-KEM-768 ct     : f13c237de6ed80cf31a5995d8d5b25fb … 1088 B
  X25519 ephemeral  : 27c68c1b77af1a3ff2eabd5c09f39af6 … 32 B
AES-256-GCM ct      : 80 B (plaintext 64 + 16 tag)
decrypted           : Meet at the usual place, 19:00.
tampered aad        : HPKE open failed
```

Correctness is checked three ways in [`test/hpke.test.ts`](../reference/test/hpke.test.ts): (1) X-Wing is rebuilt by hand from ML-KEM-768, X25519, SHAKE256 and SHA3-256 per the draft and compared byte for byte; (2) **hpke-js decrypts what we encrypt**; (3) **we decrypt what hpke-js encrypts**.

---

## 4. Example 3: packing into a transport container and sending via Telegram

From [`examples/03-pack-and-send.ts`](../reference/examples/03-pack-and-send.ts):

```ts
// 1. L3 plaintext
const content = encodeContent({ text: { body: 'Sealed for Bob only. The host sees a 4 KiB blob.' } });

// 2. L0 routing tag: unlinkable without the inbox tag key, rotates hourly
const tag = routingTag(inboxTagKey, epochOf(Date.now()));

// 3. Pad inside the AEAD so the whole frame is a bucket; bind the tag as AAD
const overhead = TAG_BYTES + XWING.cipherText + 16;
const box = sealBox(inboxKem.publicKey, padToBucket(content, overhead), utf8ToBytes('SMA/v1/sealed-box'), tag);
const frame = encodeFrame({ tag, body: box });                  // exactly 4096 B, no cleartext structure

// 4a. Binary carrier: Telegram document
const tg = new TelegramBotTransport({ token: process.env.TELEGRAM_BOT_TOKEN! });
const { messageId, fileId } = await tg.putBlob(process.env.TELEGRAM_CHAT_ID!, frame);

// 4b. Text carrier: Nostr content / Matrix body
const text = armorFrame(frame);                                 // base64url, no prefix
```

The Telegram call it makes ([`src/transport/telegram.ts`](../reference/src/transport/telegram.ts)):

```ts
const form = new FormData();
form.set('chat_id', chatId);
form.set('document', new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), 'data.bin');
form.set('disable_content_type_detection', 'true');
form.set('disable_notification', 'true');
const msg = await this.call<TgMessage>('sendDocument', form);  // 429 → RateLimitedError(retry_after)
```

```
frame: 4096 B = tag 16 ‖ X-Wing enc 1120 ‖ AES-GCM(padded 2944 B) ‖ tag 16
text armor (Nostr/Matrix): sOZqSI809PyJATHWGpesUj5UAShOo25q9oS9998fR7UxJzA2… (5462 chars)
  POST sendDocument  name=data.bin type=application/octet-stream size=4096
offline fake: message 1, file_id BQACAgEAAxkDAAIB…
recipient reads: Sealed for Bob only. The host sees a 4 KiB blob.
```

Run against the real Bot API with your own bot as admin of your own private channel (topology T3, 01 §2.3):

```bash
TELEGRAM_BOT_TOKEN=123456:ABC… TELEGRAM_CHAT_ID=-100… npm run example:pack
```

---

## 5. End-to-end demo

`npm run demo` runs the full protocol: QR-pinned contact, PreKeyMessage, hybrid ratchet, failover from a rate-limited "Telegram" to "Nostr", and a call OFFER. Then it prints what the hosts stored:

```
1. First contact (PreKeyMessage to Bob's inbox tag)
  sent via telegram
  Bob ← a1d12001 (new session): Hi Bob, this is Alice.
2. Telegram starts rate limiting; traffic fails over to Nostr
  sent via nostr
  Alice ← 75b524bc: Hi Alice! Telegram is throttling us.
3. Call signalling rides the same ratchet
  sent via telegram
  Bob ← a1d12001: [call]
4. What the hosts store (all they can see):
  telegram  16384 B  tag 31998afba31517ff88679e77014edec0  body 277d8aba455bcef8…
  telegram   4096 B  tag 88688bb85703b2e41a30a89a3e1a06ae  body ee63e36503183d4c…
  nostr      4096 B  tag 85d90d3afc879f261a5b554227ebc982  body 7098fb02b18f026f…
```

---

## 6. Test coverage

| Suite | What it proves |
|-------|----------------|
| `kdf.test.ts` | **RFC 9106 Argon2id test vector**; **BIP-39 reference vector**; NFKC normalisation; parameter bounds; vault round trip; header tampering (cost downgrade) detected; phrase → identity determinism; 25th-word identity separation |
| `hpke.test.ts` | X-Wing equals the draft construction over ML-KEM-768/X25519; HPKE round trip; tamper detection on `enc` (both halves), `ct`, `info`, `aad`, wrong key; **two-way interop with hpke-js** |
| `sign.test.ts` | Composite sizes; context binding; rejection when either component is swapped for another key's; safety-number symmetry |
| `envelope.test.ts` | Every padded length lands on a bucket; padding edge cases; tags rotate and separate; base64url armor; protobuf round trips |
| `ratchet.test.ts` | 20 ratchet steps; out-of-order within and **across** chains; replay rejection; tamper rejection with state preserved; MAX_SKIP; header encryption (no key on the wire); persistence; **post-compromise healing** |
| `handshake.test.ts` | Bundle pinning; host-substituted prekey rejected; expiry; matching session secrets; **initiator identity never in clear**; OTK; SPK rotation by trial; wrong recipient; sealed-init tampering; timestamp window; **impersonation rejected** |
| `session.test.ts` | Full conversation; inbox → session tag switch; bucket sizes; tag rotation across epochs; foreign frames ignored; replayed first message rejected; call signalling |
| `transport.test.ts` | Bot API request shape (octet-stream, neutral name, no caption); `getUpdates`/`getFile` read-back; 429 → `RateLimitedError`; unpadded payloads refused; failover; **send quota does not block fetch**; redundancy + dedupe |

---

## 7. Benchmarks

`npm run bench`, one core of a 2.1 GHz Xeon, Node 22, pure JS:

| Operation | ms/op |
|-----------|------:|
| X-Wing keygen | 1.25 |
| X-Wing encapsulate | 3.21 |
| X-Wing decapsulate | 4.48 |
| ML-DSA-65 sign | 13.6 |
| Composite sign / verify | 13.4 / 4.5 |
| Ratchet message, same chain (enc + dec) | 0.89 |
| Ratchet round trip with 2 KEM steps | 17.2 |
| Argon2id t=3, m=64 MiB | ~1400 |

---

## 8. What this is not (yet)

- **Not audited.** It is an executable specification. Pure JS gives no constant-time guarantees (02 §9); production builds should use a native core.
- `Endpoint` is single-device and keeps state in memory; `serializeState` shows the persistence format.
- Specified but not implemented here: sender-key groups (02 §6), deniable handshake mode (02 §3.5), sparse ratchet mode (02 §4.7), key-history gossip (02 §5.3), the MTProto and Nostr adapters (sketched in 01 §4), file chunking (05 §5), SFrame (04 §3), device linking and backups (03).
