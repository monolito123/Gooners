/**
 * Model catalog. Text models run either on WebGPU through WebLLM (MLC-compiled, 4-bit) or on
 * the CPU through Transformers.js/ONNX Runtime WASM when WebGPU is unavailable. Sizes are the
 * download sizes of the published weights; VRAM figures come from WebLLM's model records.
 */
export type TextBackend = 'webgpu' | 'wasm';
export type ModelTag = 'chat' | 'code' | 'reasoning' | 'tiny' | 'multilingual' | 'uncensored';
export type Localized = { en: string; pt: string };

export interface TextModelInfo {
  /** WebLLM model_id for webgpu models, `wasm:<repo>` for CPU models, `custom:<id>` for user models. */
  id: string;
  backend: TextBackend;
  label: string;
  params: string;
  quant: string;
  downloadMB: number;
  vramMB: number;
  contextWindow: number;
  tags: ModelTag[];
  /** Needs the WebGPU shader-f16 feature; `f32Variant` is used on adapters without it. */
  requiresF16: boolean;
  f32Variant?: string;
  /** CPU models: Hugging Face repo and ONNX dtype. */
  repo?: string;
  dtype?: 'q4' | 'q8' | 'int8' | 'fp16';
  /** User-supplied MLC model (e.g. a community fine-tune). */
  custom?: { modelUrl: string; modelLib: string };
  /**
   * Community MLC weights with the same architecture as an official WebLLM model: they run on
   * that model's compiled library (`libFrom`), with weights from `modelUrl`.
   */
  mlc?: { modelUrl: string; libFrom: string };
  blurb: Localized;
}

