/**
 * CLIP byte-level BPE tokenizer (the one Stable Diffusion's text encoder was trained with),
 * built from the model's own vocab.json and merges.txt so no network access is needed.
 */

const START = '<|startoftext|>';
const END = '<|endoftext|>';
const PATTERN = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/giu;

/** GPT-2/CLIP mapping from bytes to printable unicode characters. */
function bytesToUnicode(): string[] {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n++);
    }
  }
  const table: string[] = new Array(256);
  bs.forEach((b, i) => (table[b] = String.fromCharCode(cs[i])));
  return table;
}

export interface ClipTokenizerOptions {
  maxLength?: number;
  /** SD 2.x pads with "!" (id 0); SD 1.x with the end token. */
  padToken?: string;
}

export class ClipTokenizer {
  private readonly encoder: Map<string, number>;
  private readonly ranks = new Map<string, number>();
  private readonly byteTable = bytesToUnicode();
  private readonly cache = new Map<string, string[]>();
  private readonly textEncoder = new TextEncoder();
  readonly startId: number;
  readonly endId: number;
  readonly padId: number;
  readonly maxLength: number;

  constructor(vocab: Record<string, number>, merges: string, options: ClipTokenizerOptions = {}) {
    this.encoder = new Map(Object.entries(vocab));
    const lines = merges.split('\n');
    let rank = 0;
    for (const line of lines) {
      if (!line || line.startsWith('#version')) continue;
      const parts = line.trim().split(' ');
      if (parts.length === 2) this.ranks.set(`${parts[0]} ${parts[1]}`, rank++);
    }
    this.startId = this.idOf(START);
    this.endId = this.idOf(END);
    this.padId = this.idOf(options.padToken ?? '!');
    this.maxLength = options.maxLength ?? 77;
  }

  private idOf(token: string): number {
    const id = this.encoder.get(token);
    if (id === undefined) throw new Error(`Token ${token} missing from vocabulary`);
    return id;
  }

  private bpe(token: string): string[] {
    const cached = this.cache.get(token);
    if (cached) return cached;
    const chars = Array.from(token);
    let word = [...chars.slice(0, -1), `${chars[chars.length - 1]}</w>`];
    if (word.length === 1) {
      this.cache.set(token, word);
      return word;
    }
    for (;;) {
      let best = -1;
      let bestRank = Number.POSITIVE_INFINITY;
      for (let i = 0; i < word.length - 1; i++) {
        const r = this.ranks.get(`${word[i]} ${word[i + 1]}`);
        if (r !== undefined && r < bestRank) {
          bestRank = r;
          best = i;
        }
      }
      if (best < 0) break;
      const first = word[best];
      const second = word[best + 1];
      const merged: string[] = [];
      for (let i = 0; i < word.length; ) {
        if (i < word.length - 1 && word[i] === first && word[i + 1] === second) {
          merged.push(first + second);
          i += 2;
        } else {
          merged.push(word[i]);
          i += 1;
        }
      }
      word = merged;
      if (word.length === 1) break;
    }
    this.cache.set(token, word);
    return word;
  }

  /** Token ids of `text` without start/end tokens. */
  tokenize(text: string): number[] {
    const clean = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const ids: number[] = [];
    for (const match of clean.matchAll(PATTERN)) {
      const piece = match[0];
      if (piece === START || piece === END) {
        ids.push(this.idOf(piece));
        continue;
      }
      const mapped = Array.from(this.textEncoder.encode(piece), (b) => this.byteTable[b]).join('');
      for (const sub of this.bpe(mapped)) {
        const id = this.encoder.get(sub);
        if (id !== undefined) ids.push(id);
      }
    }
    return ids;
  }

  /** Fixed-length input for the text encoder: start, tokens (truncated), end, padding. */
  encode(text: string): Int32Array {
    const body = this.tokenize(text).slice(0, this.maxLength - 2);
    const out = new Int32Array(this.maxLength).fill(this.padId);
    out[0] = this.startId;
    out.set(body, 1);
    out[body.length + 1] = this.endId;
    return out;
  }
}
