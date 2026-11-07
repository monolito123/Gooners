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

/** Chromium's install prompt event (not in the DOM typings). */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PlatformState {
  info?: PlatformInfo;
  /** Available when the browser offers to install the app (installed apps keep their storage). */
  installPrompt?: InstallPromptEvent;
  installed: boolean;
  install: () => Promise<boolean>;
  /** Asks the browser not to evict our data; returns whether storage is now persistent. */
  persist: () => Promise<boolean>;
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
  installPrompt: undefined,
  installed: typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches,
  install: async () => {
    const prompt = get().installPrompt;
    if (!prompt) return false;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    set({ installPrompt: undefined, installed: outcome === 'accepted' });
    if (outcome === 'accepted') await get().persist();
    return outcome === 'accepted';
  },
  persist: async () => {
    const ok = (await navigator.storage?.persist?.().catch(() => false)) ?? false;
    await get().refreshStorage();
    return ok;
  },
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
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    usePlatform.setState({ installPrompt: event as InstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    usePlatform.setState({ installPrompt: undefined, installed: true });
    void usePlatform.getState().persist();
  });
  window.addEventListener('online', () => usePlatform.setState({ online: true }));
  window.addEventListener('offline', () => usePlatform.setState({ online: false }));
}
