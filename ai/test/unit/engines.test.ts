import { describe, expect, it } from 'vitest';
import { estimateTokens, fitToContext } from '../../src/engines/context.ts';
import { TEXT_MODELS, findTextModel, isUsable, resolveWebLLMId } from '../../src/engines/models.ts';
import { SCENE_MODES, interpretPrompt, sanitizeSpec } from '../../src/engines/procedural/artEngine.ts';
import { parseWebLLMReport } from '../../src/engines/progress.ts';
import { float16ToFloat32, float32ToFloat16, fromHalf, toHalf } from '../../src/lib/float16.ts';
import { hashString, mulberry32 } from '../../src/lib/prng.ts';
import { formatBytes, formatDuration } from '../../src/lib/format.ts';

describe('fitToContext', () => {
  const system = { role: 'system' as const, content: 'sys' };
  it('keeps everything that fits', () => {
    const msgs = [system, { role: 'user' as const, content: 'hi' }, { role: 'assistant' as const, content: 'hello' }, { role: 'user' as const, content: 'q' }];
    expect(fitToContext(msgs, 4096, 512)).toEqual(msgs);
  });
  it('drops the oldest turns and never starts with an assistant turn', () => {
    const long = 'x'.repeat(3000);
    const msgs = [system, { role: 'user' as const, content: long }, { role: 'assistant' as const, content: long }, { role: 'user' as const, content: 'latest' }];
    const out = fitToContext(msgs, 1024, 256);
    expect(out[0]).toBe(system);
    expect(out.at(-1)?.content).toBe('latest');
    expect(out[1].role).toBe('user');
  });
  it('cuts the beginning of a single oversized message', () => {
    const out = fitToContext([system, { role: 'user', content: `${'a'.repeat(10000)}END` }], 1024, 256);
    expect(out[1].content.startsWith('…')).toBe(true);
    expect(out[1].content.endsWith('END')).toBe(true);
    expect(estimateTokens(out[1].content)).toBeLessThan(1024);
  });
});

describe('WebLLM progress parsing', () => {
  it('reads download progress and infers the total size', () => {
    const r = parseWebLLMReport({ progress: 0.5, text: 'Fetching param cache[12/22]: 300MB fetched. 50% completed, 20 secs elapsed. It can take a while when you first visit this page.' });
    expect(r).toEqual({ phase: 'download', fraction: 0.5, loadedMB: 300, totalMB: 600 });
  });
  it('recognises cache loads, shader compilation and completion', () => {
    expect(parseWebLLMReport({ progress: 0, text: 'Loading model from cache[3/22]: 120MB loaded. 20% completed, 2 secs elapsed.' }).phase).toBe('cache');
    expect(parseWebLLMReport({ progress: 0, text: 'Loading GPU shader modules[30/60]: 50% completed' })).toEqual({ phase: 'compile', fraction: 0.5 });
    expect(parseWebLLMReport({ progress: 1, text: 'Finish loading on WebGPU - nvidia' }).phase).toBe('ready');
  });
});

describe('model catalog', () => {
  it('falls back to the f32 build without shader-f16', () => {
    const llama = findTextModel('Llama-3.2-1B-Instruct-q4f16_1-MLC')!;
    expect(resolveWebLLMId(llama, true)).toBe('Llama-3.2-1B-Instruct-q4f16_1-MLC');
    expect(resolveWebLLMId(llama, false)).toBe('Llama-3.2-1B-Instruct-q4f32_1-MLC');
    expect(isUsable(llama, { supported: true, hasF16: false })).toBe(true);
    expect(isUsable(findTextModel('gemma3-1b-it-q4f16_1-MLC')!, { supported: true, hasF16: false })).toBe(false);
  });
  it('keeps CPU models usable without WebGPU', () => {
    for (const m of TEXT_MODELS.filter((x) => x.backend === 'wasm')) expect(isUsable(m, { supported: false, hasF16: false })).toBe(true);
    for (const m of TEXT_MODELS.filter((x) => x.backend === 'webgpu')) expect(isUsable(m, { supported: false, hasF16: false })).toBe(false);
  });
});

describe('procedural prompt interpreter', () => {
  it('maps English and Portuguese keywords to scenes', () => {
    expect(interpretPrompt('neon synthwave sunset').mode).toBe('synthwave');
    expect(interpretPrompt('ondas do mar ao entardecer').mode).toBe('ocean');
    expect(interpretPrompt('aurora boreal sobre montanhas').mode).toBe('aurora');
    expect(interpretPrompt('galáxia distante com nebulosa').mode).toBe('nebula');
  });
  it('derives palettes, speed and determinism from the words', () => {
    const fire = interpretPrompt('slow fire');
    expect(fire.palette[2]).toBe('#f48c06');
    expect(fire.speed).toBeLessThan(0.7);
    expect(interpretPrompt('chaotic plasma').speed).toBeGreaterThan(1.5);
    expect(interpretPrompt('azul e roxo').palette).toContain('#3a86ff');
    expect(interpretPrompt('anything at all', 5)).toEqual(interpretPrompt('anything at all', 5));
    expect(SCENE_MODES).toContain(interpretPrompt('xyzzy').mode);
  });
  it('sanitizes LLM output', () => {
    const fallback = interpretPrompt('ocean');
    const spec = sanitizeSpec({ mode: 'lava', palette: ['#000000', '#111111', '#222222', '#333333'], speed: 99, glow: -1 }, fallback);
    expect(spec.mode).toBe('lava');
    expect(spec.speed).toBe(2.5);
    expect(spec.glow).toBe(0);
    expect(sanitizeSpec({ mode: 'nope', palette: ['red'] }, fallback)).toMatchObject({ mode: fallback.mode, palette: fallback.palette });
  });
});

describe('numeric helpers', () => {
  it('round-trips float16', () => {
    const values = new Float32Array([0, 1, -2.5, 0.333, 65504, 1e-5, -0.0001]);
    const back = float16ToFloat32(float32ToFloat16(values));
    values.forEach((v, i) => expect(back[i]).toBeCloseTo(v, Math.abs(v) < 1 ? 3 : 0));
    expect(fromHalf(toHalf(Number.POSITIVE_INFINITY))).toBe(Number.POSITIVE_INFINITY);
    expect(toHalf(1)).toBe(0x3c00);
  });
  it('produces stable seeded randomness', () => {
    expect(hashString('gooners')).toBe(hashString('gooners'));
    expect(hashString('gooners')).not.toBe(hashString('Gooners'));
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('formats sizes and durations', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2.5 * 2 ** 30)).toBe('2.5 GB');
    expect(formatDuration(0.25)).toBe('250 ms');
    expect(formatDuration(125)).toBe('2m 05s');
  });
});
