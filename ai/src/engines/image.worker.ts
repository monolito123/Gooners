/**
 * SD-Turbo text-to-image / image-to-image on ONNX Runtime Web (WebGPU), fully local.
 * Pipeline: CLIP tokenizer → text encoder → UNet (1–4 Euler steps) → VAE decoder.
 * Also produces video frames: latent morphs/loops and a zoom feedback loop (img2img).
 */
import { ort } from './ortEnv.ts';
import { float16ToFloat32, float32ToFloat16 } from '../lib/float16.ts';
import { gaussianNoise } from '../lib/prng.ts';
import * as store from '../lib/blobStore.ts';
import { exposeWorker } from '../lib/rpc.ts';
import type { DiffusionFrame, DiffusionRequest, ImageWorkerApi } from './imageTypes.ts';
import { SD_TURBO_FILES, SD_TURBO_GROUP, SD_TURBO_REPO } from './models.ts';
import { ClipTokenizer } from './sd/clipTokenizer.ts';
import { VAE_SCALE, eulerStep, initNoiseSigma, makeSchedule, scaleModelInput } from './sd/scheduler.ts';
import { IMAGE_SIZE, LATENT_LENGTH, LATENT_SIZE, chwToRgba, circularNoise, lerp, rgbaToChw, slerp } from './sd/tensor.ts';

type Session = ort.InferenceSession;
interface Sessions {
  text: Session;
  unet: Session;
  decoder: Session;
  encoder?: Session;
}

let sessions: Sessions | null = null;
let tokenizer: ClipTokenizer | null = null;
const embeddingCache = new Map<string, Float32Array>();

const SESSION_BASE: ort.InferenceSession.SessionOptions = {
  executionProviders: ['webgpu'],
  enableMemPattern: false,
  enableCpuMemArena: false,
  graphOptimizationLevel: 'all',
  extra: {
    session: {
      disable_prepacking: '1',
      use_device_allocator_for_initializers: '1',
      use_ort_model_bytes_directly: '1',
      use_ort_model_bytes_for_initializers: '1',
    },
  },
};

const DIMS: Record<string, Record<string, number>> = {
  text_encoder: { batch_size: 1, sequence_length: 77 },
  unet: { batch_size: 1, num_channels: 4, height: LATENT_SIZE, width: LATENT_SIZE, sequence_length: 77, steps: 1 },
  vae_decoder: { batch_size: 1, num_channels_latent: 4, height_latent: LATENT_SIZE, width_latent: LATENT_SIZE },
  vae_encoder: { batch_size: 1, num_channels: 3, height: IMAGE_SIZE, width: IMAGE_SIZE },
};

