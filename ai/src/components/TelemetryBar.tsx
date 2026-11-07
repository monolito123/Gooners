import { Activity, Cpu, Database, Gauge, MemoryStick, RefreshCw, Timer, Wifi, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useImageEngine, useTextEngine } from '../hooks.ts';
import { useT } from '../i18n/index.ts';
import { formatBytes, formatMB, formatMs } from '../lib/format.ts';
import { applyUpdate } from '../lib/sw.ts';
import { gpuLabel } from '../lib/webgpu.ts';
import { usePlatform } from '../state/platform.ts';
import { useUi } from '../state/ui.ts';
import { cx } from './ui/primitives.tsx';

function Cell({ icon, children, title, tone, onClick, status }: { icon: ReactNode; children: ReactNode; title?: string; tone?: string; onClick?: () => void; status?: string }) {
  const className = cx('flex shrink-0 items-center gap-1.5 px-2.5 whitespace-nowrap', onClick && 'hover:text-white', tone);
  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={className} data-model-status={status}>
      {icon}
      {children}
    </button>
  ) : (
    <div title={title} className={className} data-model-status={status}>
      {icon}
      {children}
    </div>
  );
}

/** Live telemetry: GPU, connectivity/offline readiness, active model, tok/s, TTFT, VRAM, storage. */
export function TelemetryBar() {
  const t = useT();
  const text = useTextEngine();
  const image = useImageEngine();
  const { info, online, storage, offline } = usePlatform();
  const setLoaderOpen = useUi((s) => s.setLoaderOpen);
  const openSettings = useUi((s) => s.openSettings);

  const stats = text.live ?? text.lastStats;
  const tokPerSec = text.live?.tokensPerSec ?? text.lastStats?.tokensPerSec;
  const ttft = text.live?.ttftMs ?? text.lastStats?.ttftMs;
  const vramMB = (text.model && text.status !== 'idle' ? text.model.vramMB : 0) + (image.status === 'ready' || image.status === 'generating' ? 3000 : 0);
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;

  const statusTone =
    text.status === 'generating' ? 'text-neon-lime' : text.status === 'ready' ? 'text-neon-cyan' : text.status === 'loading' ? 'text-neon-amber' : text.status === 'error' ? 'text-neon-red' : 'text-ink-400';
  const progress = text.progress;

  return (
    <footer className="flex h-9 shrink-0 items-center overflow-x-auto border-t border-ink-700 bg-ink-950/90 font-mono text-[11px] text-ink-300 [scrollbar-width:none]">
      <Cell
        icon={<Cpu className={cx('size-3.5', info?.gpu.supported ? 'text-neon-cyan' : 'text-neon-red')} />}
        title={info?.gpu.supported ? `${info.gpu.description ?? ''} ${info.gpu.hasF16 ? '· shader-f16' : '· no shader-f16'}` : t('telemetry.noGpu')}
      >
        {info ? gpuLabel(info.gpu) : '…'}
        {info?.gpu.supported && <span className={info.gpu.hasF16 ? 'text-neon-lime' : 'text-ink-400'}>{info.gpu.hasF16 ? 'f16' : 'f32'}</span>}
      </Cell>
      <span className="h-4 w-px bg-ink-700" />
      <Cell
        icon={online ? <Wifi className="size-3.5 text-neon-lime" /> : <WifiOff className="size-3.5 text-neon-amber" />}
        title={offline.shellReady ? t('telemetry.offlineReady') : t('telemetry.offlineNotReady')}
      >
        <span data-connectivity={online ? 'online' : 'offline'}>{online ? t('telemetry.online') : t('telemetry.offline')}</span>
        <span className={offline.shellReady ? 'text-neon-lime' : 'text-ink-400'}>{offline.shellReady ? '● ' + t('telemetry.cached') : '○'}</span>
      </Cell>
      {offline.updateReady && (
        <Cell icon={<RefreshCw className="size-3.5" />} tone="text-neon-pink" onClick={applyUpdate}>
          {t('telemetry.update')}
        </Cell>
      )}
      <span className="h-4 w-px bg-ink-700" />
      <Cell
        icon={<Activity className={cx('size-3.5', statusTone)} />}
        onClick={text.status === 'loading' ? () => setLoaderOpen(true) : () => openSettings('models')}
        title={text.error}
        status={text.status}
      >
        <span className="max-w-[180px] truncate">{text.model ? text.model.label : t('telemetry.noModel')}</span>
        {text.model?.backend === 'cloud' && <span className="rounded border border-neon-pink/40 px-1 text-[9px] text-neon-pink uppercase">{t('cloud.badge')}</span>}
        <span className={cx(statusTone, text.status === 'idle' && 'hidden')}>
          {text.status === 'loading' && progress
            ? `${Math.round(progress.fraction * 100)}%`
            : t(`status.${text.status}` as 'status.idle')}
        </span>
      </Cell>
      <Cell icon={<Gauge className="size-3.5 text-neon-cyan" />} title={t('telemetry.tps')}>
        {tokPerSec !== undefined ? `${tokPerSec.toFixed(1)} tok/s` : '– tok/s'}
      </Cell>
      <Cell icon={<Timer className="size-3.5 text-neon-pink" />} title={t('telemetry.ttft')}>
        TTFT {formatMs(ttft)}
      </Cell>
      {stats && 'tokens' in stats && (
        <Cell icon={<span className="text-neon-lime">#</span>}>{stats.tokens} tok</Cell>
      )}
      <Cell icon={<MemoryStick className="size-3.5 text-neon-violet" />} title={t('telemetry.vram')}>
        VRAM ~{vramMB ? formatMB(vramMB) : '0'}
        {heap ? <span className="text-ink-400">· JS {formatBytes(heap, 0)}</span> : null}
      </Cell>
      <Cell icon={<Database className="size-3.5 text-neon-amber" />} onClick={() => openSettings('storage')} title={t('telemetry.storage')}>
        {formatBytes(storage.usage)}
        {storage.quota ? <span className="text-ink-400">/ {formatBytes(storage.quota, 0)}</span> : null}
      </Cell>
    </footer>
  );
}
