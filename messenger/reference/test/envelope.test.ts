import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from '../src/bytes.ts';
import {
  FRAME_BUCKETS,
  TAG_BYTES,
  armorFrame,
  bucketFor,
  dearmorFrame,
  decodeFrame,
  encodeFrame,
  epochOf,
  padToBucket,
  routingTag,
  unpad,
  watchTags,
} from '../src/envelope.ts';
import { decodeContent, encodeContent } from '../src/payload.ts';

describe('padding', () => {
  it('lands every total length on a bucket and round-trips', () => {
    for (const len of [0, 1, 100, 4096 - 64, 4096, 10_000, 200_000]) {
      const pt = new Uint8Array(len).fill(0xab);
      const padded = padToBucket(pt, 64);
      assert.ok(FRAME_BUCKETS.includes(padded.length + 64), `len ${len}`);
      assert.deepEqual(unpad(padded), pt);
    }
  });

  it('handles plaintexts that end in 0x80 / 0x00', () => {
    const pt = new Uint8Array([1, 0x80, 0, 0]);
    assert.deepEqual(unpad(padToBucket(pt, 16)), pt);
  });

  it('rejects malformed padding and oversized payloads', () => {
    assert.throws(() => unpad(new Uint8Array(10)), /bad padding/);
    assert.throws(() => bucketFor((1 << 20) + 1), /send as a file/);
  });
});

describe('frames and tags', () => {
  it('only accepts bucket-sized frames', () => {
    const tag = randomBytes(TAG_BYTES);
    const frame = encodeFrame({ tag, body: randomBytes(4096 - TAG_BYTES) });
    assert.deepEqual(decodeFrame(frame).tag, tag);
    assert.throws(() => encodeFrame({ tag, body: randomBytes(100) }), /not a bucket/);
    assert.throws(() => decodeFrame(randomBytes(5000)), /not a frame/);
  });

  it('rotates tags per epoch and separates keys', () => {
    const k = randomBytes(32);
    assert.deepEqual(routingTag(k, 10), routingTag(k, 10));
    assert.notDeepEqual(routingTag(k, 10), routingTag(k, 11));
    assert.notDeepEqual(routingTag(k, 10), routingTag(randomBytes(32), 10));
    const now = Date.UTC(2026, 9, 29, 12, 30);
    assert.equal(epochOf(now + 3600_000), epochOf(now) + 1);
    assert.equal(watchTags(k, now).length, 3);
  });

  it('armors to plain base64url without any marker', () => {
    const frame = encodeFrame({ tag: randomBytes(16), body: randomBytes(8192 - 16) });
    const text = armorFrame(frame);
    assert.match(text, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(dearmorFrame(text), frame);
  });
});

describe('Content protobuf', () => {
  it('round-trips text, files and call signals', () => {
    const t = decodeContent(encodeContent({ text: { body: 'olá 👋' }, expireAfterS: 3600 }));
    assert.equal(t.body, 'text');
    assert.deepEqual(t.text, { body: 'olá 👋' });

    const f = decodeContent(
      encodeContent({
        file: {
          mimeType: 'image/jpeg',
          size: 3_000_000,
          fileKey: randomBytes(32),
          noncePrefix: randomBytes(8),
          chunkSize: 1 << 20,
          chunks: [{ ciphertextSha256: randomBytes(32), locators: [{ ipfsCid: 'bafkrei...' }, { telegram: 'bot:BQAC' }] }],
        },
      }),
    );
    assert.equal(f.body, 'file');

    const c = decodeContent(
      encodeContent({ call: { callId: randomBytes(16), type: 'OFFER', sdp: 'v=0\r\n', mediaKeySeed: randomBytes(32), video: true } }),
    );
    assert.equal((c.call as { type: string }).type, 'OFFER');
  });

  it('rejects a Content without a 16-byte message id', () => {
    assert.throws(() => decodeContent(encodeContent({ messageId: randomBytes(4), text: { body: 'x' } })), /message_id/);
  });
});
