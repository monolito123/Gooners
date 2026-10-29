/**
 * Module 2: session establishment (a KEM-only analogue of PQXDH).
 *
 * Responder (Bob) publishes a signed PrekeyBundle:
 *   IK_B   composite Ed25519+ML-DSA-65 identity key (signs everything below)
 *   IKEM_B long-term X-Wing key   → implicit, post-quantum authentication of Bob
 *   SPK_B  weekly X-Wing key      → forward secrecy against later IKEM compromise
 *   OTK_B  optional one-time X-Wing key, only inside single-use invites
 *
 * Initiator (Alice) sends a PreKeyMessage:
 *   ct_spk[1120] ‖ ct_ikem[1120] ‖ [ct_otk[1120]] ‖ sealed_init[6605] ‖ ratchet_message
 *
 *   ss        = ss_spk ‖ ss_ikem ‖ [ss_otk]
 *   ctx_pub   = SHA-256("SMA/v1/handshake/public" ‖ IK_B ‖ IKEM_B ‖ SPK_B ‖ [OTK_B] ‖ cts)
 *   hsk‖chain = HKDF-SHA256(ss, salt=0³², "SMA/v1/handshake/k1" ‖ ctx_pub, 64)
 *   sealed_init = AES-256-GCM(hsk, nonce=0, aad=ctx_pub,
 *                   IK_A ‖ IKEM_A ‖ ts ‖ spk_id ‖ otk_id ‖ Sig_IK_A("handshake", transcript))
 *   transcript  = ctx_pub ‖ IK_A ‖ IKEM_A ‖ ts ‖ spk_id ‖ otk_id
 *   rk‖hkA‖nhkB‖tagAB‖tagBA = HKDF-SHA256(chain, 0³², "SMA/v1/handshake/session" ‖ SHA-256(transcript), 160)
 *
 * Alice's identity is only inside sealed_init (sealed sender: the transport never sees it).
 * Alice is authenticated to Bob by a composite signature, Bob to Alice by the bundle
 * signature plus the fact that only Bob can decapsulate ct_ikem. Trade-off: the signature
 * is a transferable proof (to Bob) that Alice opened a session with him; message contents
 * stay deniable because they are authenticated only by symmetric ratchet keys.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Reader, concatBytes, equalBytes, toHex, u32be, u64be, utf8ToBytes } from './bytes.ts';
import { KEY_LABELS, deriveSubkey } from './kdf.ts';
import { XWING, type XWingKeyPair, xwingDecapsulate, xwingEncapsulate, xwingKeygen } from './hpke.ts';
import { decodeMessage, encodeMessage } from './payload.ts';
import { initInitiator, initResponder, type RatchetState } from './ratchet.ts';
import {
  COMPOSITE,
  type CompositeKeyPair,
  compositeKeygen,
  compositeSign,
  compositeVerify,
  fingerprint,
} from './sign.ts';

export const SIGNED_PREKEY_LIFETIME_MS = 7 * 24 * 3600 * 1000;
export const SIGNED_PREKEY_GRACE_MS = 7 * 24 * 3600 * 1000; // old SPK kept for late messages
export const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

const ZERO_SALT = new Uint8Array(32);
const ZERO_NONCE = new Uint8Array(12); // hsk is single-use
const INIT_PLAINTEXT_BYTES = COMPOSITE.publicKey + XWING.publicKey + 8 + 4 + 4 + COMPOSITE.signature;
export const SEALED_INIT_BYTES = INIT_PLAINTEXT_BYTES + 16;
export const NO_OTK = 0xffffffff;

// ─── Identity ───────────────────────────────────────────────────────────────────

export interface Identity {
  signing: CompositeKeyPair;
  kem: XWingKeyPair;
  fingerprint: Uint8Array;
}

/** All long-term keys come from the root key, so the recovery phrase restores them. */
export function identityFromRootKey(rootKey: Uint8Array): Identity {
  const signing = compositeKeygen(
    deriveSubkey(rootKey, KEY_LABELS.identityEd25519),
    deriveSubkey(rootKey, KEY_LABELS.identityMlDsa65),
  );
  const kem = xwingKeygen(deriveSubkey(rootKey, KEY_LABELS.identityXWing));
  return { signing, kem, fingerprint: fingerprint(signing.publicKey) };
}

