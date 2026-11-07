/**
 * Tiny typed request/response protocol between the UI thread and engine workers, with
 * streaming progress events and cancellation (AbortSignal on both sides).
 */

export interface MethodSpec {
  params: unknown;
  progress: unknown;
  result: unknown;
}
export type ApiSpec = Record<string, MethodSpec>;

type Outgoing =
  | { kind: 'call'; id: number; method: string; params: unknown }
  | { kind: 'cancel'; id: number };

type Incoming =
  | { kind: 'progress'; id: number; data: unknown }
  | { kind: 'result'; id: number; data: unknown }
  | { kind: 'error'; id: number; error: { name: string; message: string } };

export class RpcAbortError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AbortError';
  }
}

export interface CallOptions<P> {
  onProgress?: (progress: P) => void;
  signal?: AbortSignal;
  transfer?: Transferable[];
}

export class WorkerClient<Api extends ApiSpec> {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: unknown) => void }
  >();

  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', (event: MessageEvent<Incoming>) => {
      const msg = event.data;
      const call = this.pending.get(msg.id);
      if (!call) return;
      if (msg.kind === 'progress') call.onProgress?.(msg.data);
      else {
        this.pending.delete(msg.id);
        if (msg.kind === 'result') call.resolve(msg.data);
        else {
          const error = msg.error.name === 'AbortError' ? new RpcAbortError() : new Error(msg.error.message);
          if (msg.error.name !== 'AbortError') error.name = msg.error.name;
          call.reject(error);
        }
      }
    });
    worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'Worker crashed');
      for (const call of this.pending.values()) call.reject(error);
      this.pending.clear();
    });
  }

  call<K extends keyof Api & string>(
    method: K,
    params: Api[K]['params'],
    options: CallOptions<Api[K]['progress']> = {},
  ): Promise<Api[K]['result']> {
    const id = this.nextId++;
    return new Promise<Api[K]['result']>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new RpcAbortError());
        return;
      }
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress: options.onProgress as ((p: unknown) => void) | undefined,
      });
      options.signal?.addEventListener('abort', () => this.post({ kind: 'cancel', id }), { once: true });
      this.post({ kind: 'call', id, method, params }, options.transfer);
    });
  }

  terminate(): void {
    this.worker.terminate();
    for (const call of this.pending.values()) call.reject(new RpcAbortError());
    this.pending.clear();
  }

  private post(msg: Outgoing, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }
}

export interface HandlerContext<P> {
  signal: AbortSignal;
  progress: (data: P, transfer?: Transferable[]) => void;
}

export type Handlers<Api extends ApiSpec> = {
  [K in keyof Api]: (
    params: Api[K]['params'],
    ctx: HandlerContext<Api[K]['progress']>,
  ) => Promise<Api[K]['result'] | { value: Api[K]['result']; transfer: Transferable[] }>;
};

/** Marks a handler result whose buffers should be transferred instead of copied. */
export function transfer<T>(value: T, list: Transferable[]): { value: T; transfer: Transferable[] } {
  return { value, transfer: list };
}

function isTransferResult(v: unknown): v is { value: unknown; transfer: Transferable[] } {
  return typeof v === 'object' && v !== null && 'transfer' in v && 'value' in v && Array.isArray((v as { transfer: unknown }).transfer);
}

/** The subset of DedicatedWorkerGlobalScope used here (the DOM lib does not declare it). */
export interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** Installs the message loop inside a worker. */
export function exposeWorker<Api extends ApiSpec>(handlers: Handlers<Api>): void {
  const scope = self as unknown as WorkerScope;
  const controllers = new Map<number, AbortController>();
  scope.addEventListener('message', async (event: MessageEvent<Outgoing>) => {
    const msg = event.data;
    if (msg?.kind === 'cancel') {
      controllers.get(msg.id)?.abort();
      return;
    }
    if (msg?.kind !== 'call') return;
    const controller = new AbortController();
    controllers.set(msg.id, controller);
    const handler = handlers[msg.method as keyof Api];
    try {
      if (!handler) throw new Error(`Unknown method ${msg.method}`);
      const out = await handler(msg.params as never, {
        signal: controller.signal,
        progress: (data, list) => scope.postMessage({ kind: 'progress', id: msg.id, data } satisfies Incoming, list ?? []),
      });
      if (isTransferResult(out)) scope.postMessage({ kind: 'result', id: msg.id, data: out.value } satisfies Incoming, out.transfer);
      else scope.postMessage({ kind: 'result', id: msg.id, data: out } satisfies Incoming);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const name = controller.signal.aborted ? 'AbortError' : err.name;
      scope.postMessage({ kind: 'error', id: msg.id, error: { name, message: err.message } } satisfies Incoming);
    } finally {
      controllers.delete(msg.id);
    }
  });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
