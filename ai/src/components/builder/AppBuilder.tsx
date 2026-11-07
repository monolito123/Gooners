import {
  AppWindow,
  CircleStop,
  Code,
  Columns2,
  Copy,
  Download,
  Globe,
  History,
  ImagePlus,
  Maximize2,
  Play,
  RefreshCw,
  SendHorizontal,
  Terminal,
  Trash2,
  Wand2,
} from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { ensureDocument, extractCode } from '../../appBuilder/extractCode.ts';
import { splitReasoning } from '../../lib/reasoning.ts';
import { APP_SYSTEM_PROMPT, type AppAsset, buildCreatePrompt, buildEditPrompt, editFits } from '../../appBuilder/prompts.ts';
import { textEngine } from '../../engines/TextEngine.ts';
import { ensureTextModel, useTextEngine } from '../../hooks.ts';
import { type TKey, useT } from '../../i18n/index.ts';
import { assetDataUrl, useAssets } from '../../state/assets.ts';
import { titleFrom } from '../../state/chats.ts';
import { useProjects } from '../../state/projects.ts';
import { useSettings } from '../../state/settings.ts';
import { useUi } from '../../state/ui.ts';
import { AssetPicker } from '../media.tsx';
import { ModelGate } from '../ModelGate.tsx';
import { StatsLine } from '../chat/MessageBubble.tsx';
import { Badge, Button, IconButton, Segmented, Spinner, copyText, cx, downloadBlob } from '../ui/primitives.tsx';
import { AppSandbox, type AppSandboxHandle, type ConsoleEntry } from './AppSandbox.tsx';

const CodeEditor = lazy(() => import('./CodeEditor.tsx'));

const STARTERS: TKey[] = ['builder.starter.1', 'builder.starter.2', 'builder.starter.3', 'builder.starter.4', 'builder.starter.5', 'builder.starter.6'];

type View = 'split' | 'code' | 'preview';

function useIsWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1100px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1100px)');
    const fn = () => setWide(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return wide;
}

