/**
 * Module 2 / Example 2: hybrid post-quantum public-key encryption.
 *
 * HPKE (RFC 9180) base mode with:
 *   KEM  = X-Wing (ML-KEM-768 + X25519, draft-connolly-cfrg-xwing-kem), KEM id 0x647a
 *   KDF  = HKDF-SHA256                                              KDF id 0x0001
 *   AEAD = AES-256-GCM                                              AEAD id 0x0002
 *
 * X-Wing's shared secret is SHA3-256(ss_MLKEM ‖ ss_X25519 ‖ ct_X25519 ‖ pk_X25519 ‖ label),
 * so an attacker must break BOTH ML-KEM-768 and X25519 to recover it. The test suite checks
 * byte-level interoperability with the independent hpke-js implementation in both directions,
 * which also makes the output decryptable by any other conformant HPKE+X-Wing stack.
 *
 * Used for: sealed contact capsules, first-contact payloads, device-link provisioning,
 * backup key wrapping, and the reference "encrypt a payload with Kyber + AES-256-GCM" example.
 */
import { ml_kem768_x25519 } from '@noble/post-quantum/hybrid.js';
import { gcm } from '@noble/ciphers/aes.js';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { EMPTY, concatBytes, randomBytes, u16be, utf8ToBytes } from './bytes.ts';

export const xwing = ml_kem768_x25519;

export const XWING = {
  publicKey: 1216, // ML-KEM-768 ek (1184) ‖ X25519 pk (32)
  secretKey: 32, // a seed; both component keys are expanded from it with SHAKE256
  cipherText: 1120, // ML-KEM-768 ct (1088) ‖ X25519 ephemeral pk (32)
  sharedSecret: 32,
} as const;

export interface XWingKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Deterministic when `seed` is given (identity keys derived from the recovery phrase). */
export function xwingKeygen(seed: Uint8Array = randomBytes(XWING.secretKey)): XWingKeyPair {
  if (seed.length !== XWING.secretKey) throw new RangeError('X-Wing seed must be 32 bytes');
  const { publicKey, secretKey } = xwing.keygen(seed);
  return { publicKey, secretKey };
}

export function xwingEncapsulate(publicKey: Uint8Array): { cipherText: Uint8Array; sharedSecret: Uint8Array } {
  if (publicKey.length !== XWING.publicKey) throw new RangeError('bad X-Wing public key length');
  return xwing.encapsulate(publicKey);
}

/**
 * ML-KEM uses implicit rejection: a wrong or tampered ciphertext yields a pseudorandom
 * secret instead of an error. Callers MUST authenticate the result (AEAD tag, transcript MAC).
 */
export function xwingDecapsulate(cipherText: Uint8Array, secretKey: Uint8Array): Uint8Array {
  if (cipherText.length !== XWING.cipherText) throw new RangeError('bad X-Wing ciphertext length');
  return xwing.decapsulate(cipherText, secretKey);
}

// ─── RFC 9180 key schedule (base mode, single shot) ─────────────────────────────

const KEM_ID = 0x647a;
const KDF_ID = 0x0001;
const AEAD_ID = 0x0002;
const SUITE_ID = concatBytes(utf8ToBytes('HPKE'), u16be(KEM_ID), u16be(KDF_ID), u16be(AEAD_ID));
const HPKE_V1 = utf8ToBytes('HPKE-v1');
const MODE_BASE = 0x00;
const NK = 32;
const NN = 12;

function labeledExtract(salt: Uint8Array, label: string, ikm: Uint8Array): Uint8Array {
  return extract(sha256, concatBytes(HPKE_V1, SUITE_ID, utf8ToBytes(label), ikm), salt);
}

function labeledExpand(prk: Uint8Array, label: string, info: Uint8Array, length: number): Uint8Array {
  return expand(sha256, prk, concatBytes(u16be(length), HPKE_V1, SUITE_ID, utf8ToBytes(label), info), length);
}

function keySchedule(sharedSecret: Uint8Array, info: Uint8Array): { key: Uint8Array; baseNonce: Uint8Array } {
  const pskIdHash = labeledExtract(EMPTY, 'psk_id_hash', EMPTY);
  const infoHash = labeledExtract(EMPTY, 'info_hash', info);
  const context = concatBytes(new Uint8Array([MODE_BASE]), pskIdHash, infoHash);
  const secret = labeledExtract(sharedSecret, 'secret', EMPTY);
  return {
    key: labeledExpand(secret, 'key', context, NK),
    baseNonce: labeledExpand(secret, 'base_nonce', context, NN),
  };
}

export interface HpkeCiphertext {
  /** KEM encapsulation (X-Wing ciphertext), 1120 bytes. */
  enc: Uint8Array;
  /** AES-256-GCM ciphertext ‖ 16-byte tag. */
  ct: Uint8Array;
}

/** HPKE SealBase: encrypt one message to `recipientPublicKey`. */
export function hpkeSeal(
  recipientPublicKey: Uint8Array,
  plaintext: Uint8Array,
  info: Uint8Array = EMPTY,
  aad: Uint8Array = EMPTY,
): HpkeCiphertext {
  const { cipherText: enc, sharedSecret } = xwingEncapsulate(recipientPublicKey);
  const { key, baseNonce } = keySchedule(sharedSecret, info);
  try {
    // Single-shot: sequence number 0, so the nonce is base_nonce itself.
    return { enc, ct: gcm(key, baseNonce, aad).encrypt(plaintext) };
  } finally {
    key.fill(0);
    sharedSecret.fill(0);
  }
}

/** HPKE OpenBase. Throws on any tampering with `enc`, `ct`, `info` or `aad`. */
export function hpkeOpen(
  recipientSecretKey: Uint8Array,
  { enc, ct }: HpkeCiphertext,
  info: Uint8Array = EMPTY,
  aad: Uint8Array = EMPTY,
): Uint8Array {
  const sharedSecret = xwingDecapsulate(enc, recipientSecretKey);
  const { key, baseNonce } = keySchedule(sharedSecret, info);
  try {
    return gcm(key, baseNonce, aad).decrypt(ct);
  } catch {
    throw new Error('HPKE open failed');
  } finally {
    key.fill(0);
    sharedSecret.fill(0);
  }
}

/** Sealed box = enc ‖ ct as one byte string (what goes inside a transport frame). */
export function sealBox(recipientPublicKey: Uint8Array, plaintext: Uint8Array, info: Uint8Array, aad: Uint8Array = EMPTY): Uint8Array {
  const { enc, ct } = hpkeSeal(recipientPublicKey, plaintext, info, aad);
  return concatBytes(enc, ct);
}

export function openBox(recipientSecretKey: Uint8Array, box: Uint8Array, info: Uint8Array, aad: Uint8Array = EMPTY): Uint8Array {
  if (box.length < XWING.cipherText + 16) throw new Error('sealed box too short');
  return hpkeOpen(
    recipientSecretKey,
    { enc: box.subarray(0, XWING.cipherText), ct: box.subarray(XWING.cipherText) },
    info,
    aad,
  );
}