export const TEXT_MODELS: TextModelInfo[] = [
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    backend: 'webgpu',
    label: 'Llama 3.2 1B Instruct',
    params: '1.2B',
    quant: 'q4f16',
    downloadMB: 672,
    vramMB: 879,
    contextWindow: 4096,
    tags: ['chat', 'multilingual'],
    requiresF16: true,
    f32Variant: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    blurb: { en: 'Best all-round quality under 1 GB of VRAM.', pt: 'Melhor qualidade geral com menos de 1 GB de VRAM.' },
  },
  {
    id: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
    backend: 'webgpu',
    label: 'Qwen2.5 Coder 1.5B',
    params: '1.5B',
    quant: 'q4f16',
    downloadMB: 840,
    vramMB: 1630,
    contextWindow: 4096,
    tags: ['code', 'chat'],
    requiresF16: true,
    f32Variant: 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC',
    blurb: { en: 'Recommended for the App Builder: writes HTML, CSS and JavaScript.', pt: 'Recomendado para o App Builder: escreve HTML, CSS e JavaScript.' },
  },
  {
    id: 'Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC',
    backend: 'webgpu',
    label: 'Qwen2.5 Coder 0.5B',
    params: '0.5B',
    quant: 'q4f16',
    downloadMB: 276,
    vramMB: 945,
    contextWindow: 4096,
    tags: ['code', 'tiny'],
    requiresF16: true,
    f32Variant: 'Qwen2.5-Coder-0.5B-Instruct-q4f32_1-MLC',
    blurb: { en: 'Light coding model for small apps and widgets.', pt: 'Modelo de código leve para apps e widgets simples.' },
  },
  {
    id: 'Qwen3-0.6B-q4f16_1-MLC',
    backend: 'webgpu',
    label: 'Qwen3 0.6B',
    params: '0.6B',
    quant: 'q4f16',
    downloadMB: 335,
    vramMB: 1403,
    contextWindow: 4096,
    tags: ['chat', 'reasoning', 'multilingual'],
    requiresF16: true,
    f32Variant: 'Qwen3-0.6B-q4f32_1-MLC',
    blurb: { en: 'Thinks step by step before answering (shown as "reasoning").', pt: 'Raciocina passo a passo antes de responder (aparece como "raciocínio").' },
  },
  {
    id: 'gemma3-1b-it-q4f16_1-MLC',
    backend: 'webgpu',
    label: 'Gemma 3 1B',
    params: '1B',
    quant: 'q4f16',
    downloadMB: 574,
    vramMB: 711,
    contextWindow: 4096,
    tags: ['chat', 'multilingual'],
    requiresF16: true,
    blurb: { en: 'Google model with good Portuguese and a small memory footprint.', pt: 'Modelo do Google com bom português e pouca memória.' },
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    backend: 'webgpu',
    label: 'Qwen2.5 0.5B Instruct',
    params: '0.5B',
    quant: 'q4f16',
    downloadMB: 276,
    vramMB: 945,
    contextWindow: 4096,
    tags: ['chat', 'tiny', 'multilingual'],
    requiresF16: true,
    f32Variant: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
    blurb: { en: 'Fast and small; fine for short answers.', pt: 'Rápido e pequeno; bom para respostas curtas.' },
  },
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    backend: 'webgpu',
    label: 'SmolLM2 360M Instruct',
    params: '360M',
    quant: 'q4f16',
    downloadMB: 198,
    vramMB: 376,
    contextWindow: 4096,
    tags: ['chat', 'tiny'],
    requiresF16: true,
    f32Variant: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
    blurb: { en: 'Smallest download; runs on almost any GPU (English).', pt: 'Menor download; roda em quase qualquer GPU (inglês).' },
  },
  // Abliterated ("uncensored") variants: refusal behaviour removed from the weights.
  {
    id: 'Llama-3.2-1B-Instruct-abliterated-q4f16_1-MLC',
    backend: 'webgpu',
    label: 'Llama 3.2 1B Abliterated',
    params: '1.2B',
    quant: 'q4f16',
    downloadMB: 672,
    vramMB: 879,
    contextWindow: 4096,
    tags: ['chat', 'uncensored', 'multilingual'],
    requiresF16: true,
    mlc: {
      modelUrl: 'https://huggingface.co/Sandoche/Llama-3.2-1B-Instruct-abliterated-q4f16_1-MLC/resolve/052bc232082385a722cb6872df37567f4f7a61f1/',
      libFrom: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    },
    blurb: {
      en: 'Llama 3.2 1B with refusals removed (abliteration): answers without moralising. You are responsible for how you use it.',
      pt: 'Llama 3.2 1B sem recusas (abliteração): responde sem moralizar. Você é responsável pelo uso.',
    },
  },
  {
    id: 'Qwen3-0.6B-abliterated-q4f16_1-MLC',
    backend: 'webgpu',
    label: 'Qwen3 0.6B Abliterated',
    params: '0.6B',
    quant: 'q4f16',
    downloadMB: 335,
    vramMB: 1403,
    contextWindow: 4096,
    tags: ['chat', 'uncensored', 'reasoning', 'multilingual'],
    requiresF16: true,
    mlc: {
      modelUrl: 'https://huggingface.co/Jay0628/Qwen3-0.6B-abliterated-MLC-q4f16_1/resolve/21cd3471cec408100b67b2eb30796c5753c3b11e/',
      libFrom: 'Qwen3-0.6B-q4f16_1-MLC',
    },
    blurb: {
      en: 'Small uncensored model that reasons before answering.',
      pt: 'Modelo pequeno sem censura que raciocina antes de responder.',
    },
  },
  {
    id: 'wasm:onnx-community/Qwen2.5-0.5B-Instruct-abliterated-v3-ONNX',
    backend: 'wasm',
    label: 'Qwen2.5 0.5B Abliterated (CPU)',
    params: '0.5B',
    quant: 'q8',
    downloadMB: 472,
    vramMB: 0,
    contextWindow: 2048,
    tags: ['chat', 'uncensored', 'multilingual'],
    requiresF16: false,
    repo: 'onnx-community/Qwen2.5-0.5B-Instruct-abliterated-v3-ONNX',
    dtype: 'q8',
    blurb: {
      en: 'Uncensored model that runs on any device, without WebGPU (CPU).',
      pt: 'Modelo sem censura que roda em qualquer aparelho, sem WebGPU (CPU).',
    },
  },
  // CPU (WASM) fallbacks for browsers without WebGPU.
  {
    id: 'wasm:HuggingFaceTB/SmolLM2-360M-Instruct',
    backend: 'wasm',
    label: 'SmolLM2 360M (CPU)',
    params: '360M',
    quant: 'q4',
    downloadMB: 369,
    vramMB: 0,
    contextWindow: 2048,
    tags: ['chat', 'tiny'],
    requiresF16: false,
    repo: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    dtype: 'q4',
    blurb: { en: 'Runs on the CPU without WebGPU. Slower, but works everywhere.', pt: 'Roda na CPU, sem WebGPU. Mais lento, mas funciona em qualquer lugar.' },
  },
  {
    id: 'wasm:HuggingFaceTB/SmolLM2-135M-Instruct',
    backend: 'wasm',
    label: 'SmolLM2 135M (CPU)',
    params: '135M',
    quant: 'q4',
    downloadMB: 173,
    vramMB: 0,
    contextWindow: 2048,
    tags: ['chat', 'tiny'],
    requiresF16: false,
    repo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    dtype: 'q4',
    blurb: { en: 'Tiny CPU model for slow devices.', pt: 'Modelo minúsculo para CPU em aparelhos modestos.' },
  },
  {
    id: 'wasm:onnx-community/Qwen2.5-Coder-0.5B-Instruct',
    backend: 'wasm',
    label: 'Qwen2.5 Coder 0.5B (CPU)',
    params: '0.5B',
    quant: 'q8',
    downloadMB: 609,
    vramMB: 0,
    contextWindow: 4096,
    tags: ['code'],
    requiresF16: false,
    repo: 'onnx-community/Qwen2.5-Coder-0.5B-Instruct',
    dtype: 'q8',
    blurb: { en: 'Coding model for the App Builder on devices without WebGPU.', pt: 'Modelo de código para o App Builder em aparelhos sem WebGPU.' },
  },
  {
    id: 'wasm:onnx-community/Qwen2.5-0.5B-Instruct',
    backend: 'wasm',
    label: 'Qwen2.5 0.5B (CPU)',
    params: '0.5B',
    quant: 'q4',
    downloadMB: 749,
    vramMB: 0,
    contextWindow: 2048,
    tags: ['chat', 'multilingual'],
    requiresF16: false,
    repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
    dtype: 'q4',
    blurb: { en: 'Multilingual CPU model (Portuguese included).', pt: 'Modelo multilíngue para CPU (inclui português).' },
  },
];

