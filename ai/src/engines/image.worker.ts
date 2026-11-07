/**
 * Text-to-image / image-to-image on ONNX Runtime Web, fully local, for every model in
 * DIFFUSION_MODELS (SDXS fp16/fp32, SD-Turbo) on WebGPU or on the CPU (WebAssembly).
 * Pipeline: CLIP tokenizer → text encoder → UNet (1–4 Euler steps) → VAE decoder.
 * Also produces video frames: latent morphs/loops and a zoom feedback loop (img2img).
 */
import { ort } from './ortEnv.ts';
import { float16ToFloat32, float32ToFloat16 } from '../lib/float16.ts';
import { gaussianNoise } from '../lib/prng.ts';
import * as store from '../lib/blobStore.ts';
import { exposeWorker } from '../lib/rpc.ts';
import type { DiffusionFrame, DiffusionRequest, ImageWorkerApi } from './imageTypes.ts';
import { type DiffusionDevice, type DiffusionModelInfo, type DiffusionRole, findDiffusionModel } from './models.ts';
import { ClipTokenizer } from './sd/clipTokenizer.ts';
import { eulerStep, initNoiseSigma, makeSchedule, scaleModelInput } from './sd/scheduler.ts';
import { IMAGE_SIZE, LATENT_LENGTH, LATENT_SIZE, chwToRgba, lerp, orbitNoise, rgbaToChw, slerp } from './sd/tensor.ts';

type Session = ort.InferenceSession;
interface Loaded {
  model: DiffusionModelInfo;
  device: DiffusionDevice;
  tokenizer: ClipTokenizer;
  text: Session;
  unet: Session;
  decoder: Session;
  encoder?: Session;
}

let loaded: Loaded | null = null;
const embeddingCache = new Map<string, Float32Array>();

