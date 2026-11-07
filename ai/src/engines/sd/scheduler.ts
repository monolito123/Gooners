/**
 * Euler discrete scheduler as configured for SD-Turbo (scaled_linear betas, epsilon prediction,
 * "trailing" timestep spacing), reduced to the 1–4 step regime the model is distilled for.
 */

const TRAIN_STEPS = 1000;
const BETA_START = 0.00085;
const BETA_END = 0.012;
/** VAE latent scaling of Stable Diffusion 2.x. */
export const VAE_SCALE = 0.18215;

const alphasCumprod: Float64Array = (() => {
  const out = new Float64Array(TRAIN_STEPS);
  const a = Math.sqrt(BETA_START);
  const b = Math.sqrt(BETA_END);
  let prod = 1;
  for (let i = 0; i < TRAIN_STEPS; i++) {
    const beta = (a + ((b - a) * i) / (TRAIN_STEPS - 1)) ** 2;
    prod *= 1 - beta;
    out[i] = prod;
  }
  return out;
})();

export function sigmaAt(timestep: number): number {
  const ac = alphasCumprod[Math.max(0, Math.min(TRAIN_STEPS - 1, Math.round(timestep)))];
  return Math.sqrt((1 - ac) / ac);
}

/** diffusers' "trailing" spacing: round(arange(1000, 0, -1000/n)) - 1. */
export function trailingTimesteps(steps: number): number[] {
  const out: number[] = [];
  const ratio = TRAIN_STEPS / steps;
  for (let i = 0; i < steps; i++) out.push(Math.round(TRAIN_STEPS - i * ratio) - 1);
  return out;
}

export interface Schedule {
  timesteps: number[];
  /** sigmas[i] for each timestep, plus a final 0. */
  sigmas: number[];
}

/**
 * Text-to-image uses the full schedule (strength 1). Image-to-image with `strength` < 1 skips
 * the noisiest steps, matching diffusers' img2img: the schedule is computed for
 * `round(steps / strength)` steps and only the last `steps` are run.
 */
export function makeSchedule(steps: number, strength = 1): Schedule {
  const s = Math.min(1, Math.max(0.05, strength));
  const total = s >= 1 ? steps : Math.max(steps, Math.round(steps / s));
  const timesteps = trailingTimesteps(total).slice(total - steps);
  return { timesteps, sigmas: [...timesteps.map(sigmaAt), 0] };
}

/** Initial noise scale (EulerDiscreteScheduler.init_noise_sigma with trailing spacing). */
export function initNoiseSigma(schedule: Schedule): number {
  return schedule.sigmas[0];
}

/** Scales the latent before the UNet: x / sqrt(sigma² + 1). */
export function scaleModelInput(latent: Float32Array, sigma: number): Float32Array {
  const k = 1 / Math.sqrt(sigma * sigma + 1);
  const out = new Float32Array(latent.length);
  for (let i = 0; i < latent.length; i++) out[i] = latent[i] * k;
  return out;
}

/** One Euler step for epsilon prediction: x_next = x + (sigma_next - sigma) * eps. Mutates `latent`. */
export function eulerStep(latent: Float32Array, eps: Float32Array, sigma: number, sigmaNext: number): void {
  const dt = sigmaNext - sigma;
  for (let i = 0; i < latent.length; i++) latent[i] += dt * eps[i];
}
