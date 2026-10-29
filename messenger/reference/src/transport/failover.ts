/**
 * Module 1 fallback architecture: multi-homed delivery with per-transport circuit breakers.
 *
 * - Routes are tried in priority order; a transport that is rate limited is parked until
 *   its `retry_after` passes, one that errors is parked with exponential backoff.
 * - `redundancy` > 1 sends the same frame through several hosts. Receivers dedupe by frame
 *   hash, and the ratchet rejects a second copy anyway (its message key is gone).
 * - A host that rejects a payload permanently (TransportRejectedError) is parked for an
 *   hour: we route around a host that does not want our traffic instead of disguising it.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { toHex } from '../bytes.ts';
import { RateLimitedError, TransportRejectedError, type StoredFrame, type Transport } from './types.ts';

export interface Route {
  transport: string;
  mailbox: string;
}

interface Health {
  parkedUntilMs: number;
  failures: number;
}

/** Sending and fetching fail independently: a send quota must not stop us from reading. */
type Op = 'send' | 'fetch';

const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const REJECTED_PARK_MS = 60 * 60_000;

export class FailoverTransport {
  private readonly transports = new Map<string, Transport>();
  private readonly health = new Map<string, Health>(); // key: `${op}|${transport}`
  private readonly cursors = new Map<string, string>();
  private readonly seen = new Set<string>();
  private readonly now: () => number;

  constructor(transports: Transport[], now: () => number = Date.now) {
    for (const t of transports) {
      this.transports.set(t.name, t);
      for (const op of ['send', 'fetch'] as const) this.health.set(`${op}|${t.name}`, { parkedUntilMs: 0, failures: 0 });
    }
    this.now = now;
  }

  isAvailable(name: string, op: Op = 'send'): boolean {
    return (this.health.get(`${op}|${name}`)?.parkedUntilMs ?? Infinity) <= this.now();
  }

  /** Delivers through the first `redundancy` healthy routes; returns the ids per transport. */
  async send(routes: Route[], frame: Uint8Array, redundancy = 1): Promise<Route[]> {
    const delivered: Route[] = [];
    const errors: string[] = [];
    for (const route of routes) {
      if (delivered.length >= redundancy) break;
      const t = this.transports.get(route.transport);
      if (!t || !this.isAvailable(route.transport, 'send')) continue;
      if (frame.length > t.maxFrameBytes) continue;
      try {
        await t.send(route.mailbox, frame);
        this.health.set(`send|${route.transport}`, { parkedUntilMs: 0, failures: 0 });
        delivered.push(route);
      } catch (err) {
        errors.push(String(err));
        this.park('send', route.transport, err);
      }
    }
    if (delivered.length === 0) throw new Error(`no transport delivered the frame: ${errors.join('; ') || 'all parked'}`);
    return delivered;
  }

  /** Polls every healthy route and returns frames not seen before (deduped by hash). */
  async fetch(routes: Route[]): Promise<StoredFrame[]> {
    const out: StoredFrame[] = [];
    for (const route of routes) {
      const t = this.transports.get(route.transport);
      if (!t || !this.isAvailable(route.transport, 'fetch')) continue;
      const key = `${route.transport}|${route.mailbox}`;
      try {
        const res = await t.fetch(route.mailbox, this.cursors.get(key));
        if (res.cursor !== undefined) this.cursors.set(key, res.cursor);
        for (const f of res.frames) {
          const h = toHex(sha256(f.frame));
          if (this.seen.has(h)) continue;
          this.seen.add(h);
          out.push(f);
        }
        this.health.set(`fetch|${route.transport}`, { parkedUntilMs: 0, failures: 0 });
      } catch (err) {
        this.park('fetch', route.transport, err);
      }
    }
    return out;
  }

  private park(op: Op, name: string, err: unknown): void {
    const h = this.health.get(`${op}|${name}`)!;
    h.failures += 1;
    if (err instanceof RateLimitedError) h.parkedUntilMs = this.now() + err.retryAfterMs;
    else if (err instanceof TransportRejectedError) h.parkedUntilMs = this.now() + REJECTED_PARK_MS;
    else h.parkedUntilMs = this.now() + Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (h.failures - 1));
  }
}
