/**
 * Minimal Nostr client (NIP-01, NIP-40) used as the primary transport (docs/01-transport.md §4.2).
 *
 * - Every frame is a regular event of KIND_FRAME whose content is base64url(frame) and whose
 *   only indexed tag is ["z", hex(routing tag)]. Each event is signed with a fresh random
 *   secp256k1 key, so relays cannot link events by author.
 * - Contact cards are parameterised replaceable events (NIP-78, kind 30078) signed by a key
 *   derived from the capsule key, so the relay keeps only the newest card and nobody without
 *   the capsule key can overwrite it.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { toHex, utf8ToBytes } from '../../reference/src/index.ts';

export const KIND_FRAME = 9259;
export const KIND_CARD = 30078;
export const FRAME_TTL_S = 14 * 24 * 3600;
export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export type Filter = { kinds?: number[]; authors?: string[]; since?: number; limit?: number } & Record<`#${string}`, string[]>;

export function signEvent(kind: number, content: string, tags: string[][], secretKey: Uint8Array = schnorr.utils.randomSecretKey()): NostrEvent {
  const pubkey = toHex(schnorr.getPublicKey(secretKey));
  const created_at = Math.floor(Date.now() / 1000);
  const id = toHex(sha256(utf8ToBytes(JSON.stringify([0, pubkey, created_at, kind, tags, content]))));
  const sig = toHex(schnorr.sign(hexToBytes(id), secretKey));
  return { id, pubkey, created_at, kind, tags, content, sig };
}

export function verifyEvent(e: NostrEvent): boolean {
  try {
    const id = toHex(sha256(utf8ToBytes(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))));
    return id === e.id && schnorr.verify(hexToBytes(e.sig), hexToBytes(e.id), hexToBytes(e.pubkey));
  } catch {
    return false;
  }
}

/** Deterministic signing key for our contact card events, derived from the capsule key. */
export function cardSigningKey(capsuleKey: Uint8Array): Uint8Array {
  // HKDF output reduced into the valid scalar range by retrying with a counter (practically never needed).
  for (let i = 0; i < 16; i++) {
    const sk = hkdf(sha256, capsuleKey, undefined, utf8ToBytes(`SMA/v1/nostr-card-key/${i}`), 32);
    try {
      schnorr.getPublicKey(sk);
      return sk;
    } catch {
      /* out of range: next counter */
    }
  }
  throw new Error('could not derive card key');
}

function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

// ─── Relay connection ──────────────────────────────────────────────────────────

type Listener = (relay: string, e: NostrEvent) => void;

class Relay {
  readonly url: string;
  private ws: WebSocket | null = null;
  private backoff = 1000;
  private closedByUs = false;
  private readonly pendingOk = new Map<string, (ok: boolean, msg: string) => void>();
  private readonly subs = new Map<string, Filter[]>();
  private readonly onEvent: Listener;
  private readonly onStatus: () => void;
  private readonly eoseWaiters = new Map<string, () => void>();
  connected = false;

  constructor(url: string, onEvent: Listener, onStatus: () => void) {
    this.url = url;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.connect();
  }

  private connect(): void {
    if (this.closedByUs) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.backoff = 1000;
      for (const [id, filters] of this.subs) this.raw(['REQ', id, ...filters]);
      this.onStatus();
    };
    ws.onmessage = (m) => this.handle(String(m.data));
    ws.onclose = () => {
      this.connected = false;
      for (const [, cb] of this.pendingOk) cb(false, 'connection closed');
      this.pendingOk.clear();
      this.onStatus();
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (this.closedByUs) return;
    setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 60_000);
  }

  private handle(text: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(msg)) return;
    const [type, a, b, c] = msg as [string, unknown, unknown, unknown];
    if (type === 'EVENT' && typeof a === 'string' && b && typeof b === 'object') {
      const e = b as NostrEvent;
      if (verifyEvent(e)) this.onEvent(this.url, e);
    } else if (type === 'OK' && typeof a === 'string') {
      this.pendingOk.get(a)?.(b === true, String(c ?? ''));
      this.pendingOk.delete(a);
    } else if (type === 'EOSE' && typeof a === 'string') {
      this.eoseWaiters.get(a)?.();
      this.eoseWaiters.delete(a);
    } else if (type === 'CLOSED' && typeof a === 'string') {
      this.eoseWaiters.get(a)?.();
      this.eoseWaiters.delete(a);
    }
  }

  private raw(msg: unknown[]): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  publish(e: NostrEvent, timeoutMs = 8000): Promise<{ ok: boolean; msg: string }> {
    return new Promise((resolve) => {
      const done = (ok: boolean, msg: string) => {
        clearTimeout(timer);
        resolve({ ok, msg });
      };
      const timer = setTimeout(() => {
        this.pendingOk.delete(e.id);
        resolve({ ok: false, msg: 'timeout' });
      }, timeoutMs);
      this.pendingOk.set(e.id, done);
      if (!this.raw(['EVENT', e])) {
        // Not connected yet: retry once the socket opens, until the timeout.
        const retry = setInterval(() => {
          if (this.raw(['EVENT', e])) clearInterval(retry);
        }, 250);
        setTimeout(() => clearInterval(retry), timeoutMs);
      }
    });
  }

  /** Persistent subscription (re-sent on every reconnect). Resolves on EOSE or timeout. */
  subscribe(id: string, filters: Filter[], timeoutMs = 10_000): Promise<void> {
    this.subs.set(id, filters);
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      this.eoseWaiters.set(id, () => {
        clearTimeout(t);
        resolve();
      });
      this.raw(['REQ', id, ...filters]);
    });
  }

  unsubscribe(id: string): void {
    if (this.subs.delete(id)) this.raw(['CLOSE', id]);
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
  }
}

