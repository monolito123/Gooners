/** Device/runtime facts shown in the telemetry bar: GPU, connectivity, storage, service worker. */
import { create } from 'zustand';
import { type PlatformInfo, detectPlatform } from '../lib/webgpu.ts';

export interface StorageInfo {
  usage?: number;
  quota?: number;
  persisted?: boolean;
}

export interface OfflineInfo {
  /** A service worker controls the page (app shell available offline). */
  shellReady: boolean;
  /** Large runtimes (.wasm) not yet cached for offline use. */
  missing: string[];
  version?: string;
  updateReady: boolean;
}

interface PlatformState {
  info?: PlatformInfo;
  online: boolean;
  storage: StorageInfo;
  offline: OfflineInfo;
  detect: () => Promise<PlatformInfo>;
  refreshStorage: () => Promise<void>;
  setOffline: (patch: Partial<OfflineInfo>) => void;
}

export const usePlatform = create<PlatformState>()((set, get) => ({
  info: undefined,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  storage: {},
  offline: { shellReady: false, missing: [], updateReady: false },
  detect: async () => {
    const info = await detectPlatform();
    set({ info });
    return info;
  },
  refreshStorage: async () => {
    if (!navigator.storage?.estimate) return;
    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate().catch(() => ({}) as StorageEstimate),
      navigator.storage.persisted?.().catch(() => undefined),
    ]);
    set({ storage: { usage: estimate.usage, quota: estimate.quota, persisted } });
  },
  setOffline: (patch) => set({ offline: { ...get().offline, ...patch } }),
}));

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => usePlatform.setState({ online: true }));
  window.addEventListener('offline', () => usePlatform.setState({ online: false }));
}
