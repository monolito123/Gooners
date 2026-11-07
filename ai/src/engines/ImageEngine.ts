/**
 * ImageEngine: UI-thread facade for the diffusion worker. Tracks the selected model, picks the
 * device (WebGPU or CPU/WASM), and on generate downloads and loads the model when needed, so a
 * single "Generate" click works from scratch. Reports download speed/ETA and streams frames.
 */
import * as store from '../lib/blobStore.ts';
import { Ema } from '../lib/format.ts';
import { Observable } from '../lib/observable.ts';
import { WorkerClient, isAbortError } from '../lib/rpc.ts';
import { usePlatform } from '../state/platform.ts';
import type { DiffusionFrame, DiffusionRequest, ImageWorkerApi } from './imageTypes.ts';
import {
  DIFFUSION_MODELS,
  type DiffusionDevice,
  type DiffusionModelId,
  type DiffusionModelInfo,
  diffusionBytes,
  diffusionDevice,
  findDiffusionModel,
} from './models.ts';

export type ImageModelStatus = 'unknown' | 'absent' | 'partial' | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'generating' | 'error';

export interface ImageEngineState {
  modelId: DiffusionModelId;
  /** Run fp32 models on the CPU even when a GPU is available. */
  preferCpu: boolean;
  status: ImageModelStatus;
  downloadedBytes: number;
  totalBytes: number;
  /** Model and device currently resident in the worker. */
  loaded?: { modelId: DiffusionModelId; device: DiffusionDevice };
  download?: { loaded: number; total: number; file: string; speedMBps?: number; etaSec?: number };
  load?: { file: string; index: number; count: number; fraction: number; stage: 'read' | 'session' };
  error?: string;
  lastFrameMs?: number;
}

export class ImageEngine extends Observable<ImageEngineState> {
  private client?: WorkerClient<ImageWorkerApi>;
  private task?: AbortController;

  constructor() {
    const model = DIFFUSION_MODELS[0];
    super({ modelId: model.id, preferCpu: false, status: 'unknown', downloadedBytes: 0, totalBytes: diffusionBytes(model) });
  }

  get model(): DiffusionModelInfo {
    return findDiffusionModel(this.state.modelId);
  }

  /** Where the selected model would run on this device, or null if it cannot. */
  device(model = this.model): DiffusionDevice | null {
    const gpu = usePlatform.getState().info?.gpu;
    return diffusionDevice(model, { supported: gpu?.supported ?? false, hasF16: gpu?.hasF16 ?? false, isFallbackAdapter: gpu?.isFallbackAdapter }, this.state.preferCpu);
  }

