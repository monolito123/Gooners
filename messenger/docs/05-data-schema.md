# Module 5: Data Schema and Payload Structure

Three layers, and only the outermost is visible to hosts:

```
L0/L1  Frame (fixed binary)       tag[16] ‖ PreKeyMessage | RatchetMessage | SealedBox | SenderKeyMessage
L2     Padding (inside the AEAD)  plaintext ‖ 0x80 ‖ 0x00…   → frame length ∈ buckets
L3     Content (protobuf)         sma.v1.Content { message_id, sent_at_ms, oneof body {...} }
```

The canonical schema is [`proto/sma.proto`](../proto/sma.proto). The reference implementation loads that file at runtime, so the schema documented here is the one the tests run against.

**Why L0/L1 is not protobuf or JSON.** Protobuf field keys, JSON property names, length prefixes and version bytes are all plaintext structure that identifies the protocol and the message type. The outer layers are fixed binary layouts whose type is implied by the routing tag, and every variable-length or typed field is inside an AEAD.

---

## 1. Size buckets

`FRAME_BUCKETS = 4 KiB, 8 KiB, 16 KiB, 32 KiB, 64 KiB, 128 KiB, 256 KiB, 512 KiB, 1 MiB`. Larger payloads become files (§5).

| Frame kind | Fixed overhead | Max `Content` bytes in 4 KiB | 8 KiB | 16 KiB |
|------------|---------------:|-----------------------------:|------:|-------:|
| RatchetMessage (normal) | 2405 | 1690 | 5786 | 13978 |
| PreKeyMessage (first contact) | 11250 | — | — | 5133 |
| PreKeyMessage with OTK | 12370 | — | — | 4013 |
| SealedBox | 1152 | 2943 | 7039 | 15231 |

(The capacity is one byte less than bucket − overhead, because of the 0x80 padding marker.)

---

## 2. L0: the frame

| Offset | Size | Field | Notes |
|-------:|-----:|-------|-------|
| 0 | 16 | `tag` | `HMAC-SHA256(tag_key, "SMA/v1/tag" ‖ u64be(epoch))[0..16]`, `epoch = floor(unix_s / 3600)` |
| 16 | bucket − 16 | `body` | One of the L1 layouts below; the receiver chooses the layout by which tag table matched |

Tag tables a receiver maintains (each for epochs e−1, e, e+1):

| Tag key | Matches | Layout |
|---------|---------|--------|
| `inbox_tag_key` (own, from root) | First contact from anyone holding the ContactCard | PreKeyMessage (2 KEM cts) |
| Invite tag key (per invite with OTK) | First contact through that invite | PreKeyMessage (3 KEM cts) |
| Session `tagKeyX→self` (per session) | Ongoing conversation | RatchetMessage |
| Group `HKDF(group_secret_e, "group/tag")` | Group traffic | SenderKeyMessage |
| Link key (temporary) | Device linking | SealedBox |

Text transports carry `base64url(frame)` with no padding and no prefix (`armorFrame`).

---

## 3. L1 layouts

All integers are big-endian. `‖` is concatenation.

### 3.1 RatchetMessage

```
RatchetMessage = ENC_HEADER(2373) ‖ BODY(padded + 16)
```

| Offset | Size | Field |
|-------:|-----:|-------|
| 0 | 12 | header nonce (random) |
| 12 | 2345 + 16 | `AES-256-GCM(HKs, nonce, aad = AD, HEADER)` |
| 2373 | n + 16 | `AES-256-GCM(MSG_KEYS(mk), aad = AD ‖ ENC_HEADER, padded Content)` |

HEADER plaintext (2345 B):

| Offset | Size | Field |
|-------:|-----:|-------|
| 0 | 1 | `version` = 0x01 |
| 1 | 1120 | `ct`: X-Wing ciphertext to the peer's current key (ML-KEM-768 ct 1088 ‖ X25519 ephemeral 32) |
| 1121 | 1216 | `ek`: sender's next X-Wing public key (ML-KEM-768 ek 1184 ‖ X25519 pk 32) |
| 2337 | 4 | `pn`: length of the previous sending chain |
| 2341 | 4 | `n`: message number in this chain |

`AD = SHA-256("SMA/v1/ad" ‖ IK_initiator ‖ IK_responder)`

### 3.2 PreKeyMessage

```
PreKeyMessage = ct_spk(1120) ‖ ct_ikem(1120) ‖ [ct_otk(1120)] ‖ sealed_init(6605) ‖ RatchetMessage
```

`sealed_init = AES-256-GCM(hsk, nonce = 0¹², aad = ctx_pub, plaintext)`, plaintext (6589 B):

