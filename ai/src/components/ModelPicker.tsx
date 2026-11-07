import { Check, Cpu, Download, HardDriveDownload, Play, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { deleteTextModel } from '../engines/modelCache.ts';
import type { TextModelInfo } from '../engines/models.ts';
import { textEngine } from '../engines/TextEngine.ts';
import { invalidateModelCache, loadTextModel, useCachedModels, useGpu, useModelCatalog, useTextEngine } from '../hooks.ts';
import { useLocalized, useT } from '../i18n/index.ts';
import { formatMB } from '../lib/format.ts';
import { useSettings } from '../state/settings.ts';
import { useUi } from '../state/ui.ts';
import { Badge, Button, IconButton, cx } from './ui/primitives.tsx';

/** Model list with sizes, VRAM, cache state and load/delete actions. */
export function ModelPicker({ purpose, compact }: { purpose?: 'chat' | 'code'; compact?: boolean }) {
  const t = useT();
  const loc = useLocalized();
  const { models, usable } = useModelCatalog();
  const cached = useCachedModels();
  const engine = useTextEngine();
  const gpu = useGpu();
  const settings = useSettings();
  const toast = useUi((s) => s.toast);
  const [showCpu, setShowCpu] = useState(!gpu.supported);

  const visible = models.filter((m) => (m.backend === 'wasm' ? showCpu || !gpu.supported : true));
  const sorted = purpose === 'code' ? [...visible].sort((a, b) => Number(b.tags.includes('code')) - Number(a.tags.includes('code'))) : visible;

  const choose = (m: TextModelInfo) => {
    if (purpose === 'code' || m.tags.includes('code')) settings.set({ codeModelId: m.id });
    if (purpose !== 'code') settings.set({ chatModelId: m.id });
    void loadTextModel(m);
  };

  return (
    <div className="space-y-2">
      {sorted.map((m) => {
        const isCached = cached.has(m.id);
        const isActive = engine.model?.id === m.id && engine.status !== 'idle' && engine.status !== 'error';
        const ok = usable(m);
        const preferred = purpose === 'code' ? settings.codeModelId === m.id : settings.chatModelId === m.id;
        return (
          <div
            key={m.id}
            className={cx(
              'flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center',
              isActive ? 'border-neon-cyan/50 bg-neon-cyan/5' : 'border-ink-600 bg-ink-900/50',
              !ok && 'opacity-50',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-white">{m.label}</span>
                {m.backend === 'webgpu' ? (
                  <Badge tone="cyan">
                    <Zap className="size-2.5" /> GPU
                  </Badge>
                ) : (
                  <Badge tone="amber">
                    <Cpu className="size-2.5" /> CPU
                  </Badge>
                )}
                {m.tags.includes('code') && <Badge tone="lime">code</Badge>}
                {m.tags.includes('reasoning') && <Badge tone="pink">think</Badge>}
                {isCached && (
                  <Badge tone="lime">
                    <Check className="size-2.5" /> {t('model.cached')}
                  </Badge>
                )}
                {preferred && <Badge>{t('model.default')}</Badge>}
              </div>
              {!compact && <p className="mt-1 text-xs text-ink-300">{loc(m.blurb)}</p>}
              <p className="mt-1 font-mono text-[11px] text-ink-400">
                {m.params} · {m.quant} · ↓ {formatMB(m.downloadMB)}
                {m.vramMB ? ` · VRAM ${formatMB(m.vramMB)}` : ''} · ctx {m.contextWindow}
                {m.requiresF16 && !gpu.hasF16 && m.f32Variant ? ' · f32' : ''}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {isCached && !isActive && (
                <IconButton
                  label={t('model.delete')}
                  className="hover:text-neon-red"
                  onClick={async () => {
                    await deleteTextModel(m, settings.customModels);
                    invalidateModelCache();
                    toast(t('model.deleted', { name: m.label }));
                  }}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              )}
              {isActive ? (
                <Button size="sm" variant="outline" onClick={() => void textEngine.unload()}>
                  {engine.status === 'loading' ? t('common.cancel') : t('model.unload')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={isCached ? 'primary' : 'outline'}
                  disabled={!ok || engine.status === 'loading'}
                  icon={isCached ? <Play className="size-3.5" /> : <Download className="size-3.5" />}
                  onClick={() => choose(m)}
                >
                  {isCached ? t('model.load') : t('model.download')}
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {gpu.supported && (
        <button type="button" onClick={() => setShowCpu(!showCpu)} className="flex items-center gap-2 px-1 pt-1 text-xs text-ink-400 hover:text-ink-200">
          <HardDriveDownload className="size-3.5" />
          {showCpu ? t('model.hideCpu') : t('model.showCpu')}
        </button>
      )}
    </div>
  );
}
