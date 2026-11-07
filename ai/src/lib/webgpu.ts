/** Hardware capability detection (WebGPU, WebGL2, threads, storage). */

export interface GpuInfo {
  /** navigator.gpu exists and an adapter was granted. */
  supported: boolean;
  /** Why WebGPU is unavailable, when it is. */
  reason?: 'no-api' | 'no-adapter' | 'insecure-context' | 'error';
  error?: string;
  vendor?: string;
  architecture?: string;
  description?: string;
  device?: string;
  isFallbackAdapter: boolean;
  /** shader-f16: required by the q4f16 LLMs and the fp16 diffusion model. */
  hasF16: boolean;
  features: string[];
  maxBufferSizeMB?: number;
  maxStorageBufferBindingSizeMB?: number;
}

export interface PlatformInfo {
  gpu: GpuInfo;
  webgl2: boolean;
  crossOriginIsolated: boolean;
  threads: number;
  deviceMemoryGB?: number;
  browser: string;
  os: string;
}

function describeBrowser(): { browser: string; os: string } {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Unknown';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux|CrOS/.test(ua)
            ? 'Linux'
            : 'Unknown';
  return { browser, os };
}

export async function detectGpu(): Promise<GpuInfo> {
  const base: GpuInfo = { supported: false, isFallbackAdapter: false, hasF16: false, features: [] };
  if (!window.isSecureContext) return { ...base, reason: 'insecure-context' };
  if (!('gpu' in navigator) || !navigator.gpu) return { ...base, reason: 'no-api' };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { ...base, reason: 'no-adapter' };
    const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
    const features = Array.from(adapter.features as unknown as Iterable<string>);
    return {
      supported: true,
      vendor: info?.vendor || undefined,
      architecture: info?.architecture || undefined,
      description: info?.description || undefined,
      device: info?.device || undefined,
      // SwiftShader is a CPU emulation of a GPU: slower than WebAssembly for model inference.
      isFallbackAdapter:
        Boolean((info as (GPUAdapterInfo & { isFallbackAdapter?: boolean }) | undefined)?.isFallbackAdapter) ||
        /swiftshader/i.test(`${info?.architecture ?? ''} ${info?.description ?? ''}`),
      hasF16: adapter.features.has('shader-f16'),
      features,
      maxBufferSizeMB: adapter.limits.maxBufferSize / 2 ** 20,
      maxStorageBufferBindingSizeMB: adapter.limits.maxStorageBufferBindingSize / 2 ** 20,
    };
  } catch (error) {
    return { ...base, reason: 'error', error: error instanceof Error ? error.message : String(error) };
  }
}

export function hasWebGL2(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

export async function detectPlatform(): Promise<PlatformInfo> {
  const gpu = await detectGpu();
  return {
    gpu,
    webgl2: hasWebGL2(),
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    threads: navigator.hardwareConcurrency || 1,
    deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    ...describeBrowser(),
  };
}

/** Short label for the telemetry bar, e.g. "nvidia · ampere". */
export function gpuLabel(gpu: GpuInfo): string {
  if (!gpu.supported) return 'WebGPU off';
  const parts = [gpu.vendor, gpu.architecture].filter(Boolean);
  return parts.length ? parts.join(' · ') : gpu.description || 'WebGPU';
}