| Offset | Size | Field |
|-------:|-----:|-------|
| 0 | 1984 | `IK_A`: composite public key (Ed25519 32 ‖ ML-DSA-65 1952) |
| 1984 | 1216 | `IKEM_A`: X-Wing public key |
| 3200 | 8 | `ts_ms` |
| 3208 | 4 | `spk_id` |
| 3212 | 4 | `otk_id` (0xFFFFFFFF = none) |
| 3216 | 3373 | `sig = CompositeSign(IK_A, ctx_pub ‖ bytes[0..3216], "handshake")` |

Key schedule: 02 §3.3. The initiator prepends the same prefix to every message until the first reply arrives.

### 3.3 SealedBox (one-shot, sender-anonymous)

```
SealedBox = enc(1120) ‖ AES-256-GCM(key, base_nonce, aad = tag, padded Content)       // RFC 9180 SealBase
```

Suite `(0x647a, 0x0001, 0x0002)`, `info = "SMA/v1/sealed-box"` (or a purpose label from 02 §7).

### 3.4 SenderKeyMessage (groups, specified, not in reference)

| Field | Size |
|-------|------|
| sender header nonce | 12 |
| `AES-256-GCM(group_header_key, nonce, key_id u32 ‖ iteration u32 ‖ sender_device_id[16])` | 24 + 16 |
| body `AES-256-GCM(MSG_KEYS(mk_iteration), aad = tag ‖ sender_header, padded Content)` | n + 16 |
| `CompositeSign(sender_key_sig, tag ‖ sender_header ‖ body, "group-message")` | 3373 |

---

## 4. L3: Content

```proto
message Content {
  bytes  message_id     = 1;   // 16 random bytes: dedupe across redundant transports
  uint64 sent_at_ms     = 2;   // sender clock (display only)
  uint32 expire_after_s = 3;   // disappearing timer
  bytes  reply_to       = 4;
  bytes  group_id       = 5;   // 32 B for group traffic
  oneof body {
    Text text = 10;                       FileManifest file = 11;
    CallSignal call = 12;                 GroupKeyDistribution group_key = 13;
    Receipt receipt = 14;                 Reaction reaction = 15;
    Edit edit = 16;                       Delete delete = 17;
    Typing typing = 18;                   GroupControl group_control = 19;
    DeviceSync device_sync = 20;          PrekeyRefresh prekey_refresh = 21;
    PluginMessage plugin = 22;
  }
}
```

| Message type | Variant | Delivered via | Notes |
|--------------|---------|---------------|-------|
| Text | `Text{body, mentions}` | ratchet / sender key | |
| File / media | `FileManifest` | ratchet / sender key | Bytes live in blobs (§5) |
| Call signal | `CallSignal{call_id, type, sdp, candidates, media_key_seed, key_epoch, video, expires_at_ms}` | ratchet only (1:1 or per member) | 04 §2 |
| Group key distribution | `GroupKeyDistribution{group_id, epoch, key_id, iteration, chain_key, signing_key}` | **pairwise ratchet only** | 02 §6.2 |
| Group membership | `GroupControl{group_id, epoch, parent_hash, op}` inside a `SignedBlob` | pairwise ratchet | Hash-chained, admin-signed |
| Receipts, reactions, edits, deletes, typing | as named | ratchet / sender key | Receipts batch `message_ids` |
| Own-device sync | `DeviceSync` | own devices' sessions | 03 §5 |
| Key refresh | `PrekeyRefresh{SignedBlob bundle}` | ratchet | Carries key-history gossip |
| Plugin | `PluginMessage{plugin_id, schema_version, payload}` | ratchet / sender key | Opaque to the host app |

Public, signed objects (`PrekeyBundle`, `DeviceCertificate`, `OneTimePrekey`, `GroupControl`, `PluginManifest`) are always wrapped as `SignedBlob{body, signer, signature}`. **The signature covers the exact `body` bytes**, never a re-encoding, because protobuf serialisation is not canonical across implementations.

### 4.1 JSON (canonical proto3 JSON mapping)

For debugging, logs in test builds, and interop tests only. JSON never goes on the wire. Bytes are base64; `uint64` values are strings. These were produced by the reference implementation (`ContentType.toJSON()`).

**Text**

```json
{
  "messageId": "EREREREREREREREREREREQ==",
  "sentAtMs": "1793270400000",
  "expireAfterS": 604800,
  "text": { "body": "See you at 19:00 👋" }
}
```

**File**

