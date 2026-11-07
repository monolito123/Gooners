/** Conversions between RGBA pixels, latents and model tensors for the diffusion pipeline. */

export const IMAGE_SIZE = 512;
export const LATENT_SIZE = IMAGE_SIZE / 8;
export const LATENT_CHANNELS = 4;
export const LATENT_LENGTH = LATENT_CHANNELS * LATENT_SIZE * LATENT_SIZE;

/** VAE decoder output [1,3,H,W] in [-1, 1] → RGBA bytes. */
export function chwToRgba(data: Float32Array, width: number, height: number): Uint8ClampedArray {
  const plane = width * height;
  const out = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) {
    out[i * 4] = (data[i] / 2 + 0.5) * 255;
    out[i * 4 + 1] = (data[plane + i] / 2 + 0.5) * 255;
    out[i * 4 + 2] = (data[2 * plane + i] / 2 + 0.5) * 255;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** RGBA bytes → [1,3,H,W] in [-1, 1] (VAE encoder input). */
export function rgbaToChw(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Float32Array {
  const plane = width * height;
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    out[i] = (rgba[i * 4] / 255) * 2 - 1;
    out[plane + i] = (rgba[i * 4 + 1] / 255) * 2 - 1;
    out[2 * plane + i] = (rgba[i * 4 + 2] / 255) * 2 - 1;
  }
  return out;
}

/** Spherical interpolation between two noise tensors (keeps the Gaussian's norm). */
export function slerp(a: Float32Array, b: Float32Array, t: number): Float32Array {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  const out = new Float32Array(a.length);
  if (Math.abs(cos) > 0.9995) {
    for (let i = 0; i < a.length; i++) out[i] = a[i] + t * (b[i] - a[i]);
    return out;
  }
  const theta = Math.acos(cos);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  for (let i = 0; i < a.length; i++) out[i] = wa * a[i] + wb * b[i];
  return out;
}

/** Point on a closed loop through noise space: a·cos(2πt) + b·sin(2πt) (seamless video loops). */
export function circularNoise(a: Float32Array, b: Float32Array, t: number): Float32Array {
  const c = Math.cos(2 * Math.PI * t);
  const s = Math.sin(2 * Math.PI * t);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = c * a[i] + s * b[i];
  return out;
}

export function lerp(a: Float32Array, b: Float32Array, t: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + t * (b[i] - a[i]);
  return out;
}
