import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClipTokenizer } from '../../src/engines/sd/clipTokenizer.ts';
import { initNoiseSigma, makeSchedule, sigmaAt, trailingTimesteps } from '../../src/engines/sd/scheduler.ts';
import { chwToRgba, circularNoise, rgbaToChw, slerp } from '../../src/engines/sd/tensor.ts';
import { gaussianNoise } from '../../src/lib/prng.ts';

const CACHE = join(import.meta.dirname, '../../node_modules/.cache/gooners-ai-test');
const BASE = 'https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main/tokenizer/';

async function fixture(name: string): Promise<string | null> {
  const file = join(CACHE, name);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  try {
    const res = await fetch(BASE + name);
    if (!res.ok) return null;
    const text = await res.text();
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, text);
    return text;
  } catch {
    return null;
  }
}

const vocab = await fixture('vocab.json');
const merges = await fixture('merges.txt');

describe.skipIf(!vocab || !merges)('CLIP tokenizer (real SD-Turbo vocabulary)', () => {
  const tok = new ClipTokenizer(JSON.parse(vocab!), merges!, { padToken: '!' });

  it('encodes known prompts to the reference ids', () => {
    expect(tok.tokenize('a photo of a cat')).toEqual([320, 1125, 539, 320, 2368]);
    expect(tok.tokenize('A Photo   of a CAT!')).toEqual([320, 1125, 539, 320, 2368, 256]);
  });

  it('builds the 77-token input with start, end and "!" padding', () => {
    const ids = tok.encode('a photo of a cat');
    expect(ids.length).toBe(77);
    expect(Array.from(ids.slice(0, 7))).toEqual([49406, 320, 1125, 539, 320, 2368, 49407]);
    expect(tok.padId).toBe(0);
    expect(ids[7]).toBe(0);
    expect(ids[76]).toBe(0);
  });

  it('handles accents and unknown scripts via byte-level BPE', () => {
    const ids = tok.tokenize('pôr do sol em São Paulo 🌅');
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.every((id) => Number.isInteger(id) && id >= 0 && id < 49408)).toBe(true);
  });

  it('truncates long prompts and always ends with the end token', () => {
    const ids = tok.encode('cat '.repeat(200));
    expect(ids.length).toBe(77);
    expect(ids[76]).toBe(49407);
  });
});

describe('Euler scheduler for SD-Turbo', () => {
  it('matches the diffusers sigma range', () => {
    expect(sigmaAt(999)).toBeCloseTo(14.6146, 3);
    expect(sigmaAt(0)).toBeCloseTo(0.0292, 3);
  });

  it('uses trailing timestep spacing', () => {
    expect(trailingTimesteps(1)).toEqual([999]);
    expect(trailingTimesteps(2)).toEqual([999, 499]);
    expect(trailingTimesteps(3)).toEqual([999, 666, 332]);
    expect(trailingTimesteps(4)).toEqual([999, 749, 499, 249]);
  });

  it('skips the noisiest steps for image-to-image strength', () => {
    expect(makeSchedule(1, 0.5).timesteps).toEqual([499]);
    expect(makeSchedule(2, 0.5).timesteps).toEqual([499, 249]);
    const full = makeSchedule(1);
    expect(full.sigmas.at(-1)).toBe(0);
    expect(initNoiseSigma(full)).toBeCloseTo(14.6146, 3);
  });
});

describe('latent helpers', () => {
  it('converts between CHW floats and RGBA bytes', () => {
    const rgba = new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 64, 255]);
    const chw = rgbaToChw(rgba, 2, 1);
    expect(chw[0]).toBeCloseTo(1);
    expect(chw[1]).toBeCloseTo(-1);
    const back = chwToRgba(chw, 2, 1);
    expect(Array.from(back)).toEqual([255, 0, 128, 255, 0, 255, 64, 255]);
  });

  it('keeps Gaussian noise statistics when interpolating', () => {
    const a = gaussianNoise(16384, 1);
    const b = gaussianNoise(16384, 2);
    const std = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    expect(std(a)).toBeCloseTo(1, 1);
    expect(std(slerp(a, b, 0.5))).toBeCloseTo(1, 1);
    expect(std(circularNoise(a, b, 0.3))).toBeCloseTo(1, 1);
    expect(Array.from(slerp(a, b, 0).slice(0, 4))).toEqual(Array.from(a.slice(0, 4)).map((v) => expect.closeTo(v, 5)));
  });
});