export default function AppBuilder() {
  const t = useT();
  const engine = useTextEngine();
  const { projects, activeId, create, patch, addVersion, select } = useProjects();
  const project = projects.find((p) => p.id === activeId);
  const allAssets = useAssets((s) => s.assets);
  const allowNetwork = useSettings((s) => s.sandboxNetwork);
  const setSettings = useSettings((s) => s.set);
  const toast = useUi((s) => s.toast);
  const wide = useIsWide();
  const [view, setView] = useState<View>(wide ? 'split' : 'preview');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [streamCode, setStreamCode] = useState<string | null>(null);
  const [previewCode, setPreviewCode] = useState(project?.code ?? '');
  const [reloadKey, setReloadKey] = useState(0);
  const [logs, setLogs] = useState<ConsoleEntry[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [picker, setPicker] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [lastStats, setLastStats] = useState<Parameters<typeof StatsLine>[0]['stats']>();
  const [waitingModel, setWaitingModel] = useState(false);
  const sandbox = useRef<AppSandboxHandle>(null);
  const logId = useRef(0);
  const editTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ready = engine.status === 'ready';

  useEffect(() => {
    if (!wide && view === 'split') setView('preview');
  }, [wide, view]);

  // Switching projects: show its code.
  useEffect(() => {
    setPreviewCode(project?.code ?? '');
    setStreamCode(null);
    setLogs([]);
    setLastStats(undefined);
  }, [project?.id]);

  // Assets attached to the project → data: URLs for asset://name references.
  const projectAssets = (project?.assetIds ?? []).map((id) => allAssets.find((a) => a.id === id)).filter((a) => a !== undefined);
  const assetKey = projectAssets.map((a) => a.id).join(',');
  useEffect(() => {
    let alive = true;
    void (async () => {
      const map: Record<string, string> = {};
      for (const a of projectAssets) map[a.name] = await assetDataUrl(a.id).catch(() => '');
      if (alive) setAssetUrls(map);
    })();
    return () => {
      alive = false;
    };
  }, [assetKey]);

  const ensureProject = useCallback(
    (title: string) => {
      const state = useProjects.getState();
      const current = state.projects.find((p) => p.id === state.activeId);
      if (current) return current;
      const id = create(title);
      return useProjects.getState().projects.find((p) => p.id === id)!;
    },
    [create],
  );

  const attachAsset = useCallback(
    (assetId: string) => {
      const p = ensureProject(t('builder.untitled'));
      if (!p.assetIds.includes(assetId)) patch(p.id, { assetIds: [...p.assetIds, assetId] });
    },
    [ensureProject, patch, t],
  );

  // Hand-offs from other modes: an image to use, or a prompt from the chat.
  useEffect(() => {
    const handoff = useUi.getState().takeHandoff('builder');
    if (handoff?.purpose === 'app') attachAsset(handoff.assetId);
    const request = useUi.getState().appRequest;
    if (request) setPrompt(request);
  }, [attachAsset]);

  const pendingRequest = useUi((s) => s.appRequest);
  useEffect(() => {
    if (pendingRequest && !generating && !waitingModel) {
      useUi.getState().requestApp(undefined);
      void generate(pendingRequest);
    }
  }); // runs after each render; guarded by the flags above

  const addLog = useCallback((entry: Omit<ConsoleEntry, 'id'>) => {
    setLogs((l) => [...l.slice(-199), { ...entry, id: ++logId.current }]);
  }, []);

  const generate = async (text = prompt) => {
    const request = text.trim();
    if (!request || generating || waitingModel) return;
    const p = ensureProject(titleFrom(request));
    if (textEngine.getState().status !== 'ready') {
      // No model yet: load the recommended coding model, then continue with this request.
      setWaitingModel(true);
      setPrompt(request);
      const ok = await ensureTextModel('code').finally(() => setWaitingModel(false));
      if (!ok) return;
    }
    if (!p.title) patch(p.id, { title: titleFrom(request) });
    const model = textEngine.getState().model!;
    const maxTokens = useSettings.getState().appMaxTokens;
    const current = p.code.trim();
    const assets: AppAsset[] = projectAssets.map((a) => ({ name: a.name, description: `${a.width}×${a.height} image: ${a.prompt.slice(0, 80)}` }));
    let content = buildCreatePrompt(request, assets);
    if (current) {
      if (editFits(current, model.contextWindow, maxTokens)) content = buildEditPrompt(request, current, assets);
      else toast(t('builder.tooLong'), 'info');
    }
    setGenerating(true);
    setStreamCode('');
    setPrompt('');
    setLogs([]);
    if (!wide && view === 'code') setView('preview');
    let buffer = '';
    let lastExtract = 0;
    let lastPreview = 0;
    try {
      const { text: answer, stats } = await textEngine.generate(
        [
          { role: 'system', content: APP_SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        {
          params: { temperature: 0.4, topP: 0.9, maxTokens },
          onDelta: (delta) => {
            buffer += delta;
            const now = performance.now();
            if (now - lastExtract > 200) {
              lastExtract = now;
              const code = extractCode(splitReasoning(buffer).answer);
              if (code.found) {
                setStreamCode(code.code);
                if (now - lastPreview > 1500) {
                  lastPreview = now;
                  setPreviewCode(code.code);
                }
              }
            }
          },
        },
      );
      setLastStats(stats);
      // Reasoning models may sketch code while thinking: only the final answer counts.
      const result = extractCode(splitReasoning(answer).answer);
      if (!result.found) {
        addLog({ level: 'warn', text: t('builder.noCode'), time: Date.now() });
        addLog({ level: 'info', text: answer.slice(0, 2000), time: Date.now() });
        setShowConsole(true);
        toast(t('builder.noCode'), 'error');
      } else {
        const code = ensureDocument(result.code, titleFrom(request));
        addVersion(p.id, { prompt: request, code, stats });
        setPreviewCode(code);
        setReloadKey((k) => k + 1);
        if (!result.complete) toast(t('builder.truncated'), 'info');
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setGenerating(false);
      setStreamCode(null);
    }
  };

  const onEdit = (code: string) => {
    if (!project || generating) return;
    patch(project.id, { code });
    clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => setPreviewCode(code), 700);
  };

  const editorValue = streamCode ?? project?.code ?? '';
  const errors = logs.filter((l) => l.level === 'error').length;
  const hasCode = Boolean(editorValue.trim());

  const editorPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-ink-700 bg-[#070a11]">
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <CodeEditor value={editorValue} onChange={onEdit} readOnly={generating} follow={generating} />
      </Suspense>
    </div>
  );

  const previewPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 bg-white">
        {hasCode || previewCode ? (
          <AppSandbox
            ref={sandbox}
            code={previewCode || editorValue}
            reloadKey={reloadKey}
            allowNetwork={allowNetwork}
            assets={assetUrls}
            storage={project?.storage ?? {}}
            onStorage={(storage) => project && patch(project.id, { storage })}
            onConsole={addLog}
            title={project?.title || t('builder.preview')}
          />
        ) : (
          <div className="grid-backdrop flex h-full items-center justify-center bg-ink-950 p-6 text-center text-sm text-ink-400">
            <div>
              <AppWindow className="mx-auto mb-3 size-10 text-ink-500" />
              {t('builder.previewEmpty')}
            </div>
          </div>
        )}
        {generating && (
          <div className="pointer-events-none absolute top-2 right-2 flex items-center gap-2 rounded-lg bg-ink-950/85 px-2.5 py-1.5 font-mono text-[11px] text-neon-lime">
            <Spinner className="size-3" /> {t('builder.live')}
            {engine.live?.tokensPerSec !== undefined && <span className="text-ink-300">{engine.live.tokensPerSec.toFixed(1)} tok/s</span>}
          </div>
        )}
      </div>
      {showConsole && (
        <div role="log" aria-label={t('builder.console')} className="h-40 shrink-0 overflow-y-auto border-t border-ink-700 bg-ink-950 p-2 font-mono text-[11px]">
          {logs.length === 0 && <p className="text-ink-500">{t('builder.consoleEmpty')}</p>}
          {logs.map((l) => (
            <p key={l.id} className={cx('break-words whitespace-pre-wrap', l.level === 'error' ? 'text-neon-red' : l.level === 'warn' ? 'text-neon-amber' : 'text-ink-200')}>
              <span className="text-ink-500">{new Date(l.time).toLocaleTimeString()} </span>
              {l.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 px-3 py-2">
        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={[
            ...(wide ? [{ value: 'split' as View, label: <Columns2 className="size-3.5" />, title: t('builder.view.split') }] : []),
            { value: 'code', label: <Code className="size-3.5" />, title: t('builder.view.code') },
            { value: 'preview', label: <Play className="size-3.5" />, title: t('builder.view.preview') },
          ]}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{project?.title || t('builder.untitled')}</span>
        {project && project.versions.length > 0 && (
          <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setShowVersions(!showVersions)}>
            v{project.versions.length}
          </Button>
        )}
        <IconButton label={t('builder.run')} onClick={() => setReloadKey((k) => k + 1)} disabled={!hasCode}>
          <RefreshCw className="size-4" />
        </IconButton>
        <IconButton label={t('builder.console')} active={showConsole} onClick={() => setShowConsole(!showConsole)} className="relative">
          <Terminal className="size-4" />
          {errors > 0 && <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-neon-red text-[9px] font-bold text-white">{errors}</span>}
        </IconButton>
        <IconButton
          label={allowNetwork ? t('builder.networkOn') : t('builder.networkOff')}
          active={allowNetwork}
          onClick={() => {
            setSettings({ sandboxNetwork: !allowNetwork });
            setReloadKey((k) => k + 1);
          }}
        >
          <Globe className={cx('size-4', allowNetwork && 'text-neon-amber')} />
        </IconButton>
        <IconButton label={t('builder.fullscreen')} onClick={() => sandbox.current?.fullscreen()} disabled={!hasCode}>
          <Maximize2 className="size-4" />
        </IconButton>
        <IconButton label={t('common.copy')} disabled={!hasCode} onClick={() => void copyText(editorValue).then(() => toast(t('common.copied'), 'success'))}>
          <Copy className="size-4" />
        </IconButton>
        <IconButton
          label={t('builder.download')}
          disabled={!hasCode}
          onClick={() => {
            const name = (project?.title || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
            downloadBlob(new Blob([editorValue], { type: 'text/html' }), `${name}.html`);
          }}
        >
          <Download className="size-4" />
        </IconButton>
      </div>

      {showVersions && project && (
        <div className="max-h-48 overflow-y-auto border-b border-ink-700 bg-ink-900/70 px-3 py-2">
          {[...project.versions].reverse().map((v, i) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                patch(project.id, { code: v.code });
                setPreviewCode(v.code);
                setReloadKey((k) => k + 1);
              }}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-ink-800"
            >
              <Badge tone={i === 0 ? 'lime' : 'default'}>v{project.versions.length - i}</Badge>
              <span className="min-w-0 flex-1 truncate text-ink-200">{v.prompt}</span>
              <span className="font-mono text-[10px] text-ink-400">{new Date(v.createdAt).toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {view !== 'preview' && editorPane}
        {view === 'split' && <div className="w-px bg-ink-700" />}
        {view !== 'code' && previewPane}
      </div>

      <div className="border-t border-ink-700 bg-ink-950/70 px-3 py-3">
        {!ready && !generating && (
          <div className="mb-3">
            <ModelGate purpose="code" />
          </div>
        )}
        {!hasCode && !generating && (
          <div className="mx-auto mb-2 flex max-w-4xl flex-wrap gap-1.5">
            {STARTERS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPrompt(t(key))}
                className="rounded-full border border-ink-600 px-3 py-1 text-xs text-ink-200 hover:border-neon-lime/60 hover:text-neon-lime"
              >
                {t(key)}
              </button>
            ))}
          </div>
        )}
        {projectAssets.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-4xl flex-wrap items-center gap-1.5">
            {projectAssets.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-ink-600 bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-200">
                asset://{a.name}
                <button type="button" aria-label={t('common.remove')} onClick={() => project && patch(project.id, { assetIds: project.assetIds.filter((x) => x !== a.id) })}>
                  <Trash2 className="size-3 text-ink-400 hover:text-neon-red" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-2xl border border-ink-600 bg-ink-850 p-2 focus-within:border-neon-lime/50">
          <IconButton label={t('builder.addAsset')} onClick={() => setPicker(true)} className="size-10">
            <ImagePlus className="size-4.5" />
          </IconButton>
          <textarea
            rows={1}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void generate();
              }
            }}
            placeholder={hasCode ? t('builder.placeholderEdit') : t('builder.placeholder')}
            aria-label={t('builder.placeholder')}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-white placeholder:text-ink-400 focus:outline-none"
          />
          {generating ? (
            <IconButton label={t('chat.stop')} onClick={() => textEngine.stop()} className="size-10 rounded-xl border border-neon-red/50 text-neon-red">
              <CircleStop className="size-5" />
            </IconButton>
          ) : (
            <IconButton
              label={hasCode ? t('builder.apply') : t('builder.generate')}
              disabled={!prompt.trim() || waitingModel}
              onClick={() => void generate()}
              data-testid="builder-submit"
              className={cx('size-10 rounded-xl', prompt.trim() && !waitingModel ? 'bg-neon-lime text-ink-950 hover:bg-[#cdff70] hover:text-ink-950' : 'bg-ink-700')}
            >
              {waitingModel ? <Spinner className="size-5" /> : hasCode ? <Wand2 className="size-5" /> : <SendHorizontal className="size-5" />}
            </IconButton>
          )}
        </div>
        <div className="mx-auto mt-1.5 flex max-w-4xl flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-ink-400">
          <span className={waitingModel ? 'text-neon-lime' : undefined}>
            {waitingModel ? t('builder.waitingModel') : allowNetwork ? t('builder.networkOnHint') : t('builder.sandboxHint')}
          </span>
          {lastStats && <StatsLine stats={lastStats} />}
          {project && !generating && (
            <button type="button" className="hover:text-white" onClick={() => select(create())}>
              + {t('builder.new')}
            </button>
          )}
        </div>
      </div>
      <AssetPicker open={picker} onClose={() => setPicker(false)} onPick={(a) => attachAsset(a.id)} />
    </div>
  );
}