function sessionOptions(device: DiffusionDevice, dims?: Record<string, number>): ort.InferenceSession.SessionOptions {
  if (device === 'wasm') return { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  return {
    executionProviders: ['webgpu'],
    enableMemPattern: false,
    enableCpuMemArena: false,
    graphOptimizationLevel: 'all',
    freeDimensionOverrides: dims,
    extra: {
      session: {
        disable_prepacking: '1',
        use_device_allocator_for_initializers: '1',
        use_ort_model_bytes_directly: '1',
        use_ort_model_bytes_for_initializers: '1',
      },
    },
  };
}

function fileFor(model: DiffusionModelInfo, role: DiffusionRole) {
  const f = model.files.find((x) => x.role === role);
  if (!f) throw new Error(`${model.label} has no ${role}`);
  return f;
}

// ─── tensors with dtype taken from the model's own metadata ─────────────────────────────

function inputType(session: Session, name: string, fallback: ort.Tensor.Type): ort.Tensor.Type {
  const meta = session.inputMetadata?.find((m) => m.name === name);
  return meta && meta.isTensor ? meta.type : fallback;
}

function floatTensor(session: Session, name: string, data: Float32Array, dims: number[]): ort.Tensor {
  return inputType(session, name, 'float32') === 'float16'
    ? new ort.Tensor('float16', float32ToFloat16(data), dims)
    : new ort.Tensor('float32', data, dims);
}

function intTensor(session: Session, name: string, values: ArrayLike<number>, dims: number[]): ort.Tensor {
  const type = inputType(session, name, 'int64');
  if (type === 'int64') return new ort.Tensor('int64', BigInt64Array.from(Array.from(values), (v) => BigInt(v)), dims);
  if (type === 'int32') return new ort.Tensor('int32', Int32Array.from(Array.from(values)), dims);
  return floatTensor(session, name, Float32Array.from(Array.from(values)), dims);
}

function readFloat(tensor: ort.Tensor): Float32Array {
  const data = tensor.data as unknown;
  if (data instanceof Float32Array) return data;
  if (data instanceof Uint16Array) return float16ToFloat32(data);
  return Float32Array.from(data as ArrayLike<number>);
}

function output(result: ort.InferenceSession.OnnxValueMapType, session: Session, preferred: string): ort.Tensor {
  return (result[preferred] ?? result[session.outputNames[0]] ?? Object.values(result)[0]) as ort.Tensor;
}

function disposeAll(result: ort.InferenceSession.OnnxValueMapType): void {
  for (const value of Object.values(result)) (value as ort.Tensor).dispose?.();
}

// ─── pipeline stages ────────────────────────────────────────────────────────────────────

function requireLoaded(): Loaded {
  if (!loaded) throw new Error('Image model is not loaded');
  return loaded;
}

async function embed(prompt: string): Promise<Float32Array> {
  const key = prompt.trim();
  const hit = embeddingCache.get(key);
  if (hit) return hit;
  const { text, tokenizer } = requireLoaded();
  const ids = tokenizer.encode(key);
  const result = await text.run({ input_ids: intTensor(text, 'input_ids', ids, [1, ids.length]) });
  const hidden = readFloat(output(result, text, 'last_hidden_state'));
  disposeAll(result);
  if (embeddingCache.size > 16) embeddingCache.clear();
  embeddingCache.set(key, hidden);
  return hidden;
}

async function denoise(latent: Float32Array, embedding: Float32Array, steps: number, strength: number): Promise<Float32Array> {
  const { unet } = requireLoaded();
  const schedule = makeSchedule(steps, strength);
  const hiddenDims = [1, 77, embedding.length / 77];
  for (let i = 0; i < schedule.timesteps.length; i++) {
    const sigma = schedule.sigmas[i];
    const result = await unet.run({
      sample: floatTensor(unet, 'sample', scaleModelInput(latent, sigma), [1, 4, LATENT_SIZE, LATENT_SIZE]),
      timestep: intTensor(unet, 'timestep', [schedule.timesteps[i]], [1]),
      encoder_hidden_states: floatTensor(unet, 'encoder_hidden_states', embedding, hiddenDims),
    });
    const eps = readFloat(output(result, unet, 'out_sample'));
    disposeAll(result);
    eulerStep(latent, eps, sigma, schedule.sigmas[i + 1]);
  }
  return latent;
}

async function decode(latent: Float32Array): Promise<Uint8ClampedArray> {
  const { decoder, model } = requireLoaded();
  const scaled = new Float32Array(latent.length);
  for (let i = 0; i < latent.length; i++) scaled[i] = latent[i] / model.vaeScale;
  const name = decoder.inputNames[0];
  const result = await decoder.run({ [name]: floatTensor(decoder, name, scaled, [1, 4, LATENT_SIZE, LATENT_SIZE]) });
  const pixels = readFloat(output(result, decoder, 'sample'));
  disposeAll(result);
  return chwToRgba(pixels, IMAGE_SIZE, IMAGE_SIZE);
}

async function encodeImage(rgba: Uint8ClampedArray): Promise<Float32Array> {
  const { model } = requireLoaded();
  if (!model.img2img) throw new Error(`${model.label} cannot start from an image; choose SD-Turbo for image-to-image`);
  const encoder = await ensureEncoder();
  const name = encoder.inputNames[0];
  const result = await encoder.run({
    [name]: floatTensor(encoder, name, rgbaToChw(rgba, IMAGE_SIZE, IMAGE_SIZE), [1, 3, IMAGE_SIZE, IMAGE_SIZE]),
  });
  const latent = readFloat(output(result, encoder, 'latent_sample'));
  disposeAll(result);
  const out = new Float32Array(latent.length);
  for (let i = 0; i < latent.length; i++) out[i] = latent[i] * model.vaeScale;
  return out;
}

/** Image-to-image: noise the encoded image to the schedule's first sigma, then denoise. */
async function img2img(rgba: Uint8ClampedArray, embedding: Float32Array, seed: number, steps: number, strength: number) {
  const clean = await encodeImage(rgba);
  const sigma = makeSchedule(steps, strength).sigmas[0];
  const noise = gaussianNoise(LATENT_LENGTH, seed);
  for (let i = 0; i < clean.length; i++) clean[i] += noise[i] * sigma;
  return decode(await denoise(clean, embedding, steps, strength));
}

async function txt2img(noise: Float32Array, embedding: Float32Array, steps: number): Promise<Uint8ClampedArray> {
  const sigma = initNoiseSigma(makeSchedule(steps));
  const latent = new Float32Array(noise.length);
  for (let i = 0; i < noise.length; i++) latent[i] = noise[i] * sigma;
  return decode(await denoise(latent, embedding, steps, 1));
}

/** Zoom/rotate a frame around its centre (feedback loop for "dream zoom" videos). */
function transformFrame(rgba: Uint8ClampedArray, scale: number, rotateDeg: number): Uint8ClampedArray {
  const src = new OffscreenCanvas(IMAGE_SIZE, IMAGE_SIZE);
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), IMAGE_SIZE, IMAGE_SIZE), 0, 0);
  const dst = new OffscreenCanvas(IMAGE_SIZE, IMAGE_SIZE);
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(IMAGE_SIZE / 2, IMAGE_SIZE / 2);
  ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.drawImage(src, -IMAGE_SIZE / 2, -IMAGE_SIZE / 2);
  return ctx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE).data;
}

// ─── session management ────────────────────────────────────────────────────────────────

async function createSession(role: DiffusionRole, onRead?: (fraction: number) => void): Promise<Session> {
  const { model, device } = pending!;
  const bytes = await store.readBytes(fileFor(model, role).key, (p) => onRead?.(p.loaded / p.total));
  return ort.InferenceSession.create(bytes, sessionOptions(device, model.dims?.[role]));
}

/** Model/device being loaded (createSession reads it). */
let pending: { model: DiffusionModelInfo; device: DiffusionDevice } | null = null;

async function ensureEncoder(): Promise<Session> {
  const l = requireLoaded();
  if (!l.encoder) {
    pending = { model: l.model, device: l.device };
    l.encoder = await createSession('vae_encoder');
  }
  return l.encoder;
}

async function release(): Promise<void> {
  if (!loaded) return;
  const list = [loaded.text, loaded.unet, loaded.decoder, loaded.encoder];
  loaded = null;
  embeddingCache.clear();
  for (const s of list) await s?.release().catch(() => undefined);
}

