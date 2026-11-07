/**
 * Video encoding entirely in the browser: ffmpeg.wasm (single-threaded core, no
 * SharedArrayBuffer needed) for MP4/H.264, WebM/VP8 and palette-optimised GIF.
 * Falls back to MediaRecorder (WebM) if ffmpeg cannot load.
 */
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import coreUrl from '@ffmpeg/core?url';
import wasmUrl from '@ffmpeg/core/wasm?url';

export type VideoFormat = 'mp4' | 'webm' | 'gif';

export interface FrameSet {
  frames: Blob[];
  width: number;
  height: number;
  fps: number;
}

let ffmpegPromise: Promise<FFmpeg> | null = null;

export function loadFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: new URL(coreUrl, location.href).href,
        wasmURL: new URL(wasmUrl, location.href).href,
      });
      return ffmpeg;
    })();
    ffmpegPromise.catch(() => {
      ffmpegPromise = null;
    });
  }
  return ffmpegPromise;
}

export function isFFmpegLoaded(): boolean {
  return ffmpegPromise !== null;
}

const MIME: Record<VideoFormat, string> = { mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif' };

function args(format: VideoFormat, fps: number, width: number): string[] {
  const input = ['-framerate', String(fps), '-i', 'f%05d.png'];
  switch (format) {
    case 'mp4':
      return [...input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'out.mp4'];
    case 'webm':
      return [...input, '-c:v', 'libvpx', '-b:v', '4M', '-crf', '10', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', 'out.webm'];
    case 'gif': {
      const gifFps = Math.min(fps, 15);
      const scale = Math.min(width, 480);
      const filter = `fps=${gifFps},scale=${scale}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
      return [...input, '-vf', filter, '-loop', '0', 'out.gif'];
    }
  }
}

export interface EncodeOptions {
  format: VideoFormat;
  onProgress?: (fraction: number, stage: 'load' | 'write' | 'encode') => void;
  signal?: AbortSignal;
}

/** Encodes PNG frames into a video file. */
export async function encodeFrames(set: FrameSet, options: EncodeOptions): Promise<Blob> {
  const { format, onProgress, signal } = options;
  if (!set.frames.length) throw new Error('No frames to encode');
  let ffmpeg: FFmpeg;
  try {
    onProgress?.(0, 'load');
    ffmpeg = await loadFFmpeg();
  } catch (error) {
    if (format === 'webm' && typeof MediaRecorder !== 'undefined') return recordWebM(set, onProgress, signal);
    throw new Error(`ffmpeg.wasm could not start (${error instanceof Error ? error.message : String(error)})`);
  }
  const abort = () => {
    ffmpeg.terminate();
    ffmpegPromise = null;
  };
  signal?.addEventListener('abort', abort, { once: true });
  const names: string[] = [];
  const onFFmpegProgress = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)), 'encode');
  try {
    for (let i = 0; i < set.frames.length; i++) {
      const name = `f${String(i).padStart(5, '0')}.png`;
      await ffmpeg.writeFile(name, new Uint8Array(await set.frames[i].arrayBuffer()));
      names.push(name);
      onProgress?.((i + 1) / set.frames.length, 'write');
    }
    ffmpeg.on('progress', onFFmpegProgress);
    const out = `out.${format}`;
    const code = await ffmpeg.exec(args(format, set.fps, set.width));
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    const data = await ffmpeg.readFile(out);
    await ffmpeg.deleteFile(out).catch(() => undefined);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return new Blob([bytes as BlobPart], { type: MIME[format] });
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!signal?.aborted) {
      ffmpeg.off('progress', onFFmpegProgress);
      for (const name of names) await ffmpeg.deleteFile(name).catch(() => undefined);
    }
  }
}

/** Real-time WebM recording of the frames on a canvas (fallback without ffmpeg). */
async function recordWebM(set: FrameSet, onProgress?: EncodeOptions['onProgress'], signal?: AbortSignal): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = set.width;
  canvas.height = set.height;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(set.fps);
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start();
  for (let i = 0; i < set.frames.length; i++) {
    if (signal?.aborted) break;
    const bitmap = await createImageBitmap(set.frames[i]);
    ctx.drawImage(bitmap, 0, 0, set.width, set.height);
    bitmap.close();
    onProgress?.((i + 1) / set.frames.length, 'encode');
    await new Promise((r) => setTimeout(r, 1000 / set.fps));
  }
  recorder.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  return new Blob(chunks, { type: 'video/webm' });
}
