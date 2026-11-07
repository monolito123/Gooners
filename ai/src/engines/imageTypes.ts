/** Types shared by the image engine and its worker. */
import type { DiffusionDevice, DiffusionModelId } from './models.ts';

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
  /** morph: fraction of the way from seed to seedB that the frames cover (default 1). */
  walk?: number;
  /** loop: radius of the orbit around the seed's noise (default 0.45); smaller = subtler motion. */
  radius?: number;
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

export type ImageWorkerApi = {
  download: {
    params: { modelId: DiffusionModelId };
    progress: { loaded: number; total: number; file: string };
    result: undefined;
  };
  load: {
    params: { modelId: DiffusionModelId; device: DiffusionDevice };
    progress: { stage: 'read' | 'session'; file: string; index: number; count: number; fraction: number };
    result: { ms: number };
  };
  generate: { params: DiffusionRequest; progress: DiffusionFrame; result: { frames: number; ms: number } };
  unload: { params: undefined; progress: never; result: undefined };
};
