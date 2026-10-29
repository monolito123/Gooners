/**
 * Ties the layers together for one user device: handshake → ratchet → padding → frame.
 *
 *   send:    Content bytes → pad → ratchetEncrypt → [prekey prefix] → tag → frame
 *   receive: frame → tag lookup (inbox | session) → [respond] → ratchetDecrypt → unpad
 *
 * The routing tag decides how a frame is parsed, so frames carry no type field:
 *   inbox tag   = PRF(inbox_tag_key, epoch)  → PreKeyMessage (first contact)
 *   session tag = PRF(session_tag_key, epoch) → RatchetMessage
 */
import { concatBytes, toHex } from './bytes.ts';
import { decodeFrame, encodeFrame, epochOf, padToBucket, routingTag, TAG_BYTES, unpad, watchTags } from './envelope.ts';
import {
  type Identity,
  type SignedPrekey,
  type VerifiedBundle,
  createPrekeyBundle,
  generateSignedPrekey,
  handshakeIdOf,
  identityFromRootKey,
  initiate,
  prekeyPrefixLength,
  respond,
} from './handshake.ts';
import { KEY_LABELS, deriveRootKey, deriveSubkey, recoveryPhraseToSeed } from './kdf.ts';
import { RATCHET_OVERHEAD, type RatchetState, ratchetDecrypt, ratchetEncrypt } from './ratchet.ts';

/** What Alice learns about Bob from his QR code / contact card. */
export interface ContactInfo {
  fingerprint: Uint8Array;
  inboxTagKey: Uint8Array;
  bundle: VerifiedBundle;
}

interface SessionRecord {
  peer: string;
  ratchet: RatchetState;
  ad: Uint8Array;
  sendTagKey: Uint8Array;
  recvTagKey: Uint8Array;
  /** Initiator only, until the first reply: frames go to the peer's inbox with this prefix. */
  prekeyPrefix: Uint8Array | null;
  peerInboxTagKey: Uint8Array | null;
  handshakeId: string;
}

export interface Received {
  from: string;
  plaintext: Uint8Array;
  newSession: boolean;
}

export class Endpoint {
  readonly identity: Identity;
  readonly fingerprintHex: string;
  readonly inboxTagKey: Uint8Array;
  signedPrekeys: SignedPrekey[];
  private readonly sessions = new Map<string, SessionRecord>();
  /** Replay cache: handshake id → peer. Must outlive sessions until the SPK expires. */
  private readonly handshakes = new Map<string, string>();

  constructor(rootKey: Uint8Array, nowMs = Date.now()) {
    this.identity = identityFromRootKey(rootKey);
    this.fingerprintHex = toHex(this.identity.fingerprint);
    this.inboxTagKey = deriveSubkey(rootKey, KEY_LABELS.inboxTagKey);
    this.signedPrekeys = [generateSignedPrekey(1, nowMs)];
  }

  static fromRecoveryPhrase(phrase: string, nowMs = Date.now()): Endpoint {
    return new Endpoint(deriveRootKey(recoveryPhraseToSeed(phrase)), nowMs);
  }

  /** Signed bundle to publish on any transport (it is public). */
  publishBundle(nowMs = Date.now()): Uint8Array {
    return createPrekeyBundle(this.identity, this.signedPrekeys[0]!, nowMs);
  }

  /** Weekly: new SPK first, previous ones kept until their grace period ends. */
  rotateSignedPrekey(nowMs = Date.now()): void {
    const next = generateSignedPrekey((this.signedPrekeys[0]?.id ?? 0) + 1, nowMs);
    this.signedPrekeys = [next, ...this.signedPrekeys].slice(0, 3);
  }

  hasSession(peer: string): boolean {
    return this.sessions.has(peer);
  }