function fileFor(name: string) {
  const f = SD_TURBO_FILES.find((x) => x.path.startsWith(`${name}/`));
  if (!f) throw new Error(`Unknown model part ${name}`);
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

function readFloat(tensor: ort.Tensor): Float32Array {
  const data = tensor.data as unknown;
  if (data instanceof Float32Array) return data;
  if (data instanceof Uint16Array) return float16ToFloat32(data);
  return Float32Array.from(data as ArrayLike<number>);
}

function output(result: ort.InferenceSession.OnnxValueMapType, preferred: string): ort.Tensor {
  return (result[preferred] ?? Object.values(result)[0]) as ort.Tensor;
}

// ─── pipeline stages ────────────────────────────────────────────────────────────────────

async function embed(prompt: string): Promise<Float32Array> {
  const key = prompt.trim();
  const hit = embeddingCache.get(key);
  if (hit) return hit;
  const { text } = requireSessions();
  const ids = tokenizer!.encode(key);
  const type = inputType(text, 'input_ids', 'int32');
  const input =
    type === 'int64'
      ? new ort.Tensor('int64', BigInt64Array.from(ids, (v) => BigInt(v)), [1, ids.length])
      : new ort.Tensor('int32', ids, [1, ids.length]);
  const result = await text.run({ input_ids: input });
  const hidden = readFloat(output(result, 'last_hidden_state'));
  disposeAll(result);
  if (embeddingCache.size > 16) embeddingCache.clear();
  embeddingCache.set(key, hidden);
  return hidden;
}

async function denoise(latent: Float32Array, embedding: Float32Array, steps: number, strength: number): Promise<Float32Array> {
  const { unet } = requireSessions();
  const schedule = makeSchedule(steps, strength);
  const hiddenDims = [1, 77, embedding.length / 77];
  for (let i = 0; i < schedule.timesteps.length; i++) {
    const sigma = schedule.sigmas[i];
    const t = schedule.timesteps[i];
    const timestepType = inputType(unet, 'timestep', 'int64');
    const timestep =
      timestepType === 'int64'
        ? new ort.Tensor('int64', BigInt64Array.from([BigInt(t)]), [1])
        : floatTensor(unet, 'timestep', Float32Array.from([t]), [1]);
    const result = await unet.run({
      sample: floatTensor(unet, 'sample', scaleModelInput(latent, sigma), [1, 4, LATENT_SIZE, LATENT_SIZE]),
      timestep,
      encoder_hidden_states: floatTensor(unet, 'encoder_hidden_states', embedding, hiddenDims),
    });
    const eps = readFloat(output(result, 'out_sample'));
    disposeAll(result);
    eulerStep(latent, eps, sigma, schedule.sigmas[i + 1]);
  }
  return latent;
}

async function decode(latent: Float32Array): Promise<Uint8ClampedArray> {
  const { decoder } = requireSessions();
  const scaled = new Float32Array(latent.length);
  for (let i = 0; i < latent.length; i++) scaled[i] = latent[i] / VAE_SCALE;
  const result = await decoder.run({
    latent_sample: floatTensor(decoder, 'latent_sample', scaled, [1, 4, LATENT_SIZE, LATENT_SIZE]),
  });
  const pixels = readFloat(output(result, 'sample'));
  disposeAll(result);
  return chwToRgba(pixels, IMAGE_SIZE, IMAGE_SIZE);
}

async function encodeImage(rgba: Uint8ClampedArray): Promise<Float32Array> {
  const encoder = await ensureEncoder();
  const result = await encoder.run({
    sample: floatTensor(encoder, 'sample', rgbaToChw(rgba, IMAGE_SIZE, IMAGE_SIZE), [1, 3, IMAGE_SIZE, IMAGE_SIZE]),
  });
  const latent = readFloat(output(result, 'latent_sample'));
  disposeAll(result);
  const out = new Float32Array(latent.length);
  for (let i = 0; i < latent.length; i++) out[i] = latent[i] * VAE_SCALE;
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

function requireSessions(): Sessions {
  if (!sessions || !tokenizer) throw new Error('Image model is not loaded');
  return sessions;
}

function disposeAll(result: ort.InferenceSession.OnnxValueMapType): void {
  for (const value of Object.values(result)) (value as ort.Tensor).dispose?.();
}

async function createSession(name: string, onRead?: (fraction: number) => void): Promise<Session> {
  const bytes = await store.readBytes(fileFor(name).key, (p) => onRead?.(p.loaded / p.total));
  return ort.InferenceSession.create(bytes, { ...SESSION_BASE, freeDimensionOverrides: DIMS[name] });
}

async function ensureEncoder(): Promise<Session> {
  const s = requireSessions();
  s.encoder ??= await createSession('vae_encoder');
  return s.encoder;
}

async function releaseSessions(): Promise<void> {
  if (!sessions) return;
  const list = [sessions.text, sessions.unet, sessions.decoder, sessions.encoder];
  sessions = null;
  embeddingCache.clear();
  for (const s of list) await s?.release().catch(() => undefined);
}

exposeWorker<ImageWorkerApi>({
  async status() {
    const files = await Promise.all(
      SD_TURBO_FILES.map(async (f) => {
        const stored = await store.getFile(f.key);
        return { key: f.key, received: stored?.received ?? 0, size: f.size, complete: Boolean(stored?.complete) };
      }),
    );
    return { files, loaded: sessions !== null };
  },

  async download(_params, { progress, signal }) {
    const done = new Map<string, number>();
    const total = SD_TURBO_FILES.reduce((sum, f) => sum + f.size, 0);
    const report = (file: string) => {
      let loaded = 0;
      for (const v of done.values()) loaded += v;
      progress({ loaded, total, file });
    };
    for (const f of SD_TURBO_FILES) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      await store.download({
        key: f.key,
        url: SD_TURBO_REPO + f.path,
        group: SD_TURBO_GROUP,
        size: f.size,
        signal,
        onProgress: (p) => {
          done.set(f.key, p.loaded);
          report(f.path);
        },
      });
      done.set(f.key, f.size);
      report(f.path);
    }
    return undefined;
  },

  async load(_params, { progress }) {
    if (sessions) return { ms: 0 };
    const start = performance.now();
    if (!('gpu' in navigator) || !navigator.gpu) throw new Error('WebGPU is required for the diffusion model');
    const [vocab, merges] = await Promise.all([
      store.readBlob('sd-turbo/tokenizer/vocab.json').then((b) => b.text()),
      store.readBlob('sd-turbo/tokenizer/merges.txt').then((b) => b.text()),
    ]);
    tokenizer = new ClipTokenizer(JSON.parse(vocab) as Record<string, number>, merges, { padToken: '!' });
    const parts = ['text_encoder', 'unet', 'vae_decoder'] as const;
    const created: Session[] = [];
    try {
      for (let i = 0; i < parts.length; i++) {
        const file = parts[i];
        const session = await createSession(file, (fraction) =>
          progress({ stage: 'read', file, index: i, count: parts.length, fraction }),
        );
        progress({ stage: 'session', file, index: i, count: parts.length, fraction: 1 });
        created.push(session);
      }
    } catch (error) {
      for (const s of created) await s.release().catch(() => undefined);
      throw error;
    }
    sessions = { text: created[0], unet: created[1], decoder: created[2] };
    return { ms: performance.now() - start };
  },

  async generate(req: DiffusionRequest, { progress, signal }) {
    requireSessions();
    const start = performance.now();
    const total = Math.max(1, req.frames);
    const steps = Math.min(4, Math.max(1, Math.round(req.steps)));
    const embA = await embed(req.prompt);
    const embB = req.mode === 'morph' && req.promptB?.trim() ? await embed(req.promptB) : embA;
    const noiseA = gaussianNoise(LATENT_LENGTH, req.seed);
    const noiseB = gaussianNoise(LATENT_LENGTH, req.seedB ?? req.seed + 7919);
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
        const noise = req.mode === 'loop' ? circularNoise(noiseA, noiseB, t) : slerp(noiseA, noiseB, t);
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
    await releaseSessions();
    tokenizer = null;
    return undefined;
  },
});