  private worker(): WorkerClient<ImageWorkerApi> {
    this.client ??= new WorkerClient<ImageWorkerApi>(new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module', name: 'diffusion' }));
    return this.client;
  }

  private busy(): boolean {
    return ['downloading', 'loading', 'generating'].includes(this.state.status);
  }

  async select(modelId: DiffusionModelId): Promise<void> {
    if (modelId === this.state.modelId && this.state.status !== 'unknown') return;
    if (this.busy()) return;
    this.setState({ modelId, status: 'unknown', error: undefined, totalBytes: diffusionBytes(findDiffusionModel(modelId)) });
    await this.refresh();
  }

  setPreferCpu(preferCpu: boolean): void {
    if (this.busy()) return;
    this.setState({ preferCpu });
    void this.refresh();
  }

  /** Reads what is on disk for the selected model. */
  async refresh(): Promise<void> {
    if (this.busy()) return;
    const model = this.model;
    const device = this.device();
    const loaded = this.state.loaded;
    if (loaded?.modelId === model.id && loaded.device === device) {
      this.setState({ status: 'ready' });
      return;
    }
    try {
      const files = await store.listFiles(model.id);
      const downloadedBytes = files.reduce((sum, f) => sum + f.received, 0);
      const complete = model.files.every((f) => files.some((s) => s.key === f.key && s.complete));
      this.setState({ status: complete ? 'downloaded' : downloadedBytes > 0 ? 'partial' : 'absent', downloadedBytes });
    } catch (error) {
      this.setState({ status: 'error', error: String(error) });
    }
  }

  async download(): Promise<boolean> {
    const model = this.model;
    this.task = new AbortController();
    const speed = new Ema(0.2);
    let last: { t: number; loaded: number } | undefined;
    this.setState({ status: 'downloading', error: undefined });
    void usePlatform.getState().persist();
    try {
      await this.worker().call('download', { modelId: model.id }, {
        signal: this.task.signal,
        onProgress: ({ loaded, total, file }) => {
          const now = performance.now();
          if (!last) last = { t: now, loaded };
          else if (now - last.t > 500) {
            speed.push((loaded - last.loaded) / 2 ** 20 / ((now - last.t) / 1000));
            last = { t: now, loaded };
          }
          const mbps = speed.current;
          this.setState({
            downloadedBytes: loaded,
            download: { loaded, total, file, speedMBps: mbps, etaSec: mbps && mbps > 0.01 ? (total - loaded) / 2 ** 20 / mbps : undefined },
          });
        },
      });
      this.setState({ status: 'downloaded', download: undefined });
      void usePlatform.getState().refreshStorage();
      return true;
    } catch (error) {
      this.setState({ status: 'unknown', download: undefined });
      await this.refresh();
      if (!isAbortError(error)) this.setState({ error: describe(error) });
      return false;
    } finally {
      this.task = undefined;
    }
  }

  async load(): Promise<void> {
    const model = this.model;
    const device = this.device();
    if (!device) throw new Error(describe('shader-f16'));
    if (this.state.loaded?.modelId === model.id && this.state.loaded.device === device) {
      this.setState({ status: 'ready' });
      return;
    }
    this.setState({ status: 'loading', error: undefined, load: undefined, loaded: undefined });
    try {
      await this.worker().call('load', { modelId: model.id, device }, { onProgress: (load) => this.setState({ load }) });
      this.setState({ status: 'ready', load: undefined, loaded: { modelId: model.id, device } });
    } catch (error) {
      const message = describe(error);
      this.setState({ status: 'error', load: undefined, error: message });
      throw new Error(message);
    }
  }

  /** Downloads and loads the selected model if needed. Returns false if the user cancelled. */
  async prepare(): Promise<boolean> {
    if (this.state.status === 'unknown') await this.refresh();
    if (this.state.status === 'absent' || this.state.status === 'partial' || this.state.status === 'error') {
      const files = await store.listFiles(this.model.id);
      const complete = this.model.files.every((f) => files.some((s) => s.key === f.key && s.complete));
      if (!complete && !(await this.download())) return false;
    }
    if (this.state.status !== 'ready') await this.load();
    return true;
  }

  /** Runs a diffusion request, calling `onFrame` for every image/video frame as it is ready. */
  async generate(request: DiffusionRequest, onFrame: (frame: DiffusionFrame) => void, signal?: AbortSignal): Promise<void> {
    if (!(await this.prepare())) throw new DOMException('Cancelled', 'AbortError');
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    this.task = new AbortController();
    const forward = () => this.task?.abort();
    signal?.addEventListener('abort', forward, { once: true });
    this.setState({ status: 'generating', error: undefined });
    try {
      await this.worker().call('generate', request, {
        signal: this.task.signal,
        onProgress: (frame) => {
          this.setState({ lastFrameMs: frame.ms });
          onFrame(frame);
        },
      });
      this.setState({ status: 'ready' });
    } catch (error) {
      if (isAbortError(error)) {
        this.setState({ status: 'ready' });
        throw error;
      }
      const message = describe(error);
      this.setState({ status: 'ready', error: message });
      throw new Error(message);
    } finally {
      signal?.removeEventListener('abort', forward);
      this.task = undefined;
    }
  }

  cancel(): void {
    this.task?.abort();
  }

  async unload(): Promise<void> {
    this.cancel();
    this.client?.terminate();
    this.client = undefined;
    this.setState({ status: 'unknown', loaded: undefined });
    await this.refresh();
  }

  async remove(modelId: DiffusionModelId = this.state.modelId): Promise<void> {
    if (this.state.loaded?.modelId === modelId) await this.unload();
    await store.deleteGroup(modelId);
    this.setState({ status: 'unknown' });
    await this.refresh();
  }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/shader-f16|\bf16\b/i.test(message)) return 'This model needs a GPU with 16-bit shaders (shader-f16). Pick "SDXS DreamShaper (fp32)", which runs on any device.';
  if (/out of memory|OOM|allocation|bad_alloc/i.test(message)) return `Not enough memory for this model (${message}). Close other tabs or pick a smaller model.`;
  return message;
}

export const imageEngine = new ImageEngine();