  /** Encrypts `content` (an encoded `Content` protobuf) for `peer` into one frame. */
  send(peer: ContactInfo, content: Uint8Array, nowMs = Date.now()): Uint8Array {
    const peerHex = toHex(peer.fingerprint);
    let rec = this.sessions.get(peerHex);
    if (!rec) {
      const hs = initiate(this.identity, peer.bundle, { nowMs });
      rec = {
        peer: peerHex,
        ratchet: hs.ratchet,
        ad: hs.ad,
        sendTagKey: hs.tagKeyInitiatorToResponder,
        recvTagKey: hs.tagKeyResponderToInitiator,
        prekeyPrefix: hs.prekeyPrefix,
        peerInboxTagKey: peer.inboxTagKey,
        handshakeId: hs.handshakeId,
      };
      this.sessions.set(peerHex, rec);
    }
    const prefix = rec.prekeyPrefix;
    const overhead = TAG_BYTES + (prefix?.length ?? 0) + RATCHET_OVERHEAD;
    const { state, message } = ratchetEncrypt(rec.ratchet, padToBucket(content, overhead), rec.ad);
    rec.ratchet = state;
    const epoch = epochOf(nowMs);
    const tag = prefix ? routingTag(rec.peerInboxTagKey!, epoch) : routingTag(rec.sendTagKey, epoch);
    const body = prefix ? concatBytes(prefix, message) : message;
    return encodeFrame({ tag, body });
  }

  /** Tags to subscribe to on every transport (hex), refreshed each epoch. */
  watchedTags(nowMs = Date.now()): Map<string, { kind: 'inbox' } | { kind: 'session'; peer: string }> {
    const out = new Map<string, { kind: 'inbox' } | { kind: 'session'; peer: string }>();
    for (const t of watchTags(this.inboxTagKey, nowMs)) out.set(t, { kind: 'inbox' });
    for (const rec of this.sessions.values()) {
      for (const t of watchTags(rec.recvTagKey, nowMs)) out.set(t, { kind: 'session', peer: rec.peer });
    }
    return out;
  }

  /** Returns null for frames that are not addressed to this endpoint (not our tags). */
  receive(frameBytes: Uint8Array, nowMs = Date.now()): Received | null {
    const { tag, body } = decodeFrame(frameBytes);
    const route = this.watchedTags(nowMs).get(toHex(tag));
    if (!route) return null;

    if (route.kind === 'session') return this.decryptWith(route.peer, body, false);

    // Inbox: a PreKeyMessage (2-ciphertext layout; OTK invites use their own tag table and
    // respond(..., { oneTimePrekey })). Known handshake → the initiator has not seen our reply yet.
    const hid = handshakeIdOf(body);
    const known = this.handshakes.get(hid);
    if (known) return this.decryptWith(known, body.subarray(prekeyPrefixLength(false)), false);

    const hs = respond(this.identity, this.signedPrekeys, body, { nowMs });
    const peer = toHex(hs.peerFingerprint);
    const { state, plaintext } = ratchetDecrypt(hs.ratchet, hs.ratchetMessage, hs.ad);
    // Commit only after the first message authenticated. A new handshake from a known
    // peer replaces the old session (reinstall); the app should surface that to the user.
    this.sessions.set(peer, {
      peer,
      ratchet: state,
      ad: hs.ad,
      sendTagKey: hs.tagKeyResponderToInitiator,
      recvTagKey: hs.tagKeyInitiatorToResponder,
      prekeyPrefix: null,
      peerInboxTagKey: null,
      handshakeId: hs.handshakeId,
    });
    this.handshakes.set(hs.handshakeId, peer);
    return { from: peer, plaintext: unpad(plaintext), newSession: true };
  }

  private decryptWith(peer: string, message: Uint8Array, newSession: boolean): Received {
    const rec = this.sessions.get(peer);
    if (!rec) throw new Error('no session for peer');
    const { state, plaintext } = ratchetDecrypt(rec.ratchet, message, rec.ad);
    rec.ratchet = state;
    rec.prekeyPrefix = null; // any authenticated message from the peer proves it has the session
    return { from: peer, plaintext: unpad(plaintext), newSession };
  }
}
