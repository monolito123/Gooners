/**
 * Module 2: Hybrid KEM Double Ratchet with header encryption.
 *
 * This is Signal's Double Ratchet (header-encryption variant, §4 of the spec) with the
 * Diffie-Hellman ratchet replaced by an X-Wing KEM ratchet. X-Wing already combines
 * ML-KEM-768 and X25519, so every asymmetric ratchet step is hybrid: forward secrecy and
 * post-compromise security hold unless BOTH lattice and elliptic-curve assumptions fail.
 *
 * A DH ratchet gets "my new key" and "secret for your key" out of one 32-byte value. A KEM
 * needs two: each header carries the ciphertext to the peer's latest encapsulation key
 * (ct, 1120 B) and our next encapsulation key (ek, 1216 B).
 *
 *   send step:    (ct, ss) = Encap(peer_ek);  self = KeyGen();  RK, CKs, NHKs = KDF_RK(RK, ss)
 *   receive step: ss = Decap(header.ct, self.sk);               RK, CKr, NHKr = KDF_RK(RK, ss)
 *
 * Chains still alternate strictly (a party opens a new sending chain only after it receives
 * the peer's newest chain), so a header's ct is always addressed to the receiver's current
 * key pair, and one key pair per party is enough.
 *
 * Bandwidth: ~2.4 KB of header per message, fine for document-style transports. For
 * constrained links, see docs/02-crypto-protocol.md §4.4 (sparse mode, SPQR-style chunking).
 */
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  Reader,
  concatBytes,
  equalBytes,
  fromBase64Url,
  randomBytes,
  toBase64Url,
  u32be,
  utf8ToBytes,
} from './bytes.ts';
import { XWING, type XWingKeyPair, xwingDecapsulate, xwingEncapsulate, xwingKeygen } from './hpke.ts';

export const MAX_SKIP = 1000; // per chain: bounds work an attacker can force with a large `n`
export const MAX_SKIPPED_KEYS = 2000; // total stored; oldest evicted first

const HEADER_VERSION = 1;
const HEADER_NONCE = 12;
const GCM_TAG = 16;
export const HEADER_PLAINTEXT_BYTES = 1 + XWING.cipherText + XWING.publicKey + 4 + 4; // 2345
export const ENCRYPTED_HEADER_BYTES = HEADER_NONCE + HEADER_PLAINTEXT_BYTES + GCM_TAG; // 2373
/** Bytes a ratchet message adds around its (padded) plaintext. */
export const RATCHET_OVERHEAD = ENCRYPTED_HEADER_BYTES + GCM_TAG;

const INFO_RK = utf8ToBytes('SMA/v1/ratchet/root');
const INFO_MK = utf8ToBytes('SMA/v1/ratchet/message');

interface Header {
  ct: Uint8Array;
  ek: Uint8Array;
  pn: number;
  n: number;
}

interface SkippedKey {
  hk: Uint8Array;
  n: number;
  mk: Uint8Array;
}

export interface RatchetState {
  rk: Uint8Array;
  /** Our current KEM pair. Its public key is advertised in our headers. */
  kemSelf: XWingKeyPair;
  /** Peer's latest advertised encapsulation key. */
  kemPeer: Uint8Array | null;
  /** Encapsulation to `kemPeer` that opened our current sending chain. */
  ctOut: Uint8Array | null;
  cks: Uint8Array | null;
  ckr: Uint8Array | null;
  hks: Uint8Array | null;
  hkr: Uint8Array | null;
  nhks: Uint8Array;
  nhkr: Uint8Array;
  ns: number;
  nr: number;
  pn: number;
  skipped: SkippedKey[];
}

/** Secrets the handshake hands to the ratchet. */
export interface RatchetSeed {
  rootKey: Uint8Array;
  /** Header key for the initiator's first chain. */
  headerKeyA: Uint8Array;
  /** Next header key for the responder's first chain. */
  nextHeaderKeyB: Uint8Array;
}

// ─── KDFs ───────────────────────────────────────────────────────────────────────

function kdfRk(rk: Uint8Array, ss: Uint8Array): [Uint8Array, Uint8Array, Uint8Array] {
  const out = hkdf(sha256, ss, rk, INFO_RK, 96);
  return [out.slice(0, 32), out.slice(32, 64), out.slice(64, 96)];
}

function kdfCk(ck: Uint8Array): [Uint8Array, Uint8Array] {
  return [hmac(sha256, ck, new Uint8Array([0x02])), hmac(sha256, ck, new Uint8Array([0x01]))];
}

/** Each message key is used once, so a derived (not random) nonce is safe. */
function messageCipher(mk: Uint8Array, aad: Uint8Array) {
  const out = hkdf(sha256, mk, new Uint8Array(32), INFO_MK, 44);
  return gcm(out.subarray(0, 32), out.subarray(32, 44), aad);
}