export interface SignedPrekey {
  id: number;
  keyPair: XWingKeyPair;
  createdAtMs: number;
  expiresAtMs: number;
}

export function generateSignedPrekey(id: number, nowMs = Date.now()): SignedPrekey {
  return { id, keyPair: xwingKeygen(), createdAtMs: nowMs, expiresAtMs: nowMs + SIGNED_PREKEY_LIFETIME_MS };
}

export interface OneTimePrekey {
  id: number;
  keyPair: XWingKeyPair;
}

// ─── Bundle ─────────────────────────────────────────────────────────────────────

/** Serialized `SignedBlob{ body: PrekeyBundle }`, safe to publish anywhere. */
export function createPrekeyBundle(identity: Identity, spk: SignedPrekey, nowMs = Date.now()): Uint8Array {
  const body = encodeMessage('PrekeyBundle', {
    version: 1,
    identityKey: identity.signing.publicKey,
    identityKemKey: identity.kem.publicKey,
    signedPrekey: {
      id: spk.id,
      publicKey: spk.keyPair.publicKey,
      createdAtMs: spk.createdAtMs,
      expiresAtMs: spk.expiresAtMs,
    },
    publishedAtMs: nowMs,
  });
  return encodeMessage('SignedBlob', {
    body,
    signer: identity.signing.publicKey,
    signature: compositeSign(identity.signing, body, 'prekey-bundle'),
  });
}

export interface VerifiedBundle {
  identityKey: Uint8Array;
  identityKemKey: Uint8Array;
  fingerprint: Uint8Array;
  signedPrekey: { id: number; publicKey: Uint8Array; expiresAtMs: number };
}

/**
 * Verifies the bundle signature and pins it to `expectedFingerprint` (from a QR code,
 * an invite link or a previously verified contact). Without the pin, a malicious host
 * could substitute its own bundle.
 */
export function verifyPrekeyBundle(bytes: Uint8Array, expectedFingerprint: Uint8Array, nowMs = Date.now()): VerifiedBundle {
  const blob = decodeMessage('SignedBlob', bytes) as { body: Uint8Array; signer: Uint8Array; signature: Uint8Array };
  const b = decodeMessage('PrekeyBundle', blob.body) as {
    version: number;
    identityKey: Uint8Array;
    identityKemKey: Uint8Array;
    signedPrekey: { id: number; publicKey: Uint8Array; expiresAtMs: number };
  };
  if (b.version !== 1) throw new Error('unsupported bundle version');
  if (!equalBytes(fingerprint(b.identityKey), expectedFingerprint)) throw new Error('bundle identity does not match the pinned fingerprint');
  if (!equalBytes(blob.signer, b.identityKey)) throw new Error('bundle signer mismatch');
  if (!compositeVerify(b.identityKey, blob.body, blob.signature, 'prekey-bundle')) throw new Error('bad bundle signature');
  if (b.identityKemKey.length !== XWING.publicKey || b.signedPrekey.publicKey.length !== XWING.publicKey) throw new Error('bad key length');
  if (b.signedPrekey.expiresAtMs + MAX_CLOCK_SKEW_MS < nowMs) throw new Error('signed prekey expired');
  return {
    identityKey: b.identityKey,
    identityKemKey: b.identityKemKey,
    fingerprint: expectedFingerprint,
    signedPrekey: { id: b.signedPrekey.id, publicKey: b.signedPrekey.publicKey, expiresAtMs: b.signedPrekey.expiresAtMs },
  };
}

// ─── Key schedule ───────────────────────────────────────────────────────────────

export interface SessionSecrets {
  ratchet: RatchetState;
  /** Binds both identities into every AEAD. */
  ad: Uint8Array;
  tagKeyInitiatorToResponder: Uint8Array;
  tagKeyResponderToInitiator: Uint8Array;
  /** Stable id of this handshake: replay cache key. */
  handshakeId: string;
}

function publicContext(
  responderIk: Uint8Array,
  responderIkem: Uint8Array,
  spkPublic: Uint8Array,
  otkPublic: Uint8Array | null,
  cts: Uint8Array,
): Uint8Array {
  return sha256(
    concatBytes(utf8ToBytes('SMA/v1/handshake/public'), responderIk, responderIkem, spkPublic, otkPublic ?? new Uint8Array(0), cts),
  );
}

