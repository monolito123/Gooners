/** Types shared by the text engine and its workers. */
export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface GenerationParams {
  temperature: number;
  topP: number;
  maxTokens: number;
}

export interface GenerationStats {
  /** Time from request to first generated token (includes prompt prefill). */
  ttftMs: number;
  totalMs: number;
  completionTokens: number;
  promptTokens?: number;
  /** Decode speed: tokens after the first one divided by the time after the first token. */
  tokensPerSec: number;
  prefillTokensPerSec?: number;
  finishReason: 'stop' | 'length' | 'abort';
  modelId: string;
  backend: 'webgpu' | 'wasm';
}

export type LoadPhase = 'download' | 'cache' | 'compile' | 'init' | 'ready';

export interface LoadProgress {
  phase: LoadPhase;
  /** 0..1 within the current phase. */
  fraction: number;
  loadedMB?: number;
  totalMB?: number;
  speedMBps?: number;
  etaSec?: number;
  elapsedSec: number;
  text: string;
}

/** RPC surface of the CPU (Transformers.js) worker. */
export type WasmTextApi = {
  load: {
    params: { repo: string; dtype: string };
    progress: { loaded: number; total: number; file: string };
    result: { fromCache: boolean };
  };
  generate: {
    params: { messages: ChatTurn[]; params: GenerationParams };
    progress: { delta: string; tokens: number };
    result: { completionTokens: number; promptTokens: number; ttftMs: number; totalMs: number; interrupted: boolean; hitLimit: boolean };
  };
  unload: { params: undefined; progress: never; result: undefined };
};
