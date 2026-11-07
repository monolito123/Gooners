/**
 * TextEngine: one facade over two local backends.
 *  - webgpu: WebLLM (MLC, 4-bit) in a dedicated worker; weights cached in IndexedDB.
 *  - wasm:   Transformers.js on ONNX Runtime WASM (CPU) in a worker, for browsers without WebGPU.
 * Exposes load progress (phase, MB, speed, ETA), token streaming and generation telemetry.
 */
import type { CompletionUsage, InitProgressReport, WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { Ema } from '../lib/format.ts';
import { Observable } from '../lib/observable.ts';
import { RpcAbortError, WorkerClient, isAbortError } from '../lib/rpc.ts';
import { fitToContext } from './context.ts';
import { webllmAppConfig, webllmLib } from './modelCache.ts';
import { type CloudConnection, type CloudProviderId, type StreamEvent, findProvider, streamCloudChat } from './cloud.ts';
import { type TextModelInfo, resolveWebLLMId } from './models.ts';
import { parseWebLLMReport } from './progress.ts';
import type { ChatTurn, GenerationParams, GenerationStats, LoadProgress, WasmTextApi } from './textTypes.ts';

export type TextEngineStatus = 'idle' | 'loading' | 'ready' | 'generating' | 'error';

export interface LiveStats {
  tokens: number;
  ttftMs?: number;
  tokensPerSec?: number;
}

export interface TextEngineState {
  status: TextEngineStatus;
  model?: TextModelInfo;
  /** The id actually loaded (the f32 variant on GPUs without shader-f16). */
  runtimeId?: string;
  progress?: LoadProgress;
  error?: string;
  live?: LiveStats;
  lastStats?: GenerationStats;
}

export interface GenerateOptions {
  params: GenerationParams;
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}

type WebLLMModule = typeof import('@mlc-ai/web-llm');

export class TextEngine extends Observable<TextEngineState> {
  private webllmModule?: WebLLMModule;
  private webllm?: WebWorkerMLCEngine;
  private webllmWorker?: Worker;
  private wasm?: WorkerClient<WasmTextApi>;
  private generation?: AbortController;
  private loadSeq = 0;
  private progressStart = 0;
  private lastSample?: { t: number; mb: number };
  private readonly speed = new Ema(0.2);

  constructor() {
    super({ status: 'idle' });
  }

  get ready(): boolean {
    return this.state.status === 'ready' || this.state.status === 'generating';
  }

  /** Loads (downloading on first use) a model, replacing whatever is loaded. */
  async load(model: TextModelInfo, opts: { hasF16: boolean; customModels?: TextModelInfo[] }): Promise<void> {
    const seq = ++this.loadSeq;
    this.stop();
    const runtimeId = model.backend === 'webgpu' ? resolveWebLLMId(model, opts.hasF16) : model.id;
    this.progressStart = performance.now();
    this.lastSample = undefined;
    this.setState({
      status: 'loading',
      model,
      runtimeId,
      error: undefined,
      live: undefined,
      progress: { phase: 'init', fraction: 0, elapsedSec: 0, text: '' },
    });
    try {
      if (model.backend === 'cloud') {
        // Nothing to download: free local memory and check the connection details.
        await this.unloadWebLLM();
        await this.unloadWasm();
        const connection = this.cloudConnection(model);
        const provider = findProvider(connection.provider);
        if (provider.needsKey && !connection.key?.trim()) throw new Error(`${provider.label} needs an API key: add it in Settings → Cloud.`);
      } else if (model.backend === 'webgpu') {
        await this.unloadWasm();
        await this.loadWebLLM(runtimeId, opts.customModels ?? []);
      } else {
        await this.unloadWebLLM();
        await this.loadWasm(model);
      }
      if (seq !== this.loadSeq) return;
      this.setState({
        status: 'ready',
        progress: { phase: 'ready', fraction: 1, elapsedSec: this.elapsed(), text: '' },
      });
    } catch (error) {
      if (seq !== this.loadSeq) return;
      const message = describeError(error);
      this.setState({ status: 'error', error: message, progress: undefined });
      throw new Error(message);
    }
  }

  /** Aborts a load in progress by tearing the worker down (partial shards stay cached). */
  cancelLoad(): void {
    if (this.state.status !== 'loading') return;
    this.loadSeq++;
    this.webllmWorker?.terminate();
    this.webllmWorker = undefined;
    this.webllm = undefined;
    this.wasm?.terminate();
    this.wasm = undefined;
    this.setState({ status: 'idle', model: undefined, runtimeId: undefined, progress: undefined });
  }

  async unload(): Promise<void> {
    this.stop();
    this.loadSeq++;
    await this.unloadWebLLM();
    await this.unloadWasm();
    this.setState({ status: 'idle', model: undefined, runtimeId: undefined, progress: undefined, live: undefined });
  }

  stop(): void {
    this.generation?.abort();
  }

  /** Streams a chat completion. Resolves with the full text and its statistics. */
  async generate(messages: ChatTurn[], options: GenerateOptions): Promise<{ text: string; stats: GenerationStats }> {
    const { model, runtimeId } = this.state;
    if (!model || !runtimeId || this.state.status !== 'ready') throw new Error('Load a model first');
    const controller = new AbortController();
    this.generation = controller;
    const forward = () => controller.abort();
    options.signal?.addEventListener('abort', forward, { once: true });
    const fitted = fitToContext(messages, model.contextWindow, options.params.maxTokens);
    const live: LiveStats = { tokens: 0 };
    this.setState({ status: 'generating', live: { ...live } });
    const start = performance.now();
    let firstAt = 0;
    let lastEmit = 0;
    let text = '';
    const onToken = (delta: string, count = 1) => {
      if (!delta) return;
      const now = performance.now();
      if (!firstAt) {
        firstAt = now;
        live.ttftMs = now - start;
      }
      live.tokens += count;
      const decodeSec = (now - firstAt) / 1000;
      if (decodeSec > 0.15) live.tokensPerSec = (live.tokens - 1) / decodeSec;
      text += delta;
      options.onDelta(delta);
      if (now - lastEmit > 120) {
        lastEmit = now;
        this.setState({ live: { ...live } });
      }
    };
    try {
      const stats =
        model.backend === 'cloud'
          ? await this.generateCloud(model, fitted, options.params, controller.signal, onToken)
          : model.backend === 'webgpu'
          ? await this.generateWebLLM(fitted, options.params, controller.signal, onToken)
          : await this.generateWasm(fitted, options.params, controller.signal, onToken);
      const end = performance.now();
      const ttftMs = stats.ttftMs ?? (firstAt ? firstAt - start : end - start);
      const completionTokens = stats.completionTokens ?? live.tokens;
      const decodeMs = firstAt ? end - firstAt : 0;
      const final: GenerationStats = {
        ttftMs,
        totalMs: end - start,
        completionTokens,
        promptTokens: stats.promptTokens,
        tokensPerSec: stats.tokensPerSec ?? (decodeMs > 0 ? ((completionTokens - 1) / decodeMs) * 1000 : 0),
        prefillTokensPerSec: stats.prefillTokensPerSec,
        finishReason: controller.signal.aborted ? 'abort' : (stats.finishReason ?? 'stop'),
        modelId: runtimeId,
        backend: model.backend,
      };
      this.setState({ status: 'ready', live: undefined, lastStats: final });
      return { text, stats: final };
    } catch (error) {
      const lost = isDeviceLost(error);
      const aborted = !lost && (controller.signal.aborted || isAbortError(error));
      if (aborted) {
        const end = performance.now();
        const stats: GenerationStats = {
          ttftMs: firstAt ? firstAt - start : end - start,
          totalMs: end - start,
          completionTokens: live.tokens,
          tokensPerSec: live.tokensPerSec ?? 0,
          finishReason: 'abort',
          modelId: runtimeId,
          backend: model.backend,
        };
        this.setState({ status: 'ready', live: undefined, lastStats: stats });
        return { text, stats };
      }
      const message = describeError(error);
      if (lost) {
        // The GPU device is gone (out of memory, driver reset, tab backgrounded on mobile):
        // the engine cannot recover in place, so drop it and ask for a reload.
        await this.unloadWebLLM().catch(() => undefined);
        this.setState({ status: 'error', live: undefined, error: message });
      } else {
        this.setState({ status: this.state.model ? 'ready' : 'idle', live: undefined });
      }
      throw new Error(message);
    } finally {
      options.signal?.removeEventListener('abort', forward);
      if (this.generation === controller) this.generation = undefined;
    }
  }

  // ─── WebGPU (WebLLM) ────────────────────────────────────────────────────────────────

  private async loadWebLLM(runtimeId: string, customModels: TextModelInfo[]): Promise<void> {
    const appConfig = await webllmAppConfig(customModels);
    const lib = (this.webllmModule ??= await webllmLib());
    if (!this.webllm) {
      this.webllmWorker = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module', name: 'webllm' });
      this.webllm = new lib.WebWorkerMLCEngine(this.webllmWorker, {
        appConfig,
        initProgressCallback: (report) => this.onWebLLMProgress(report),
        logLevel: 'WARN',
      });
    } else {
      this.webllm.setAppConfig(appConfig);
      this.webllm.setInitProgressCallback((report) => this.onWebLLMProgress(report));
    }
    await this.webllm.reload(runtimeId);
  }

  private onWebLLMProgress(report: InitProgressReport): void {
    if (this.state.status !== 'loading') return;
    const parsed = parseWebLLMReport(report);
    const progress: LoadProgress = { ...parsed, elapsedSec: this.elapsed(), text: report.text };
    if (parsed.phase === 'download' && parsed.loadedMB !== undefined) this.applySpeed(progress, parsed.loadedMB);
    this.setState({ progress });
  }

  private async generateWebLLM(
    messages: ChatTurn[],
    params: GenerationParams,
    signal: AbortSignal,
    onToken: (delta: string) => void,
  ): Promise<Partial<GenerationStats>> {
    const engine = this.webllm;
    if (!engine) throw new Error('Engine not ready');
    const onAbort = () => engine.interruptGenerate();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const stream = await engine.chat.completions.create({
        messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: params.temperature,
        top_p: params.topP,
        max_tokens: params.maxTokens,
      });
      let finish: GenerationStats['finishReason'] = 'stop';
      let usage: CompletionUsage | undefined;
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (choice?.delta?.content) onToken(choice.delta.content);
        if (choice?.finish_reason === 'length') finish = 'length';
        if (choice?.finish_reason === 'abort') finish = 'abort';
        if (chunk.usage) usage = chunk.usage;
      }
      const extra = usage?.extra;
      return {
        finishReason: finish,
        completionTokens: usage?.completion_tokens,
        promptTokens: usage?.prompt_tokens,
        ttftMs: extra?.time_to_first_token_s !== undefined ? extra.time_to_first_token_s * 1000 : undefined,
        tokensPerSec: extra?.decode_tokens_per_s,
        prefillTokensPerSec: extra?.prefill_tokens_per_s,
      };
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  private async unloadWebLLM(): Promise<void> {
    if (!this.webllm) return;
    try {
      await this.webllm.unload();
    } catch {
      /* worker may already be gone */
    }
    this.webllmWorker?.terminate();
    this.webllm = undefined;
    this.webllmWorker = undefined;
  }

  // ─── CPU (Transformers.js / WASM) ───────────────────────────────────────────────────

  private async loadWasm(model: TextModelInfo): Promise<void> {
    if (!model.repo) throw new Error('Invalid CPU model');
    this.wasm ??= new WorkerClient<WasmTextApi>(
      new Worker(new URL('./wasmText.worker.ts', import.meta.url), { type: 'module', name: 'text-wasm' }),
    );
    const totalMB = model.downloadMB;
    await this.wasm.call(
      'load',
      { repo: model.repo, dtype: model.dtype ?? 'q4', revision: model.revision, externalData: model.externalData },
      {
        onProgress: ({ loaded, total }) => {
          if (this.state.status !== 'loading') return;
          const loadedMB = loaded / 2 ** 20;
          const knownTotal = Math.max(total / 2 ** 20, totalMB);
          const progress: LoadProgress = {
            phase: 'download',
            fraction: Math.min(1, loadedMB / knownTotal),
            loadedMB,
            totalMB: knownTotal,
            elapsedSec: this.elapsed(),
            text: '',
          };
          this.applySpeed(progress, loadedMB);
          this.setState({ progress });
        },
      },
    );
    this.setState({ progress: { phase: 'init', fraction: 1, elapsedSec: this.elapsed(), text: '' } });
  }

  // ─── Cloud (OpenAI-compatible APIs) ─────────────────────────────────────────────────

  /** Supplies the API key / base URL for a cloud provider (set by the app from settings). */
  cloudResolver?: (provider: CloudProviderId) => CloudConnection;

  private cloudConnection(model: TextModelInfo): CloudConnection {
    const provider = model.cloud!.provider;
    return this.cloudResolver?.(provider) ?? { provider };
  }

  private async generateCloud(
    model: TextModelInfo,
    messages: ChatTurn[],
    params: GenerationParams,
    signal: AbortSignal,
    onToken: (delta: string, count?: number) => void,
  ): Promise<Partial<GenerationStats>> {
    let finish: GenerationStats['finishReason'] = 'stop';
    let usage: StreamEvent['usage'];
    let thinking = false;
    let answered = false;
    for await (const event of streamCloudChat(this.cloudConnection(model), model.cloud!.model, messages, params, signal)) {
      // Reasoning models stream their thoughts separately: show them as a <think> block.
      if (event.reasoning && !answered) {
        if (!thinking) onToken('<think>', 0);
        thinking = true;
        onToken(event.reasoning);
      }
      if (event.content) {
        if (thinking) onToken('</think>\n\n', 0);
        thinking = false;
        answered = true;
        onToken(event.content);
      }
      if (event.finish === 'length') finish = 'length';
      if (event.usage) usage = event.usage;
    }
    if (thinking) onToken('</think>', 0);
    return { finishReason: finish, completionTokens: usage?.completion_tokens, promptTokens: usage?.prompt_tokens };
  }

  private async generateWasm(
    messages: ChatTurn[],
    params: GenerationParams,
    signal: AbortSignal,
    onToken: (delta: string, count?: number) => void,
  ): Promise<Partial<GenerationStats>> {
    if (!this.wasm) throw new Error('Engine not ready');
    let seen = 0;
    const result = await this.wasm.call(
      'generate',
      { messages, params },
      {
        signal,
        onProgress: ({ delta, tokens }) => {
          onToken(delta, Math.max(1, tokens - seen));
          seen = tokens;
        },
      },
    );
    const decodeMs = result.totalMs - result.ttftMs;
    return {
      completionTokens: result.completionTokens,
      promptTokens: result.promptTokens,
      ttftMs: result.ttftMs,
      tokensPerSec: decodeMs > 0 ? ((result.completionTokens - 1) / decodeMs) * 1000 : undefined,
      prefillTokensPerSec: result.ttftMs > 0 ? (result.promptTokens / result.ttftMs) * 1000 : undefined,
      finishReason: result.interrupted ? 'abort' : result.hitLimit ? 'length' : 'stop',
    };
  }

  private async unloadWasm(): Promise<void> {
    if (!this.wasm) return;
    try {
      await this.wasm.call('unload', undefined);
    } catch {
      /* ignore */
    }
    this.wasm.terminate();
    this.wasm = undefined;
  }

  // ─── helpers ────────────────────────────────────────────────────────────────────────

  private elapsed(): number {
    return (performance.now() - this.progressStart) / 1000;
  }

  private applySpeed(progress: LoadProgress, loadedMB: number): void {
    const now = performance.now();
    if (this.lastSample && now - this.lastSample.t > 400) {
      const rate = (loadedMB - this.lastSample.mb) / ((now - this.lastSample.t) / 1000);
      if (rate >= 0) this.speed.push(rate);
      this.lastSample = { t: now, mb: loadedMB };
    } else if (!this.lastSample) {
      this.lastSample = { t: now, mb: loadedMB };
    }
    const speed = this.speed.current;
    progress.speedMBps = speed;
    if (speed && speed > 0.01 && progress.totalMB) progress.etaSec = Math.max(0, (progress.totalMB - loadedMB) / speed);
  }
}

const DEVICE_LOST = /device (was )?lost|GPUDeviceLostInfo|Instance (dropped|reference no longer exists)|external Instance/i;

export function isDeviceLost(error: unknown): boolean {
  return DEVICE_LOST.test(error instanceof Error ? `${error.name} ${error.message}` : String(error));
}

function describeError(error: unknown): string {
  if (error instanceof RpcAbortError) return 'Cancelled';
  const message = error instanceof Error ? error.message : String(error);
  if (DEVICE_LOST.test(message)) return 'The GPU device was lost (out of GPU memory or a driver reset). Load the model again, or pick a smaller one.';
  if (/QuotaExceeded|quota/i.test(message)) return 'Browser storage is full: free space in Storage settings and try again.';
  if (/Failed to fetch|NetworkError|network/i.test(message)) return `Network error while downloading the model (${message}). Model files are downloaded once, then work offline.`;
  if (/shader-f16/i.test(message)) return 'This GPU does not support 16-bit shaders (shader-f16). Pick a model without the f16 requirement.';
  if (/maxStorageBufferBindingSize|max.*buffer/i.test(message)) return `This GPU's buffer limits are too small for this model (${message}). Try a smaller model.`;
  return message;
}

export const textEngine = new TextEngine();
