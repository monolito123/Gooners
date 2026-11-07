/**
 * CPU text generation with Transformers.js on ONNX Runtime WASM, for browsers without WebGPU.
 * Model files are cached in IndexedDB through a custom cache (see blobStore.ts).
 */
import { ort } from './ortEnv.ts';
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  InterruptableStoppingCriteria,
  TextStreamer,
  env,
} from '@huggingface/transformers';
import * as store from '../lib/blobStore.ts';
import { exposeWorker } from '../lib/rpc.ts';
import { TRANSFORMERS_GROUP } from './models.ts';
import type { WasmTextApi } from './textTypes.ts';

void ort;

env.allowLocalModels = false;
env.useBrowserCache = false;
env.useWasmCache = false;
env.useCustomCache = true;
env.customCache = {
  async match(url: string) {
    const file = await store.getFile(url);
    if (!file?.complete) return undefined;
    const blob = await store.readBlob(url);
    return new Response(blob, { headers: { 'content-type': file.contentType, 'content-length': String(blob.size) } });
  },
  async put(url: string, response: Response, onProgress?: (p: { progress: number; loaded: number; total: number }) => void) {
    await store.storeResponse(url, TRANSFORMERS_GROUP, response, (p) =>
      onProgress?.({ progress: p.total ? (p.loaded / p.total) * 100 : 0, loaded: p.loaded, total: p.total }),
    );
  },
  async delete(url: string) {
    await store.deleteFile(url);
    return true;
  },
};

type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type Model = Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>>;

let tokenizer: Tokenizer | null = null;
let model: Model | null = null;
let loaded = '';

interface FileProgress {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

exposeWorker<WasmTextApi>({
  async load({ repo, dtype }, { progress }) {
    const key = `${repo}:${dtype}`;
    if (loaded === key && model && tokenizer) return { fromCache: true };
    await model?.dispose();
    model = null;
    tokenizer = null;
    loaded = '';
    const files = new Map<string, { loaded: number; total: number }>();
    let downloaded = false;
    const onProgress = (info: FileProgress) => {
      if (info.status !== 'progress' || !info.file) return;
      downloaded = true;
      files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
      let sumLoaded = 0;
      let sumTotal = 0;
      for (const f of files.values()) {
        sumLoaded += f.loaded;
        sumTotal += f.total;
      }
      progress({ loaded: sumLoaded, total: sumTotal, file: info.file });
    };
    tokenizer = await AutoTokenizer.from_pretrained(repo, { progress_callback: onProgress as never });
    model = await AutoModelForCausalLM.from_pretrained(repo, {
      dtype: dtype as never,
      device: 'wasm',
      progress_callback: onProgress as never,
    });
    loaded = key;
    return { fromCache: !downloaded };
  },

  async generate({ messages, params }, { progress, signal }) {
    if (!model || !tokenizer) throw new Error('No model loaded');
    const stopping = new InterruptableStoppingCriteria();
    signal.addEventListener('abort', () => stopping.interrupt(), { once: true });
    const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true }) as unknown as {
      input_ids: { dims: number[] };
      attention_mask: unknown;
    };
    const start = performance.now();
    let first = 0;
    let tokens = 0;
    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        if (text) progress({ delta: text, tokens });
      },
      token_callback_function: () => {
        tokens++;
        if (!first) first = performance.now();
      },
    });
    const sample = params.temperature > 0;
    await model.generate({
      ...(inputs as object),
      max_new_tokens: params.maxTokens,
      do_sample: sample,
      ...(sample ? { temperature: params.temperature, top_p: params.topP } : {}),
      repetition_penalty: 1.1,
      streamer,
      stopping_criteria: [stopping],
    } as never);
    const end = performance.now();
    return {
      completionTokens: tokens,
      promptTokens: inputs.input_ids.dims.at(-1) ?? 0,
      ttftMs: (first || end) - start,
      totalMs: end - start,
      interrupted: stopping.interrupted,
      hitLimit: tokens >= params.maxTokens,
    };
  },

  async unload() {
    await model?.dispose();
    model = null;
    tokenizer = null;
    loaded = '';
    return undefined;
  },
});
