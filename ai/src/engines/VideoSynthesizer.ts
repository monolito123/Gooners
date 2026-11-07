/**
 * VideoSynthesizer: produces frame sequences locally from
 *  - procedural WebGL2 shader scenes derived from the prompt,
 *  - animated effects over an existing image (e.g. one generated in the Image Studio),
 *  - SD-Turbo diffusion (latent morphs, seamless loops, zoom feedback),
 * then hands them to encoder.ts (ffmpeg.wasm) for MP4/WebM/GIF.
 */
import { imageEngine } from './ImageEngine.ts';
import type { DiffusionRequest } from './imageTypes.ts';
import type { SceneSpec } from './procedural/artEngine.ts';
import { ShaderRenderer } from './procedural/shaderRenderer.ts';
import type { ImageEffect } from './procedural/shaders.ts';
import type { FrameSet } from './encoder.ts';

export const MAX_FRAMES = 360;

export interface SynthesisOptions {
  fps: number;
  seconds: number;
  width: number;
  height: number;
  signal?: AbortSignal;
  /** Called with each finished frame (PNG) for live preview. */
  onFrame?: (frame: Blob, index: number, total: number) => void;
}

function frameCount(opts: SynthesisOptions): number {
  return Math.max(2, Math.min(MAX_FRAMES, Math.round(opts.fps * opts.seconds)));
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}

/** Yields to the event loop so the UI stays responsive between frames. */
const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function synthesizeShaderFrames(spec: SceneSpec, opts: SynthesisOptions): Promise<FrameSet> {
  const total = frameCount(opts);
  const renderer = new ShaderRenderer(opts.width, opts.height);
  const frames: Blob[] = [];
  try {
    for (let i = 0; i < total; i++) {
      checkAbort(opts.signal);
      renderer.renderScene(spec, 3 + i / opts.fps);
      const blob = await renderer.toBlob('image/png');
      frames.push(blob);
      opts.onFrame?.(blob, i, total);
      if (i % 4 === 3) await nextTick();
    }
  } finally {
    renderer.dispose();
  }
  return { frames, width: opts.width, height: opts.height, fps: opts.fps };
}

export async function synthesizeImageEffectFrames(
  image: ImageBitmap,
  effect: ImageEffect,
  strength: number,
  opts: SynthesisOptions,
): Promise<FrameSet> {
  const total = frameCount(opts);
  const renderer = new ShaderRenderer(opts.width, opts.height);
  const frames: Blob[] = [];
  try {
    for (let i = 0; i < total; i++) {
      checkAbort(opts.signal);
      renderer.renderImageEffect(image, effect, i / opts.fps, i / (total - 1), strength);
      const blob = await renderer.toBlob('image/png');
      frames.push(blob);
      opts.onFrame?.(blob, i, total);
      if (i % 4 === 3) await nextTick();
    }
  } finally {
    renderer.dispose();
  }
  return { frames, width: opts.width, height: opts.height, fps: opts.fps };
}

export async function rgbaToPng(rgba: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}

/** Diffusion frames (each one a full SD-Turbo generation; expect ~0.3–2 s per frame on a GPU). */
export async function synthesizeDiffusionFrames(
  request: Omit<DiffusionRequest, 'frames'>,
  opts: Omit<SynthesisOptions, 'width' | 'height'> & { frames: number },
): Promise<FrameSet> {
  const frames: Blob[] = [];
  const pending: Promise<void>[] = [];
  let size = 512;
  await imageEngine.generate(
    { ...request, frames: Math.min(MAX_FRAMES, opts.frames) },
    (frame) => {
      size = frame.width;
      pending.push(
        rgbaToPng(frame.rgba, frame.width, frame.height).then((blob) => {
          frames[frame.index] = blob;
          opts.onFrame?.(blob, frame.index, frame.total);
        }),
      );
    },
    opts.signal,
  );
  await Promise.all(pending);
  checkAbort(opts.signal);
  return { frames: frames.filter(Boolean), width: size, height: size, fps: opts.fps };
}
