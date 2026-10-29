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
import { concatBytes, fromBase64Url, toBase64Url, toHex } from './bytes.ts';
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
import {
  RATCHET_OVERHEAD,
  type RatchetState,
  deserializeState,
  ratchetDecrypt,
  ratchetEncrypt,
  serializeState,
} from './ratchet.ts';

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

type Route = { kind: 'inbox' } | { kind: 'session'; peer: string };

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
  private readonly rootKey: Uint8Array;
  private readonly sessions = new Map<string, SessionRecord>();
  /** Replay cache: handshake id → peer. Must outlive sessions until the SPK expires. */
  private readonly handshakes = new Map<string, string>();
  private sessionsVersion = 0;
  private tagCache: { key: string; map: Map<string, Route> } | null = null;

  constructor(rootKey: Uint8Array, nowMs = Date.now()) {
    this.rootKey = rootKey;
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

  /** True while we initiated the session and have not yet seen the peer's first reply. */
  awaitingReply(peer: string): boolean {
    return this.sessions.get(peer)?.prekeyPrefix != null;
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
      this.sessionsVersion++;
    }
    return this.encryptFor(rec, content, nowMs);
  }

  /** Sends on an existing session (e.g. replying to someone who contacted us first). */
  sendTo(peer: string, content: Uint8Array, nowMs = Date.now()): Uint8Array {
    const rec = this.sessions.get(peer);
    if (!rec) throw new Error('no session for peer');
    return this.encryptFor(rec, content, nowMs);
  }

  private encryptFor(rec: SessionRecord, content: Uint8Array, nowMs: number): Uint8Array {
    const prefix = rec.prekeyPrefix;
    const overhead = TAG_BYTES + (prefix?.length ?? 0) + RATCHET_OVERHEAD;
    const { state, message } = ratchetEncrypt(rec.ratchet, padToBucket(content, overhead), rec.ad);
    rec.ratchet = state;
    const epoch = epochOf(nowMs);
    const tag = prefix ? routingTag(rec.peerInboxTagKey!, epoch) : routingTag(rec.sendTagKey, epoch);
    const body = prefix ? concatBytes(prefix, message) : message;
    return encodeFrame({ tag, body });
  }

  /**
   * Tags to subscribe to on every transport (hex), refreshed each epoch. `backlogEpochs`
   * adds older epochs for catching up after being offline (e.g. 168 = one week).
   */
  watchedTags(nowMs = Date.now(), backlogEpochs = 0): Map<string, Route> {
    const key = `${epochOf(nowMs)}|${backlogEpochs}|${this.sessionsVersion}`;
    if (this.tagCache?.key === key) return this.tagCache.map;
    const out = new Map<string, Route>();
    for (const t of watchTags(this.inboxTagKey, nowMs, undefined, backlogEpochs)) out.set(t, { kind: 'inbox' });
    for (const rec of this.sessions.values()) {
      for (const t of watchTags(rec.recvTagKey, nowMs, undefined, backlogEpochs)) out.set(t, { kind: 'session', peer: rec.peer });
    }
    this.tagCache = { key, map: out };
    return out;
  }

  /** Returns null for frames that are not addressed to this endpoint (not our tags). */
  receive(frameBytes: Uint8Array, nowMs = Date.now(), backlogEpochs = 0): Received | null {
    const { tag, body } = decodeFrame(frameBytes);
    const route = this.watchedTags(nowMs, backlogEpochs).get(toHex(tag));
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
    this.sessionsVersion++;
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

  /**
   * Full device state as JSON (root key, prekeys, sessions, replay cache). It is secret:
   * store it only inside the encrypted vault, and never sync it to another device.
   */
  serialize(): string {
    const b = (x: Uint8Array | null) => (x ? toBase64Url(x) : null);
    return JSON.stringify({
      v: 1,
      root: b(this.rootKey),
      spks: this.signedPrekeys.map((k) => ({
        id: k.id,
        pk: b(k.keyPair.publicKey),
        sk: b(k.keyPair.secretKey),
        created: k.createdAtMs,
        expires: k.expiresAtMs,
      })),
      sessions: [...this.sessions.values()].map((r) => ({
        peer: r.peer,
        ratchet: serializeState(r.ratchet),
        ad: b(r.ad),
        sendTagKey: b(r.sendTagKey),
        recvTagKey: b(r.recvTagKey),
        prekeyPrefix: b(r.prekeyPrefix),
        peerInboxTagKey: b(r.peerInboxTagKey),
        handshakeId: r.handshakeId,
      })),
      handshakes: [...this.handshakes.entries()],
    });
  }

  static deserialize(json: string): Endpoint {
    const o = JSON.parse(json);
    if (o.v !== 1) throw new Error('unsupported endpoint state version');
    const b = (x: string | null) => (x === null ? null : fromBase64Url(x));
    const e = new Endpoint(fromBase64Url(o.root));
    e.signedPrekeys = o.spks.map((k: { id: number; pk: string; sk: string; created: number; expires: number }) => ({
      id: k.id,
      keyPair: { publicKey: fromBase64Url(k.pk), secretKey: fromBase64Url(k.sk) },
      createdAtMs: k.created,
      expiresAtMs: k.expires,
    }));
    for (const r of o.sessions) {
      e.sessions.set(r.peer, {
        peer: r.peer,
        ratchet: deserializeState(r.ratchet),
        ad: fromBase64Url(r.ad),
        sendTagKey: fromBase64Url(r.sendTagKey),
        recvTagKey: fromBase64Url(r.recvTagKey),
        prekeyPrefix: b(r.prekeyPrefix),
        peerInboxTagKey: b(r.peerInboxTagKey),
        handshakeId: r.handshakeId,
      });
    }
    for (const [hid, peer] of o.handshakes) e.handshakes.set(hid, peer);
    return e;
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
