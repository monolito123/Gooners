import { ChevronDown, Cloud, Cpu, Download, Layers, Play, Zap } from 'lucide-react';
import { FREE_CLOUD_MODEL, activateCloudModel } from './CloudPanel.tsx';
import { findProvider } from '../engines/cloud.ts';
import { useMemo } from 'react';
import { loadTextModel, preferredModel, useCachedModels, useGpu, useTextEngine } from '../hooks.ts';
import { useLocalized, useT } from '../i18n/index.ts';
import { formatMB } from '../lib/format.ts';
import { useSettings } from '../state/settings.ts';
import { useUi } from '../state/ui.ts';
import { Badge, Button, Panel, ProgressBar } from './ui/primitives.tsx';

/** Inline call-to-action shown where a text model is needed but none is loaded. */
export function ModelGate({ purpose }: { purpose: 'chat' | 'code' }) {
  const t = useT();
  const loc = useLocalized();
  const engine = useTextEngine();
  const cached = useCachedModels();
  const gpu = useGpu();
  const openSettings = useUi((s) => s.openSettings);
  const setLoaderOpen = useUi((s) => s.setLoaderOpen);
  const ids = useSettings((s) => `${s.chatModelId}|${s.codeModelId}|${s.customModels.length}|${s.cloudModels.length}`);
  // Recomputed when the preferred ids or the GPU change.
  const model = useMemo(() => preferredModel(purpose), [purpose, ids, gpu.supported, gpu.hasF16]);
  const isCached = cached.has(model.id);

  if (engine.status === 'loading') {
    const p = engine.progress;
    return (
      <Panel className="mx-auto w-full max-w-xl p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-white">{t('loader.title', { name: engine.model?.label ?? '' })}</p>
          <span className="font-mono text-xs text-neon-cyan">{p ? `${Math.round(p.fraction * 100)}%` : ''}</span>
        </div>
        <ProgressBar value={p?.fraction} indeterminate={!p || p.phase === 'init'} />
        <div className="mt-3 flex items-center justify-between gap-3 font-mono text-xs text-ink-400">
          <span>
            {p?.loadedMB !== undefined ? `${formatMB(p.loadedMB)}${p.totalMB ? ` / ${formatMB(p.totalMB)}` : ''}` : t(`phase.${p?.phase ?? 'init'}` as 'phase.init')}
          </span>
          <button type="button" className="text-ink-300 hover:text-white" onClick={() => setLoaderOpen(true)}>
            {t('loader.details')}
          </button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="mx-auto w-full max-w-xl p-5">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan">
          {model.backend === 'webgpu' ? <Zap className="size-5" /> : model.backend === 'cloud' ? <Cloud className="size-5" /> : <Cpu className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{t(purpose === 'code' ? 'gate.titleCode' : 'gate.title')}</p>
          <p className="mt-1 text-sm text-ink-300">
            {model.cloud ? t('gate.cloudDesc', { provider: findProvider(model.cloud.provider).label }) : isCached ? t('gate.cached') : t('gate.download', { size: formatMB(model.downloadMB) })}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-white">{model.label}</span>
            <Badge tone={model.backend === 'webgpu' ? 'cyan' : model.backend === 'cloud' ? 'pink' : 'amber'}>
              {model.backend === 'webgpu' ? 'WebGPU' : model.backend === 'cloud' ? t('cloud.badge') : 'CPU'}
            </Badge>
            <Badge>{model.params}</Badge>
            {model.vramMB > 0 && <Badge tone="pink">VRAM {formatMB(model.vramMB)}</Badge>}
          </div>
          <p className="mt-1 text-xs text-ink-400">{loc(model.blurb)}</p>
          {engine.status === 'error' && engine.error && <p className="mt-2 text-xs break-words text-neon-red">{engine.error}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" icon={isCached || model.cloud ? <Play className="size-4" /> : <Download className="size-4" />} onClick={() => void loadTextModel(model)}>
              {model.cloud ? t('gate.useCloud') : isCached ? t('gate.load') : t('gate.downloadLoad', { size: formatMB(model.downloadMB) })}
            </Button>
            <Button variant="ghost" icon={<Layers className="size-4" />} onClick={() => openSettings('models')}>
              {t('gate.other')}
              <ChevronDown className="size-3.5" />
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-700 pt-3">
            <span className="text-xs text-ink-400">{t('gate.cloudHint')}</span>
            <Button size="sm" variant="outline" icon={<Cloud className="size-3.5" />} onClick={() => void activateCloudModel('pollinations', FREE_CLOUD_MODEL)}>
              {t('gate.cloudFree')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => openSettings('cloud')}>
              {t('gate.cloudMore')}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
