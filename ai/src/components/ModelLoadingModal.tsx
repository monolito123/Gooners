import { Check, CircleStop, Cpu, Download, HardDrive, Minimize2, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LoadPhase } from '../engines/textTypes.ts';
import { textEngine } from '../engines/TextEngine.ts';
import { useTextEngine } from '../hooks.ts';
import { type TKey, useLocalized, useT } from '../i18n/index.ts';
import { formatDuration, formatMB } from '../lib/format.ts';
import { useUi } from '../state/ui.ts';
import { Badge, Button, Modal, ProgressBar, cx } from './ui/primitives.tsx';

const STEPS: { phase: LoadPhase[]; label: TKey; icon: ReactNode }[] = [
  { phase: ['download', 'cache'], label: 'loader.step.weights', icon: <Download className="size-4" /> },
  { phase: ['compile'], label: 'loader.step.shaders', icon: <Zap className="size-4" /> },
  { phase: ['init', 'ready'], label: 'loader.step.init', icon: <Cpu className="size-4" /> },
];

const ORDER: LoadPhase[] = ['init', 'download', 'cache', 'compile', 'ready'];

/** Detailed progress while a text model downloads, compiles its WebGPU shaders and initialises. */
export function ModelLoadingModal() {
  const t = useT();
  const loc = useLocalized();
  const state = useTextEngine();
  const open = useUi((s) => s.loaderOpen);
  const setOpen = useUi((s) => s.setLoaderOpen);
  const visible = open && (state.status === 'loading' || state.status === 'error');
  const p = state.progress;
  const model = state.model;
  const phaseIndex = p ? ORDER.indexOf(p.phase) : 0;
  const activeStep = !p ? 0 : p.phase === 'download' || p.phase === 'cache' ? 0 : p.phase === 'compile' ? 1 : phaseIndex > 0 ? 2 : 0;
  const fromCache = p?.phase === 'cache';

  return (
    <Modal
      open={visible}
      onClose={() => setOpen(false)}
      title={
        <span className="flex items-center gap-2">
          <HardDrive className="size-4 text-neon-cyan" /> {model ? t('loader.title', { name: model.label }) : t('loader.titleGeneric')}
        </span>
      }
      footer={
        state.status === 'loading' ? (
          <>
            <Button variant="ghost" icon={<Minimize2 className="size-4" />} onClick={() => setOpen(false)}>
              {t('loader.background')}
            </Button>
            <Button variant="danger" icon={<CircleStop className="size-4" />} onClick={() => textEngine.cancelLoad()}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('common.close')}
          </Button>
        )
      }
    >
      {model && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="cyan">{model.backend === 'webgpu' ? 'WebGPU' : 'CPU · WASM'}</Badge>
          <Badge>{model.params}</Badge>
          <Badge>{model.quant}</Badge>
          <Badge tone="amber">{formatMB(model.downloadMB)}</Badge>
          {model.vramMB > 0 && <Badge tone="pink">VRAM {formatMB(model.vramMB)}</Badge>}
          <span className="w-full text-ink-300">{loc(model.blurb)}</span>
        </div>
      )}

      {state.status === 'error' ? (
        <div className="rounded-xl border border-neon-red/40 bg-neon-red/5 p-3 text-sm text-ink-100">
          <p className="mb-1 font-semibold text-neon-red">{t('loader.failed')}</p>
          <p className="break-words text-ink-200">{state.error}</p>
        </div>
      ) : (
        <>
          <ol className="mb-5 space-y-2">
            {STEPS.map((step, i) => {
              const done = i < activeStep;
              const active = i === activeStep;
              return (
                <li
                  key={step.label}
                  className={cx(
                    'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm',
                    active ? 'border-neon-cyan/50 bg-neon-cyan/5 text-white' : done ? 'border-ink-600 text-ink-200' : 'border-ink-700 text-ink-400',
                  )}
                >
                  <span className={cx('flex size-7 items-center justify-center rounded-lg', done ? 'bg-neon-lime/15 text-neon-lime' : active ? 'bg-neon-cyan/15 text-neon-cyan' : 'bg-ink-800')}>
                    {done ? <Check className="size-4" /> : step.icon}
                  </span>
                  <span className="flex-1">
                    {i === 0 && fromCache ? t('loader.step.cache') : t(step.label)}
                  </span>
                  {active && p && <span className="font-mono text-xs text-neon-cyan">{Math.round(p.fraction * 100)}%</span>}
                </li>
              );
            })}
          </ol>
          <ProgressBar value={p?.fraction} indeterminate={!p || p.phase === 'init'} />
          <dl className="mt-4 grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-4">
            <div>
              <dt className="text-ink-400">{t('loader.loaded')}</dt>
              <dd className="text-white">
                {p?.loadedMB !== undefined ? formatMB(p.loadedMB) : '–'}
                {p?.totalMB ? <span className="text-ink-400"> / {formatMB(p.totalMB)}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-ink-400">{t('loader.speed')}</dt>
              <dd className="text-white">{p?.speedMBps ? `${p.speedMBps.toFixed(1)} MB/s` : '–'}</dd>
            </div>
            <div>
              <dt className="text-ink-400">{t('loader.eta')}</dt>
              <dd className="text-white">{formatDuration(p?.etaSec)}</dd>
            </div>
            <div>
              <dt className="text-ink-400">{t('loader.elapsed')}</dt>
              <dd className="text-white">{formatDuration(p?.elapsedSec)}</dd>
            </div>
          </dl>
          {p?.text && <p className="mt-3 truncate font-mono text-[11px] text-ink-400" title={p.text}>{p.text}</p>}
          <p className="mt-4 text-xs text-ink-400">{t('loader.note')}</p>
        </>
      )}
    </Modal>
  );
}
