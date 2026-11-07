/** React bindings for the engines plus app-level actions shared by several views. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { imageEngine } from './engines/ImageEngine.ts';
import { cachedTextModels } from './engines/modelCache.ts';
import { DEFAULT_CPU_CODE_MODEL, DEFAULT_CPU_MODEL, TEXT_MODELS, type TextModelInfo, findTextModel, isUsable } from './engines/models.ts';
import { textEngine } from './engines/TextEngine.ts';
import { translate } from './i18n/index.ts';
import { useObservable } from './lib/observable.ts';
import { usePlatform } from './state/platform.ts';
import { useSettings } from './state/settings.ts';
import { useUi } from './state/ui.ts';

export const useTextEngine = () => useObservable(textEngine);
export const useImageEngine = () => useObservable(imageEngine);

export function useGpu(): { supported: boolean; hasF16: boolean; known: boolean } {
  const info = usePlatform((s) => s.info);
  return { supported: info?.gpu.supported ?? false, hasF16: info?.gpu.hasF16 ?? false, known: Boolean(info) };
}

/** Catalog + user models, with availability on this device. */
export function useModelCatalog(): { models: TextModelInfo[]; usable: (m: TextModelInfo) => boolean } {
  const custom = useSettings((s) => s.customModels);
  const gpu = useGpu();
  const models = useMemo(() => [...TEXT_MODELS, ...custom], [custom]);
  const usable = useCallback((m: TextModelInfo) => isUsable(m, gpu), [gpu]);
  return { models, usable };
}

let cachedVersion = 0;
const cacheListeners = new Set<() => void>();
/** Call after downloading or deleting model files so badges refresh. */
export function invalidateModelCache(): void {
  cachedVersion++;
  for (const fn of cacheListeners) fn();
}

export function useCachedModels(): Set<string> {
  const custom = useSettings((s) => s.customModels);
  const { hasF16, known } = useGpu();
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(cachedVersion);
  useEffect(() => {
    const fn = () => setVersion(cachedVersion);
    cacheListeners.add(fn);
    return () => void cacheListeners.delete(fn);
  }, []);
  useEffect(() => {
    if (!known) return;
    let alive = true;
    void cachedTextModels(hasF16, custom).then((set) => alive && setCached(set));
    return () => {
      alive = false;
    };
  }, [hasF16, known, custom, version]);
  return cached;
}

/** Loads a text model, showing the loading modal and reporting errors as toasts. */
export async function loadTextModel(model: TextModelInfo, options: { showModal?: boolean } = {}): Promise<boolean> {
  const settings = useSettings.getState();
  const ui = useUi.getState();
  const gpu = usePlatform.getState().info?.gpu;
  if (!isUsable(model, { supported: gpu?.supported ?? false, hasF16: gpu?.hasF16 ?? false })) {
    ui.toast(translate(settings.language, 'model.unavailable'), 'error');
    return false;
  }
  if (options.showModal !== false) ui.setLoaderOpen(true);
  try {
    await textEngine.load(model, { hasF16: gpu?.hasF16 ?? false, customModels: settings.customModels });
    useSettings.getState().set({ lastModelId: model.id });
    invalidateModelCache();
    void usePlatform.getState().refreshStorage();
    if (textEngine.getState().status === 'ready') {
      ui.setLoaderOpen(false);
      ui.toast(translate(settings.language, 'model.loaded', { name: model.label }), 'success');
    }
    return textEngine.getState().status === 'ready';
  } catch (error) {
    ui.toast(error instanceof Error ? error.message : String(error), 'error');
    return false;
  }
}

/**
 * Makes sure a text model is ready: waits for a load in progress, or loads the preferred model
 * for `purpose` (downloading it on first use). Resolves false if loading failed or was cancelled.
 */
export async function ensureTextModel(purpose: 'chat' | 'code'): Promise<boolean> {
  const status = textEngine.getState().status;
  if (status === 'ready') return true;
  if (status === 'generating') return false;
  if (status === 'loading') {
    await new Promise<void>((resolve) => {
      const stop = textEngine.subscribe(() => {
        if (textEngine.getState().status !== 'loading') {
          stop();
          resolve();
        }
      });
    });
    return textEngine.getState().status === 'ready';
  }
  return loadTextModel(preferredModel(purpose));
}

/** The model to suggest for a purpose on this device. */
export function preferredModel(purpose: 'chat' | 'code'): TextModelInfo {
  const settings = useSettings.getState();
  const gpu = usePlatform.getState().info?.gpu;
  const id = purpose === 'code' ? settings.codeModelId : settings.chatModelId;
  const model = findTextModel(id, settings.customModels);
  const ok = (m?: TextModelInfo) => m && isUsable(m, { supported: gpu?.supported ?? false, hasF16: gpu?.hasF16 ?? false });
  if (ok(model)) return model!;
  return findTextModel(purpose === 'code' ? DEFAULT_CPU_CODE_MODEL : DEFAULT_CPU_MODEL)!;
}
