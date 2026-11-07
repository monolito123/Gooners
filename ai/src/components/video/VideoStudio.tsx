import { Clapperboard, Dices, Download, Film, ImagePlus, Pause, Play, Save, Sparkles, Square } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { type FrameSet, type VideoFormat, encodeFrames } from '../../engines/encoder.ts';
import { imageEngine } from '../../engines/ImageEngine.ts';
import { type SceneSpec, interpretPrompt } from '../../engines/procedural/artEngine.ts';
import { canUseLLM, interpretWithLLM } from '../../engines/procedural/llmSpec.ts';
import { IMAGE_EFFECTS, type ImageEffect } from '../../engines/procedural/shaders.ts';
import { type AiMotion, synthesizeAiVideo, synthesizeImageEffectFrames, synthesizeShaderFrames } from '../../engines/VideoSynthesizer.ts';
import { findDiffusionModel } from '../../engines/models.ts';
import { useGpu, useImageEngine, useTextEngine } from '../../hooks.ts';
import { useT } from '../../i18n/index.ts';
import { formatBytes, formatDuration } from '../../lib/format.ts';
import { randomSeed } from '../../lib/prng.ts';
import { isAbortError } from '../../lib/rpc.ts';
import { assetBlob, useAssets } from '../../state/assets.ts';
import { useUi } from '../../state/ui.ts';
import { SceneEditor } from '../image/ImageStudio.tsx';
import { AssetCard, AssetChip, AssetPicker, DiffusionModelPanel } from '../media.tsx';
import { Button, EmptyState, Field, IconButton, Panel, ProgressBar, Segmented, Slider, Toggle, downloadBlob, inputClass } from '../ui/primitives.tsx';

type Source = 'ai' | 'image' | 'shader';
type Aspect = 'square' | 'landscape' | 'portrait';

const SIZES: Record<Aspect, [number, number]> = { square: [640, 640], landscape: [960, 540], portrait: [540, 960] };

/** Plays a frame sequence on a canvas at its frame rate. */
function FramePlayer({ set }: { set: FrameSet }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bitmaps, setBitmaps] = useState<ImageBitmap[]>([]);
  const [playing, setPlaying] = useState(true);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    const list: ImageBitmap[] = [];
    void (async () => {
      for (const frame of set.frames) {
        if (!alive) break;
        list.push(await createImageBitmap(frame));
      }
      if (alive) setBitmaps(list);
    })();
    return () => {
      alive = false;
      list.forEach((b) => b.close());
    };
  }, [set]);

  useEffect(() => {
    if (!playing || bitmaps.length === 0) return;
    let raf = 0;
    let last = performance.now();
    let i = index;
    const tick = (now: number) => {
      if (now - last >= 1000 / set.fps) {
        last = now;
        i = (i + 1) % bitmaps.length;
        setIndex(i);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, bitmaps, set.fps]);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    const bmp = bitmaps[index];
    if (ctx && bmp) ctx.drawImage(bmp, 0, 0, set.width, set.height);
  }, [index, bitmaps, set.width, set.height]);

  return (
    <div className="space-y-2">
      <div className="checkerboard flex max-h-[60vh] justify-center overflow-hidden rounded-xl border border-ink-600">
        <canvas ref={canvas} width={set.width} height={set.height} className="max-h-[60vh] w-auto max-w-full object-contain" />
      </div>
      <div className="flex items-center gap-3">
        <IconButton label={playing ? t('video.pause') : t('video.play')} onClick={() => setPlaying(!playing)} className="border border-ink-600">
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </IconButton>
        <input
          type="range"
          className="slider flex-1"
          min={0}
          max={Math.max(0, set.frames.length - 1)}
          value={index}
          aria-label={t('video.frame')}
          style={{ '--fill': `${(index / Math.max(1, set.frames.length - 1)) * 100}%` } as CSSProperties}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
        />
        <span className="font-mono text-[11px] text-ink-400">
          {index + 1}/{set.frames.length} · {set.fps} fps · {set.width}×{set.height}
        </span>
      </div>
    </div>
  );
}

