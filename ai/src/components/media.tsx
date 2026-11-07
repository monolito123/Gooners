/** Pieces shared by the Image and Video studios: diffusion model card, asset cards and picker. */
import { AppWindow, Check, Clapperboard, Download, HardDriveDownload, ImagePlus, Pause, Play, Power, Trash2, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { imageEngine } from '../engines/ImageEngine.ts';
import { SD_TURBO_TOTAL_BYTES, SD_TURBO_VRAM_MB } from '../engines/models.ts';
import { useGpu, useImageEngine } from '../hooks.ts';
import { useT } from '../i18n/index.ts';
import { formatBytes, formatDuration, formatMB } from '../lib/format.ts';
import { type Asset, assetBlob, assetUrl, useAssets } from '../state/assets.ts';
import { usePlatform } from '../state/platform.ts';
import { useUi } from '../state/ui.ts';
import { Badge, Button, IconButton, Modal, Panel, ProgressBar, cx, downloadBlob } from './ui/primitives.tsx';

/** Download / load state of the SD-Turbo diffusion model. */
export function DiffusionModelCard() {
  const t = useT();
  const sd = useImageEngine();
  const gpu = useGpu();
  const refreshStorage = usePlatform((s) => s.refreshStorage);
  useEffect(() => {
    void imageEngine.refresh();
  }, []);

  if (!gpu.supported || !gpu.hasF16) {
    return (
      <Panel className="flex gap-3 p-4 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-neon-amber" />
        <p className="text-ink-300">{gpu.supported ? t('sd.noF16') : t('sd.noGpu')}</p>
      </Panel>
    );
  }

  const pct = sd.totalBytes ? sd.downloadedBytes / sd.totalBytes : 0;
  let body: ReactNode;
  switch (sd.status) {
    case 'downloading':
      body = (
        <>
          <ProgressBar value={sd.download ? sd.download.loaded / sd.download.total : pct} tone="pink" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-ink-300">
            <span>
              {formatBytes(sd.download?.loaded ?? sd.downloadedBytes)} / {formatBytes(SD_TURBO_TOTAL_BYTES)}
            </span>
            <span>{sd.download?.speedMBps ? `${sd.download.speedMBps.toFixed(1)} MB/s · ${t('loader.eta')} ${formatDuration(sd.download.etaSec)}` : ''}</span>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-ink-400">{sd.download?.file}</p>
          <Button className="mt-3" size="sm" variant="outline" icon={<Pause className="size-3.5" />} onClick={() => imageEngine.cancel()}>
            {t('sd.pause')}
          </Button>
        </>
      );
      break;
    case 'loading':
      body = (
        <>
          <ProgressBar value={sd.load ? (sd.load.index + sd.load.fraction) / sd.load.count : undefined} indeterminate={!sd.load} tone="pink" />
          <p className="mt-2 font-mono text-[11px] text-ink-300">
            {sd.load ? `${sd.load.stage === 'read' ? t('sd.reading') : t('sd.compiling')} ${sd.load.file} (${sd.load.index + 1}/${sd.load.count})` : t('sd.starting')}
          </p>
        </>
      );
      break;
    case 'ready':
    case 'generating':
      body = (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="lime">
            <Check className="size-2.5" /> {t('sd.ready')}
          </Badge>
          {sd.lastFrameMs !== undefined && <span className="font-mono text-[11px] text-ink-400">{formatDuration(sd.lastFrameMs / 1000)} / {t('sd.perImage')}</span>}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" icon={<Power className="size-3.5" />} disabled={sd.status === 'generating'} onClick={() => void imageEngine.unload()}>
            {t('sd.unload')}
          </Button>
        </div>
      );
      break;
    case 'downloaded':
      body = (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="lime">
            <Check className="size-2.5" /> {t('sd.downloaded')}
          </Badge>
          <span className="flex-1" />
          <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => void imageEngine.load().catch(() => undefined)}>
            {t('sd.load')}
          </Button>
        </div>
      );
      break;
    default:
      body = (
        <>
          <p className="text-xs text-ink-300">{t('sd.about', { size: formatBytes(SD_TURBO_TOTAL_BYTES), vram: formatMB(SD_TURBO_VRAM_MB) })}</p>
          {sd.status === 'partial' && <ProgressBar className="mt-3" value={pct} tone="pink" />}
          <Button
            className="mt-3"
            size="sm"
            variant="primary"
            icon={<HardDriveDownload className="size-3.5" />}
            onClick={async () => {
              await navigator.storage?.persist?.().catch(() => false);
              await imageEngine.download();
              void refreshStorage();
            }}
          >
            {sd.status === 'partial' ? t('sd.resume', { pct: Math.round(pct * 100) }) : t('sd.download', { size: formatBytes(SD_TURBO_TOTAL_BYTES) })}
          </Button>
        </>
      );
  }

  return (
    <Panel className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-white">SD-Turbo</span>
        <Badge tone="pink">diffusion</Badge>
        <Badge>fp16 · 512px</Badge>
      </div>
      {body}
      {sd.error && <p className="mt-2 text-xs break-words text-neon-red">{sd.error}</p>}
    </Panel>
  );
}