/** blobStore group holding the CPU models' files (keys are their Hugging Face URLs). */
export const TRANSFORMERS_GROUP = 'transformers';

export const DEFAULT_CHAT_MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
export const DEFAULT_CODE_MODEL = 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC';
export const DEFAULT_CPU_MODEL = 'wasm:HuggingFaceTB/SmolLM2-360M-Instruct';
export const DEFAULT_CPU_CODE_MODEL = 'wasm:onnx-community/Qwen2.5-Coder-0.5B-Instruct';

export function findTextModel(id: string, custom: TextModelInfo[] = []): TextModelInfo | undefined {
  return TEXT_MODELS.find((m) => m.id === id || m.f32Variant === id) ?? custom.find((m) => m.id === id);
}

/** The WebLLM model_id to actually load on this adapter (f32 variant when shader-f16 is missing). */
export function resolveWebLLMId(model: TextModelInfo, hasF16: boolean): string {
  if (model.custom) return model.id;
  return !hasF16 && model.f32Variant ? model.f32Variant : model.id;
}

export function isUsable(model: TextModelInfo, gpu: { supported: boolean; hasF16: boolean }): boolean {
  if (model.backend === 'wasm') return true;
  if (!gpu.supported) return false;
  return !(model.requiresF16 && !gpu.hasF16 && !model.f32Variant);
}

// ─── Image models (ONNX Runtime Web) ────────────────────────────────────────────────────

export type DiffusionModelId = 'sdxs' | 'sdxs-fp32' | 'sd-turbo';
export type DiffusionRole = 'vocab' | 'merges' | 'text_encoder' | 'unet' | 'vae_decoder' | 'vae_encoder';
export type DiffusionDevice = 'webgpu' | 'wasm';

