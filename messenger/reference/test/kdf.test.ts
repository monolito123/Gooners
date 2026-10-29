import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { argon2id } from '@noble/hashes/argon2.js';
import { fromHex, toHex } from '../src/bytes.ts';
import {
  ARGON2,
  KEY_LABELS,
  deriveKeyFromPassphrase,
  deriveRootKey,
  deriveSubkey,
  generateRecoveryPhrase,
  openVault,
  recoveryPhraseToSeed,
  sealVault,
} from '../src/kdf.ts';
import { identityFromRootKey } from '../src/handshake.ts';

const ZERO_PHRASE = `${'abandon '.repeat(23)}art`;

describe('Argon2id', () => {
  it('matches the RFC 9106 §5.3 Argon2id test vector', () => {
    const tag = argon2id(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), {
      t: 3,
      m: 32,
      p: 4,
      key: new Uint8Array(8).fill(3),
      personalization: new Uint8Array(12).fill(4),
      dkLen: 32,
    });
    assert.equal(toHex(tag), '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
  });

  it('is deterministic, salt- and purpose-separated', async () => {
    const salt = new Uint8Array(16).fill(7);
    const a = await deriveKeyFromPassphrase('correct horse battery staple', salt, ARGON2.insecureTest);
    const b = await deriveKeyFromPassphrase('correct horse battery staple', salt, ARGON2.insecureTest);
    const c = await deriveKeyFromPassphrase('correct horse battery staple', new Uint8Array(16).fill(8), ARGON2.insecureTest);
    const d = await deriveKeyFromPassphrase('correct horse battery staple', salt, ARGON2.insecureTest, 'backup');
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.notDeepEqual(a, d);
    assert.equal(a.length, 32);
  });

  it('normalises Unicode (NFKC) so every keyboard yields the same key', async () => {
    const salt = new Uint8Array(16);
    const composed = await deriveKeyFromPassphrase('café', salt, ARGON2.insecureTest);
    const decomposed = await deriveKeyFromPassphrase('café', salt, ARGON2.insecureTest);
    assert.deepEqual(composed, decomposed);
  });

  it('rejects short salts and out-of-range parameters', async () => {
    await assert.rejects(deriveKeyFromPassphrase('pw', new Uint8Array(8), ARGON2.insecureTest), /salt/);
    await assert.rejects(deriveKeyFromPassphrase('pw', new Uint8Array(16), { t: 1, m: 64, p: 1 }), /parameter m/);
    await assert.rejects(deriveKeyFromPassphrase('pw', new Uint8Array(16), { t: 1, m: 2 * 1024 * 1024, p: 1 }), /parameter m/);
  });
});

describe('recovery phrase', () => {
  it('generates 24 valid words', () => {
    const phrase = generateRecoveryPhrase();
    assert.equal(phrase.split(' ').length, 24);
    assert.equal(recoveryPhraseToSeed(phrase).length, 64);
  });

  it('matches the BIP-39 reference vector (all-zero entropy, passphrase "TREZOR")', () => {
    assert.equal(
      toHex(recoveryPhraseToSeed(ZERO_PHRASE, 'TREZOR')),
      'bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8',
    );
  });

  it('rejects bad checksums and 12-word phrases', () => {
    assert.throws(() => recoveryPhraseToSeed(`${'abandon '.repeat(23)}abandon`), /checksum/);
    assert.throws(() => recoveryPhraseToSeed(`${'abandon '.repeat(11)}about`), /24 words/);
  });

  it('tolerates extra whitespace', () => {
    assert.deepEqual(recoveryPhraseToSeed(`  ${ZERO_PHRASE.replace(/ /g, '   ')}\n`), recoveryPhraseToSeed(ZERO_PHRASE));
  });
});

describe('key hierarchy', () => {
  const root = deriveRootKey(recoveryPhraseToSeed(ZERO_PHRASE));

  it('derives distinct 32-byte keys per label', () => {
    const keys = Object.values(KEY_LABELS).map((l) => toHex(deriveSubkey(root, l)));
    assert.equal(new Set(keys).size, keys.length);
  });

  it('restores the same identity from the same phrase', () => {
    const a = identityFromRootKey(root);
    const b = identityFromRootKey(deriveRootKey(recoveryPhraseToSeed(ZERO_PHRASE)));
    assert.deepEqual(a.signing.publicKey, b.signing.publicKey);
    assert.deepEqual(a.kem.publicKey, b.kem.publicKey);
    assert.deepEqual(a.fingerprint, b.fingerprint);
  });

  it('gives a different identity for a different BIP-39 passphrase', () => {
    const hidden = identityFromRootKey(deriveRootKey(recoveryPhraseToSeed(ZERO_PHRASE, 'duress')));
    assert.notDeepEqual(hidden.fingerprint, identityFromRootKey(root).fingerprint);
  });
});

describe('vault', () => {
  const secret = fromHex('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');

  it('round-trips and rejects a wrong passphrase', async () => {
    const blob = await sealVault(secret, 'hunter2 but longer', ARGON2.insecureTest);
    assert.deepEqual(await openVault(blob, 'hunter2 but longer'), secret);
    await assert.rejects(openVault(blob, 'hunter3 but longer'), /wrong passphrase/);
  });

  it('authenticates the header: downgrading the cost parameters breaks it', async () => {
    const blob = await sealVault(secret, 'pw-pw-pw-pw', { t: 2, m: 8 * 1024, p: 1 });
    const tampered = blob.slice();
    tampered[4] = 1; // t: 2 → 1
    await assert.rejects(openVault(tampered, 'pw-pw-pw-pw'), /wrong passphrase or corrupted/);
  });
});
