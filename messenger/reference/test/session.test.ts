import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, toHex } from '../src/bytes.ts';
import { FRAME_BUCKETS, decodeFrame } from '../src/envelope.ts';
import { verifyPrekeyBundle } from '../src/handshake.ts';
import { decodeContent, encodeContent } from '../src/payload.ts';
import { type ContactInfo, Endpoint } from '../src/session.ts';

const NOW = Date.UTC(2026, 9, 29, 12, 0);

function contactOf(e: Endpoint): ContactInfo {
  // In the app this arrives via QR capsule → encrypted ContactCard fetched from a transport.
  return {
    fingerprint: e.identity.fingerprint,
    inboxTagKey: e.inboxTagKey,
    bundle: verifyPrekeyBundle(e.publishBundle(NOW), e.identity.fingerprint, NOW),
  };
}

const text = (s: string) => encodeContent({ text: { body: s } });
const read = (pt: Uint8Array) => (decodeContent(pt).text as { body: string }).body;

describe('Endpoint (handshake + ratchet + frames)', () => {
  it('runs a full conversation and switches from inbox to session tags', () => {
    const alice = new Endpoint(randomBytes(64), NOW);
    const bob = new Endpoint(randomBytes(64), NOW);
    const bobCard = contactOf(bob);
    const aliceCard = contactOf(alice);

    const f1 = alice.send(bobCard, text('hi bob'), NOW);
    const f2 = alice.send(bobCard, text('are you there?'), NOW); // still a prekey message
    const r1 = bob.receive(f1, NOW)!;
    assert.equal(r1.from, alice.fingerprintHex);
    assert.equal(r1.newSession, true);
    assert.equal(read(r1.plaintext), 'hi bob');
    assert.equal(read(bob.receive(f2, NOW)!.plaintext), 'are you there?');

    const reply = bob.send(aliceCard, text('hey alice'), NOW);
    assert.equal(read(alice.receive(reply, NOW)!.plaintext), 'hey alice');

    const f3 = alice.send(bobCard, text('great'), NOW);
    assert.notDeepEqual(decodeFrame(f3).tag, decodeFrame(f1).tag, 'session tag replaces inbox tag');
    assert.ok(f3.length < f1.length, 'no more prekey prefix');
    assert.equal(read(bob.receive(f3, NOW)!.plaintext), 'great');
  });

  it('produces bucket-sized frames and rotating tags', () => {
    const alice = new Endpoint(randomBytes(64), NOW);
    const bob = new Endpoint(randomBytes(64), NOW);
    const card = contactOf(bob);
    bob.receive(alice.send(card, text('x'), NOW), NOW);
    alice.receive(bob.send(contactOf(alice), text('y'), NOW), NOW);

    const a = alice.send(card, text('short'), NOW);
    const b = alice.send(card, encodeContent({ text: { body: 'z'.repeat(5000) } }), NOW);
    const later = alice.send(card, text('later'), NOW + 2 * 3600_000);
    for (const f of [a, b, later]) assert.ok(FRAME_BUCKETS.includes(f.length));
    assert.equal(a.length, 4096);
    assert.equal(b.length, 8192);
    assert.deepEqual(decodeFrame(a).tag, decodeFrame(b).tag);
    assert.notDeepEqual(decodeFrame(a).tag, decodeFrame(later).tag);
    assert.equal(read(bob.receive(later, NOW + 2 * 3600_000)!.plaintext), 'later');
  });

  it('ignores frames for other users and rejects replayed first messages', () => {
    const alice = new Endpoint(randomBytes(64), NOW);
    const bob = new Endpoint(randomBytes(64), NOW);
    const carol = new Endpoint(randomBytes(64), NOW);
    const f1 = alice.send(contactOf(bob), text('for bob'), NOW);
    assert.equal(carol.receive(f1, NOW), null);
    bob.receive(f1, NOW);
    assert.throws(() => bob.receive(f1, NOW));
  });

  it('carries call signalling like any other content', () => {
    const alice = new Endpoint(randomBytes(64), NOW);
    const bob = new Endpoint(randomBytes(64), NOW);
    const callId = randomBytes(16);
    const offer = encodeContent({
      call: { callId, type: 'OFFER', sdp: 'v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\n', mediaKeySeed: randomBytes(32), video: true },
    });
    const got = decodeContent(bob.receive(alice.send(contactOf(bob), offer, NOW), NOW)!.plaintext);
    assert.equal(got.body, 'call');
    assert.equal(toHex((got.call as { callId: Uint8Array }).callId), toHex(callId));
  });

  it('restores the same identity from the recovery phrase', () => {
    const phrase = `${'abandon '.repeat(23)}art`;
    assert.equal(Endpoint.fromRecoveryPhrase(phrase).fingerprintHex, Endpoint.fromRecoveryPhrase(phrase).fingerprintHex);
  });
});
