import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromBase64Url, randomBytes, toBase64Url } from '../src/bytes.ts';
import {
  cardContent,
  cardFromContent,
  createContactCard,
  decodeCapsule,
  encodeCapsule,
  openCard,
  parseContactCard,
  sanitizeName,
  sanitizeRelays,
  sealCard,
} from '../src/contact.ts';
import { decodeContent, encodeContent } from '../src/payload.ts';
import { Endpoint } from '../src/session.ts';

const NOW = Date.UTC(2026, 9, 29, 12, 0);
const RELAYS = ['wss://relay.example', 'wss://nos.example'];
const text = (s: string) => encodeContent({ text: { body: s } });
const read = (pt: Uint8Array) => (decodeContent(pt).text as { body: string }).body;

describe('portable base64url', () => {
  it('matches Node Buffer for every length and rejects garbage', () => {
    for (let n = 0; n < 70; n++) {
      const b = randomBytes(n);
      const s = toBase64Url(b);
      assert.equal(s, Buffer.from(b).toString('base64url'));
      assert.deepEqual(fromBase64Url(s), b);
    }
    const big = new Uint8Array(200_000).fill(7);
    assert.deepEqual(fromBase64Url(toBase64Url(big)), big);
    assert.throws(() => fromBase64Url('ab+c'));
    assert.throws(() => fromBase64Url('a'));
  });
});

describe('generated schema', () => {
  it('is in sync with proto/sma.proto (run npm run gen:schema)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sma-schema-'));
    try {
      execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/gen-schema.mjs', import.meta.url)), dir], { stdio: 'ignore' });
      for (const f of ['schema.static.js', 'schema.static.d.ts']) {
        assert.equal(readFileSync(join(dir, f), 'utf8'), readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), f);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('contact cards and capsules', () => {
  it('round-trips a card, pinned and trust-on-first-use', () => {
    const bob = new Endpoint(randomBytes(64), NOW);
    const card = createContactCard(bob, 'Bob', RELAYS, NOW);
    const tofu = parseContactCard(card, { nowMs: NOW });
    assert.equal(tofu.displayName, 'Bob');
    assert.deepEqual(tofu.relays, RELAYS);
    assert.deepEqual(tofu.contact.fingerprint, bob.identity.fingerprint);
    assert.deepEqual(tofu.contact.inboxTagKey, bob.inboxTagKey);
    parseContactCard(card, { expectedFingerprint: bob.identity.fingerprint, nowMs: NOW });
    assert.throws(() => parseContactCard(card, { expectedFingerprint: randomBytes(32), nowMs: NOW }), /pinned fingerprint/);
  });

  it('seals the card under the capsule key and finds it via the capsule', () => {
    const bob = new Endpoint(randomBytes(64), NOW);
    const key = randomBytes(32);
    const capsule = decodeCapsule(encodeCapsule(bob.identity.fingerprint, key, RELAYS));
    assert.deepEqual(capsule.relays, RELAYS);
    const sealed = sealCard(key, createContactCard(bob, 'Bob', RELAYS, NOW));
    const card = parseContactCard(openCard(capsule.capsuleKey, sealed), { expectedFingerprint: capsule.fingerprint, nowMs: NOW });
    assert.equal(card.displayName, 'Bob');
    const tampered = sealed.slice();
    tampered[40]! ^= 1;
    assert.throws(() => openCard(key, tampered));
    assert.ok(encodeCapsule(bob.identity.fingerprint, key, RELAYS).length < 200, 'fits a QR code');
  });

  it('a stranger cannot pass off a card for a pinned identity', () => {
    const bob = new Endpoint(randomBytes(64), NOW);
    const mallory = new Endpoint(randomBytes(64), NOW);
    const card = createContactCard(mallory, 'Bob', RELAYS, NOW);
    assert.throws(() => parseContactCard(card, { expectedFingerprint: bob.identity.fingerprint, nowMs: NOW }));
  });

  it('sanitises relays and names', () => {
    assert.deepEqual(
      sanitizeRelays(['wss://a.example/', 'http://b.example', 'ws://c.example', 'ws://localhost:7000', 'wss://a.example', 42, 'nope']),
      ['wss://a.example', 'ws://localhost:7000'],
    );
    assert.equal(sanitizeName('  Al‮ice\u0007  '), 'Alice');
    assert.equal(sanitizeName('x'.repeat(100)).length, 64);
  });
});

describe('Endpoint persistence and replies', () => {
  it('survives serialisation at every stage of a conversation', () => {
    let alice = new Endpoint(randomBytes(64), NOW);
    let bob = new Endpoint(randomBytes(64), NOW);
    const bobCard = parseContactCard(createContactCard(bob, 'Bob', RELAYS, NOW), { nowMs: NOW });

    const f1 = alice.send(bobCard.contact, text('one'), NOW);
    const f2 = alice.send(bobCard.contact, text('two (delayed)'), NOW);
    alice = Endpoint.deserialize(alice.serialize()); // pending prekey prefix survives
    assert.ok(alice.awaitingReply(bob.fingerprintHex));

    const r1 = bob.receive(f1, NOW)!;
    assert.equal(read(r1.plaintext), 'one');
    bob = Endpoint.deserialize(bob.serialize()); // replay cache + session survive

    const reply = bob.sendTo(r1.from, text('hi alice'), NOW); // no card needed to answer
    assert.equal(read(alice.receive(reply, NOW)!.plaintext), 'hi alice');
    assert.ok(!alice.awaitingReply(bob.fingerprintHex));
    assert.equal(read(bob.receive(f2, NOW)!.plaintext), 'two (delayed)');
    assert.throws(() => bob.receive(f1, NOW), 'replay still rejected after restore');

    alice = Endpoint.deserialize(alice.serialize());
    assert.equal(read(bob.receive(alice.sendTo(bob.fingerprintHex, text('after restore'), NOW), NOW)!.plaintext), 'after restore');
    assert.equal(alice.fingerprintHex, Endpoint.deserialize(alice.serialize()).fingerprintHex);
  });

  it('catches up on frames from past epochs only when asked to', () => {
    const alice = new Endpoint(randomBytes(64), NOW);
    const bob = new Endpoint(randomBytes(64), NOW);
    const bobCard = parseContactCard(createContactCard(bob, 'Bob', RELAYS, NOW), { nowMs: NOW });
    const f = alice.send(bobCard.contact, text('sent while bob was offline'), NOW);
    const later = NOW + 30 * 3600_000;
    assert.equal(bob.receive(f, later), null, 'outside the live window');
    assert.equal(read(bob.receive(f, later, 48)!.plaintext), 'sent while bob was offline');
  });

  it('carries the sender contact card as Content and keeps the signature valid', () => {
    const alice = new Endpoint(randomBytes(64), NOW);
    const content = decodeContent(cardContent(createContactCard(alice, 'Alice', RELAYS, NOW)));
    const parsed = parseContactCard(cardFromContent(content), { expectedFingerprint: alice.identity.fingerprint, nowMs: NOW });
    assert.equal(parsed.displayName, 'Alice');
    assert.throws(() => cardFromContent(decodeContent(text('x'))), /not a contact card/);
  });
});
