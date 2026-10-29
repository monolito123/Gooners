/**
 * Composite signatures: Ed25519 AND ML-DSA-65 (FIPS 204), both must verify.
 *
 * Breaking authentication then requires breaking both a classical and a lattice scheme,
 * which covers a future quantum computer (Ed25519 falls) and a cryptanalytic surprise
 * against a young standard (ML-DSA falls). Follows the idea of
 * draft-ietf-lamps-pq-composite-sigs: both components sign the same domain-separated
 * representative M' = label ‖ len(ctx) ‖ ctx ‖ SHA-512(message).
 *
 *   public key = ed25519_pk (32)  ‖ ml_dsa_65_pk (1952)  = 1984 bytes
 *   signature  = ed25519_sig (64) ‖ ml_dsa_65_sig (3309) = 3373 bytes
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from './bytes.ts';

export const COMPOSITE = {
  publicKey: 32 + 1952,
  signature: 64 + 3309,
  seed: 32 + 32,
} as const;

const LABEL = utf8ToBytes('SMA-v1-COMPOSITE-SIG-Ed25519-ML-DSA-65');

export interface CompositeKeyPair {
  publicKey: Uint8Array;
  edSecretKey: Uint8Array;
  pqSecretKey: Uint8Array;
}

/** Deterministic from two independent 32-byte seeds (derived from the recovery phrase). */
export function compositeKeygen(edSeed: Uint8Array, pqSeed: Uint8Array): CompositeKeyPair {
  if (edSeed.length !== 32 || pqSeed.length !== 32) throw new RangeError('seeds must be 32 bytes');
  const edPublic = ed25519.getPublicKey(edSeed);
  const pq = ml_dsa65.keygen(pqSeed);
  return { publicKey: concatBytes(edPublic, pq.publicKey), edSecretKey: edSeed, pqSecretKey: pq.secretKey };
}

function representative(message: Uint8Array, context: string): Uint8Array {
  const ctx = utf8ToBytes(context);
  if (ctx.length > 255) throw new RangeError('context too long');
  return concatBytes(LABEL, new Uint8Array([ctx.length]), ctx, sha512(message));
}

/** `context` names what is being signed ("prekey-bundle", "handshake", ...) so a
 *  signature can never be replayed as a signature over a different kind of object. */
export function compositeSign(key: CompositeKeyPair, message: Uint8Array, context: string): Uint8Array {
  const m = representative(message, context);
  // ML-DSA signing is hedged (fresh randomness mixed with the key) by default in noble.
  return concatBytes(ed25519.sign(m, key.edSecretKey), ml_dsa65.sign(m, key.pqSecretKey));
}

export function compositeVerify(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
  context: string,
): boolean {
  if (publicKey.length !== COMPOSITE.publicKey || signature.length !== COMPOSITE.signature) return false;
  const m = representative(message, context);
  // Evaluate both, no short-circuit: the verdict must not reveal which component failed.
  let edOk = false;
  let pqOk = false;
  try {
    edOk = ed25519.verify(signature.subarray(0, 64), m, publicKey.subarray(0, 32));
  } catch {
    edOk = false;
  }
  try {
    pqOk = ml_dsa65.verify(signature.subarray(64), m, publicKey.subarray(32));
  } catch {
    pqOk = false;
  }
  return edOk && pqOk;
}

/** 32-byte identity fingerprint: what QR codes, safety numbers and contact capsules pin. */
export function fingerprint(compositePublicKey: Uint8Array): Uint8Array {
  return sha256(concatBytes(utf8ToBytes('SMA/v1/fingerprint'), compositePublicKey));
}

/**
 * Safety number shown to both users (order-independent): 12 groups of 5 digits.
 * Each side contributes 30 digits derived from its fingerprint, sorted so both screens match.
 */
export function safetyNumber(fingerprintA: Uint8Array, fingerprintB: Uint8Array): string {
  const digits = (fp: Uint8Array): string => {
    const h = sha512(concatBytes(utf8ToBytes('SMA/v1/safety-number'), fp));
    let out = '';
    for (let i = 0; i < 6; i++) {
      // 5 bytes → 40-bit integer → 5 decimal digits (mod 10^5): bias < 2^-23, negligible.
      let v = 0n;
      for (let j = 0; j < 5; j++) v = (v << 8n) | BigInt(h[i * 5 + j]!);
      out += (v % 100000n).toString().padStart(5, '0');
    }
    return out;
  };
  const [first, second] = [digits(fingerprintA), digits(fingerprintB)].sort();
  return (first! + second!).match(/.{5}/g)!.join(' ');
}
