/**
 * Example 2: encrypt a payload with ML-KEM-768 (Kyber) + X25519 → HKDF → AES-256-GCM.
 * This is HPKE (RFC 9180) with the X-Wing KEM; it interoperates with hpke-js and with
 * Apple CryptoKit's X-Wing HPKE suite.
 *   node examples/02-hybrid-encrypt.ts
 */
import {
  XWING,
  decodeContent,
  encodeContent,
  hpkeOpen,
  hpkeSeal,
  toHex,
  utf8ToBytes,
  xwingKeygen,
} from '../src/index.ts';

// Recipient key pair: 32-byte seed → ML-KEM-768 ek (1184 B) ‖ X25519 pk (32 B).
const bob = xwingKeygen();
console.log('recipient public key:', bob.publicKey.length, 'B  (ML-KEM-768 1184 + X25519 32)');

// Payload: a protobuf `Content` (schema in proto/sma.proto).
const plaintext = encodeContent({ text: { body: 'Meet at the usual place, 19:00.' }, expireAfterS: 86_400 });

// `info` names the protocol context; `aad` is authenticated but not encrypted.
const info = utf8ToBytes('SMA/v1/example');
const aad = utf8ToBytes('routing-tag-or-header');
const { enc, ct } = hpkeSeal(bob.publicKey, plaintext, info, aad);

console.log('enc (KEM ciphertext):', enc.length, 'B');
console.log('  ML-KEM-768 ct     :', toHex(enc.subarray(0, 16)), '…', XWING.cipherText - 32, 'B');
console.log('  X25519 ephemeral  :', toHex(enc.subarray(XWING.cipherText - 32, XWING.cipherText - 16)), '… 32 B');
console.log('AES-256-GCM ct      :', ct.length, 'B (plaintext', plaintext.length, '+ 16 tag)');
console.log('shared secret       : SHA3-256(ss_mlkem ‖ ss_x25519 ‖ ct_x25519 ‖ pk_x25519 ‖ "\\.//^\\")');

const opened = decodeContent(hpkeOpen(bob.secretKey, { enc, ct }, info, aad));
console.log('decrypted           :', (opened.text as { body: string }).body);

try {
  hpkeOpen(bob.secretKey, { enc, ct }, info, utf8ToBytes('tampered aad'));
} catch (e) {
  console.log('tampered aad        :', (e as Error).message);
}