```json
{
  "messageId": "IiIiIiIiIiIiIiIiIiIiIg==",
  "sentAtMs": "1793270460000",
  "file": {
    "mimeType": "video/mp4",
    "fileName": "clip.mp4",
    "size": "3145728",
    "fileKey": "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
    "noncePrefix": "u7u7u7u7u7s=",
    "chunkSize": 1048560,
    "chunks": [
      {
        "ciphertextSha256": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        "locators": [
          { "blossom": "https://blossom.example/0101…" },
          { "telegram": "bot:BQACAgEAAxkDAAIB…" }
        ]
      }
    ],
    "plaintextSha256": "zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw=",
    "width": 1280, "height": 720, "durationMs": 12000
  }
}
```

**Call signal**

```json
{
  "messageId": "MzMzMzMzMzMzMzMzMzMzMw==",
  "sentAtMs": "1793270520000",
  "call": {
    "callId": "RERERERERERERERERERERA==",
    "type": "OFFER",
    "sdp": "v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\n…a=fingerprint:sha-256 7B:8B:…\r\n",
    "mediaKeySeed": "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=",
    "video": true,
    "expiresAtMs": "1793270580000"
  }
}
```

**Group key distribution** (`signingKey` truncated; it is a 1984-byte composite key)

```json
{
  "messageId": "ZmZmZmZmZmZmZmZmZmZmZg==",
  "sentAtMs": "1793270580000",
  "groupId": "d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3c=",
  "groupKey": {
    "groupId": "d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3c=",
    "epoch": 3,
    "keyId": 1,
    "chainKey": "iIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIg=",
    "signingKey": "mZmZmZmZmZk…"
  }
}
```

**ContactCapsule** (what a QR code holds; ~100–150 bytes as protobuf)

```json
{
  "version": 1,
  "fingerprint": "JlWhsaAyioppkHtAqLvb+qxM8i6fFLFT11xztvj4MHA=",
  "capsuleKey": "q1x…32 bytes…=",
  "cardLocators": [ { "blossom": "https://blossom.example/9f2c…" }, { "ipfsCid": "bafkrei…" } ],
  "expiresAtMs": "1793875200000"
}
```

---

## 5. Files and media

Media never travels inside a message. It is chunked, encrypted under a per-file key, stored as blobs on any blob host, and referenced by a `FileManifest` that travels through the ratchet.

```
file_key     = 32 random bytes          nonce_prefix = 8 random bytes
chunk_size   = 1,048,560 B  (so each ciphertext is exactly 1 MiB = 1,048,576 B)
               files ≤ 1 MiB: one chunk padded up the frame bucket ladder instead
n            = max(1, ceil(size / chunk_size))
chunk_i      = file[i·cs .. (i+1)·cs], last chunk zero-padded to cs
nonce_i      = nonce_prefix ‖ u32be(i)
aad_i        = "SMA/v1/chunk" ‖ u32be(i) ‖ u8(i == n−1) ‖ u64be(size)
ct_i         = AES-256-GCM(file_key, nonce_i, aad_i, chunk_i)
BlobRef_i    = { ciphertext_sha256 = SHA-256(ct_i), locators = [≥ 2 hosts] }
```

- **Integrity and ordering.** The index in the nonce and AAD prevents reordering. The last-chunk flag prevents truncation, which is the STREAM construction's defence. `plaintext_sha256` is a final end-to-end check.
- **Uniform blobs.** Every chunk of a large file is exactly 1 MiB, so hosts learn a file's size only to 1 MiB granularity, and cannot tell the last chunk from the others.
- **Content addressing.** `ciphertext_sha256` doubles as the Blossom address and is verified on download, so a host cannot substitute a blob.
- **Limits.** 1 MiB chunks stay far below the Telegram Bot API's 20 MB download cap and fit IPFS block limits.
- **Thumbnails.** Up to 2 KiB inline in the manifest (blurred preview), so no blob fetch is needed before the user taps.

---

## 6. Versioning and evolution

| Layer | Mechanism |
|-------|-----------|
| L0 tag | Labels are versioned (`SMA/v1/tag`). A v2 tag derivation produces different tags, and receivers watch both during a migration window. No version byte on the wire. |
| L1 | `version` byte **inside** the encrypted ratchet header. Handshake versions are bound through labels in the transcript. |
| Crypto suite | Changing any primitive means new labels, `SMA/v2/...`. Suites are never negotiated in clear. |
| L3 protobuf | Standard proto3 rules: never reuse field numbers; unknown fields are ignored; new `oneof` members show as "unsupported message, update the app" on old clients. |
| Signed objects | `SignedBlob` plus a context label per type, so a signature over one type can never verify as another. |
