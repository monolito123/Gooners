// The receipt claim page's cryptography (docs/03 §3.2): the one-time claim key from the URL
// fragment signs the relay's NIP-42 challenge and opens the gift wrap (NIP-59) and the seal
// inside it with NIP-44 version 2. Nothing leaves the browser. This module runs in Node too:
// tools/check.mjs holds it to the signed examples and to nostr-tools.

import { hex, unhex, sha256, verifyEvent, secp256k1 as C } from '../verify.js';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const concat = (...as) => {
  const out = new Uint8Array(as.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of as) {
    out.set(a, i);
    i += a.length;
  }
  return out;
};
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

function scalar(secretHex) {
  const d = C.num(unhex(secretHex));
  if (unhex(secretHex).length !== 32 || d <= 0n || d >= C.N) throw new Error('not a secret key');
  return d;
}

/** The x-only public key (hex) of a 32-byte secret (hex). */
export function publicKey(secretHex) {
  return hex(C.bytes32(C.mul(scalar(secretHex), C.G)[0]));
}

/** Signs an event (NIP-01 id, BIP-340 signature) with secretHex. */
export async function signEvent(ev, secretHex, aux = random(32)) {
  const d0 = scalar(secretHex);
  const P = C.mul(d0, C.G);
  const d = P[1] & 1n ? C.N - d0 : d0;
  const pub = C.bytes32(P[0]);
  const out = { pubkey: hex(pub), created_at: ev.created_at, kind: ev.kind, tags: ev.tags ?? [], content: ev.content ?? '' };
  const msg = await sha256(enc.encode(JSON.stringify([0, out.pubkey, out.created_at, out.kind, out.tags, out.content])));
  const t = C.bytes32(d ^ C.num(await C.taggedHash('BIP0340/aux', aux)));
  const k0 = C.mod(C.num(await C.taggedHash('BIP0340/nonce', t, pub, msg)), C.N);
  if (k0 === 0n) throw new Error('signing failed');
  const R = C.mul(k0, C.G);
  const k = R[1] & 1n ? C.N - k0 : k0;
  const e = C.mod(C.num(await C.taggedHash('BIP0340/challenge', C.bytes32(R[0]), pub, msg)), C.N);
  out.id = hex(msg);
  out.sig = hex(concat(C.bytes32(R[0]), C.bytes32(C.mod(k + e * d, C.N))));
  return out;
}

async function hmac(key, ...data) {
  const k = await globalThis.crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', k, concat(...data)));
}

/** NIP-44's conversation key: HKDF-extract with salt "nip44-v2" of the shared point's x. */
export async function conversationKey(secretHex, pubHex) {
  const peer = C.liftX(C.num(unhex(pubHex)));
  if (!peer) throw new Error('not a public key');
  const shared = C.mul(scalar(secretHex), peer);
  return hmac(enc.encode('nip44-v2'), C.bytes32(shared[0]));
}

async function messageKeys(ck, nonce) {
  // HKDF-expand(ck, nonce, 76): ChaCha20 key, ChaCha20 nonce, HMAC key.
  let t = new Uint8Array(0);
  let okm = new Uint8Array(0);
  for (let i = 1; okm.length < 76; i++) {
    t = await hmac(ck, t, nonce, new Uint8Array([i]));
    okm = concat(okm, t);
  }
  return { key: okm.slice(0, 32), nonce: okm.slice(32, 44), auth: okm.slice(44, 76) };
}