export default function VideoStudio() {
  const t = useT();
  const sd = useImageEngine();
  const text = useTextEngine();
  useGpu(); // re-render when the GPU capabilities are known
  const toast = useUi((s) => s.toast);
  const assets = useAssets((s) => s.assets);
  const [source, setSource] = useState<Source>('ai');
  const [prompt, setPrompt] = useState('');
  const [seed, setSeed] = useState(randomSeed);
  const [override, setOverride] = useState<SceneSpec | null>(null);
  const [useLLM, setUseLLM] = useState(false);
  const [aspect, setAspect] = useState<Aspect>('square');
  const [fps, setFps] = useState(24);
  const [seconds, setSeconds] = useState(4);
  const [imageId, setImageId] = useState<string | null>(null);
  const [effect, setEffect] = useState<ImageEffect>('kenburns');
  const [strength, setStrength] = useState(1);
  const [motion, setMotion] = useState<AiMotion>('flow');
  const [keyframes, setKeyframes] = useState(0);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'keyframes' | 'frames'>('frames');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [frames, setFrames] = useState<FrameSet | null>(null);
  const [encoding, setEncoding] = useState<{ fraction: number; stage: string } | null>(null);
  const [output, setOutput] = useState<{ blob: Blob; url: string; format: VideoFormat } | null>(null);
  const [error, setError] = useState<string>();
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    void imageEngine.refresh();
    const handoff = useUi.getState().takeHandoff('video');
    if (handoff?.purpose === 'animate') {
      setSource('image');
      setImageId(handoff.assetId);
    }
  }, []);

  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);
  useEffect(() => () => void (output && URL.revokeObjectURL(output.url)), [output]);

  const derived = useMemo(() => interpretPrompt(prompt || 'abstract', seed), [prompt, seed]);
  const spec = override ?? derived;
  const sdModel = findDiffusionModel(sd.modelId);
  const device = imageEngine.device(sdModel);
  // Dream zoom repaints with img2img, which one-step models cannot do.
  useEffect(() => {
    if (motion === 'dream' && !sdModel.img2img) setMotion('flow');
  }, [motion, sdModel.img2img]);
  // Fewer diffusion passes on the CPU, where each one takes several seconds.
  const keyCount = keyframes || (device === 'wasm' ? 4 : 8);
  const videos = assets.filter((a) => a.kind === 'video');

  const onFrame = (blob: Blob, index: number, total: number) => {
    setStage('frames');
    setProgress({ done: index + 1, total });
    setPreviewUrl(URL.createObjectURL(blob));
  };

  const synthesize = async () => {
    if (busy) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setFrames(null);
    setOutput(null);
    setError(undefined);
    setProgress({ done: 0, total: 1 });
    try {
      const [width, height] = SIZES[aspect];
      let set: FrameSet;
      if (source === 'ai') {
        if (!prompt.trim()) throw new Error(t('video.needPrompt'));
        setStage('keyframes');
        set = await synthesizeAiVideo({
          prompt,
          seed,
          motion,
          keyframes: keyCount,
          fps,
          seconds,
          effect,
          signal: controller.signal,
          onKeyframe: (png, index, total) => {
            setStage('keyframes');
            setProgress({ done: index + 1, total });
            setPreviewUrl(URL.createObjectURL(png));
          },
          onFrame,
        });
      } else if (source === 'shader') {
        let base = spec;
        if (useLLM && !override && prompt.trim()) base = await interpretWithLLM(prompt, spec);
        set = await synthesizeShaderFrames(base, { fps, seconds, width, height, signal: controller.signal, onFrame });
      } else {
        if (!imageId) throw new Error(t('video.pickImage'));
        const bitmap = await createImageBitmap(await assetBlob(imageId));
        try {
          set = await synthesizeImageEffectFrames(bitmap, effect, strength, { fps, seconds, width, height, signal: controller.signal, onFrame });
        } finally {
          bitmap.close();
        }
      }
      setFrames(set);
      setSeed(randomSeed());
    } catch (err) {
      if (!isAbortError(err)) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast(message, 'error');
      }
    } finally {
      setBusy(false);
      setProgress(null);
      abort.current = null;
    }
  };

  const exportVideo = async (format: VideoFormat) => {
    if (!frames) return;
    const controller = new AbortController();
    abort.current = controller;
    setEncoding({ fraction: 0, stage: 'load' });
    setError(undefined);
    try {
      const blob = await encodeFrames(frames, { format, signal: controller.signal, onProgress: (fraction, s) => setEncoding({ fraction, stage: s }) });
      const actual: VideoFormat = blob.type.includes('webm') ? 'webm' : blob.type.includes('gif') ? 'gif' : 'mp4';
      if (actual !== format) toast(t('video.fallbackWebm'), 'info');
      setOutput({ blob, url: URL.createObjectURL(blob), format: actual });
    } catch (err) {
      if (!isAbortError(err)) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast(message, 'error');
      }
    } finally {
      setEncoding(null);
      abort.current = null;
    }
  };

  const saveOutput = async () => {
    if (!output || !frames) return;
    await useAssets.getState().add(output.blob, {
      kind: 'video',
      prompt: prompt || effect,
      engine: source === 'ai' ? `${sdModel.label} · ${motion}` : source === 'image' ? `fx ${effect}` : `shader ${spec.mode}`,
      width: frames.width,
      height: frames.height,
      durationSec: frames.frames.length / frames.fps,
    });
    toast(t('video.saved'), 'success');
  };

  const totalFrames = Math.round(fps * seconds);
  const sdBusy = sd.status === 'downloading' || sd.status === 'loading' || sd.status === 'generating';
  const canRun =
    !busy &&
    !encoding &&
    (source === 'image' ? Boolean(imageId) : source === 'ai' ? Boolean(prompt.trim()) && Boolean(device) && !sdBusy : true);
  const needsDownload = source === 'ai' && (sd.status === 'absent' || sd.status === 'partial');

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <section className="space-y-4 border-ink-700 p-4 lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-r">
        <Segmented
          className="w-full"
          value={source}
          onChange={setSource}
          size="sm"
          options={[
            { value: 'ai', label: t('video.source.ai') },
            { value: 'image', label: t('video.source.image') },
            { value: 'shader', label: t('video.source.shader') },
          ]}
        />
        <p className="text-xs text-ink-400">{t(`video.source.${source}.about` as 'video.source.ai.about')}</p>

        {source === 'ai' && <DiffusionModelPanel disabled={busy} />}

        {source !== 'image' && (
          <Field label={t('video.prompt')}>
            <textarea
              className={`${inputClass} min-h-20`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={source === 'ai' ? t('video.prompt.placeholderAi') : t('video.prompt.placeholder')}
            />
          </Field>
        )}

        {source === 'ai' && (
          <>
            <Field group label={t('video.motion')}>
              <Segmented
                value={motion}
                onChange={setMotion}
                size="sm"
                options={[
                  { value: 'flow', label: t('video.motion.flow') },
                  { value: 'loop', label: t('video.motion.loop') },
                  { value: 'camera', label: t('video.motion.camera') },
                  { value: 'dream', label: t('video.motion.dream'), disabled: !sdModel.img2img, title: sdModel.img2img ? undefined : t('video.motion.dreamNeeds') },
                ]}
              />
            </Field>
            <p className="text-xs text-ink-400">{t(`video.motion.${motion}.about` as 'video.motion.dream.about')}</p>
            {motion === 'camera' ? (
              <Field label={t('video.effect')}>
                <select className={inputClass} value={effect} onChange={(e) => setEffect(e.target.value as ImageEffect)}>
                  {IMAGE_EFFECTS.map((fx) => (
                    <option key={fx} value={fx}>
                      {t(`fx.${fx}` as 'fx.kenburns')}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Slider label={t('video.keyframes')} value={keyCount} min={2} max={16} step={1} onChange={setKeyframes} hint={t('video.keyframesHint')} />
            )}
          </>
        )}

        {source === 'image' &&
          (imageId ? (
            <AssetChip assetId={imageId} onClear={() => setImageId(null)}>
              <p className="text-xs text-ink-300">{t('video.imageChosen')}</p>
            </AssetChip>
          ) : (
            <Button variant="outline" icon={<ImagePlus className="size-4" />} onClick={() => setPicker(true)}>
              {t('video.pickImage')}
            </Button>
          ))}

        {source === 'image' && (
          <>
            <Field label={t('video.effect')}>
              <select className={inputClass} value={effect} onChange={(e) => setEffect(e.target.value as ImageEffect)}>
                {IMAGE_EFFECTS.map((fx) => (
                  <option key={fx} value={fx}>
                    {t(`fx.${fx}` as 'fx.kenburns')}
                  </option>
                ))}
              </select>
            </Field>
            <Slider label={t('video.strength')} value={strength} min={0.1} max={2} step={0.05} onChange={setStrength} format={(v) => v.toFixed(2)} />
          </>
        )}

        {source === 'shader' && (
          <>
            <div className="flex items-end gap-2">
              <Field label={t('image.seed')}>
                <input className={`${inputClass} font-mono`} type="number" value={seed} onChange={(e) => setSeed(Math.abs(Math.floor(Number(e.target.value))) || 0)} />
              </Field>
              <IconButton label={t('image.randomSeed')} className="mb-0.5 size-10 border border-ink-600" onClick={() => setSeed(randomSeed())}>
                <Dices className="size-4" />
              </IconButton>
            </div>
            <SceneEditor spec={spec} custom={override !== null} onChange={setOverride} onReset={() => setOverride(null)} />
            <Slider label={t('proc.speed')} value={spec.speed} min={0.2} max={2.5} step={0.05} onChange={(speed) => setOverride({ ...spec, speed })} format={(v) => `${v.toFixed(2)}×`} />
            <Toggle checked={useLLM && text.status === 'ready'} onChange={setUseLLM} label={t('proc.llm')} hint={canUseLLM() ? t('proc.llmHint') : t('proc.llmNoModel')} />
          </>
        )}

        {source !== 'ai' && (
          <Field group label={t('video.aspect')}>
            <Segmented
              value={aspect}
              onChange={setAspect}
              size="sm"
              options={[
                { value: 'square', label: '1:1' },
                { value: 'landscape', label: '16:9' },
                { value: 'portrait', label: '9:16' },
              ]}
            />
          </Field>
        )}
        <Slider label={t('video.duration')} value={seconds} min={1} max={12} step={0.5} onChange={setSeconds} format={(v) => `${v}s`} />
        <Field group label="FPS">
          <Segmented value={String(fps)} onChange={(v) => setFps(Number(v))} size="sm" options={[12, 24, 30].map((v) => ({ value: String(v), label: String(v) }))} />
        </Field>

        <div className="flex gap-2">
          <Button variant="primary" size="lg" className="flex-1" disabled={!canRun} busy={busy} icon={<Sparkles className="size-4.5" />} onClick={() => void synthesize()} data-testid="video-render">
            {needsDownload ? t('image.downloadGenerate', { size: formatBytes(sd.totalBytes) }) : t('video.render', { n: totalFrames })}
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
        {error && !busy && <p className="rounded-lg border border-neon-red/40 bg-neon-red/5 p-2 text-xs break-words text-neon-red">{error}</p>}
      </section>

      <section className="min-h-0 flex-1 space-y-4 p-4 lg:overflow-y-auto">
        {busy && (
          <Panel className="space-y-3 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-white">
                <Film className="size-4 animate-pulse text-neon-amber" />
                {sd.status === 'downloading'
                  ? t('image.stageDownload')
                  : sd.status === 'loading'
                    ? t('image.stageLoad')
                    : stage === 'keyframes' && source === 'ai'
                      ? t(device === 'wasm' ? 'video.keyframesCpu' : 'video.keyframesGpu')
                      : t('video.rendering')}
              </span>
              {progress && progress.total > 1 && (
                <span className="font-mono text-xs text-ink-300">
                  {progress.done}/{progress.total}
                </span>
              )}
            </div>
            <ProgressBar value={progress && progress.total > 1 ? progress.done / progress.total : undefined} indeterminate={!progress || progress.total <= 1} tone="pink" />
            {previewUrl && <img src={previewUrl} alt="" className="mx-auto max-h-[50vh] rounded-lg border border-ink-600" />}
          </Panel>
        )}

        {frames && !busy && (
          <Panel className="space-y-4 p-4">
            <FramePlayer set={frames} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm font-medium text-white">{t('video.export')}</span>
              {(['mp4', 'webm', 'gif'] as VideoFormat[]).map((f) => (
                <Button key={f} size="sm" variant={f === 'mp4' ? 'primary' : 'outline'} disabled={Boolean(encoding)} icon={<Clapperboard className="size-3.5" />} onClick={() => void exportVideo(f)}>
                  {f.toUpperCase()}
                </Button>
              ))}
              <span className="font-mono text-[11px] text-ink-400">{formatDuration(frames.frames.length / frames.fps)}</span>
            </div>
            {encoding && (
              <div className="space-y-1.5">
                <ProgressBar value={encoding.fraction} indeterminate={encoding.stage === 'load'} />
                <p className="font-mono text-[11px] text-ink-400">{t(`video.encode.${encoding.stage}` as 'video.encode.load')}</p>
              </div>
            )}
            {output && (
              <div className="space-y-3 rounded-xl border border-neon-lime/30 bg-neon-lime/5 p-3">
                {output.format === 'gif' ? (
                  <img src={output.url} alt="" className="mx-auto max-h-[50vh] rounded-lg" />
                ) : (
                  <video src={output.url} controls loop autoPlay muted playsInline className="mx-auto max-h-[50vh] rounded-lg" />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="primary" icon={<Download className="size-3.5" />} onClick={() => downloadBlob(output.blob, `gooners-video.${output.format}`)}>
                    {t('media.download')} {output.format.toUpperCase()}
                  </Button>
                  <Button size="sm" variant="outline" icon={<Save className="size-3.5" />} onClick={() => void saveOutput()}>
                    {t('video.save')}
                  </Button>
                  <span className="font-mono text-[11px] text-ink-400">{formatBytes(output.blob.size)}</span>
                </div>
              </div>
            )}
          </Panel>
        )}

        {!frames && !busy && videos.length === 0 && (
          <EmptyState icon={<Clapperboard className="size-6" />} title={t('video.empty.title')}>
            {t('video.empty.body')}
          </EmptyState>
        )}

        {videos.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-white">{t('nav.gallery')}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
              {videos.map((a) => (
                <AssetCard key={a.id} asset={a} />
              ))}
            </div>
          </div>
        )}
      </section>
      <AssetPicker open={picker} onClose={() => setPicker(false)} onPick={(a) => setImageId(a.id)} />
    </div>
  );
}
