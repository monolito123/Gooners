/**
 * Contact exchange (docs/02-crypto-protocol.md §5.2).
 *
 * A ContactCard (signed bundle + inbox tag key + mailboxes + name) is ~8 KB, far too big
 * for a QR code. The QR / invite link carries a ContactCapsule instead:
 *
 *   capsule = { fingerprint[32], capsule_key[32], locator = { relays, tag[16] } }   (~150 B)
 *   card blob on relays = nonce[12] ‖ AES-256-GCM(capsule_key, nonce, aad, ContactCard)
 *
 * Whoever scans the capsule fetches the newest blob carrying `tag`, decrypts it and accepts
 * the card only if its identity key hashes to the pinned fingerprint, so a relay can
 * neither read the card nor substitute another identity.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, equalBytes, randomBytes, utf8ToBytes } from './bytes.ts';
import { verifyPrekeyBundle } from './handshake.ts';
import { type ContentObject, decodeMessage, encodeContent, encodeMessage } from './payload.ts';
import type { ContactInfo, Endpoint } from './session.ts';
import { fingerprint } from './sign.ts';

const CARD_AAD = utf8ToBytes('SMA/v1/contact-card');
const MAX_NAME = 64;
const MAX_RELAYS = 8;

export interface ParsedCard {
  contact: ContactInfo;
  displayName: string;
  relays: string[];
}

export interface Capsule {
  fingerprint: Uint8Array;
  capsuleKey: Uint8Array;
  relays: string[];
  tag: Uint8Array;
}

/** Relay URLs must be wss:// (ws:// only for localhost development). */
export function sanitizeRelays(relays: unknown[]): string[] {
  const out: string[] = [];
  for (const r of relays) {
    if (typeof r !== 'string' || r.length > 200) continue;
    let u: URL;
    try {
      u = new URL(r);
    } catch {
      continue;
    }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && local)) continue;
    const s = u.toString().replace(/\/$/, '');
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, MAX_RELAYS);
}

export function sanitizeName(name: unknown): string {
  // Strip control and bidi-override characters so a name cannot fake UI text.
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim() : '';
  return [...s].slice(0, MAX_NAME).join('');
}

export function createContactCard(e: Endpoint, displayName: string, relays: string[], nowMs = Date.now()): Uint8Array {
  return encodeMessage('ContactCard', {
    bundle: decodeMessage('SignedBlob', e.publishBundle(nowMs)),
    inboxTagKey: e.inboxTagKey,
    inboxes: [{ nostr: { relays: sanitizeRelays(relays) } }],
    displayName: sanitizeName(displayName),
  });
}

/**
 * Verifies the card's bundle. With `expectedFingerprint` (from a capsule or an existing
 * session) the identity is pinned; without it the card is trust-on-first-use.
 */
export function parseContactCard(bytes: Uint8Array, opts: { expectedFingerprint?: Uint8Array; nowMs?: number } = {}): ParsedCard {
  const card = decodeMessage('ContactCard', bytes) as {
    bundle?: Record<string, unknown>;
    inboxTagKey?: Uint8Array;
    inboxes?: { nostr?: { relays?: string[] } }[];
    displayName?: string;
  };
  if (!card.bundle) throw new Error('contact card has no bundle');
  if (!(card.inboxTagKey instanceof Uint8Array) || card.inboxTagKey.length !== 32) throw new Error('bad inbox tag key');
  const bundleBytes = encodeMessage('SignedBlob', card.bundle);
  const body = decodeMessage('PrekeyBundle', card.bundle.body as Uint8Array) as { identityKey: Uint8Array };
  const fp = opts.expectedFingerprint ?? fingerprint(body.identityKey);
  const bundle = verifyPrekeyBundle(bundleBytes, fp, opts.nowMs);
  return {
    contact: { fingerprint: fp, inboxTagKey: new Uint8Array(card.inboxTagKey), bundle },
    displayName: sanitizeName(card.displayName),
    relays: sanitizeRelays((card.inboxes ?? []).flatMap((m) => m.nostr?.relays ?? [])),
  };
}

// ─── Capsule (what the QR code / invite link holds) ────────────────────────────

export function cardLocatorTag(capsuleKey: Uint8Array): Uint8Array {
  return hmac(sha256, capsuleKey, utf8ToBytes('SMA/v1/card-locator')).subarray(0, 16);
}

export function encodeCapsule(fp: Uint8Array, capsuleKey: Uint8Array, relays: string[]): Uint8Array {
  return encodeMessage('ContactCapsule', {
    version: 1,
    fingerprint: fp,
    capsuleKey,
    cardLocators: [{ nostr: { relays: sanitizeRelays(relays), tag: cardLocatorTag(capsuleKey) } }],
  });
}

export function decodeCapsule(bytes: Uint8Array): Capsule {
  const c = decodeMessage('ContactCapsule', bytes) as {
    version?: number;
    fingerprint?: Uint8Array;
    capsuleKey?: Uint8Array;
    cardLocators?: { nostr?: { relays?: string[]; tag?: Uint8Array } }[];
  };
  if (c.version !== 1) throw new Error('unsupported invite version');
  if (c.fingerprint?.length !== 32 || c.capsuleKey?.length !== 32) throw new Error('malformed invite');
  const loc = c.cardLocators?.find((l) => l.nostr)?.nostr;
  const tag = cardLocatorTag(c.capsuleKey);
  if (!loc || !loc.tag || !equalBytes(loc.tag, tag)) throw new Error('invite has no valid card locator');
  const relays = sanitizeRelays(loc.relays ?? []);
  if (relays.length === 0) throw new Error('invite lists no usable relay');
  return { fingerprint: new Uint8Array(c.fingerprint), capsuleKey: new Uint8Array(c.capsuleKey), relays, tag };
}

export function sealCard(capsuleKey: Uint8Array, card: Uint8Array): Uint8Array {
  const nonce = randomBytes(12);
  return concatBytes(nonce, gcm(capsuleKey, nonce, CARD_AAD).encrypt(card));
}

export function openCard(capsuleKey: Uint8Array, sealed: Uint8Array): Uint8Array {
  if (sealed.length < 12 + 16) throw new Error('sealed card too short');
  return gcm(capsuleKey, sealed.subarray(0, 12), CARD_AAD).decrypt(sealed.subarray(12));
}


/** Wraps our card as a `Content` (sent with the first message of a session). */
export function cardContent(card: Uint8Array): Uint8Array {
  return encodeContent({ contactCard: decodeMessage('ContactCard', card) });
}

/** Extracts the card bytes from a decoded `Content` whose body is `contactCard`. */
export function cardFromContent(content: ContentObject): Uint8Array {
  if (content.body !== 'contactCard') throw new Error('not a contact card');
  return encodeMessage('ContactCard', content.contactCard as Record<string, unknown>);
}
