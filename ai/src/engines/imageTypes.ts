/** Types shared by the image engine and its worker. */

export type DiffusionMode = 'single' | 'morph' | 'loop' | 'zoom';

export interface DiffusionRequest {
  prompt: string;
  seed: number;
  /** Denoising steps actually run (SD-Turbo is distilled for 1–4). */
  steps: number;
  /** Number of frames (images for 'single', video frames otherwise). */
  frames: number;
  mode: DiffusionMode;
  /** Image-to-image: 512×512 RGBA start image and how much of it to repaint (0–1). */
  init?: { rgba: Uint8ClampedArray; strength: number };
  /** morph: second prompt and seed to travel towards. */
  promptB?: string;
  seedB?: number;
  /** zoom: per-frame transform and repaint strength for the feedback loop. */
  zoom?: { scale: number; rotateDeg: number; strength: number };
}

export interface DiffusionFrame {
  index: number;
  total: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  ms: number;
}

export interface ModelFileStatus {
  key: string;
  received: number;
  size: number;
  complete: boolean;
}

export type ImageWorkerApi = {
  status: { params: undefined; progress: never; result: { files: ModelFileStatus[]; loaded: boolean } };
  download: {
    params: undefined;
    progress: { loaded: number; total: number; file: string };
    result: undefined;
  };
  load: {
    params: undefined;
    progress: { stage: 'read' | 'session'; file: string; index: number; count: number; fraction: number };
    result: { ms: number };
  };
  generate: { params: DiffusionRequest; progress: DiffusionFrame; result: { frames: number; ms: number } };
  unload: { params: undefined; progress: never; result: undefined };
};
