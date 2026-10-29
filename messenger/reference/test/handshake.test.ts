import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToUtf8, concatBytes, randomBytes, utf8ToBytes } from '../src/bytes.ts';
import { decodeMessage, encodeMessage } from '../src/payload.ts';
import { ratchetDecrypt, ratchetEncrypt } from '../src/ratchet.ts';
import { xwingKeygen } from '../src/hpke.ts';
import { compositeKeygen } from '../src/sign.ts';
import {
  type Identity,
  SIGNED_PREKEY_LIFETIME_MS,
  createPrekeyBundle,
  generateSignedPrekey,
  identityFromRootKey,
  initiate,
  prekeyPrefixLength,
  respond,
  verifyPrekeyBundle,
} from '../src/handshake.ts';

const NOW = Date.UTC(2026, 9, 29, 12, 0);
const DAY = 24 * 3600 * 1000;
const newIdentity = (): Identity => identityFromRootKey(randomBytes(64));

function setup() {
  const alice = newIdentity();
  const bob = newIdentity();
  const spk = generateSignedPrekey(1, NOW);
  const bundle = verifyPrekeyBundle(createPrekeyBundle(bob, spk, NOW), bob.fingerprint, NOW);
  return { alice, bob, spk, bundle };
}

/** First message: prefix ‖ ratchet message; returns what Bob decrypts. */
function firstMessage(alice: Identity, bundle: ReturnType<typeof setup>['bundle'], text: string, opts: Parameters<typeof initiate>[2] = {}) {
  const hs = initiate(alice, bundle, { nowMs: NOW, ...opts });
  const { message } = ratchetEncrypt(hs.ratchet, utf8ToBytes(text), hs.ad);
  return { hs, body: concatBytes(hs.prekeyPrefix, message) };
}

describe('prekey bundle', () => {
  it('verifies and pins the identity fingerprint', () => {
    const { bob, spk } = setup();
    const bytes = createPrekeyBundle(bob, spk, NOW);
    assert.equal(verifyPrekeyBundle(bytes, bob.fingerprint, NOW).signedPrekey.id, 1);
    assert.throws(() => verifyPrekeyBundle(bytes, newIdentity().fingerprint, NOW), /pinned fingerprint/);
  });

  it('rejects a bundle whose prekey was swapped by the host', () => {
    const { bob, spk } = setup();
    const blob = decodeMessage('SignedBlob', createPrekeyBundle(bob, spk, NOW));
    const body = decodeMessage('PrekeyBundle', blob.body as Uint8Array) as Record<string, any>;
    body.signedPrekey.publicKey = xwingKeygen().publicKey;
    const forged = encodeMessage('SignedBlob', { ...blob, body: encodeMessage('PrekeyBundle', body) });
    assert.throws(() => verifyPrekeyBundle(forged, bob.fingerprint, NOW), /bad bundle signature/);
  });

  it('rejects an expired signed prekey', () => {
    const { bob, spk } = setup();
    const bytes = createPrekeyBundle(bob, spk, NOW);
    assert.throws(() => verifyPrekeyBundle(bytes, bob.fingerprint, NOW + 2 * SIGNED_PREKEY_LIFETIME_MS), /expired/);
  });
});

describe('handshake', () => {
  it('establishes matching sessions and authenticates the initiator', () => {
    const { alice, bob, spk, bundle } = setup();
    const { hs, body } = firstMessage(alice, bundle, 'hi bob');
    const res = respond(bob, [spk], body, { nowMs: NOW });
    assert.deepEqual(res.peerFingerprint, alice.fingerprint);
    assert.deepEqual(res.ad, hs.ad);
    assert.equal(res.handshakeId, hs.handshakeId);
    assert.deepEqual(res.tagKeyInitiatorToResponder, hs.tagKeyInitiatorToResponder);
    assert.equal(bytesToUtf8(ratchetDecrypt(res.ratchet, res.ratchetMessage, res.ad).plaintext), 'hi bob');
    assert.equal(hs.prekeyPrefix.length, prekeyPrefixLength(false));
  });

  it('never puts the initiator identity on the wire in clear', () => {
    const { alice, bundle } = setup();
    const { body } = firstMessage(alice, bundle, 'x');
    assert.equal(Buffer.from(body).indexOf(Buffer.from(alice.signing.publicKey.subarray(0, 32))), -1);
  });

  it('works with a one-time prekey from an invite', () => {
    const { alice, bob, spk, bundle } = setup();
    const otk = { id: 42, keyPair: xwingKeygen() };
    const { body } = firstMessage(alice, bundle, 'via invite', { oneTimePrekey: { id: 42, publicKey: otk.keyPair.publicKey } });
    const res = respond(bob, [spk], body, { nowMs: NOW, oneTimePrekey: otk });
    assert.equal(bytesToUtf8(ratchetDecrypt(res.ratchet, res.ratchetMessage, res.ad).plaintext), 'via invite');
    assert.throws(() => respond(bob, [spk], body, { nowMs: NOW, oneTimePrekey: { id: 42, keyPair: xwingKeygen() } }));
  });

  it('finds the right signed prekey after rotation (no key id on the wire)', () => {
    const { alice, bob, spk, bundle } = setup();
    const { body } = firstMessage(alice, bundle, 'old bundle');
    const res = respond(bob, [generateSignedPrekey(2, NOW), spk], body, { nowMs: NOW });
    assert.equal(res.usedSignedPrekeyId, 1);
  });

  it('rejects the wrong recipient, tampering, and stale handshakes', () => {
    const { alice, bob, spk, bundle } = setup();
    const { body } = firstMessage(alice, bundle, 'x');
    assert.throws(() => respond(newIdentity(), [spk], body, { nowMs: NOW }), /no signed prekey opens/);
    const t = body.slice();
    t[2 * 1120 + 100]! ^= 1; // inside sealed_init
    assert.throws(() => respond(bob, [spk], t, { nowMs: NOW }), /no signed prekey opens/);
    // SPK past lifetime + grace: it is no longer even tried.
    assert.throws(() => respond(bob, [spk], body, { nowMs: NOW + 15 * DAY }), /no signed prekey opens/);
  });

  it('rejects handshake timestamps outside the prekey window or in the future', () => {
    const { alice, bob, spk, bundle } = setup();
    const stale = firstMessage(alice, bundle, 'x', { nowMs: NOW - 20 * DAY }).body;
    assert.throws(() => respond(bob, [spk], stale, { nowMs: NOW }), /timestamp out of range/);
    const future = firstMessage(alice, bundle, 'x', { nowMs: NOW + 3600_000 }).body;
    assert.throws(() => respond(bob, [spk], future, { nowMs: NOW }), /timestamp out of range/);
  });

  it('rejects an impersonation: claims Alice, cannot sign as Alice', () => {
    const { alice, bob, spk, bundle } = setup();
    const mallory = compositeKeygen(randomBytes(32), randomBytes(32));
    const fakeAlice: Identity = { ...alice, signing: { ...mallory, publicKey: alice.signing.publicKey } };
    const { body } = firstMessage(fakeAlice, bundle, 'it is me, alice');
    assert.throws(() => respond(bob, [spk], body, { nowMs: NOW }), /bad initiator signature/);
  });
});