// ─── Pool ──────────────────────────────────────────────────────────────────────

export class RelayPool {
  private readonly relays = new Map<string, Relay>();
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<Listener>();
  /** One-shot query collectors: see every event, before dedupe. */
  private readonly collectors = new Set<Listener>();
  onStatus: () => void = () => {};

  private dispatch(relay: string, e: NostrEvent): void {
    for (const c of this.collectors) c(relay, e);
    if (this.seen.has(e.id)) return;
    this.seen.add(e.id);
    if (this.seen.size > 20_000) this.seen.clear();
    for (const l of this.listeners) l(relay, e);
  }

  private relay(url: string): Relay {
    let r = this.relays.get(url);
    if (!r) {
      r = new Relay(url, (relay, e) => this.dispatch(relay, e), () => this.onStatus());
      this.relays.set(url, r);
    }
    return r;
  }

  /** Keeps connections to `urls` open; closes the rest. */
  setRelays(urls: string[]): void {
    for (const [url, r] of this.relays) {
      if (!urls.includes(url)) {
        r.close();
        this.relays.delete(url);
      }
    }
    for (const u of urls) this.relay(u);
  }

  status(): { url: string; connected: boolean }[] {
    return [...this.relays.values()].map((r) => ({ url: r.url, connected: r.connected }));
  }

  onEvent(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Publishes to every listed relay (opening connections as needed); resolves per relay. */
  async publish(e: NostrEvent, urls: string[]): Promise<{ url: string; ok: boolean; msg: string }[]> {
    return Promise.all(urls.map(async (url) => ({ url, ...(await this.relay(url).publish(e)) })));
  }

  /** Persistent subscription on `urls`; resolves when every relay has sent EOSE (or timed out). */
  async subscribe(id: string, filters: Filter[], urls: string[]): Promise<void> {
    await Promise.all(urls.map((u) => this.relay(u).subscribe(id, filters)));
  }

  unsubscribe(id: string): void {
    for (const r of this.relays.values()) r.unsubscribe(id);
  }

  /** One-shot query: collects matching events until every relay sends EOSE (or times out). */
  async query(filters: Filter[], urls: string[], timeoutMs = 8000, graceMs = 1500): Promise<NostrEvent[]> {
    const id = `q${Math.random().toString(36).slice(2, 10)}`;
    const got = new Map<string, NostrEvent>();
    // Once something matched, give the other relays only `graceMs` more (one may never EOSE).
    let early: () => void = () => {};
    const firstHit = new Promise<void>((resolve) => (early = resolve));
    const collector: Listener = (_r, e) => {
      if (!matches(filters, e)) return;
      if (got.size === 0) setTimeout(early, graceMs);
      got.set(e.id, e);
    };
    this.collectors.add(collector);
    try {
      await Promise.race([Promise.all(urls.map((u) => this.relay(u).subscribe(id, filters, timeoutMs))), firstHit]);
    } finally {
      this.unsubscribe(id);
      this.collectors.delete(collector);
    }
    return [...got.values()];
  }

  close(): void {
    for (const r of this.relays.values()) r.close();
    this.relays.clear();
  }
}

function matches(filters: Filter[], e: NostrEvent): boolean {
  return filters.some(
    (f) =>
      (!f.kinds || f.kinds.includes(e.kind)) &&
      (!f.authors || f.authors.includes(e.pubkey)) &&
      (f.since === undefined || e.created_at >= f.since) &&
      Object.entries(f)
        .filter(([k]) => k.startsWith('#'))
        .every(([k, vals]) => e.tags.some((t) => t[0] === k.slice(1) && (vals as string[]).includes(t[1] ?? ''))),
  );
}
