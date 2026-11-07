/**
 * "Add a model from Hugging Face": inspects a repository and turns it into a catalog entry.
 *  - MLC repos (WebLLM): the architecture in mlc-chat-config.json is matched against the
 *    official WebLLM models; the match's compiled WebGPU library runs the new weights.
 *  - ONNX repos (Transformers.js): runs on the CPU with the smallest 4/8-bit file available.
 * The repository is pinned to its current commit.
 */
import type { TextModelInfo } from './models.ts';

export interface HfSibling {
  rfilename: string;
  size?: number;
}

export interface HfRepoInfo {
  id: string;
  sha: string;
  siblings: HfSibling[];
  pipeline_tag?: string;
  library_name?: string;
  tags?: string[];
}

export interface MlcConfig {
  model_type?: string;
  quantization?: string;
  context_window_size?: number;
  model_config?: Record<string, unknown>;
}

export interface OfficialRecord {
  model: string;
  model_id: string;
  model_lib: string;
  vram_required_MB?: number;
  overrides?: { context_window_size?: number };
}

export type Inspection =
  | { ok: true; format: 'mlc' | 'onnx'; model: TextModelInfo; note?: string }
  | { ok: false; reason: 'not-found' | 'gguf' | 'no-match' | 'unsupported'; detail?: string };

/** Accepts "owner/name", a huggingface.co URL, or a URL to a file/tree inside the repo. */
export function parseRepoId(input: string): string | null {
  const text = input.trim().replace(/\/+$/, '');
  const url = text.match(/huggingface\.co\/(?:models\/)?([\w.-]+\/[\w.-]+)/i);
  const id = url ? url[1] : text;
  return /^[\w.-]+\/[\w.-]+$/.test(id) ? id : null;
}

const UNCENSORED = /abliterat|uncensor|heretic|lexi|dolphin/i;
const ARCH_FIELDS = ['hidden_size', 'num_hidden_layers', 'num_attention_heads', 'num_key_value_heads', 'intermediate_size', 'vocab_size', 'head_dim'];

/** Same model_type and identical shape-defining fields (fields absent on both sides are ignored). */
export function sameArchitecture(a: MlcConfig, b: MlcConfig): boolean {
  if (!a.model_type || a.model_type !== b.model_type) return false;
  const ca = a.model_config ?? {};
  const cb = b.model_config ?? {};
  let compared = 0;
  for (const field of ARCH_FIELDS) {
    if (ca[field] === undefined && cb[field] === undefined) continue;
    if (ca[field] !== cb[field]) return false;
    compared++;
  }
  return compared >= 4;
}

/** Official records with the same quantization, likeliest families first (fewer fetches). */
export function candidateRecords(records: OfficialRecord[], config: MlcConfig, repo: string): OfficialRecord[] {
  const quant = config.quantization ?? '';
  const sameQuant = records.filter((r) => quant && r.model_id.includes(`-${quant}-MLC`) && !/-1k$/.test(r.model_id));
  const words = repo.split('/').pop()!.toLowerCase().split(/[-_.]/).filter((w) => w.length > 1);
  const score = (r: OfficialRecord) => words.filter((w) => r.model_id.toLowerCase().includes(w)).length;
  return sameQuant.sort((a, b) => score(b) - score(a));
}

function sizeMB(siblings: HfSibling[], filter: (name: string) => boolean): number {
  return Math.round(siblings.filter((s) => filter(s.rfilename)).reduce((sum, s) => sum + (s.size ?? 0), 0) / 2 ** 20);
}

function label(repo: string): string {
  return repo.split('/').pop()!.replace(/([-_](q\d\w*|MLC|ONNX))+$/i, '');
}

/** Builds the catalog entry of an MLC repo given its matched official record. Pure, for tests. */
export function mlcModelInfo(info: HfRepoInfo, config: MlcConfig, base: OfficialRecord): TextModelInfo {
  const quant = config.quantization ?? 'q4f16_1';
  return {
    id: `hf--${info.id.replace('/', '--')}`,
    backend: 'webgpu',
    label: label(info.id),
    params: '?',
    quant: quant.replace(/_\d+$/, ''),
    downloadMB: sizeMB(info.siblings, (n) => n.startsWith('params_shard') || n.endsWith('.json')),
    vramMB: Math.round(base.vram_required_MB ?? 0),
    contextWindow: base.overrides?.context_window_size ?? Math.min(config.context_window_size ?? 4096, 4096),
    tags: UNCENSORED.test(info.id) ? ['chat', 'uncensored'] : ['chat'],
    requiresF16: /f16/.test(quant),
    mlc: { modelUrl: `https://huggingface.co/${info.id}/resolve/${info.sha}/`, libFrom: base.model_id },
    blurb: { en: `${info.id} · library of ${base.model_id}`, pt: `${info.id} · biblioteca de ${base.model_id}` },
  };
}

