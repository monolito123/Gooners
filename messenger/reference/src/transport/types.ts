/**
 * Transport abstraction. A transport is an untrusted, replaceable mailbox: it stores and
 * forwards opaque frames and is never trusted for confidentiality, integrity or ordering.
 */

export interface StoredFrame {
  /** Host-specific id (Telegram "chat:message", Nostr event id, IPFS CID, ...). */
  id: string;
  frame: Uint8Array;
}

export interface FetchResult {
  frames: StoredFrame[];
  /** Opaque resume point for the next fetch. */
  cursor?: string;
}

export interface Transport {
  readonly name: string;
  /** Largest frame this host accepts (bytes). */
  readonly maxFrameBytes: number;
  send(mailbox: string, frame: Uint8Array): Promise<string>;
  fetch(mailbox: string, cursor?: string): Promise<FetchResult>;
}

/** The host asked us to slow down (Telegram 429 / FLOOD_WAIT, relay rate limit). */
export class RateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(transport: string, retryAfterMs: number) {
    super(`${transport}: rate limited for ${retryAfterMs} ms`);
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Permanent refusal: payload rejected, account restricted, mailbox gone. */
export class TransportRejectedError extends Error {
  constructor(transport: string, reason: string) {
    super(`${transport}: ${reason}`);
    this.name = 'TransportRejectedError';
  }
}
