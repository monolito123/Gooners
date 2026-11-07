/** Pieces shared by the Image and Video studios: diffusion model card, asset cards and picker. */
import { AppWindow, Check, Clapperboard, Download, HardDriveDownload, ImagePlus, Pause, Power, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { imageEngine } from '../engines/ImageEngine.ts';
import { DIFFUSION_MODELS, type DiffusionModelId, diffusionBytes, diffusionDevice, findDiffusionModel } from '../engines/models.ts';
import { useGpu, useImageEngine } from '../hooks.ts';
import { useLocalized, useT } from '../i18n/index.ts';
import { formatBytes, formatDuration } from '../lib/format.ts';
import { type Asset, assetBlob, assetUrl, useAssets } from '../state/assets.ts';
import { usePlatform } from '../state/platform.ts';
import { useSettings } from '../state/settings.ts';
import { useUi } from '../state/ui.ts';
import { Badge, Button, Field, IconButton, Modal, Panel, ProgressBar, Toggle, cx, downloadBlob, inputClass } from './ui/primitives.tsx';

/** Selects the diffusion model and shows its download / load state on this device. */
export function DiffusionModelPanel({ disabled }: { disabled?: boolean }) {
  const t = useT();
  const loc = useLocalized();
  const sd = useImageEngine();
  const gpu = useGpu();
  const info = usePlatform((s) => s.info);
  const setSettings = useSettings((s) => s.set);
  const model = findDiffusionModel(sd.modelId);
  const caps = { supported: gpu.supported, hasF16: gpu.hasF16, isFallbackAdapter: info?.gpu.isFallbackAdapter };
  const device = diffusionDevice(model, caps, sd.preferCpu);
  const realGpu = gpu.supported && !info?.gpu.isFallbackAdapter;
  const busy = sd.status === 'downloading' || sd.status === 'loading' || sd.status === 'generating';
  const pct = sd.totalBytes ? sd.downloadedBytes / sd.totalBytes : 0;

  return (
    <Panel className="space-y-3 p-4">
      <Field label={t('sd.model')}>
        <select
          className={inputClass}
          value={sd.modelId}
          disabled={busy || disabled}
          onChange={(e) => {
            const id = e.target.value as DiffusionModelId;
            setSettings({ imageModelId: id });
            void imageEngine.select(id);
          }}
        >
          {DIFFUSION_MODELS.map((m) => {
            const where = diffusionDevice(m, caps, false);
            return (
              <option key={m.id} value={m.id} disabled={!where}>
                {m.label} · {formatBytes(diffusionBytes(m), 1)} · {where === 'webgpu' ? 'GPU' : where === 'wasm' ? 'CPU' : t('sd.notHere')}
              </option>
            );
          })}
        </select>
      </Field>
      <p className="text-xs text-ink-300">{loc(model.blurb)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {device ? <Badge tone={device === 'webgpu' ? 'cyan' : 'amber'}>{device === 'webgpu' ? 'WebGPU' : 'CPU · WASM'}</Badge> : <Badge tone="red">{t('sd.notHere')}</Badge>}
        <Badge>{model.precision}</Badge>
        <Badge>512px</Badge>
        {sd.status === 'ready' || sd.status === 'generating' ? (
          <Badge tone="lime">
            <Check className="size-2.5" /> {t('sd.ready')}
          </Badge>
        ) : sd.status === 'downloaded' ? (
          <Badge tone="lime">
            <Check className="size-2.5" /> {t('sd.downloaded')}
          </Badge>
        ) : null}
        {sd.lastFrameMs !== undefined && (sd.status === 'ready' || sd.status === 'generating') && (
          <span className="font-mono text-[11px] text-ink-400">
            {formatDuration(sd.lastFrameMs / 1000)} / {t('sd.perImage')}
          </span>
        )}
      </div>
      {!device && <p className="text-xs text-neon-amber">{gpu.supported ? t('sd.noF16') : t('sd.noGpu')}</p>}
      {model.precision === 'fp32' && realGpu && (
        <Toggle checked={sd.preferCpu} onChange={(v) => { setSettings({ imageCpu: v }); imageEngine.setPreferCpu(v); }} label={t('sd.useCpu')} hint={t('sd.useCpuHint')} />
      )}

      {sd.status === 'downloading' && (
        <div>
          <ProgressBar value={sd.download ? sd.download.loaded / sd.download.total : pct} tone="pink" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-ink-300">
            <span>
              {t('sd.downloading')} {formatBytes(sd.download?.loaded ?? sd.downloadedBytes)} / {formatBytes(sd.totalBytes)}
            </span>
            <span>{sd.download?.speedMBps ? `${sd.download.speedMBps.toFixed(1)} MB/s · ${t('loader.eta')} ${formatDuration(sd.download.etaSec)}` : ''}</span>
          </div>
          <Button className="mt-2" size="sm" variant="outline" icon={<Pause className="size-3.5" />} onClick={() => imageEngine.cancel()}>
            {t('sd.pause')}
          </Button>
        </div>
      )}
      {sd.status === 'loading' && (
        <div>
          <ProgressBar value={sd.load ? (sd.load.index + sd.load.fraction) / sd.load.count : undefined} indeterminate={!sd.load} tone="pink" />
          <p className="mt-2 font-mono text-[11px] text-ink-300">
            {sd.load ? `${sd.load.stage === 'read' ? t('sd.reading') : t('sd.compiling')} ${sd.load.file} (${sd.load.index + 1}/${sd.load.count})` : t('sd.starting')}
          </p>
        </div>
      )}
      {(sd.status === 'absent' || sd.status === 'partial') && device && (
        <div className="space-y-2">
          <p className="text-xs text-ink-400">{t('sd.firstUse', { size: formatBytes(sd.totalBytes) })}</p>
          {sd.status === 'partial' && <ProgressBar value={pct} tone="pink" />}
          <Button size="sm" variant="outline" icon={<HardDriveDownload className="size-3.5" />} disabled={disabled} onClick={() => void imageEngine.download()}>
            {sd.status === 'partial' ? t('sd.resume', { pct: Math.round(pct * 100) }) : t('sd.downloadNow')}
          </Button>
        </div>
      )}
      {(sd.status === 'ready' || sd.status === 'downloaded') && (
        <div className="flex flex-wrap gap-2">
          {sd.status === 'ready' && (
            <Button size="sm" variant="ghost" icon={<Power className="size-3.5" />} onClick={() => void imageEngine.unload()}>
              {t('sd.unload')}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => void imageEngine.remove()}>
            {t('sd.delete')}
          </Button>
        </div>
      )}
      {sd.error && <p className="text-xs break-words text-neon-red">{sd.error}</p>}
      <p className="text-[10px] text-ink-500">{t('sd.license', { license: model.license })}</p>
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
