// Checks the SD-Turbo pipeline code (CLIP tokenizer, Euler scheduler, latent/pixel conversions,
// float16 handling) on the CPU with onnxruntime-node, using the same ONNX files as the browser.
// Downloads ~2.6 GB on first run. Usage: npm run check:sd -- [output-dir] ["prompt"]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const ort = createRequire(import.meta.url)('onnxruntime-node');
const { ClipTokenizer } = await import('../src/engines/sd/clipTokenizer.ts');
const { VAE_SCALE, eulerStep, initNoiseSigma, makeSchedule, scaleModelInput } = await import('../src/engines/sd/scheduler.ts');
const { chwToRgba, rgbaToChw } = await import('../src/engines/sd/tensor.ts');
const { gaussianNoise } = await import('../src/lib/prng.ts');
const { float16ToFloat32, float32ToFloat16 } = await import('../src/lib/float16.ts');
const { SD_TURBO_FILES, SD_TURBO_REPO } = await import('../src/engines/models.ts');

const outDir = process.argv[2] ?? 'sd-check';
const prompt = process.argv[3] ?? 'a red apple on a wooden table, studio photo';
const modelDir = join(import.meta.dirname, '../node_modules/.cache/sd-turbo');

for (const f of SD_TURBO_FILES) {
  const file = join(modelDir, f.path);
  if (existsSync(file) && statSync(file).size === f.size) continue;
  mkdirSync(join(file, '..'), { recursive: true });
  console.log(`downloading ${f.path}`);
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', file, SD_TURBO_REPO + f.path], { stdio: 'inherit' });
  if (statSync(file).size !== f.size) throw new Error(`size mismatch for ${f.path}`);
}

const session = (name) => ort.InferenceSession.create(join(modelDir, name, 'model.onnx'), { executionProviders: ['cpu'] });
const floats = (tensor) => (tensor.data instanceof Uint16Array ? float16ToFloat32(tensor.data) : Float32Array.from(tensor.data));
const LATENT = [1, 4, 64, 64];

const tokenizer = new ClipTokenizer(
  JSON.parse(readFileSync(join(modelDir, 'tokenizer/vocab.json'), 'utf8')),
  readFileSync(join(modelDir, 'tokenizer/merges.txt'), 'utf8'),
  { padToken: '!' },
);
const [text, unet, decoder, encoder] = await Promise.all(['text_encoder', 'unet', 'vae_decoder', 'vae_encoder'].map(session));

async function embed(p) {
  const { last_hidden_state } = await text.run({ input_ids: new ort.Tensor('int32', tokenizer.encode(p), [1, 77]) });
  return last_hidden_state;
}

async function denoise(latent, embedding, steps, strength) {
  const schedule = makeSchedule(steps, strength);
  for (let i = 0; i < schedule.timesteps.length; i++) {
    const { out_sample } = await unet.run({
      sample: new ort.Tensor('float32', scaleModelInput(latent, schedule.sigmas[i]), LATENT),
      timestep: new ort.Tensor('int64', BigInt64Array.from([BigInt(schedule.timesteps[i])]), [1]),
      encoder_hidden_states: embedding,
    });
    eulerStep(latent, floats(out_sample), schedule.sigmas[i], schedule.sigmas[i + 1]);
  }
  const { sample } = await decoder.run({ latent_sample: new ort.Tensor('float32', latent.map((v) => v / VAE_SCALE), LATENT) });
  return chwToRgba(floats(sample), 512, 512);
}

function png(rgba) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const raw = Buffer.alloc(512 * 2049);
  for (let y = 0; y < 512; y++) Buffer.from(rgba.buffer, y * 2048, 2048).copy(raw, y * 2049 + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(512, 0);
  ihdr.writeUInt32BE(512, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(outDir, { recursive: true });
let start = Date.now();
const emb = await embed(prompt);
const sigma0 = initNoiseSigma(makeSchedule(1));
const image = await denoise(gaussianNoise(4 * 64 * 64, 1234).map((v) => v * sigma0), emb, 1, 1);
writeFileSync(join(outDir, 'txt2img.png'), png(image));
console.log(`txt2img: ${Date.now() - start} ms → ${join(outDir, 'txt2img.png')}`);

// img2img through the float16 VAE encoder, as the browser worker does.
start = Date.now();
const half = encoder.inputMetadata?.find((m) => m.name === 'sample')?.type === 'float16';
const chw = rgbaToChw(image, 512, 512);
const { latent_sample } = await encoder.run({
  sample: half ? new ort.Tensor('float16', float32ToFloat16(chw), [1, 3, 512, 512]) : new ort.Tensor('float32', chw, [1, 3, 512, 512]),
});
const latent = floats(latent_sample).map((v) => v * VAE_SCALE);
const steps = 2;
const strength = 0.5;
const sigma = makeSchedule(steps, strength).sigmas[0];
const noise = gaussianNoise(latent.length, 7);
for (let i = 0; i < latent.length; i++) latent[i] += noise[i] * sigma;
writeFileSync(join(outDir, 'img2img.png'), png(await denoise(latent, emb, steps, strength)));
console.log(`img2img: ${Date.now() - start} ms → ${join(outDir, 'img2img.png')}`);