// ─── Header encryption ──────────────────────────────────────────────────────────

function encodeHeader(h: Header): Uint8Array {
  return concatBytes(new Uint8Array([HEADER_VERSION]), h.ct, h.ek, u32be(h.pn), u32be(h.n));
}

function decodeHeader(bytes: Uint8Array): Header {
  const r = new Reader(bytes);
  if (r.u8() !== HEADER_VERSION) throw new Error('unsupported header version');
  const h = { ct: r.bytes(XWING.cipherText), ek: r.bytes(XWING.publicKey), pn: r.u32(), n: r.u32() };
  r.end();
  return h;
}

function hencrypt(hk: Uint8Array, header: Header, ad: Uint8Array): Uint8Array {
  // Random nonce: a header key serves a whole chain and the counter is inside the header.
  const nonce = randomBytes(HEADER_NONCE);
  return concatBytes(nonce, gcm(hk, nonce, ad).encrypt(encodeHeader(header)));
}

function hdecrypt(hk: Uint8Array | null, encHeader: Uint8Array, ad: Uint8Array): Header | null {
  if (!hk) return null;
  try {
    return decodeHeader(gcm(hk, encHeader.subarray(0, HEADER_NONCE), ad).decrypt(encHeader.subarray(HEADER_NONCE)));
  } catch {
    return null;
  }
}

// ─── Initialisation ─────────────────────────────────────────────────────────────

/** Initiator: performs the first send step against the responder's signed prekey. */
export function initInitiator(seed: RatchetSeed, responderPrekey: Uint8Array): RatchetState {
  const { cipherText, sharedSecret } = xwingEncapsulate(responderPrekey);
  const [rk, cks, nhks] = kdfRk(seed.rootKey, sharedSecret);
  return {
    rk,
    kemSelf: xwingKeygen(),
    kemPeer: responderPrekey,
    ctOut: cipherText,
    cks,
    ckr: null,
    hks: seed.headerKeyA,
    hkr: null,
    nhks,
    nhkr: seed.nextHeaderKeyB,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: [],
  };
}

/** Responder: its signed prekey is its first KEM pair. It cannot send until it receives. */
export function initResponder(seed: RatchetSeed, signedPrekey: XWingKeyPair): RatchetState {
  return {
    rk: seed.rootKey,
    kemSelf: signedPrekey,
    kemPeer: null,
    ctOut: null,
    cks: null,
    ckr: null,
    hks: null,
    hkr: null,
    nhks: seed.nextHeaderKeyB,
    nhkr: seed.headerKeyA,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: [],
  };
}

// ─── Encrypt / decrypt ──────────────────────────────────────────────────────────

/**
 * Encrypts `plaintext` (already padded by the caller). `ad` binds both identities.
 * Returns the new state; the input state must not be reused.
 */
export function ratchetEncrypt(
  state: RatchetState,
  plaintext: Uint8Array,
  ad: Uint8Array,
): { state: RatchetState; message: Uint8Array } {
  if (!state.cks || !state.hks || !state.ctOut) throw new Error('cannot send before receiving the first message');
  const s = clone(state);
  const [cks, mk] = kdfCk(s.cks!);
  s.cks = cks;
  const encHeader = hencrypt(s.hks!, { ct: s.ctOut!, ek: s.kemSelf.publicKey, pn: s.pn, n: s.ns }, ad);
  s.ns += 1;
  const body = messageCipher(mk, concatBytes(ad, encHeader)).encrypt(plaintext);
  return { state: s, message: concatBytes(encHeader, body) };
}

/**
 * Decrypts one message. All-or-nothing: on any failure it throws and the caller keeps the
 * old state, so a forged or replayed message cannot desynchronise the session.
 */
