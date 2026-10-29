import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Aes256Gcm, CipherSuite, HkdfSha256 } from '@hpke/core';
import { XWing } from '@hpke/hybridkem-x-wing';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { sha3_256, shake256 } from '@noble/hashes/sha3.js';
import { bytesToUtf8, concatBytes, randomBytes, utf8ToBytes } from '../src/bytes.ts';
import { XWING, hpkeOpen, hpkeSeal, openBox, sealBox, xwingEncapsulate, xwingKeygen } from '../src/hpke.ts';

const info = utf8ToBytes('SMA/v1/test');
const aad = utf8ToBytes('frame-tag');

describe('X-Wing', () => {
  it('has the sizes from draft-connolly-cfrg-xwing-kem', () => {
    const kp = xwingKeygen();
    const { cipherText, sharedSecret } = xwingEncapsulate(kp.publicKey);
    assert.equal(kp.publicKey.length, XWING.publicKey);
    assert.equal(kp.secretKey.length, XWING.secretKey);
    assert.equal(cipherText.length, XWING.cipherText);
    assert.equal(sharedSecret.length, 32);
  });

  it('is exactly the spec construction over ML-KEM-768 and X25519', () => {
    const seed = randomBytes(32);
    const kp = xwingKeygen(seed);
    // Spec: expanded = SHAKE256(seed, 96); ML-KEM keygen(d‖z = expanded[0..64]); sk_X = expanded[64..96]
    const expanded = shake256(seed, { dkLen: 96 });
    const mlkem = ml_kem768.keygen(expanded.subarray(0, 64));
    const skX = expanded.subarray(64, 96);
    const pkX = x25519.getPublicKey(skX);
    assert.deepEqual(kp.publicKey, concatBytes(mlkem.publicKey, pkX));

    const { cipherText, sharedSecret } = xwingEncapsulate(kp.publicKey);
    const ctM = cipherText.subarray(0, 1088);
    const ctX = cipherText.subarray(1088);
    const ssM = ml_kem768.decapsulate(ctM, mlkem.secretKey);
    const ssX = x25519.getSharedSecret(skX, ctX);
    const label = new Uint8Array([0x5c, 0x2e, 0x2f, 0x2f, 0x5e, 0x5c]); // "\.//^\"
    assert.deepEqual(sharedSecret, sha3_256(concatBytes(ssM, ssX, ctX, pkX, label)));
  });
});

describe('HPKE base mode (X-Wing, HKDF-SHA256, AES-256-GCM)', () => {
  it('round-trips', () => {
    const kp = xwingKeygen();
    const sealed = hpkeSeal(kp.publicKey, utf8ToBytes('quantum-safe hello'), info, aad);
    assert.equal(bytesToUtf8(hpkeOpen(kp.secretKey, sealed, info, aad)), 'quantum-safe hello');
  });

  it('rejects tampering with enc, ct, info or aad, and the wrong key', () => {
    const kp = xwingKeygen();
    const sealed = hpkeSeal(kp.publicKey, utf8ToBytes('x'), info, aad);
    const flip = (b: Uint8Array, i: number) => {
      const c = b.slice();
      c[i]! ^= 1;
      return c;
    };
    assert.throws(() => hpkeOpen(kp.secretKey, { ...sealed, enc: flip(sealed.enc, 5) }, info, aad));
    assert.throws(() => hpkeOpen(kp.secretKey, { ...sealed, enc: flip(sealed.enc, 1100) }, info, aad)); // X25519 part
    assert.throws(() => hpkeOpen(kp.secretKey, { ...sealed, ct: flip(sealed.ct, 0) }, info, aad));
    assert.throws(() => hpkeOpen(kp.secretKey, sealed, utf8ToBytes('other'), aad));
    assert.throws(() => hpkeOpen(kp.secretKey, sealed, info, utf8ToBytes('other')));
    assert.throws(() => hpkeOpen(xwingKeygen().secretKey, sealed, info, aad));
  });

  it('interoperates with hpke-js: we seal, it opens', async () => {
    const seed = randomBytes(32);
    const kp = xwingKeygen(seed);
    const suite = new CipherSuite({ kem: new XWing(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
    const theirs = await new XWing().generateKeyPairDerand(seed);
    assert.deepEqual(new Uint8Array(await suite.kem.serializePublicKey(theirs.publicKey)), kp.publicKey);

    const sealed = hpkeSeal(kp.publicKey, utf8ToBytes('from noble'), info, aad);
    const ctx = await suite.createRecipientContext({ recipientKey: theirs.privateKey, enc: sealed.enc, info });
    assert.equal(bytesToUtf8(new Uint8Array(await ctx.open(sealed.ct, aad))), 'from noble');
  });

  it('interoperates with hpke-js: it seals, we open', async () => {
    const kp = xwingKeygen();
    const suite = new CipherSuite({ kem: new XWing(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
    const sender = await suite.createSenderContext({
      recipientPublicKey: await suite.kem.deserializePublicKey(kp.publicKey),
      info,
    });
    const ct = new Uint8Array(await sender.seal(utf8ToBytes('from hpke-js'), aad));
    const opened = hpkeOpen(kp.secretKey, { enc: new Uint8Array(sender.enc), ct }, info, aad);
    assert.equal(bytesToUtf8(opened), 'from hpke-js');
  });

  it('sealBox concatenates enc ‖ ct', () => {
    const kp = xwingKeygen();
    const box = sealBox(kp.publicKey, utf8ToBytes('boxed'), info);
    assert.equal(box.length, XWING.cipherText + 5 + 16);
    assert.equal(bytesToUtf8(openBox(kp.secretKey, box, info)), 'boxed');
  });
});
