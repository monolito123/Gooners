/**
 * VideoSynthesizer: produces frame sequences locally from
 *  - procedural WebGL2 shader scenes derived from the prompt,
 *  - animated effects over an existing image (e.g. one generated in the Image Studio),
 *  - the selected diffusion model (keyframes interpolated into dream zooms, camera moves, loops),
 * then hands them to encoder.ts (ffmpeg.wasm) for MP4/WebM/GIF.
 */
import { imageEngine } from './ImageEngine.ts';
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

// ─── AI video: diffusion keyframes from the prompt, interpolated into a smooth clip ──────

/**
 * flow: a latent walk between two noises (the scene evolves) with a slow camera push;
 * loop: a closed latent walk that ends where it starts; camera: one image with a camera move;
 * dream: endless zoom where each keyframe repaints the zoomed previous one (img2img models).
 */
export type AiMotion = 'flow' | 'loop' | 'camera' | 'dream';

export interface AiVideoOptions {
  prompt: string;
  seed: number;
  motion: AiMotion;
  /** Diffusion passes (ignored for 'camera', which needs one image). */
  keyframes: number;
  fps: number;
  seconds: number;
  /** Camera effect for 'camera'. */
  effect?: ImageEffect;
  signal?: AbortSignal;
  onKeyframe?: (image: Blob, index: number, total: number) => void;
  onFrame?: (frame: Blob, index: number, total: number) => void;
}

/** Zoom factor and rotation between consecutive "dream" keyframes (img2img of the zoomed previous one). */
export const DREAM_ZOOM = { scale: 1.22, rotateDeg: 1.5, strength: 0.5 };

const smooth = (x: number) => x * x * (3 - 2 * x);

function drawTransformed(ctx: CanvasRenderingContext2D, image: CanvasImageSource, size: number, scale: number, rotateDeg: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(size / 2, size / 2);
  ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.drawImage(image, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/** A copy of `image` whose borders fade to transparent, so a smaller overlay has no hard seam. */
function feathered(image: ImageBitmap): HTMLCanvasElement {
  const size = image.width;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(size / 2, size / 2, size * 0.38, size / 2, size / 2, size * 0.62);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the frame'))), 'image/png'));
}

/** Generates a video for the prompt with the selected diffusion model. */
export async function synthesizeAiVideo(options: AiVideoOptions): Promise<FrameSet> {
  const { motion, fps, seconds, signal } = options;
  const total = Math.max(2, Math.min(MAX_FRAMES, Math.round(fps * seconds)));
  const keyCount = motion === 'camera' ? 1 : Math.max(2, Math.min(24, Math.round(options.keyframes)));
  const keyframes: ImageBitmap[] = [];
  const pending: Promise<void>[] = [];
  try {
    await imageEngine.generate(
      {
        prompt: options.prompt,
        seed: options.seed,
        steps: 1,
        frames: keyCount,
        mode: motion === 'dream' ? 'zoom' : motion === 'loop' ? 'loop' : motion === 'flow' ? 'morph' : 'single',
        seedB: options.seed + 104729,
        // Neighbouring keyframes ~0.13 apart in noise space stay recognisably the same scene.
        walk: Math.min(1, 0.13 * (keyCount - 1)),
        radius: 0.45,
        zoom: DREAM_ZOOM,
      },
      (frame) => {
        pending.push(
          rgbaToPng(frame.rgba, frame.width, frame.height).then(async (png) => {
            keyframes[frame.index] = await createImageBitmap(png);
            options.onKeyframe?.(png, frame.index, frame.total);
          }),
        );
      },
      signal,
    );
    await Promise.all(pending);
    checkAbort(signal);

    if (motion === 'camera') {
      const effect = options.effect ?? 'kenburns';
      return await synthesizeImageEffectFrames(keyframes[0], effect, 1, { fps, seconds, width: 512, height: 512, signal, onFrame: options.onFrame });
    }

    const size = keyframes[0].width;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    const segments = motion === 'loop' ? keyCount : keyCount - 1;
    const soft = motion === 'dream' ? keyframes.map(feathered) : [];
    const frames: Blob[] = [];
    for (let i = 0; i < total; i++) {
      checkAbort(signal);
      // Position along the keyframe sequence: segment k, local time u in [0, 1).
      const pos = (i / (motion === 'loop' ? total : total - 1)) * segments;
      const k = Math.min(segments - 1, Math.floor(pos));
      const u = Math.min(1, pos - k);
      const a = keyframes[k];
      const b = keyframes[(k + 1) % keyCount];
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, size, size);
      if (motion === 'dream') {
        // Keyframe k+1 was painted from keyframe k zoomed by DREAM_ZOOM: zoom into k and fade
        // into k+1, which starts exactly where the zoom ends, so the motion is continuous.
        const zk = DREAM_ZOOM.scale ** u;
        drawTransformed(ctx, a, size, zk, DREAM_ZOOM.rotateDeg * u, 1);
        drawTransformed(ctx, u < 1 ? soft[(k + 1) % keyCount] : b, size, DREAM_ZOOM.scale ** (u - 1), DREAM_ZOOM.rotateDeg * (u - 1), smooth(u));
      } else {
        // Neighbouring keyframes differ slightly (small steps in noise space): cross-dissolve
        // them. "flow" adds a slow push-in across the clip; "loop" stays framed to loop cleanly.
        const zoom = motion === 'flow' ? 1 + 0.18 * (i / (total - 1)) : 1.02;
        drawTransformed(ctx, a, size, zoom, 0, 1);
        drawTransformed(ctx, b, size, zoom, 0, smooth(u));
      }
      const blob = await canvasToPng(canvas);
      frames.push(blob);
      options.onFrame?.(blob, i, total);
      if (i % 4 === 3) await nextTick();
    }
    return { frames, width: size, height: size, fps };
  } finally {
    keyframes.forEach((b) => b?.close());
  }
}
