/**
 * Byte helpers shared by every module. Nothing here is secret-dependent except
 * `equalBytes`, which is constant-time with respect to the contents.
 */
import { concatBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export { concatBytes, randomBytes, utf8ToBytes };

export const EMPTY: Uint8Array = new Uint8Array(0);

export function bytesToUtf8(b: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(b);
}

/** Constant-time comparison (length is not secret). */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function u16be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new RangeError(`u16 out of range: ${n}`);
  return new Uint8Array([n >>> 8, n & 0xff]);
}

export function u32be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError(`u32 out of range: ${n}`);
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

export function u64be(n: number | bigint): Uint8Array {
  const v = BigInt(n);
  if (v < 0n || v > 0xffffffffffffffffn) throw new RangeError(`u64 out of range: ${n}`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v);
  return out;
}

/** Overwrite secret material. Best effort only: JS engines may keep copies. */
export function wipe(...arrays: (Uint8Array | null | undefined)[]): void {
  for (const a of arrays) a?.fill(0);
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** RFC 4648 §5 base64url without padding: safe in URLs, JSON and Telegram/Nostr text fields. */
export function toBase64Url(b: Uint8Array): string {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64url');
}

export function fromBase64Url(s: string): Uint8Array {
  if (/[^A-Za-z0-9_-]/.test(s)) throw new Error('invalid base64url');
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

/**
 * Sequential reader for the fixed binary layouts used on the wire. Every read is
 * bounds-checked so a truncated or malicious frame throws instead of reading past the end.
 */
export class Reader {
  private offset = 0;
  private readonly buf: Uint8Array;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  bytes(len: number): Uint8Array {
    if (len < 0 || this.offset + len > this.buf.length) throw new Error('truncated input');
    const out = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return out;
  }

  u8(): number {
    return this.bytes(1)[0]!;
  }

  u16(): number {
    const b = this.bytes(2);
    return (b[0]! << 8) | b[1]!;
  }

  u32(): number {
    const b = this.bytes(4);
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0);
  }

  u64(): bigint {
    const b = this.bytes(8);
    return new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0);
  }

  rest(): Uint8Array {
    return this.bytes(this.buf.length - this.offset);
  }

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  end(): void {
    if (this.remaining !== 0) throw new Error(`unexpected trailing bytes: ${this.remaining}`);
  }
}
