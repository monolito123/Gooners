/**
 * Module 1 / Example 3: the L0 transport frame, the only thing a host ever stores.
 *
 *   frame = routing_tag[16] ‖ body          len(frame) ∈ FRAME_BUCKETS
 *
 * Properties a host (Telegram, a Nostr relay, an IPFS node) can observe:
 *   - a 16-byte tag that is a PRF output, rotating every epoch (default 1 h), unlinkable
 *     across epochs and across conversations without the tag key;
 *   - a length from a small fixed set (padding happens inside the AEAD);
 *   - no version byte, magic number, type field, key id or protobuf field keys.
 * The recipient learns what the body is (prekey message, ratchet message, sealed box)
 * from which of its tag tables the tag hits, so nothing about the type is on the wire.
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, fromBase64Url, toBase64Url, toHex, u64be, utf8ToBytes } from './bytes.ts';

export const TAG_BYTES = 16;

/** Powers of two from 4 KiB to 1 MiB. Anything larger is a file: chunked into blobs. */
export const FRAME_BUCKETS: readonly number[] = Object.freeze(
  Array.from({ length: 9 }, (_, i) => 4096 << i),
);
export const MAX_FRAME = FRAME_BUCKETS[FRAME_BUCKETS.length - 1]!;

// ─── Padding (inside the AEAD) ──────────────────────────────────────────────────

/** Smallest bucket that fits `minLength` bytes. */
export function bucketFor(minLength: number): number {
  const b = FRAME_BUCKETS.find((size) => size >= minLength);
  if (b === undefined) throw new RangeError(`payload too large for a frame (${minLength} > ${MAX_FRAME}); send as a file`);
  return b;
}

/**
 * ISO/IEC 7816-4 padding: plaintext ‖ 0x80 ‖ 0x00…, sized so that
 * `overhead + padded.length` is exactly a bucket. `overhead` is every byte the
 * encryption layers add around the plaintext (tag, headers, AEAD tags).
 */
export function padToBucket(plaintext: Uint8Array, overhead: number): Uint8Array {
  const total = bucketFor(overhead + plaintext.length + 1);
  const out = new Uint8Array(total - overhead);
  out.set(plaintext);
  out[plaintext.length] = 0x80;
  return out;
}

export function unpad(padded: Uint8Array): Uint8Array {
  let i = padded.length - 1;
  while (i >= 0 && padded[i] === 0x00) i--;
  if (i < 0 || padded[i] !== 0x80) throw new Error('bad padding');
  return padded.subarray(0, i);
}

// ─── Routing tags ───────────────────────────────────────────────────────────────

export const EPOCH_SECONDS = 3600;

export function epochOf(nowMs: number, epochSeconds = EPOCH_SECONDS): number {
  return Math.floor(nowMs / 1000 / epochSeconds);
}

/** tag = HMAC-SHA256(tagKey, "SMA/v1/tag" ‖ u64(epoch))[0..16] */
export function routingTag(tagKey: Uint8Array, epoch: number): Uint8Array {
  return hmac(sha256, tagKey, concatBytes(utf8ToBytes('SMA/v1/tag'), u64be(epoch))).subarray(0, TAG_BYTES);
}

/** Tags a receiver must watch: previous, current and next epoch (clock skew, delays). */
export function watchTags(tagKey: Uint8Array, nowMs: number, epochSeconds = EPOCH_SECONDS): string[] {
  const e = epochOf(nowMs, epochSeconds);
  return [e - 1, e, e + 1].map((x) => toHex(routingTag(tagKey, x)));
}

// ─── Frame ──────────────────────────────────────────────────────────────────────

export interface Frame {
  tag: Uint8Array;
  body: Uint8Array;
}

export function encodeFrame({ tag, body }: Frame): Uint8Array {
  if (tag.length !== TAG_BYTES) throw new RangeError('tag must be 16 bytes');
  const frame = concatBytes(tag, body);
  if (!FRAME_BUCKETS.includes(frame.length)) throw new Error(`frame length ${frame.length} is not a bucket size; pad first`);
  return frame;
}

export function decodeFrame(frame: Uint8Array): Frame {
  if (!FRAME_BUCKETS.includes(frame.length)) throw new Error(`not a frame: length ${frame.length}`);
  return { tag: frame.subarray(0, TAG_BYTES), body: frame.subarray(TAG_BYTES) };
}

/**
 * Text armor for transports that only carry strings (Nostr `content`, Matrix `body`,
 * Telegram captions/messages). Plain base64url: no prefix, so the armored form carries
 * no more structure than the binary one.
 */
export function armorFrame(frame: Uint8Array): string {
  return toBase64Url(frame);
}

export function dearmorFrame(text: string): Uint8Array {
  const frame = fromBase64Url(text.trim());
  decodeFrame(frame); // throws unless the length is a bucket size
  return frame;
}