function stage1(ss: Uint8Array, ctxPub: Uint8Array): { hsk: Uint8Array; chain: Uint8Array } {
  const out = hkdf(sha256, ss, ZERO_SALT, concatBytes(utf8ToBytes('SMA/v1/handshake/k1'), ctxPub), 64);
  return { hsk: out.slice(0, 32), chain: out.slice(32) };
}

function stage2(chain: Uint8Array, transcript: Uint8Array) {
  const out = hkdf(sha256, chain, ZERO_SALT, concatBytes(utf8ToBytes('SMA/v1/handshake/session'), sha256(transcript)), 160);
  return {
    rootKey: out.slice(0, 32),
    headerKeyA: out.slice(32, 64),
    nextHeaderKeyB: out.slice(64, 96),
    tagAB: out.slice(96, 128),
    tagBA: out.slice(128, 160),
  };
}

function associatedData(initiatorIk: Uint8Array, responderIk: Uint8Array): Uint8Array {
  return sha256(concatBytes(utf8ToBytes('SMA/v1/ad'), initiatorIk, responderIk));
}

export function handshakeIdOf(prekeyPrefix: Uint8Array): string {
  return toHex(sha256(prekeyPrefix.subarray(0, 2 * XWING.cipherText)).subarray(0, 16));
}

// ─── Initiator ──────────────────────────────────────────────────────────────────

export interface InitiateResult extends SessionSecrets {
  /** Prepended to every message until the responder's first reply arrives. */
  prekeyPrefix: Uint8Array;
}

export function initiate(
  self: Identity,
  peer: VerifiedBundle,
  opts: { oneTimePrekey?: { id: number; publicKey: Uint8Array }; nowMs?: number } = {},
): InitiateResult {
  const nowMs = opts.nowMs ?? Date.now();
  const otk = opts.oneTimePrekey ?? null;
  const spk = xwingEncapsulate(peer.signedPrekey.publicKey);
  const ikem = xwingEncapsulate(peer.identityKemKey);
  const ot = otk ? xwingEncapsulate(otk.publicKey) : null;

  const cts = concatBytes(spk.cipherText, ikem.cipherText, ot?.cipherText ?? new Uint8Array(0));
  const ss = concatBytes(spk.sharedSecret, ikem.sharedSecret, ot?.sharedSecret ?? new Uint8Array(0));
  const ctxPub = publicContext(peer.identityKey, peer.identityKemKey, peer.signedPrekey.publicKey, otk?.publicKey ?? null, cts);
  const { hsk, chain } = stage1(ss, ctxPub);
  ss.fill(0);

  const initFields = concatBytes(
    self.signing.publicKey,
    self.kem.publicKey,
    u64be(nowMs),
    u32be(peer.signedPrekey.id),
    u32be(otk?.id ?? NO_OTK),
  );
  const transcript = concatBytes(ctxPub, initFields);
  const signature = compositeSign(self.signing, transcript, 'handshake');
  const sealedInit = gcm(hsk, ZERO_NONCE, ctxPub).encrypt(concatBytes(initFields, signature));
  hsk.fill(0);

  const k = stage2(chain, transcript);
  const prekeyPrefix = concatBytes(cts, sealedInit);
  return {
    ratchet: initInitiator(
      { rootKey: k.rootKey, headerKeyA: k.headerKeyA, nextHeaderKeyB: k.nextHeaderKeyB },
      peer.signedPrekey.publicKey,
    ),
    ad: associatedData(self.signing.publicKey, peer.identityKey),
    tagKeyInitiatorToResponder: k.tagAB,
    tagKeyResponderToInitiator: k.tagBA,
    handshakeId: handshakeIdOf(prekeyPrefix),
    prekeyPrefix,
  };
}

export function prekeyPrefixLength(withOneTimePrekey: boolean): number {
  return (withOneTimePrekey ? 3 : 2) * XWING.cipherText + SEALED_INIT_BYTES;
}

// ─── Responder ──────────────────────────────────────────────────────────────────