/** ChaCha20 (RFC 8439) with a 96-bit nonce and the block counter starting at 0. */
export function chacha20(key, nonce, data) {
  const k = new DataView(key.buffer, key.byteOffset, 32);
  const n = new DataView(nonce.buffer, nonce.byteOffset, 12);
  const s = new Uint32Array(16);
  s.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
  for (let i = 0; i < 8; i++) s[4 + i] = k.getUint32(i * 4, true);
  for (let i = 0; i < 3; i++) s[13 + i] = n.getUint32(i * 4, true);
  const x = new Uint32Array(16);
  const block = new Uint8Array(64);
  const bv = new DataView(block.buffer);
  const rotl = (v, c) => (v << c) | (v >>> (32 - c));
  const qr = (a, b, c, d) => {
    x[a] += x[b]; x[d] = rotl(x[d] ^ x[a], 16);
    x[c] += x[d]; x[b] = rotl(x[b] ^ x[c], 12);
    x[a] += x[b]; x[d] = rotl(x[d] ^ x[a], 8);
    x[c] += x[d]; x[b] = rotl(x[b] ^ x[c], 7);
  };
  const out = new Uint8Array(data.length);
  for (let off = 0; off < data.length; off += 64) {
    x.set(s);
    for (let i = 0; i < 10; i++) {
      qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
      qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
    }
    for (let i = 0; i < 16; i++) bv.setUint32(i * 4, (x[i] + s[i]) >>> 0, true);
    for (let i = 0; i < 64 && off + i < data.length; i++) out[off + i] = data[off + i] ^ block[i];
    s[12]++;
  }
  return out;
}

function paddedLength(len) {
  if (len <= 32) return 32;
  const next = 1 << (Math.floor(Math.log2(len - 1)) + 1);
  const chunk = next <= 256 ? 32 : next / 8;
  return chunk * (Math.floor((len - 1) / chunk) + 1);
}

const b64 = {
  decode: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  encode: (b) => btoa(Array.from(b, (c) => String.fromCharCode(c)).join('')),
};

/** NIP-44 v2 decryption of a base64 payload with a conversation key. */
export async function nip44Decrypt(payload, ck) {
  if (typeof payload !== 'string' || payload.startsWith('#')) throw new Error('unsupported encryption version');
  const data = b64.decode(payload);
  if (data.length < 99 || data[0] !== 2) throw new Error('unsupported encryption version');
  const nonce = data.slice(1, 33);
  const ct = data.slice(33, data.length - 32);
  const mac = data.slice(data.length - 32);
  const keys = await messageKeys(ck, nonce);
  const want = await hmac(keys.auth, nonce, ct);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= want[i] ^ mac[i];
  if (diff) throw new Error('invalid MAC');
  const padded = chacha20(keys.key, keys.nonce, ct);
  const len = (padded[0] << 8) | padded[1];
  if (len < 1 || padded.length !== 2 + paddedLength(len)) throw new Error('invalid padding');
  return dec.decode(padded.slice(2, 2 + len));
}

/** NIP-44 v2 encryption (the tests' round trip). */
export async function nip44Encrypt(plaintext, ck, nonce = random(32)) {
  const pt = enc.encode(plaintext);
  if (pt.length < 1 || pt.length > 65535) throw new Error('invalid plaintext length');
  const padded = new Uint8Array(2 + paddedLength(pt.length));
  padded[0] = pt.length >> 8;
  padded[1] = pt.length & 0xff;
  padded.set(pt, 2);
  const keys = await messageKeys(ck, nonce);
  const ct = chacha20(keys.key, keys.nonce, padded);
  return b64.encode(concat(new Uint8Array([2]), nonce, ct, await hmac(keys.auth, nonce, ct)));
}

/**
 * Opens a receipt's gift wrap with the claim key: the wrap (kind 1059, to the claim key),
 * the seal (kind 13) and the receipt it holds, each signature checked, and the receipt signed
 * by the seal's author. signer, when given, is the key the seal must come from.
 */
export async function unwrapReceipt(wrap, secretHex, signer) {
  const me = publicKey(secretHex);
  if (wrap.kind !== 1059 || !wrap.tags.some((t) => t[0] === 'p' && t[1] === me)) throw new Error('not a gift wrap to this key');
  if (!(await verifyEvent(wrap))) throw new Error("the gift wrap's signature does not verify");
  const seal = JSON.parse(await nip44Decrypt(wrap.content, await conversationKey(secretHex, wrap.pubkey)));
  if (seal.kind !== 13 || !(await verifyEvent(seal))) throw new Error("the seal's signature does not verify");
  if (signer && seal.pubkey !== signer) throw new Error('the receipt was not sealed by the platform');
  const receipt = JSON.parse(await nip44Decrypt(seal.content, await conversationKey(secretHex, seal.pubkey)));
  if (!(await verifyEvent(receipt)) || receipt.pubkey !== seal.pubkey) throw new Error("the receipt's signature does not verify");
  return { seal, receipt };
}
