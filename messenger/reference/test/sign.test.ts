import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { concatBytes, randomBytes, utf8ToBytes } from '../src/bytes.ts';
import { COMPOSITE, compositeKeygen, compositeSign, compositeVerify, fingerprint, safetyNumber } from '../src/sign.ts';

const msg = utf8ToBytes('prekey bundle bytes');

describe('composite Ed25519 + ML-DSA-65', () => {
  const alice = compositeKeygen(randomBytes(32), randomBytes(32));
  const mallory = compositeKeygen(randomBytes(32), randomBytes(32));

  it('signs and verifies with the documented sizes', () => {
    const sig = compositeSign(alice, msg, 'prekey-bundle');
    assert.equal(alice.publicKey.length, COMPOSITE.publicKey);
    assert.equal(sig.length, COMPOSITE.signature);
    assert.ok(compositeVerify(alice.publicKey, msg, sig, 'prekey-bundle'));
  });

  it('binds the context label', () => {
    const sig = compositeSign(alice, msg, 'prekey-bundle');
    assert.ok(!compositeVerify(alice.publicKey, msg, sig, 'handshake'));
  });

  it('fails if either component is invalid', () => {
    const sig = compositeSign(alice, msg, 'ctx');
    const other = compositeSign(mallory, msg, 'ctx');
    const edFromMallory = concatBytes(other.subarray(0, 64), sig.subarray(64));
    const pqFromMallory = concatBytes(sig.subarray(0, 64), other.subarray(64));
    assert.ok(!compositeVerify(alice.publicKey, msg, edFromMallory, 'ctx'));
    assert.ok(!compositeVerify(alice.publicKey, msg, pqFromMallory, 'ctx'));
    assert.ok(!compositeVerify(alice.publicKey, utf8ToBytes('other'), sig, 'ctx'));
    assert.ok(!compositeVerify(alice.publicKey, msg, sig.subarray(1), 'ctx'));
  });

  it('safety numbers are order-independent and differ per pair', () => {
    const a = fingerprint(alice.publicKey);
    const m = fingerprint(mallory.publicKey);
    const n = safetyNumber(a, m);
    assert.equal(n, safetyNumber(m, a));
    assert.match(n, /^(\d{5} ){11}\d{5}$/);
    assert.notEqual(n, safetyNumber(a, fingerprint(compositeKeygen(randomBytes(32), randomBytes(32)).publicKey)));
  });
});