export interface RespondResult extends SessionSecrets {
  peerIdentityKey: Uint8Array;
  peerIdentityKemKey: Uint8Array;
  peerFingerprint: Uint8Array;
  /** The ratchet message that followed the prefix. */
  ratchetMessage: Uint8Array;
  usedSignedPrekeyId: number;
}

/**
 * Processes a PreKeyMessage. `signedPrekeys` = current plus not-yet-expired previous ones;
 * the right one is found by trial (ML-KEM implicit rejection + AEAD), so no key id is
 * exposed on the wire. `oneTimePrekey` is known from the routing tag (invite-specific).
 * The caller MUST check `handshakeId` against its replay cache before calling, and MUST
 * delete the one-time prekey afterwards.
 */
export function respond(
  self: Identity,
  signedPrekeys: SignedPrekey[],
  body: Uint8Array,
  opts: { oneTimePrekey?: OneTimePrekey; nowMs?: number } = {},
): RespondResult {
  const nowMs = opts.nowMs ?? Date.now();
  const otk = opts.oneTimePrekey ?? null;
  const r = new Reader(body);
  const ctSpk = r.bytes(XWING.cipherText);
  const ctIkem = r.bytes(XWING.cipherText);
  const ctOtk = otk ? r.bytes(XWING.cipherText) : null;
  const sealedInit = r.bytes(SEALED_INIT_BYTES);
  const ratchetMessage = r.rest();
  const cts = concatBytes(ctSpk, ctIkem, ctOtk ?? new Uint8Array(0));

  const ssIkem = xwingDecapsulate(ctIkem, self.kem.secretKey);
  const ssOtk = otk && ctOtk ? xwingDecapsulate(ctOtk, otk.keyPair.secretKey) : new Uint8Array(0);

  for (const spk of signedPrekeys) {
    if (spk.expiresAtMs + SIGNED_PREKEY_GRACE_MS < nowMs) continue;
    const ssSpk = xwingDecapsulate(ctSpk, spk.keyPair.secretKey);
    const ctxPub = publicContext(self.signing.publicKey, self.kem.publicKey, spk.keyPair.publicKey, otk?.keyPair.publicKey ?? null, cts);
    const { hsk, chain } = stage1(concatBytes(ssSpk, ssIkem, ssOtk), ctxPub);
    let init: Uint8Array;
    try {
      init = gcm(hsk, ZERO_NONCE, ctxPub).decrypt(sealedInit);
    } catch {
      continue; // wrong signed prekey: try the next one
    }

    const ir = new Reader(init);
    const peerIk = ir.bytes(COMPOSITE.publicKey);
    const peerIkem = ir.bytes(XWING.publicKey);
    const ts = Number(ir.u64());
    const spkId = ir.u32();
    const otkId = ir.u32();
    const signature = ir.bytes(COMPOSITE.signature);
    ir.end();
    const transcript = concatBytes(ctxPub, init.subarray(0, init.length - COMPOSITE.signature));

    if (spkId !== spk.id) throw new Error('signed prekey id mismatch');
    if (otkId !== (otk?.id ?? NO_OTK)) throw new Error('one-time prekey id mismatch');
    if (ts > nowMs + MAX_CLOCK_SKEW_MS || ts + SIGNED_PREKEY_LIFETIME_MS + SIGNED_PREKEY_GRACE_MS < nowMs) {
      throw new Error('handshake timestamp out of range');
    }
    if (!compositeVerify(peerIk, transcript, signature, 'handshake')) throw new Error('bad initiator signature');

    const k = stage2(chain, transcript);
    return {
      ratchet: initResponder(
        { rootKey: k.rootKey, headerKeyA: k.headerKeyA, nextHeaderKeyB: k.nextHeaderKeyB },
        spk.keyPair,
      ),
      ad: associatedData(peerIk, self.signing.publicKey),
      tagKeyInitiatorToResponder: k.tagAB,
      tagKeyResponderToInitiator: k.tagBA,
      handshakeId: handshakeIdOf(body),
      peerIdentityKey: peerIk,
      peerIdentityKemKey: peerIkem,
      peerFingerprint: fingerprint(peerIk),
      ratchetMessage,
      usedSignedPrekeyId: spk.id,
    };
  }
  throw new Error('no signed prekey opens this handshake');
}
