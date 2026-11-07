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

describe('second release: image models, abliterated models, manifest fallback', async () => {
  const { DIFFUSION_MODELS, defaultDiffusionModel, diffusionDevice, findDiffusionModel } = await import('../../src/engines/models.ts');
  const { withLegacyManifestFallback } = await import('../../src/engines/legacyManifest.ts');
  const { orbitNoise } = await import('../../src/engines/sd/tensor.ts');
  const { gaussianNoise } = await import('../../src/lib/prng.ts');

  it('runs real diffusion on every device class', () => {
    const f16 = { supported: true, hasF16: true };
    const noF16 = { supported: true, hasF16: false };
    const cpu = { supported: false, hasF16: false };
    const swiftshader = { supported: true, hasF16: false, isFallbackAdapter: true };
    expect(defaultDiffusionModel(f16)).toBe('sdxs');
    expect(defaultDiffusionModel(noF16)).toBe('sdxs-fp32');
    expect(defaultDiffusionModel(cpu)).toBe('sdxs-fp32');
    const fp32 = findDiffusionModel('sdxs-fp32');
    expect(diffusionDevice(fp32, f16)).toBe('webgpu');
    expect(diffusionDevice(fp32, cpu)).toBe('wasm');
    expect(diffusionDevice(fp32, swiftshader)).toBe('wasm');
    expect(diffusionDevice(fp32, f16, true)).toBe('wasm');
    expect(diffusionDevice(findDiffusionModel('sdxs'), noF16)).toBeNull();
    expect(diffusionDevice(findDiffusionModel('sd-turbo'), f16)).toBe('webgpu');
    for (const m of DIFFUSION_MODELS) {
      const roles = m.files.map((f) => f.role);
      for (const role of ['vocab', 'merges', 'text_encoder', 'unet', 'vae_decoder'] as const) expect(roles).toContain(role);
      expect(roles.includes('vae_encoder')).toBe(m.img2img);
      expect(new Set(m.files.map((f) => f.key)).size).toBe(m.files.length);
      for (const f of m.files) expect(f.url).toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/.+/);
    }
  });

  it('lists abliterated models for WebGPU (shader-f16) and the CPU', () => {
    const llama = findTextModel('Llama-3.2-1B-Instruct-abliterated-q4f16_1-MLC')!;
    expect(llama.tags).toContain('uncensored');
    expect(llama.mlc?.libFrom).toBe('Llama-3.2-1B-Instruct-q4f16_1-MLC');
    expect(isUsable(llama, { supported: true, hasF16: true })).toBe(true);
    expect(isUsable(llama, { supported: true, hasF16: false })).toBe(false);
    const cpu = findTextModel('wasm:onnx-community/Qwen2.5-0.5B-Instruct-abliterated-v3-ONNX')!;
    expect(isUsable(cpu, { supported: false, hasF16: false })).toBe(true);
    expect(cpu.dtype).toBe('q8');
  });

  it('builds WebLLM records for abliterated weights on the official libraries', async () => {
    const { webllmAppConfig } = await import('../../src/engines/modelCache.ts');
    const config = await webllmAppConfig([]);
    const official = config.model_list.find((r) => r.model_id === 'Llama-3.2-1B-Instruct-q4f16_1-MLC')!;
    const derived = config.model_list.find((r) => r.model_id === 'Llama-3.2-1B-Instruct-abliterated-q4f16_1-MLC')!;
    expect(derived.model_lib).toBe(official.model_lib);
    expect(derived.model).toContain('Sandoche/Llama-3.2-1B-Instruct-abliterated');
    expect(derived.integrity).toBeUndefined();
    expect(config.cacheBackend).toBe('indexeddb');
  });

  it('falls back to ndarray-cache.json for older MLC conversions', async () => {
    const seen: string[] = [];
    const fake = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      return new Response(url.endsWith('ndarray-cache.json') ? '{"records":[]}' : 'missing', { status: url.endsWith('ndarray-cache.json') ? 200 : 404 });
    }) as typeof fetch;
    const wrapped = withLegacyManifestFallback(fake);
    const res = await wrapped('https://huggingface.co/x/y/resolve/abc/tensor-cache.json');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"records":[]}');
    expect(seen.at(-1)).toBe('https://huggingface.co/x/y/resolve/abc/ndarray-cache.json');
    expect((await wrapped('https://huggingface.co/x/y/resolve/abc/params_shard_0.bin')).status).toBe(404);
  });

  it('orbits close to the seed noise and closes the loop', () => {
    const a = gaussianNoise(4096, 1);
    const b = gaussianNoise(4096, 2);
    const c = gaussianNoise(4096, 3);
    const start = orbitNoise(a, b, c, 0, 0.45);
    const end = orbitNoise(a, b, c, 1, 0.45);
    start.forEach((v, i) => expect(v).toBeCloseTo(end[i], 4));
    const mid = orbitNoise(a, b, c, 0.37, 0.45);
    const std = Math.sqrt(mid.reduce((s, v) => s + v * v, 0) / mid.length);
    expect(std).toBeCloseTo(1, 1);
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += (a[i] * mid[i]) / a.length;
    expect(dot).toBeGreaterThan(0.85);
  });
});