/** Builds the catalog entry of a Transformers.js ONNX repo. Pure, for tests. */
export function onnxModelInfo(info: HfRepoInfo): TextModelInfo | null {
  const onnx = info.siblings.filter((s) => /^onnx\/model[\w]*\.onnx$/.test(s.rfilename));
  const DTYPES: Record<string, 'q4' | 'q8' | 'int8' | 'fp16'> = {
    'onnx/model_q4.onnx': 'q4',
    'onnx/model_quantized.onnx': 'q8',
    'onnx/model_int8.onnx': 'int8',
  };
  // Smallest CPU-friendly quantization, counting external data chunks.
  const options = onnx
    .filter((s) => DTYPES[s.rfilename])
    .map((s) => {
      const base = s.rfilename;
      const chunks = info.siblings.filter((x) => x.rfilename.startsWith(`${base}_data`));
      return { dtype: DTYPES[base], file: base, bytes: (s.size ?? 0) + chunks.reduce((sum, c) => sum + (c.size ?? 0), 0), chunks: chunks.length };
    })
    .sort((a, b) => a.bytes - b.bytes);
  const best = options[0];
  if (!best) return null;
  return {
    id: `wasm:${info.id}`,
    backend: 'wasm',
    label: `${label(info.id)} (CPU)`,
    params: '?',
    quant: best.dtype,
    downloadMB: Math.round(best.bytes / 2 ** 20),
    vramMB: 0,
    contextWindow: 2048,
    tags: UNCENSORED.test(info.id) ? ['chat', 'uncensored'] : ['chat'],
    requiresF16: false,
    repo: info.id,
    dtype: best.dtype,
    revision: info.sha,
    externalData: best.chunks || undefined,
    blurb: { en: `${info.id} · ONNX ${best.dtype} on the CPU`, pt: `${info.id} · ONNX ${best.dtype} na CPU` },
  };
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${res.statusText}`), { status: res.status });
  return (await res.json()) as T;
}

/** Fetches `items` with limited concurrency, stopping at the first match. */
async function findFirst<T, R>(items: T[], limit: number, test: (item: T) => Promise<R | null>): Promise<R | null> {
  for (let i = 0; i < items.length; i += limit) {
    const results = await Promise.all(items.slice(i, i + limit).map((item) => test(item).catch(() => null)));
    const hit = results.find((r) => r !== null);
    if (hit) return hit;
  }
  return null;
}

export async function inspectHfRepo(input: string, officialRecords: () => Promise<OfficialRecord[]>, signal?: AbortSignal): Promise<Inspection> {
  const repo = parseRepoId(input);
  if (!repo) return { ok: false, reason: 'not-found', detail: input };
  let info: HfRepoInfo;
  try {
    info = await getJson<HfRepoInfo>(`https://huggingface.co/api/models/${repo}?blobs=true`, signal);
  } catch (error) {
    return { ok: false, reason: 'not-found', detail: (error as Error).message };
  }
  const names = new Set(info.siblings.map((s) => s.rfilename));

  if (names.has('mlc-chat-config.json')) {
    if (!names.has('tensor-cache.json') && !names.has('ndarray-cache.json')) return { ok: false, reason: 'unsupported', detail: 'no tensor-cache.json' };
    const config = await getJson<MlcConfig>(`https://huggingface.co/${repo}/resolve/${info.sha}/mlc-chat-config.json`, signal);
    const candidates = candidateRecords(await officialRecords(), config, repo);
    const base = await findFirst(candidates, 6, async (record) => {
      const official = await getJson<MlcConfig>(`${record.model.replace(/\/+$/, '')}/resolve/main/mlc-chat-config.json`, signal);
      return sameArchitecture(config, official) ? record : null;
    });
    if (!base) return { ok: false, reason: 'no-match', detail: `${config.model_type ?? '?'} ${config.quantization ?? ''}` };
    return { ok: true, format: 'mlc', model: mlcModelInfo(info, config, base) };
  }

  const model = onnxModelInfo(info);
  if (model) {
    const note = info.library_name && info.library_name !== 'transformers.js' ? `library: ${info.library_name}` : undefined;
    return { ok: true, format: 'onnx', model, note };
  }
  if ([...names].some((n) => n.endsWith('.gguf'))) return { ok: false, reason: 'gguf' };
  return { ok: false, reason: 'unsupported' };
}
