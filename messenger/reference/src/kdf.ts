/**
 * Module 3 / Example 1: key derivation.
 *
 * Two different secrets, two different jobs:
 *
 *   Recovery phrase (BIP-39, 24 words = 256-bit entropy)
 *     └─ the root of the identity. Full entropy, so a fast KDF is fine. Everything
 *        recoverable (identity keys, backup key, backup locator) comes from here.
 *
 *   Passphrase (low entropy, chosen by a human)
 *     └─ only ever stretched with Argon2id into a key-encryption key (KEK) that wraps
 *        the root seed in the local vault. Never used directly as an identity root, because
 *        anything derived from it that leaks (e.g. a backup on Telegram/IPFS) can be
 *        brute-forced offline forever.
 */
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import * as bip39 from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import { Reader, concatBytes, randomBytes, u32be, utf8ToBytes } from './bytes.ts';

/** Argon2id cost parameters. `m` is in KiB, as in RFC 9106. */
export interface Argon2Params {
  t: number;
  m: number;
  p: number;
}

export const ARGON2 = {
  /**
   * Device-local vault unlock. RFC 9106 §4's second recommended option is t=3, m=64 MiB,
   * p=4; p=1 here because pure JS runs single-threaded (same memory and passes).
   */
  interactive: { t: 3, m: 64 * 1024, p: 1 },
  /** Anything that leaves the device (passphrase-recoverable backup). Use native/WASM Argon2. */
  offDevice: { t: 4, m: 256 * 1024, p: 1 },
  /** Unit tests only. */
  insecureTest: { t: 1, m: 8 * 1024, p: 1 },
} as const satisfies Record<string, Argon2Params>;

const MIN_PARAMS: Argon2Params = { t: 1, m: 8 * 1024, p: 1 };
const MAX_PARAMS: Argon2Params = { t: 16, m: 1024 * 1024, p: 16 };

function checkParams(p: Argon2Params): void {
  for (const k of ['t', 'm', 'p'] as const) {
    if (!Number.isInteger(p[k]) || p[k] < MIN_PARAMS[k] || p[k] > MAX_PARAMS[k]) {
      // Upper bounds stop a tampered vault header from forcing a multi-GiB allocation.
      throw new RangeError(`argon2 parameter ${k}=${p[k]} outside [${MIN_PARAMS[k]}, ${MAX_PARAMS[k]}]`);
    }
  }
}

/**
 * Stretch a passphrase into a 256-bit key with Argon2id.
 * The passphrase is NFKC-normalised so the same phrase typed on iOS, Android and a
 * desktop keyboard produces the same bytes.
 */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  params: Argon2Params = ARGON2.interactive,
  purpose = 'vault-kek',
): Promise<Uint8Array> {
  checkParams(params);
  if (salt.length < 16) throw new RangeError('salt must be at least 16 bytes');
  if (passphrase.length === 0) throw new Error('empty passphrase');
  return argon2idAsync(utf8ToBytes(passphrase.normalize('NFKC')), salt, {
    ...params,
    dkLen: 32,
    // Argon2 "associated data" X: domain-separates keys derived for different purposes.
    personalization: utf8ToBytes(`SMA/v1/argon2id/${purpose}`),
    maxmem: (MAX_PARAMS.m + 1024) * 1024,
  });
}

// ─── Recovery phrase and key hierarchy ──────────────────────────────────────────

/** 24-word BIP-39 phrase (256 bits of entropy + 8-bit checksum). */
export function generateRecoveryPhrase(): string {
  return bip39.generateMnemonic(english, 256);
}

/**
 * Phrase → 64-byte master seed (BIP-39: PBKDF2-HMAC-SHA512, 2048 rounds). The optional
 * BIP-39 passphrase ("25th word") gives plausible deniability for a coerced phrase.
 */
export function recoveryPhraseToSeed(phrase: string, bip39Passphrase = ''): Uint8Array {
  const normalized = phrase.normalize('NFKD').trim().split(/\s+/).join(' ');
  if (!bip39.validateMnemonic(normalized, english)) throw new Error('invalid recovery phrase (checksum)');
  if (normalized.split(' ').length !== 24) throw new Error('recovery phrase must have 24 words');
  return bip39.mnemonicToSeedSync(normalized, bip39Passphrase);
}

/** Labels of every key derived from the root. Changing one rotates that key for every user. */
export const KEY_LABELS = {
  identityEd25519: 'identity/ed25519-seed',
  identityMlDsa65: 'identity/ml-dsa-65-seed',
  identityXWing: 'identity/x-wing-seed',
  backupAeadKey: 'backup/aead-key',
  backupLocator: 'backup/locator',
  inboxTagKey: 'inbox/tag-key',
  deviceLinkKey: 'device/link-key',
} as const;
export type KeyLabel = (typeof KEY_LABELS)[keyof typeof KEY_LABELS];

/** HKDF-Extract(SHA-512) of the master seed: a 64-byte PRK that never leaves the vault. */
export function deriveRootKey(masterSeed: Uint8Array): Uint8Array {
  if (masterSeed.length < 32) throw new RangeError('master seed too short');
  return extract(sha512, masterSeed, utf8ToBytes('SMA/v1/root'));
}

/** HKDF-Expand(SHA-512) of the root with a fixed, versioned label. */
export function deriveSubkey(rootKey: Uint8Array, label: KeyLabel, length = 32): Uint8Array {
  return expand(sha512, rootKey, utf8ToBytes(`SMA/v1/${label}`), length);
}

// ─── Passphrase-protected local vault ───────────────────────────────────────────
//
// Layout (all integers big-endian), the whole header is AEAD associated data:
//   version u8 = 1 | t u32 | m u32 | p u8 | salt[16] | nonce[24] | XChaCha20-Poly1305(secret)

const VAULT_VERSION = 1;

export async function sealVault(
  secret: Uint8Array,
  passphrase: string,
  params: Argon2Params = ARGON2.interactive,
): Promise<Uint8Array> {
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const header = concatBytes(
    new Uint8Array([VAULT_VERSION]),
    u32be(params.t),
    u32be(params.m),
    new Uint8Array([params.p]),
    salt,
    nonce,
  );
  const kek = await deriveKeyFromPassphrase(passphrase, salt, params);
  try {
    return concatBytes(header, xchacha20poly1305(kek, nonce, header).encrypt(secret));
  } finally {
    kek.fill(0);
  }
}

export async function openVault(blob: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const r = new Reader(blob);
  if (r.u8() !== VAULT_VERSION) throw new Error('unsupported vault version');
  const params: Argon2Params = { t: r.u32(), m: r.u32(), p: r.u8() };
  const salt = r.bytes(16);
  const nonce = r.bytes(24);
  const header = blob.subarray(0, 1 + 4 + 4 + 1 + 16 + 24);
  const ciphertext = r.rest();
  const kek = await deriveKeyFromPassphrase(passphrase, salt, params);
  try {
    return xchacha20poly1305(kek, nonce, header).decrypt(ciphertext);
  } catch {
    throw new Error('wrong passphrase or corrupted vault');
  } finally {
    kek.fill(0);
  }
}