export interface DiffusionFile {
  role: DiffusionRole;
  /** blobStore key (the file is stored once per model). */
  key: string;
  url: string;
  size: number;
}

export interface DiffusionModelInfo {
  id: DiffusionModelId;
  label: string;
  blurb: Localized;
  /** fp16 weights need WebGPU with shader-f16; fp32 weights run on any WebGPU or on the CPU (WASM). */
  precision: 'fp16' | 'fp32';
  files: DiffusionFile[];
  /** CLIP padding token: "!" for SD 2.x, the end token for SD 1.x-based models. */
  padToken: string;
  /** Latent scaling of the VAE: 0.18215 for the SD VAE, 1 for TAESD. */
  vaeScale: number;
  maxSteps: number;
  /** Supports image-to-image (partial denoising). One-step SDXS does not; SD-Turbo does. */
  img2img: boolean;
  vramMB: number;
  license: string;
  /** freeDimensionOverrides per network (WebGPU speed-up), when the export uses symbolic dims. */
  dims?: Partial<Record<DiffusionRole, Record<string, number>>>;
}

// Third-party exports are pinned to a commit so their files cannot change under us.
const SDXS16 = 'https://huggingface.co/danyalmalik/sdxs-512-dreamshaper-ONNX-WebGPU/resolve/3256e981453992aba867a15825f02a4988f2c791/';
const SDXS32 = 'https://huggingface.co/kishanhk/sdxs-512-dreamshaper-onnx/resolve/0f087f64680ac5d14e29e1a7356df2b765bbbb43/';
export const SD_TURBO_REPO = 'https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main/';

