import { Menu, Settings } from 'lucide-react';
import { Suspense, lazy, useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { ModelLoadingModal } from './components/ModelLoadingModal.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TelemetryBar } from './components/TelemetryBar.tsx';
import { Toasts } from './components/Toasts.tsx';
import { IconButton, Spinner } from './components/ui/primitives.tsx';
import { WebGPUWarning } from './components/WebGPUWarning.tsx';
import { imageEngine } from './engines/ImageEngine.ts';
import { isTextModelCached } from './engines/modelCache.ts';
import { defaultDiffusionModel, diffusionDevice, findDiffusionModel, findTextModel, isUsable } from './engines/models.ts';
import { textEngine } from './engines/TextEngine.ts';
import { loadTextModel } from './hooks.ts';
import { type TKey, translate, useT } from './i18n/index.ts';
import { completeOpenRouterConnect } from './engines/cloud.ts';
import { registerServiceWorker } from './lib/sw.ts';
import { useAssets } from './state/assets.ts';
import { usePlatform } from './state/platform.ts';
import { useSettings, userModels } from './state/settings.ts';
import { type Mode, useUi } from './state/ui.ts';

const ChatArea = lazy(() => import('./components/chat/ChatArea.tsx'));
const ImageStudio = lazy(() => import('./components/image/ImageStudio.tsx'));
const VideoStudio = lazy(() => import('./components/video/VideoStudio.tsx'));
const AppBuilder = lazy(() => import('./components/builder/AppBuilder.tsx'));

const TITLES: Record<Mode, TKey> = { chat: 'mode.chat', image: 'mode.image', video: 'mode.video', builder: 'mode.builder' };

// Cloud providers read their key / base URL from the settings at request time.
textEngine.cloudResolver = (provider) => {
  const s = useSettings.getState();
  return { provider, key: s.cloudKeys[provider], baseUrl: s.cloudBaseUrl };
};

/** Back from "Connect with OpenRouter": exchange the code for a key and keep it. */
async function finishOpenRouterConnect(): Promise<void> {
  try {
    const key = await completeOpenRouterConnect();
    if (!key) return;
    const s = useSettings.getState();
    s.set({ cloudKeys: { ...s.cloudKeys, openrouter: key }, cloudProvider: 'openrouter' });
    useUi.getState().openSettings('cloud');
    useUi.getState().toast(translate(s.language, 'cloud.connected'), 'success');
  } catch (error) {
    useUi.getState().toast(error instanceof Error ? error.message : String(error), 'error');
  }
}

/** Detects the device, registers the offline worker and reloads the last model if it is cached. */
async function bootstrap(): Promise<void> {
  void finishOpenRouterConnect();
  const platform = usePlatform.getState();
  const [info] = await Promise.all([platform.detect(), platform.refreshStorage(), useAssets.getState().load()]);
  void registerServiceWorker();
  const settings = useSettings.getState();
  // Image model: the saved choice if it runs here, else the best one for this device.
  const caps = { supported: info.gpu.supported, hasF16: info.gpu.hasF16, isFallbackAdapter: info.gpu.isFallbackAdapter };
  const saved = settings.imageModelId ? findDiffusionModel(settings.imageModelId) : undefined;
  imageEngine.setPreferCpu(settings.imageCpu);
  await imageEngine.select(saved && diffusionDevice(saved, caps) ? saved.id : defaultDiffusionModel(caps));
  if (!settings.autoLoad || !settings.lastModelId) return;
  const model = findTextModel(settings.lastModelId, userModels(settings));
  if (!model || !isUsable(model, info.gpu)) return;
  if (textEngine.getState().status !== 'idle') return;
  if (await isTextModelCached(model, info.gpu.hasF16, settings.customModels)) void loadTextModel(model, { showModal: false });
}

function Workspace({ mode }: { mode: Mode }) {
  const t = useT();
  const fallback = (
    <div className="flex h-full items-center justify-center">
      <Spinner className="size-6 text-neon-cyan" />
    </div>
  );
  return (
    <ErrorBoundary area={t(TITLES[mode])} key={mode}>
      <Suspense fallback={fallback}>
        {mode === 'chat' && <ChatArea />}
        {mode === 'image' && <ImageStudio />}
        {mode === 'video' && <VideoStudio />}
        {mode === 'builder' && <AppBuilder />}
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  const t = useT();
  const mode = useUi((s) => s.mode);
  const setSidebar = useUi((s) => s.setSidebar);
  const openSettings = useUi((s) => s.openSettings);
  const language = useSettings((s) => s.language);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === 'pt' ? 'pt-BR' : 'en';
    document.title = `${t(TITLES[mode])} · Gooners AI`;
  }, [language, mode, t]);

  return (
    <ErrorBoundary area="Gooners AI">
      <div className="grid-backdrop flex h-full overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-700 bg-ink-950/70 px-2 backdrop-blur lg:hidden">
            <IconButton label={t('nav.menu')} onClick={() => setSidebar(true)}>
              <Menu className="size-5" />
            </IconButton>
            <img src="icon.svg" alt="" className="size-6" />
            <span className="flex-1 truncate text-sm font-semibold text-white">{t(TITLES[mode])}</span>
            <IconButton label={t('nav.settings')} onClick={() => openSettings()}>
              <Settings className="size-4.5" />
            </IconButton>
          </header>
          <main className="min-h-0 flex-1">
            <Workspace mode={mode} />
          </main>
          <TelemetryBar />
        </div>
      </div>
      <SettingsModal />
      <ModelLoadingModal />
      <WebGPUWarning />
      <Toasts />
    </ErrorBoundary>
  );
}
