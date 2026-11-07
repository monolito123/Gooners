/**
 * ImageEngine: UI-thread facade for the SD-Turbo worker (download → load → generate), with
 * download speed/ETA and per-frame streaming. The procedural engine lives in procedural/.
 */
import * as store from '../lib/blobStore.ts';
import { Ema } from '../lib/format.ts';
import { Observable } from '../lib/observable.ts';
import { WorkerClient, isAbortError } from '../lib/rpc.ts';
import type { DiffusionFrame, DiffusionRequest, ImageWorkerApi } from './imageTypes.ts';
import { SD_TURBO_GROUP, SD_TURBO_TOTAL_BYTES } from './models.ts';

export type ImageModelStatus =
  | 'unknown'
  | 'absent'
  | 'partial'
  | 'downloading'
  | 'downloaded'
  | 'loading'
  | 'ready'
  | 'generating'
  | 'error';

export interface ImageEngineState {
  status: ImageModelStatus;
  downloadedBytes: number;
  totalBytes: number;
  download?: { loaded: number; total: number; file: string; speedMBps?: number; etaSec?: number };
  load?: { file: string; index: number; count: number; fraction: number; stage: 'read' | 'session' };
  error?: string;
  lastFrameMs?: number;
}

export class ImageEngine extends Observable<ImageEngineState> {
  private client?: WorkerClient<ImageWorkerApi>;
  private task?: AbortController;

  constructor() {
    super({ status: 'unknown', downloadedBytes: 0, totalBytes: SD_TURBO_TOTAL_BYTES });
  }

  private worker(): WorkerClient<ImageWorkerApi> {
    this.client ??= new WorkerClient<ImageWorkerApi>(
      new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module', name: 'sd-turbo' }),
    );
    return this.client;
  }

  /** Reads what is on disk without starting the worker. */
  async refresh(): Promise<void> {
    if (['downloading', 'loading', 'generating', 'ready'].includes(this.state.status)) return;
    try {
      const files = await store.listFiles(SD_TURBO_GROUP);
      const downloadedBytes = files.reduce((sum, f) => sum + f.received, 0);
      const complete = files.filter((f) => f.complete).length;
      const status: ImageModelStatus = complete >= 6 ? 'downloaded' : downloadedBytes > 0 ? 'partial' : 'absent';
      this.setState({ status, downloadedBytes, error: undefined });
    } catch (error) {
      this.setState({ status: 'error', error: String(error) });
    }
  }

  async download(): Promise<void> {
    this.task = new AbortController();
    const speed = new Ema(0.2);
    let last: { t: number; loaded: number } | undefined;
    this.setState({ status: 'downloading', error: undefined });
    try {
      await this.worker().call('download', undefined, {
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
            download: {
              loaded,
              total,
              file,
              speedMBps: mbps,
              etaSec: mbps && mbps > 0.01 ? (total - loaded) / 2 ** 20 / mbps : undefined,
            },
          });
        },
      });
      this.setState({ status: 'downloaded', download: undefined });
    } catch (error) {
      this.setState({ download: undefined });
      await this.refreshAfter(error);
    } finally {
      this.task = undefined;
    }
  }

  async load(): Promise<void> {
    if (this.state.status === 'ready') return;
    this.setState({ status: 'loading', error: undefined, load: undefined });
    try {
      await this.worker().call('load', undefined, { onProgress: (load) => this.setState({ load }) });
      this.setState({ status: 'ready', load: undefined });
    } catch (error) {
      this.setState({ status: 'error', load: undefined, error: describe(error) });
      throw error;
    }
  }

  /** Runs a diffusion request, calling `onFrame` for every image/video frame as it is ready. */
  async generate(request: DiffusionRequest, onFrame: (frame: DiffusionFrame) => void, signal?: AbortSignal): Promise<void> {
    if (this.state.status !== 'ready') await this.load();
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
        return;
      }
      this.setState({ status: 'ready', error: describe(error) });
      throw error;
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
    this.setState({ status: 'unknown' });
    await this.refresh();
  }

  async remove(): Promise<void> {
    await this.unload();
    await store.deleteGroup(SD_TURBO_GROUP);
    await this.refresh();
  }

  private async refreshAfter(error: unknown): Promise<void> {
    this.setState({ status: 'unknown' });
    await this.refresh();
    if (!isAbortError(error)) this.setState({ error: describe(error) });
  }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/shader-f16|f16/i.test(message)) return 'This GPU lacks 16-bit shader support (shader-f16), required by the diffusion model.';
  if (/out of memory|OOM|allocation/i.test(message)) return 'Not enough GPU memory for the diffusion model (about 3 GB). Close other tabs or use the procedural engine.';
  return message;
}

export const imageEngine = new ImageEngine();