export function useAssetUrl(id: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!id) return setUrl(undefined);
    let alive = true;
    void assetUrl(id)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(undefined));
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}

function extension(asset: Asset): string {
  return asset.mime.includes('gif') ? 'gif' : asset.mime.includes('webm') ? 'webm' : asset.mime.includes('mp4') ? 'mp4' : 'png';
}

/** Gallery card with download / hand-off / delete actions. */
export function AssetCard({ asset, highlight, onUseAsInit }: { asset: Asset; highlight?: boolean; onUseAsInit?: (asset: Asset) => void }) {
  const t = useT();
  const url = useAssetUrl(asset.id);
  const { setMode, handOff } = useUi();
  const remove = useAssets((s) => s.remove);
  return (
    <figure className={cx('group overflow-hidden rounded-xl border bg-ink-850', highlight ? 'border-neon-pink/50 shadow-neon-pink' : 'border-ink-600')}>
      <div className="checkerboard relative aspect-square">
        {url && asset.kind === 'image' && <img src={url} alt={asset.prompt} className="size-full object-contain" loading="lazy" />}
        {url && asset.kind === 'video' && (asset.mime.includes('gif') ? <img src={url} alt={asset.prompt} className="size-full object-contain" /> : <video src={url} controls loop playsInline className="size-full object-contain" />)}
        <Badge className="absolute top-2 left-2 bg-ink-950/80">{asset.engine}</Badge>
      </div>
      <figcaption className="space-y-2 p-2.5">
        <p className="line-clamp-2 text-xs text-ink-200" title={asset.prompt}>
          {asset.prompt || '—'}
        </p>
        <div className="flex items-center gap-0.5">
          <span className="flex-1 font-mono text-[10px] text-ink-400">
            {asset.width}×{asset.height} · {formatBytes(asset.size, 0)}
          </span>
          <IconButton
            label={t('media.download')}
            className="size-7"
            onClick={async () => downloadBlob(await assetBlob(asset.id), `gooners-${asset.name}.${extension(asset)}`)}
          >
            <Download className="size-3.5" />
          </IconButton>
          {asset.kind === 'image' && onUseAsInit && (
            <IconButton label={t('media.useInit')} className="size-7" onClick={() => onUseAsInit(asset)}>
              <ImagePlus className="size-3.5" />
            </IconButton>
          )}
          {asset.kind === 'image' && (
            <IconButton
              label={t('media.animate')}
              className="size-7"
              onClick={() => {
                handOff({ target: 'video', assetId: asset.id, purpose: 'animate' });
                setMode('video');
              }}
            >
              <Clapperboard className="size-3.5" />
            </IconButton>
          )}
          <IconButton
            label={t('media.useInApp')}
            className="size-7"
            onClick={() => {
              handOff({ target: 'builder', assetId: asset.id, purpose: 'app' });
              setMode('builder');
            }}
          >
            <AppWindow className="size-3.5" />
          </IconButton>
          <IconButton label={t('common.delete')} className="size-7 hover:text-neon-red" onClick={() => void remove(asset.id)}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </figcaption>
    </figure>
  );
}

function PickerThumb({ asset, onPick }: { asset: Asset; onPick: () => void }) {
  const url = useAssetUrl(asset.id);
  return (
    <button type="button" onClick={onPick} className="checkerboard aspect-square overflow-hidden rounded-lg border border-ink-600 hover:border-neon-cyan/60" title={asset.prompt}>
      {url && <img src={url} alt={asset.prompt} className="size-full object-cover" />}
    </button>
  );
}

/** Modal grid to choose one of the saved images. */
export function AssetPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (asset: Asset) => void }) {
  const t = useT();
  const assets = useAssets((s) => s.assets).filter((a) => a.kind === 'image');
  return (
    <Modal open={open} onClose={onClose} title={t('media.pick')} wide>
      {assets.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-400">{t('media.noImages')}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {assets.map((a) => (
            <PickerThumb
              key={a.id}
              asset={a}
              onPick={() => {
                onPick(a);
                onClose();
              }}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Small preview of a chosen asset with a "remove" control. */
export function AssetChip({ assetId, onClear, children }: { assetId: string; onClear: () => void; children?: ReactNode }) {
  const t = useT();
  const url = useAssetUrl(assetId);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-900/60 p-2">
      <div className="checkerboard size-14 shrink-0 overflow-hidden rounded-lg">{url && <img src={url} alt="" className="size-full object-cover" />}</div>
      <div className="min-w-0 flex-1">{children}</div>
      <IconButton label={t('common.remove')} className="size-7" onClick={onClear}>
        <Trash2 className="size-3.5" />
      </IconButton>
    </div>
  );
}