export function ratchetDecrypt(
  state: RatchetState,
  message: Uint8Array,
  ad: Uint8Array,
): { state: RatchetState; plaintext: Uint8Array } {
  if (message.length < ENCRYPTED_HEADER_BYTES + GCM_TAG) throw new Error('ratchet message too short');
  const encHeader = message.subarray(0, ENCRYPTED_HEADER_BYTES);
  const body = message.subarray(ENCRYPTED_HEADER_BYTES);
  const bodyAad = concatBytes(ad, encHeader);
  const s = clone(state);

  // 1. A message from a chain we skipped over earlier?
  const seen: Uint8Array[] = [];
  for (const entry of s.skipped) {
    if (seen.some((k) => equalBytes(k, entry.hk))) continue;
    seen.push(entry.hk);
    const header = hdecrypt(entry.hk, encHeader, ad);
    if (!header) continue;
    const idx = s.skipped.findIndex((e) => e.n === header.n && equalBytes(e.hk, entry.hk));
    if (idx < 0) break; // right chain, but not a skipped index: fall through (replay fails below)
    const plaintext = messageCipher(s.skipped[idx]!.mk, bodyAad).decrypt(body);
    s.skipped.splice(idx, 1);
    return { state: s, plaintext };
  }

  // 2. Current receiving chain, or the start of the peer's next chain?
  let header = hdecrypt(s.hkr, encHeader, ad);
  let newChain = false;
  if (!header) {
    header = hdecrypt(s.nhkr, encHeader, ad);
    newChain = true;
  }
  if (!header) throw new Error('undecryptable header');

  if (newChain) {
    skipMessageKeys(s, header.pn);
    kemRatchet(s, header);
  }
  skipMessageKeys(s, header.n);
  const [ckr, mk] = kdfCk(s.ckr!);
  s.ckr = ckr;
  s.nr += 1;
  const plaintext = messageCipher(mk, bodyAad).decrypt(body); // throws on replay or tampering
  return { state: s, plaintext };
}

function skipMessageKeys(s: RatchetState, until: number): void {
  if (s.nr + MAX_SKIP < until) throw new Error('too many skipped messages');
  if (!s.ckr) return;
  while (s.nr < until) {
    const [ckr, mk] = kdfCk(s.ckr);
    s.ckr = ckr;
    s.skipped.push({ hk: s.hkr!, n: s.nr, mk });
    s.nr += 1;
  }
  if (s.skipped.length > MAX_SKIPPED_KEYS) s.skipped.splice(0, s.skipped.length - MAX_SKIPPED_KEYS);
}

function kemRatchet(s: RatchetState, header: Header): void {
  s.pn = s.ns;
  s.ns = 0;
  s.nr = 0;
  s.hks = s.nhks;
  s.hkr = s.nhkr;
  // Receive step: the peer encapsulated to the key pair we advertised in our last chain.
  const ssIn = xwingDecapsulate(header.ct, s.kemSelf.secretKey);
  [s.rk, s.ckr, s.nhkr] = kdfRk(s.rk, ssIn);
  // Send step: answer the peer's new key with fresh randomness of our own.
  s.kemPeer = header.ek;
  const { cipherText, sharedSecret } = xwingEncapsulate(header.ek);
  s.ctOut = cipherText;
  s.kemSelf = xwingKeygen();
  [s.rk, s.cks, s.nhks] = kdfRk(s.rk, sharedSecret);
}

/** Keys are never mutated in place, so sharing the byte arrays between copies is safe. */
function clone(s: RatchetState): RatchetState {
  return { ...s, kemSelf: { ...s.kemSelf }, skipped: [...s.skipped] };
}

// ─── Persistence ────────────────────────────────────────────────────────────────
// Store only inside the encrypted local vault. Never back up or sync ratchet state:
// two devices running the same state reuse message keys.

export function serializeState(s: RatchetState): string {
  const b = (x: Uint8Array | null) => (x ? toBase64Url(x) : null);
  return JSON.stringify({
    v: 1,
    rk: b(s.rk),
    kemSelf: { pk: b(s.kemSelf.publicKey), sk: b(s.kemSelf.secretKey) },
    kemPeer: b(s.kemPeer),
    ctOut: b(s.ctOut),
    cks: b(s.cks),
    ckr: b(s.ckr),
    hks: b(s.hks),
    hkr: b(s.hkr),
    nhks: b(s.nhks),
    nhkr: b(s.nhkr),
    ns: s.ns,
    nr: s.nr,
    pn: s.pn,
    skipped: s.skipped.map((e) => [b(e.hk), e.n, b(e.mk)]),
  });
}

export function deserializeState(json: string): RatchetState {
  const o = JSON.parse(json);
  if (o.v !== 1) throw new Error('unsupported ratchet state version');
  const b = (x: string | null) => (x === null ? null : fromBase64Url(x));
  const req = (x: string) => fromBase64Url(x);
  return {
    rk: req(o.rk),
    kemSelf: { publicKey: req(o.kemSelf.pk), secretKey: req(o.kemSelf.sk) },
    kemPeer: b(o.kemPeer),
    ctOut: b(o.ctOut),
    cks: b(o.cks),
    ckr: b(o.ckr),
    hks: b(o.hks),
    hkr: b(o.hkr),
    nhks: req(o.nhks),
    nhkr: req(o.nhkr),
    ns: o.ns,
    nr: o.nr,
    pn: o.pn,
    skipped: o.skipped.map(([hk, n, mk]: [string, number, string]) => ({ hk: req(hk), n, mk: req(mk) })),
  };
}
