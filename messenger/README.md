# SMA: serverless, post-quantum end-to-end encrypted messaging

Architecture, protocol specification and a tested TypeScript reference implementation for a messenger that:

- runs **no servers of its own**: messages, media and signalling travel through hosts it does not trust (Nostr relays, Telegram, Blossom/IPFS, STUN/TURN), with automatic failover between them;
- encrypts **everything client-side with hybrid post-quantum cryptography**: X-Wing (ML-KEM-768 + X25519) for key agreement, composite Ed25519 + ML-DSA-65 signatures, AES-256-GCM payloads, and a Double Ratchet whose asymmetric steps are X-Wing KEM steps;
- shows hosts only **opaque, bucket-padded frames** (`tag[16] ‖ ciphertext`, 4 KiB … 1 MiB), with rotating unlinkable tags and no cleartext type, version, sender or key id;
- roots identity in a **24-word recovery phrase**; passphrases (Argon2id) and hardware keys (Secure Enclave, Keystore, passkeys) only unlock the local vault.

> Status: design, executable reference and a working app (web + Android APK, text chat over Nostr; see [app/README.md](app/README.md)). The cryptography is **not audited**, and the pure-JS core is not constant-time. See [07-roadmap.md](docs/07-roadmap.md) for the path to production.

## Contents

| | |
|---|---|
| [docs/00-overview.md](docs/00-overview.md) | Goals, threat model, system architecture, key decisions |
| [docs/01-transport.md](docs/01-transport.md) | **Module 1**: Telegram (Bot API vs MTProto) vs Nostr/Matrix/IPFS/WebRTC, payload opacity, fallback architecture |
| [docs/02-crypto-protocol.md](docs/02-crypto-protocol.md) | **Module 2**: primitives, handshake, hybrid KEM ratchet, authentication, groups |
| [docs/03-key-management.md](docs/03-key-management.md) | **Module 3**: recovery phrase, Argon2id, hardware keys, multi-device, backup and recovery |
| [docs/04-calls-webrtc.md](docs/04-calls-webrtc.md) | **Module 4**: signalling over the ratchet, SFrame media E2EE, STUN/TURN without infrastructure |
| [docs/05-data-schema.md](docs/05-data-schema.md) | **Module 5**: byte layouts, protobuf schema, JSON examples, file chunking |
| [docs/06-reference-implementation.md](docs/06-reference-implementation.md) | **Module 6**: code walkthrough of the three requested examples, tests, benchmarks |
| [docs/07-roadmap.md](docs/07-roadmap.md) | Phases, security programme, risk register |
| [proto/sma.proto](proto/sma.proto) | Canonical wire schema (compiled to static code with `npm run gen:schema`) |
| [app/](app) | **The app**: web/PWA and Android APK (Capacitor), chatting over Nostr relays |
| [reference/](reference) | TypeScript reference implementation |

## Quick start

Needs Node.js ≥ 22.18 (runs TypeScript directly, no build step).

```bash
cd messenger/reference
npm ci
npm test                  # 72 tests incl. RFC 9106 / BIP-39 vectors and hpke-js interop
npm run example:keys      # Argon2id + recovery phrase → identity keys
npm run example:encrypt   # ML-KEM-768 + X25519 (X-Wing) + AES-256-GCM
npm run example:pack      # pack into a frame, send via Telegram Bot API (offline fake by default)
npm run demo              # Alice ↔ Bob: first contact, ratchet, failover, call offer
```

To send a real frame through Telegram, create a bot with @BotFather, add it as an admin of a private channel you own, and run:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC… TELEGRAM_CHAT_ID=-100… npm run example:pack
```

## The protocol in one picture

```
 recovery phrase ─► root ─► IK (Ed25519+ML-DSA-65), IKEM (X-Wing), inbox/backup keys
                                     │
 Alice ── scan QR (fingerprint pin) ─┤
   │                                 ▼
   │  PreKeyMessage: Encap(SPK_B) ‖ Encap(IKEM_B) ‖ Seal(IK_A, Sig_IK_A(transcript)) ‖ RatchetMessage
   │                                 │
   │  RatchetMessage: Enc_HK(ct→peer_ek ‖ my_next_ek ‖ pn ‖ n) ‖ AES-GCM(mk, padded Content)
   │                                 │
   ▼                                 ▼
 frame = HMAC(tag_key, hour)[0..16] ‖ ciphertext      (4 KiB · 8 KiB · … · 1 MiB)
   │
   ├─► Nostr relays ×2 ─┐
   ├─► Telegram ────────┼─► Bob: tag lookup → decrypt
   └─► WebRTC (online) ─┘
```