exposeWorker<ImageWorkerApi>({
  async download({ modelId }, { progress, signal }) {
    const model = findDiffusionModel(modelId);
    const done = new Map<string, number>();
    const total = model.files.reduce((sum, f) => sum + f.size, 0);
    const report = (file: string) => {
      let sum = 0;
      for (const v of done.values()) sum += v;
      progress({ loaded: sum, total, file });
    };
    for (const f of model.files) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      await store.download({
        key: f.key,
        url: f.url,
        group: model.id,
        size: f.size,
        signal,
        onProgress: (p) => {
          done.set(f.key, p.loaded);
          report(f.role);
        },
      });
      done.set(f.key, f.size);
      report(f.role);
    }
    return undefined;
  },

  async load({ modelId, device }, { progress }) {
    if (loaded?.model.id === modelId && loaded.device === device) return { ms: 0 };
    await release();
    const start = performance.now();
    const model = findDiffusionModel(modelId);
    if (device === 'webgpu' && !('gpu' in navigator && navigator.gpu)) throw new Error('WebGPU is not available; use the CPU instead');
    const [vocab, merges] = await Promise.all([
      store.readBlob(fileFor(model, 'vocab').key).then((b) => b.text()),
      store.readBlob(fileFor(model, 'merges').key).then((b) => b.text()),
    ]);
    const tokenizer = new ClipTokenizer(JSON.parse(vocab) as Record<string, number>, merges, { padToken: model.padToken });
    pending = { model, device };
    const roles = ['text_encoder', 'unet', 'vae_decoder'] as const;
    const created: Session[] = [];
    try {
      for (let i = 0; i < roles.length; i++) {
        const role = roles[i];
        const session = await createSession(role, (fraction) => progress({ stage: 'read', file: role, index: i, count: roles.length, fraction }));
        progress({ stage: 'session', file: role, index: i, count: roles.length, fraction: 1 });
        created.push(session);
      }
    } catch (error) {
      for (const s of created) await s.release().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      if (/bad_alloc|allocate|out of memory/i.test(message)) {
        throw new Error(`Not enough memory to load ${model.label} on the ${device === 'wasm' ? 'CPU' : 'GPU'}. Close other tabs or pick a smaller model.`);
      }
      throw error;
    }
    loaded = { model, device, tokenizer, text: created[0], unet: created[1], decoder: created[2] };
    return { ms: performance.now() - start };
  },

  async generate(req: DiffusionRequest, { progress, signal }) {
    const { model } = requireLoaded();
    const start = performance.now();
    const total = Math.max(1, req.frames);
    const steps = Math.min(model.maxSteps, Math.max(1, Math.round(req.steps)));
    const embA = await embed(req.prompt);
    const embB = req.mode === 'morph' && req.promptB?.trim() ? await embed(req.promptB) : embA;
    const noiseA = gaussianNoise(LATENT_LENGTH, req.seed);
    const noiseB = gaussianNoise(LATENT_LENGTH, req.seedB ?? req.seed + 7919);
    const noiseC = req.mode === 'loop' ? gaussianNoise(LATENT_LENGTH, req.seed + 15485863) : noiseB;
    let previous: Uint8ClampedArray | undefined = req.init?.rgba;

    for (let index = 0; index < total; index++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const frameStart = performance.now();
      const t = total === 1 ? 0 : index / (req.mode === 'loop' ? total : total - 1);
      let rgba: Uint8ClampedArray;
      if (req.mode === 'single') {
        const seed = req.seed + index;
        rgba = req.init
          ? await img2img(req.init.rgba, embA, seed, steps, req.init.strength)
          : await txt2img(index === 0 ? noiseA : gaussianNoise(LATENT_LENGTH, seed), embA, steps);
      } else if (req.mode === 'zoom') {
        const zoom = req.zoom ?? { scale: 1.04, rotateDeg: 0.4, strength: 0.4 };
        if (!previous) rgba = await txt2img(noiseA, embA, steps);
        else rgba = await img2img(transformFrame(previous, zoom.scale, zoom.rotateDeg), embA, req.seed + index, steps, zoom.strength);
        previous = rgba;
      } else {
        const noise = req.mode === 'loop' ? orbitNoise(noiseA, noiseB, noiseC, t, req.radius ?? 0.45) : slerp(noiseA, noiseB, t * (req.walk ?? 1));
        const emb = embB === embA ? embA : lerp(embA, embB, t);
        rgba = await txt2img(noise, emb, steps);
      }
      const frame: DiffusionFrame = { index, total, width: IMAGE_SIZE, height: IMAGE_SIZE, rgba, ms: performance.now() - frameStart };
      // Zoom keeps `previous` for the next frame, so send a copy.
      const payload = req.mode === 'zoom' ? { ...frame, rgba: new Uint8ClampedArray(rgba) } : frame;
      progress(payload, [payload.rgba.buffer as ArrayBuffer]);
    }
    return { frames: total, ms: performance.now() - start };
  },

  async unload() {
    await release();
    return undefined;
  },
});
