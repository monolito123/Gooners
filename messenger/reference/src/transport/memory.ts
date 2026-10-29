/** In-process transport for tests and demos; behaves like a relay with an append-only log. */
import { RateLimitedError, type FetchResult, type Transport } from './types.ts';

export class MemoryTransport implements Transport {
  readonly name: string;
  readonly maxFrameBytes: number;
  private readonly log = new Map<string, Uint8Array[]>();
  /** Set to make the next N sends fail with a rate limit (failover tests). */
  rateLimitNextSends = 0;

  constructor(name = 'memory', maxFrameBytes = 1 << 20) {
    this.name = name;
    this.maxFrameBytes = maxFrameBytes;
  }

  async send(mailbox: string, frame: Uint8Array): Promise<string> {
    if (this.rateLimitNextSends > 0) {
      this.rateLimitNextSends--;
      throw new RateLimitedError(this.name, 30_000);
    }
    const list = this.log.get(mailbox) ?? [];
    list.push(frame.slice());
    this.log.set(mailbox, list);
    return `${mailbox}:${list.length - 1}`;
  }

  async fetch(mailbox: string, cursor?: string): Promise<FetchResult> {
    const list = this.log.get(mailbox) ?? [];
    const from = cursor ? Number(cursor) : 0;
    return {
      frames: list.slice(from).map((frame, i) => ({ id: `${mailbox}:${from + i}`, frame })),
      cursor: String(list.length),
    };
  }

  /** What the host operator can see: sizes and opaque bytes. */
  inspect(mailbox: string): Uint8Array[] {
    return this.log.get(mailbox) ?? [];
  }
}
