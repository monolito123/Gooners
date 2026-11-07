/**
 * Model catalog. Text models run either on WebGPU through WebLLM (MLC-compiled, 4-bit) or on
 * the CPU through Transformers.js/ONNX Runtime WASM when WebGPU is unavailable. Sizes are the
 * download sizes of the published weights; VRAM figures come from WebLLM's model records.
 */
export type TextBackend = 'webgpu' | 'wasm';
export type ModelTag = 'chat' | 'code' | 'reasoning' | 'tiny' | 'multilingual';
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

// ─── Image model (SD-Turbo, fp16 ONNX for ONNX Runtime Web/WebGPU) ───────────────────────

export const SD_TURBO_REPO = 'https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main/';

export interface ModelFile {
  key: string;
  path: string;
  size: number;
}

export const SD_TURBO_FILES: ModelFile[] = [
  { key: 'sd-turbo/tokenizer/vocab.json', path: 'tokenizer/vocab.json', size: 1_059_962 },
  { key: 'sd-turbo/tokenizer/merges.txt', path: 'tokenizer/merges.txt', size: 524_619 },
  { key: 'sd-turbo/text_encoder/model.onnx', path: 'text_encoder/model.onnx', size: 681_393_168 },
  { key: 'sd-turbo/unet/model.onnx', path: 'unet/model.onnx', size: 1_733_430_199 },
  { key: 'sd-turbo/vae_decoder/model.onnx', path: 'vae_decoder/model.onnx', size: 99_094_314 },
  { key: 'sd-turbo/vae_encoder/model.onnx', path: 'vae_encoder/model.onnx', size: 68_430_468 },
];

export const SD_TURBO_GROUP = 'sd-turbo';
export const SD_TURBO_TOTAL_BYTES = SD_TURBO_FILES.reduce((sum, f) => sum + f.size, 0);
/** Approximate GPU memory with all four networks resident. */
export const SD_TURBO_VRAM_MB = 3000;
