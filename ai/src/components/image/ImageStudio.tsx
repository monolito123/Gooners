import { Dices, Image as ImageIcon, ImagePlus, Lock, RotateCcw, ShieldAlert, Sparkles, Square, Unlock, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { generateCloudImage, listCloudImageModels } from '../../engines/cloud.ts';
import { imageEngine } from '../../engines/ImageEngine.ts';
import { findDiffusionModel } from '../../engines/models.ts';
import { SCENE_MODES, type SceneMode, type SceneSpec, interpretPrompt } from '../../engines/procedural/artEngine.ts';
import { canUseLLM, interpretWithLLM } from '../../engines/procedural/llmSpec.ts';
import { renderProceduralImage } from '../../engines/procedural/shaderRenderer.ts';
import { rgbaToPng } from '../../engines/VideoSynthesizer.ts';
import { useGpu, useImageEngine, useTextEngine } from '../../hooks.ts';
import { useT } from '../../i18n/index.ts';
import { formatBytes, formatDuration } from '../../lib/format.ts';
import { blobToRgba } from '../../lib/image.ts';
import { randomSeed } from '../../lib/prng.ts';
import { isAbortError } from '../../lib/rpc.ts';
import { type Asset, assetBlob, useAssets } from '../../state/assets.ts';
import { useSettings } from '../../state/settings.ts';
import { useUi } from '../../state/ui.ts';
import { AssetCard, AssetChip, AssetPicker, DiffusionModelPanel } from '../media.tsx';
import { Button, EmptyState, Field, IconButton, Panel, ProgressBar, Segmented, Slider, Toggle, inputClass } from '../ui/primitives.tsx';

type Engine = 'diffusion' | 'cloud' | 'procedural';
const ENGINE_SETTING = { diffusion: 'local', cloud: 'cloud', procedural: 'abstract' } as const;
const SETTING_ENGINE = { local: 'diffusion', cloud: 'cloud', abstract: 'procedural' } as const;

/** Image generation on Pollinations' servers (free, no key): model choice and privacy note. */
function CloudImagePanel({ models, model, onModel }: { models: string[]; model?: string; onModel: (m: string) => void }) {
  const t = useT();
  return (
    <Panel className="space-y-3 p-4">
      <div className="flex gap-2 text-xs text-ink-300">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-neon-amber" />
        <p>{t('cloudImage.about')}</p>
      </div>
      <Field label={t('cloudImage.model')}>
        <select className={inputClass} value={model ?? models[0] ?? ''} onChange={(e) => onModel(e.target.value)}>
          {models.length === 0 && <option value="">…</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
    </Panel>
  );
}

export function SceneEditor({ spec, onChange, onReset, custom }: { spec: SceneSpec; onChange: (spec: SceneSpec) => void; onReset: () => void; custom: boolean }) {
  const t = useT();
  return (
    <div className="space-y-3 rounded-xl border border-ink-600 bg-ink-900/50 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tracking-wide text-ink-200 uppercase">{t('proc.scene')}</span>
        {custom && (
          <button type="button" onClick={onReset} className="ml-auto inline-flex items-center gap-1 text-xs text-ink-400 hover:text-white">
            <RotateCcw className="size-3" /> {t('proc.reset')}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${inputClass} w-auto py-1.5`} value={spec.mode} onChange={(e) => onChange({ ...spec, mode: e.target.value as SceneMode })} aria-label={t('proc.mode')}>
          {SCENE_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`scene.${m}` as 'scene.nebula')}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {spec.palette.map((c, i) => (
            <input
              key={i}
              type="color"
              value={c}
              aria-label={`${t('proc.color')} ${i + 1}`}
              onChange={(e) => {
                const palette = [...spec.palette] as SceneSpec['palette'];
                palette[i] = e.target.value;
                onChange({ ...spec, palette });
              }}
              className="size-8 cursor-pointer rounded-lg border border-ink-500 bg-transparent p-0.5"
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Slider label={t('proc.detail')} value={spec.complexity} min={0} max={1} step={0.05} onChange={(complexity) => onChange({ ...spec, complexity })} format={(v) => v.toFixed(2)} />
        <Slider label={t('proc.warp')} value={spec.warp} min={0} max={1} step={0.05} onChange={(warp) => onChange({ ...spec, warp })} format={(v) => v.toFixed(2)} />
        <Slider label={t('proc.glow')} value={spec.glow} min={0} max={1} step={0.05} onChange={(glow) => onChange({ ...spec, glow })} format={(v) => v.toFixed(2)} />
        <Slider label={t('proc.grain')} value={spec.grain} min={0} max={1} step={0.05} onChange={(grain) => onChange({ ...spec, grain })} format={(v) => v.toFixed(2)} />
      </div>
    </div>
  );
}

export default function ImageStudio() {
  const t = useT();
  const sd = useImageEngine();
  const text = useTextEngine();
  useGpu(); // re-render when the GPU capabilities are known (they decide the device)
  const assets = useAssets((s) => s.assets);
  const toast = useUi((s) => s.toast);
  const sdModel = findDiffusionModel(sd.modelId);
  const sdDevice = imageEngine.device(sdModel);
  const [engine, setEngineState] = useState<Engine>(() => SETTING_ENGINE[useSettings.getState().imageEngine] ?? 'diffusion');
  const setEngine = (value: Engine) => {
    setEngineState(value);
    useSettings.getState().set({ imageEngine: ENGINE_SETTING[value] });
  };
  const cloudImageModel = useSettings((s) => s.cloudImageModel);
  const [cloudModels, setCloudModels] = useState<string[]>([]);
  useEffect(() => {
    if (engine !== 'cloud' || cloudModels.length) return;
    const controller = new AbortController();
    listCloudImageModels(controller.signal)
      .then(setCloudModels)
      .catch(() => setCloudModels(['flux']));
    return () => controller.abort();
  }, [engine, cloudModels.length]);
  const [prompt, setPrompt] = useState('');
  const [seed, setSeed] = useState(randomSeed);
  const [lockSeed, setLockSeed] = useState(false);
  const [steps, setSteps] = useState(1);
  const [count, setCount] = useState(1);
  const [size, setSize] = useState(768);
  const [init, setInit] = useState<{ assetId: string; strength: number } | null>(null);
  const [picker, setPicker] = useState(false);
  const [override, setOverride] = useState<SceneSpec | null>(null);
  const [useLLM, setUseLLM] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [latest, setLatest] = useState<string[]>([]);
  const [lastMs, setLastMs] = useState<number>();
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    void imageEngine.refresh();
    const handoff = useUi.getState().takeHandoff('image');
    if (handoff?.purpose === 'init') {
      setInit({ assetId: handoff.assetId, strength: 0.55 });
      setEngine('diffusion');
    }
  }, []);

  const derived = useMemo(() => interpretPrompt(prompt || 'abstract', seed), [prompt, seed]);
  const spec = override ?? derived;
  const images = assets.filter((a) => a.kind === 'image');

  const save = async (blob: Blob, engineName: string, width: number, height: number) => {
    const asset = await useAssets.getState().add(blob, { kind: 'image', prompt, engine: engineName, width, height });
    setLatest((l) => [asset.id, ...l].slice(0, 8));
    return asset;
  };

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setProgress({ done: 0, total: count });
    const start = performance.now();
    try {
      if (engine === 'diffusion') {
        const initRgba = init && sdModel.img2img ? await blobToRgba(await assetBlob(init.assetId), 512) : undefined;
        let done = 0;
        await imageEngine.generate(
          { prompt, seed, steps, frames: count, mode: 'single', init: initRgba ? { rgba: initRgba, strength: init!.strength } : undefined },
          (frame) => {
            done++;
            setProgress({ done, total: count });
            setLastMs(frame.ms);
            void rgbaToPng(frame.rgba, frame.width, frame.height).then((png) => save(png, sdModel.label, frame.width, frame.height));
          },
          controller.signal,
        );
      } else if (engine === 'cloud') {
        const model = cloudImageModel && cloudModels.includes(cloudImageModel) ? cloudImageModel : cloudModels[0];
        for (let i = 0; i < count; i++) {
          if (controller.signal.aborted) break;
          const t0 = performance.now();
          const blob = await generateCloudImage(prompt, { width: size, height: size, seed: seed + i, model }, controller.signal);
          await save(blob, `Pollinations${model ? ` ${model}` : ''}`, size, size);
          setProgress({ done: i + 1, total: count });
          setLastMs(performance.now() - t0);
        }
      } else {
        let base = spec;
        if (useLLM && !override) base = await interpretWithLLM(prompt, spec);
        for (let i = 0; i < count; i++) {
          if (controller.signal.aborted) break;
          const png = await renderProceduralImage({ ...base, seed: base.seed + i * 7919 }, size, size);
          await save(png, 'procedural', size, size);
          setProgress({ done: i + 1, total: count });
        }
        setLastMs((performance.now() - start) / count);
      }
      if (!lockSeed) setSeed(randomSeed());
    } catch (error) {
      if (!isAbortError(error)) toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
      setProgress(null);
      abort.current = null;
    }
  };

  const useAsInit = (asset: Asset) => {
    setInit({ assetId: asset.id, strength: 0.55 });
    setEngine('diffusion');
    // Image-to-image needs a model that supports it.
    if (!sdModel.img2img && imageEngine.device(findDiffusionModel('sd-turbo'))) {
      useSettings.getState().set({ imageModelId: 'sd-turbo' });
      void imageEngine.select('sd-turbo');
    }
  };

  const sdBusy = sd.status === 'downloading' || sd.status === 'loading' || sd.status === 'generating';
  const canGenerate = Boolean(prompt.trim()) && !busy && (engine !== 'diffusion' || (Boolean(sdDevice) && !sdBusy));
  const needsDownload = engine === 'diffusion' && (sd.status === 'absent' || sd.status === 'partial');

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <section className="space-y-4 border-ink-700 p-4 lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-r">
        <Segmented
          className="w-full"
          value={engine}
          onChange={setEngine}
          size="sm"
          options={[
            { value: 'diffusion', label: t('image.engine.diffusion') },
            { value: 'cloud', label: t('image.engine.cloud') },
            { value: 'procedural', label: t('image.engine.procedural') },
          ]}
        />
        {engine === 'diffusion' ? (
          <DiffusionModelPanel disabled={busy} />
        ) : engine === 'cloud' ? (
          <CloudImagePanel models={cloudModels} model={cloudImageModel} onModel={(m) => useSettings.getState().set({ cloudImageModel: m })} />
        ) : (
          <p className="text-xs text-ink-400">{t('image.procedural.about')}</p>
        )}

        <Field label={t('image.prompt')}>
          <textarea
            className={`${inputClass} min-h-24`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate();
            }}
            placeholder={engine === 'procedural' ? t('image.prompt.placeholderProc') : t('image.prompt.placeholder')}
          />
        </Field>

        <div className="flex items-end gap-2">
          <Field label={t('image.seed')}>
            <input className={`${inputClass} font-mono`} type="number" value={seed} onChange={(e) => setSeed(Math.abs(Math.floor(Number(e.target.value))) || 0)} />
          </Field>
          <IconButton label={t('image.randomSeed')} className="mb-0.5 size-10 border border-ink-600" onClick={() => setSeed(randomSeed())}>
            <Dices className="size-4" />
          </IconButton>
          <IconButton label={lockSeed ? t('image.unlockSeed') : t('image.lockSeed')} active={lockSeed} className="mb-0.5 size-10 border border-ink-600" onClick={() => setLockSeed(!lockSeed)}>
            {lockSeed ? <Lock className="size-4" /> : <Unlock className="size-4" />}
          </IconButton>
        </div>

        <Slider label={t('image.count')} value={count} min={1} max={4} step={1} onChange={setCount} />

        {engine === 'diffusion' ? (
          <>
            {sdModel.maxSteps > 1 && (
              <Slider label={t('image.steps')} value={Math.min(steps, sdModel.maxSteps)} min={1} max={sdModel.maxSteps} step={1} onChange={setSteps} hint={t('image.stepsHint')} />
            )}
            {!sdModel.img2img ? (
              <p className="text-xs text-ink-400">{t('image.initNeeds')}</p>
            ) : init ? (
              <AssetChip assetId={init.assetId} onClear={() => setInit(null)}>
                <Slider label={t('image.strength')} value={init.strength} min={0.1} max={1} step={0.05} onChange={(strength) => setInit({ ...init, strength })} format={(v) => v.toFixed(2)} />
              </AssetChip>
            ) : (
              <Button variant="outline" size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => setPicker(true)}>
                {t('image.init')}
              </Button>
            )}
          </>
        ) : (
          <>
            <Field group label={t('image.size')}>
              <Segmented
                value={String(size)}
                onChange={(v) => setSize(Number(v))}
                size="sm"
                options={[
                  { value: '512', label: '512' },
                  { value: '768', label: '768' },
                  { value: '1024', label: '1024' },
                  { value: '1536', label: '1536' },
                ]}
              />
            </Field>
            {engine === 'procedural' && (
              <>
                <SceneEditor spec={spec} custom={override !== null} onChange={setOverride} onReset={() => setOverride(null)} />
                <Toggle
                  checked={useLLM && text.status === 'ready'}
                  onChange={setUseLLM}
                  label={t('proc.llm')}
                  hint={canUseLLM() ? t('proc.llmHint') : t('proc.llmNoModel')}
                />
              </>
            )}
          </>
        )}

        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" size="lg" disabled={!canGenerate} busy={busy} icon={<Sparkles className="size-4.5" />} onClick={() => void generate()} data-testid="image-generate">
            {needsDownload ? t('image.downloadGenerate', { size: formatBytes(sd.totalBytes) }) : t('image.generate')}
          </Button>
          {busy && (
            <Button
              variant="danger"
              size="lg"
              icon={<Square className="size-4" />}
              onClick={() => {
                abort.current?.abort();
                imageEngine.cancel();
              }}
            >
              {t('common.stop')}
            </Button>
          )}
        </div>
        {progress && sd.status !== 'downloading' && sd.status !== 'loading' && (
          <ProgressBar value={progress.total ? progress.done / progress.total : undefined} indeterminate={progress.done === 0} tone="pink" />
        )}
        {lastMs !== undefined && !busy && (
          <p className="font-mono text-[11px] text-ink-400">
            {t('image.lastTime', { time: formatDuration(lastMs / 1000) })}
          </p>
        )}
      </section>

      <section className="min-h-0 flex-1 p-4 lg:overflow-y-auto">
        {images.length === 0 ? (
          <EmptyState icon={<ImageIcon className="size-6" />} title={t('image.empty.title')}>
            {t('image.empty.body')}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
            {images.map((a) => (
              <AssetCard key={a.id} asset={a} highlight={latest.includes(a.id)} onUseAsInit={useAsInit} />
            ))}
          </div>
        )}
        {busy && engine === 'cloud' && (
          <Panel className="mt-4 flex items-center gap-3 p-3 text-xs text-ink-300">
            <Wand2 className="size-4 animate-pulse text-neon-pink" />
            {t('cloudImage.working', { done: progress?.done ?? 0, total: progress?.total ?? count })}
          </Panel>
        )}
        {busy && engine === 'diffusion' && (
          <Panel className="mt-4 flex items-center gap-3 p-3 text-xs text-ink-300">
            <Wand2 className="size-4 animate-pulse text-neon-pink" />
            {sd.status === 'downloading'
              ? t('image.stageDownload')
              : sd.status === 'loading'
                ? t('image.stageLoad')
                : t(sdDevice === 'wasm' ? 'image.workingCpu' : 'image.working', { done: progress?.done ?? 0, total: progress?.total ?? count })}
          </Panel>
        )}
      </section>
      <AssetPicker open={picker} onClose={() => setPicker(false)} onPick={useAsInit} />
    </div>
  );
}