export const DIFFUSION_MODELS: DiffusionModelInfo[] = [
  {
    id: 'sdxs',
    label: 'SDXS DreamShaper',
    blurb: {
      en: 'One-step 512px images from any prompt in about a second on a GPU. Smallest download.',
      pt: 'Imagens de 512px de qualquer prompt em um passo, em cerca de um segundo na GPU. Menor download.',
    },
    precision: 'fp16',
    files: [
      { role: 'vocab', key: 'sdxs/tokenizer/vocab.json', url: `${SDXS16}tokenizer/vocab.json`, size: 1_059_962 },
      { role: 'merges', key: 'sdxs/tokenizer/merges.txt', url: `${SDXS16}tokenizer/merges.txt`, size: 524_619 },
      { role: 'text_encoder', key: 'sdxs/text_encoder.onnx', url: `${SDXS16}text_encoder/model.onnx`, size: 246_323_042 },
      { role: 'unet', key: 'sdxs/unet.onnx', url: `${SDXS16}unet/model.onnx`, size: 631_897_533 },
      { role: 'vae_decoder', key: 'sdxs/vae_decoder.onnx', url: `${SDXS16}vae_decoder/model.onnx`, size: 4_912_820 },
    ],
    padToken: '<|endoftext|>',
    vaeScale: 1,
    maxSteps: 1,
    img2img: false,
    vramMB: 1200,
    license: 'OpenRAIL++-M',
    dims: { text_encoder: { batch: 1 }, unet: { batch: 1, height: 64, width: 64 } },
  },
  {
    id: 'sdxs-fp32',
    label: 'SDXS DreamShaper (fp32)',
    blurb: {
      en: 'Same model in 32-bit: runs on any WebGPU and even on the CPU without a GPU (about 10–30 s per image).',
      pt: 'O mesmo modelo em 32 bits: roda em qualquer WebGPU e até na CPU, sem GPU (cerca de 10–30 s por imagem).',
    },
    precision: 'fp32',
    files: [
      { role: 'vocab', key: 'sdxs-fp32/tokenizer/vocab.json', url: `${SDXS16}tokenizer/vocab.json`, size: 1_059_962 },
      { role: 'merges', key: 'sdxs-fp32/tokenizer/merges.txt', url: `${SDXS16}tokenizer/merges.txt`, size: 524_619 },
      { role: 'text_encoder', key: 'sdxs-fp32/text_encoder.onnx', url: `${SDXS32}onnx/text_encoder.onnx`, size: 492_343_259 },
      { role: 'unet', key: 'sdxs-fp32/unet.onnx', url: `${SDXS32}onnx/unet.onnx`, size: 1_379_678_797 },
      { role: 'vae_decoder', key: 'sdxs-fp32/vae_decoder.onnx', url: `${SDXS32}onnx/vae_decoder.onnx`, size: 4_912_522 },
    ],
    padToken: '<|endoftext|>',
    vaeScale: 1,
    maxSteps: 1,
    img2img: false,
    vramMB: 2200,
    license: 'OpenRAIL++-M',
  },
  {
    id: 'sd-turbo',
    label: 'SD-Turbo',
    blurb: {
      en: 'Stable Diffusion Turbo: the most faithful to the prompt, 1–4 steps, needs a GPU with shader-f16 and ~3 GB of memory.',
      pt: 'Stable Diffusion Turbo: o mais fiel ao prompt, 1–4 passos; precisa de GPU com shader-f16 e ~3 GB de memória.',
    },
    precision: 'fp16',
    files: [
      { role: 'vocab', key: 'sd-turbo/tokenizer/vocab.json', url: `${SD_TURBO_REPO}tokenizer/vocab.json`, size: 1_059_962 },
      { role: 'merges', key: 'sd-turbo/tokenizer/merges.txt', url: `${SD_TURBO_REPO}tokenizer/merges.txt`, size: 524_619 },
      { role: 'text_encoder', key: 'sd-turbo/text_encoder/model.onnx', url: `${SD_TURBO_REPO}text_encoder/model.onnx`, size: 681_393_168 },
      { role: 'unet', key: 'sd-turbo/unet/model.onnx', url: `${SD_TURBO_REPO}unet/model.onnx`, size: 1_733_430_199 },
      { role: 'vae_decoder', key: 'sd-turbo/vae_decoder/model.onnx', url: `${SD_TURBO_REPO}vae_decoder/model.onnx`, size: 99_094_314 },
      { role: 'vae_encoder', key: 'sd-turbo/vae_encoder/model.onnx', url: `${SD_TURBO_REPO}vae_encoder/model.onnx`, size: 68_430_468 },
    ],
    padToken: '!',
    vaeScale: 0.18215,
    maxSteps: 4,
    img2img: true,
    vramMB: 3000,
    license: 'Stability AI Non-Commercial Research Community License',
    dims: {
      text_encoder: { batch_size: 1, sequence_length: 77 },
      unet: { batch_size: 1, num_channels: 4, height: 64, width: 64, sequence_length: 77, steps: 1 },
      vae_decoder: { batch_size: 1, num_channels_latent: 4, height_latent: 64, width_latent: 64 },
      vae_encoder: { batch_size: 1, num_channels: 3, height: 512, width: 512 },
    },
  },
];

export function findDiffusionModel(id: string): DiffusionModelInfo {
  return DIFFUSION_MODELS.find((m) => m.id === id) ?? DIFFUSION_MODELS[0];
}

export function diffusionBytes(model: DiffusionModelInfo): number {
  return model.files.reduce((sum, f) => sum + f.size, 0);
}

interface GpuCaps {
  supported: boolean;
  hasF16: boolean;
  isFallbackAdapter?: boolean;
}

/** Where a model can run here: fp16 needs WebGPU + shader-f16; fp32 prefers a real GPU, else the CPU. */
export function diffusionDevice(model: DiffusionModelInfo, gpu: GpuCaps, preferCpu = false): DiffusionDevice | null {
  const realGpu = gpu.supported && !gpu.isFallbackAdapter;
  if (model.precision === 'fp16') return realGpu && gpu.hasF16 ? 'webgpu' : null;
  return realGpu && !preferCpu ? 'webgpu' : 'wasm';
}

/** Best default for this device: the small fp16 model on capable GPUs, the fp32 one elsewhere. */
export function defaultDiffusionModel(gpu: GpuCaps): DiffusionModelId {
  return gpu.supported && !gpu.isFallbackAdapter && gpu.hasF16 ? 'sdxs' : 'sdxs-fp32';
}
