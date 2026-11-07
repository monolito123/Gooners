/** Transient UI state: active mode, panels, toasts and cross-mode hand-offs. */
import { create } from 'zustand';
import { uid } from '../lib/format.ts';

export const MODES = ['chat', 'image', 'video', 'builder'] as const;
export type Mode = (typeof MODES)[number];

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export type SettingsTab = 'generation' | 'models' | 'cloud' | 'storage' | 'interface';

interface UiState {
  mode: Mode;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  loaderOpen: boolean;
  toasts: Toast[];
  /** Asset handed from one mode to another ("use in video", "use as init image"). */
  handoff?: { target: Mode; assetId: string; purpose: 'init' | 'animate' | 'app' };
  /** A prompt sent from the chat to be generated in the App Builder. */
  appRequest?: string;
  requestApp: (prompt: string | undefined) => void;
  setMode: (mode: Mode) => void;
  setSidebar: (open: boolean) => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setLoaderOpen: (open: boolean) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;
  handOff: (handoff: UiState['handoff']) => void;
  takeHandoff: (target: Mode) => UiState['handoff'];
}

const modeFromHash = (): Mode => {
  const m = location.hash.replace('#', '') as Mode;
  return MODES.includes(m) ? m : 'chat';
};

export const useUi = create<UiState>()((set, get) => ({
  mode: modeFromHash(),
  sidebarOpen: false,
  settingsOpen: false,
  settingsTab: 'generation',
  loaderOpen: false,
  toasts: [],
  handoff: undefined,
  setMode: (mode) => {
    if (location.hash !== `#${mode}`) history.pushState(null, '', `#${mode}`);
    set({ mode, sidebarOpen: false });
  },
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
  openSettings: (tab) => set({ settingsOpen: true, settingsTab: tab ?? get().settingsTab }),
  closeSettings: () => set({ settingsOpen: false }),
  setLoaderOpen: (loaderOpen) => set({ loaderOpen }),
  toast: (text, kind = 'info') => {
    const id = uid('t_');
    set({ toasts: [...get().toasts, { id, kind, text }].slice(-4) });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  handOff: (handoff) => set({ handoff }),
  requestApp: (appRequest) => set({ appRequest }),
  takeHandoff: (target) => {
    const h = get().handoff;
    if (h?.target !== target) return undefined;
    set({ handoff: undefined });
    return h;
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => useUi.setState({ mode: modeFromHash() }));
}
