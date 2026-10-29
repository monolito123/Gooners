/**
 * Example 1: recovery phrase → identity keys, passphrase → Argon2id vault.
 *   node examples/01-derive-keys.ts
 *   SMA_PHRASE="word1 … word24" node examples/01-derive-keys.ts
 */
import {
  ARGON2,
  KEY_LABELS,
  deriveRootKey,
  deriveSubkey,
  generateRecoveryPhrase,
  identityFromRootKey,
  openVault,
  recoveryPhraseToSeed,
  safetyNumber,
  sealVault,
  toHex,
} from '../src/index.ts';

const short = (b: Uint8Array) => `${toHex(b.subarray(0, 8))}… (${b.length} B)`;

// 1. The recovery phrase is the root of the identity (256-bit entropy).
const phrase = process.env.SMA_PHRASE ?? generateRecoveryPhrase();
console.log('recovery phrase   :', process.env.SMA_PHRASE ? '(from SMA_PHRASE)' : phrase);

const seed = recoveryPhraseToSeed(phrase); // BIP-39 PBKDF2-HMAC-SHA512 × 2048
const root = deriveRootKey(seed); //            HKDF-Extract(SHA-512, "SMA/v1/root")
console.log('master seed       :', short(seed));
console.log('root key          :', short(root));

// 2. Every long-term key is a labelled HKDF-Expand of the root: same phrase, same keys.
const id = identityFromRootKey(root);
console.log('identity key      : Ed25519 ‖ ML-DSA-65,', id.signing.publicKey.length, 'B public');
console.log('identity KEM key  : X-Wing (ML-KEM-768 ‖ X25519),', id.kem.publicKey.length, 'B public');
console.log('fingerprint       :', toHex(id.fingerprint));
console.log('backup key        :', short(deriveSubkey(root, KEY_LABELS.backupAeadKey)));
console.log('inbox tag key     :', short(deriveSubkey(root, KEY_LABELS.inboxTagKey)));

const other = identityFromRootKey(deriveRootKey(recoveryPhraseToSeed(generateRecoveryPhrase())));
console.log('safety number     :', safetyNumber(id.fingerprint, other.fingerprint));

// 3. The passphrase only unlocks the device vault: Argon2id(t=3, m=64 MiB) → XChaCha20-Poly1305.
const passphrase = process.env.SMA_PASSPHRASE ?? 'orbit-velvet-candle-harbor-tundra-mosaic';
let t = performance.now();
const vault = await sealVault(seed, passphrase, ARGON2.interactive);
console.log(`vault sealed      : ${vault.length} B in ${(performance.now() - t).toFixed(0)} ms (Argon2id t=3 m=64MiB p=1)`);
t = performance.now();
const restored = await openVault(vault, passphrase);
console.log(`vault opened      : ${toHex(restored) === toHex(seed) ? 'seed matches' : 'MISMATCH'} in ${(performance.now() - t).toFixed(0)} ms`);
await openVault(vault, `${passphrase}!`).catch((e: Error) => console.log('wrong passphrase  :', e.message));
