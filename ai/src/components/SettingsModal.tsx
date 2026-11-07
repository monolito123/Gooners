import { Play, Plus, RotateCcw, Search, Settings2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { type Inspection, inspectHfRepo } from '../engines/hfImport.ts';
import { deleteTextModel, webllmLib } from '../engines/modelCache.ts';
import { TEXT_MODELS, type TextModelInfo } from '../engines/models.ts';
import { invalidateModelCache, loadTextModel, useGpu } from '../hooks.ts';
import { formatMB } from '../lib/format.ts';
import { type TKey, useT } from '../i18n/index.ts';
import { PERSONAS, useSettings } from '../state/settings.ts';
import { type SettingsTab, useUi } from '../state/ui.ts';
import { CloudPanel } from './CloudPanel.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { StoragePanel } from './StoragePanel.tsx';
import { Badge, Button, Field, IconButton, Modal, Segmented, Slider, Toggle, inputClass } from './ui/primitives.tsx';

function GenerationTab() {
  const t = useT();
  const s = useSettings();
  return (
    <div className="space-y-6">
      <Slider label={t('settings.temperature')} value={s.temperature} min={0} max={2} step={0.05} onChange={(v) => s.set({ temperature: v })} format={(v) => v.toFixed(2)} hint={t('settings.temperatureHint')} />
      <Slider label={t('settings.topP')} value={s.topP} min={0.05} max={1} step={0.01} onChange={(v) => s.set({ topP: v })} format={(v) => v.toFixed(2)} hint={t('settings.topPHint')} />
      <Slider label={t('settings.maxTokens')} value={s.maxTokens} min={64} max={4096} step={64} onChange={(v) => s.set({ maxTokens: v })} hint={t('settings.maxTokensHint')} />
      <Slider label={t('settings.appMaxTokens')} value={s.appMaxTokens} min={512} max={4096} step={128} onChange={(v) => s.set({ appMaxTokens: v })} hint={t('settings.appMaxTokensHint')} />
      <Field label={t('settings.persona')}>
        <select
          className={inputClass}
          value={s.personaId}
          onChange={(e) => {
            const persona = PERSONAS.find((p) => p.id === e.target.value);
            s.set({ personaId: e.target.value, ...(persona ? { systemPrompt: persona.prompt } : {}) });
          }}
        >
          {PERSONAS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name[s.language]}
            </option>
          ))}
          <option value="custom">{t('settings.personaCustom')}</option>
        </select>
      </Field>
      <Field label={t('settings.systemPrompt')} hint={t('settings.systemPromptHint')}>
        <textarea
          className={`${inputClass} min-h-32 font-mono text-xs leading-relaxed`}
          value={s.systemPrompt}
          onChange={(e) => s.set({ systemPrompt: e.target.value, personaId: 'custom' })}
        />
      </Field>
    </div>
  );
}

function ManualModelForm() {
  const t = useT();
  const s = useSettings();
  const toast = useUi((u) => u.toast);
  const [form, setForm] = useState({ id: '', modelUrl: '', modelLib: '', contextWindow: 4096, vramMB: 1500 });
  const add = () => {
    const id = form.id.trim();
    if (!id || !/^https:\/\//.test(form.modelUrl) || !/^https:\/\/.+\.wasm$/.test(form.modelLib)) {
      toast(t('custom.invalid'), 'error');
      return;
    }
    const model: TextModelInfo = {
      id,
      backend: 'webgpu',
      label: id,
      params: '?',
      quant: 'custom',
      downloadMB: 0,
      vramMB: form.vramMB,
      contextWindow: form.contextWindow,
      tags: ['chat'],
      requiresF16: false,
      custom: { modelUrl: form.modelUrl.trim(), modelLib: form.modelLib.trim() },
      blurb: { en: form.modelUrl, pt: form.modelUrl },
    };
    s.set({ customModels: [...s.customModels.filter((m) => m.id !== id), model] });
    setForm({ id: '', modelUrl: '', modelLib: '', contextWindow: 4096, vramMB: 1500 });
    toast(t('custom.added', { name: id }), 'success');
  };
  return (
    <details className="rounded-xl border border-ink-600 bg-ink-900/40 p-3 [&_summary]:cursor-pointer">
      <summary className="text-xs font-semibold text-ink-300">{t('custom.advanced')}</summary>
      <div className="mt-3">{/* manual MLC model: weights URL + compiled library URL */}
<div className="space-y-3 rounded-xl border border-ink-600 bg-ink-900/50 p-4">
      <div>
        <h4 className="text-sm font-semibold text-white">{t('custom.title')}</h4>
        <p className="mt-1 text-xs text-ink-400">{t('custom.hint')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('custom.id')}>
          <input className={inputClass} value={form.id} placeholder="My-Model-q4f16_1-MLC" onChange={(e) => setForm({ ...form, id: e.target.value })} />
        </Field>
        <Field label={t('custom.context')}>
          <input className={inputClass} type="number" min={512} step={512} value={form.contextWindow} onChange={(e) => setForm({ ...form, contextWindow: Number(e.target.value) })} />
        </Field>
        <Field label={t('custom.url')}>
          <input className={inputClass} value={form.modelUrl} placeholder="https://huggingface.co/user/model-MLC" onChange={(e) => setForm({ ...form, modelUrl: e.target.value })} />
        </Field>
        <Field label={t('custom.lib')}>
          <input className={inputClass} value={form.modelLib} placeholder="https://…/model-webgpu.wasm" onChange={(e) => setForm({ ...form, modelLib: e.target.value })} />
        </Field>
      </div>
      <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={add}>
        {t('custom.add')}
      </Button>
    </div>
      </div>
    </details>
  );
}

/** "Add a model from Hugging Face": inspect a repo, show what was found, add it to the list. */
function HfImporter() {
  const t = useT();
  const s = useSettings();
  const toast = useUi((u) => u.toast);
  const gpu = useGpu();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Inspection | null>(null);

  const inspect = async () => {
    if (!input.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await inspectHfRepo(input, async () => (await webllmLib()).prebuiltAppConfig.model_list));
    } catch (error) {
      setResult({ ok: false, reason: 'unsupported', detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const add = async (model: TextModelInfo, load: boolean) => {
    // Already a built-in model: just use that entry.
    const builtIn = TEXT_MODELS.find((m) => m.id === model.id || m.mlc?.modelUrl.includes(model.mlc?.modelUrl.split('/resolve/')[0] ?? '\u0000'));
    if (builtIn) {
      toast(t('hf.builtIn', { name: builtIn.label }), 'info');
      setResult(null);
      if (load) await loadTextModel(builtIn);
      return;
    }
    s.set({ customModels: [...s.customModels.filter((m) => m.id !== model.id), model] });
    invalidateModelCache();
    toast(t('custom.added', { name: model.label }), 'success');
    setResult(null);
    setInput('');
    if (load) await loadTextModel(model);
  };

  const reasons: Record<string, TKey> = {
    'not-found': 'hf.notFound',
    gguf: 'hf.gguf',
    'no-match': 'hf.noMatch',
    unsupported: 'hf.unsupported',
  };
  const added = s.customModels.filter((m) => m.backend !== 'cloud');

  return (
    <div className="space-y-3 rounded-xl border border-neon-cyan/30 bg-neon-cyan/5 p-4">
      <div>
        <h4 className="text-sm font-semibold text-white">{t('hf.title')}</h4>
        <p className="mt-1 text-xs text-ink-300">{t('hf.hint')}</p>
      </div>
      <div className="flex gap-2">
        <input
          className={`${inputClass} font-mono`}
          value={input}
          placeholder="onnx-community/Qwen2.5-0.5B-Instruct-abliterated-v3-ONNX"
          aria-label={t('hf.title')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void inspect()}
        />
        <Button variant="primary" busy={busy} disabled={!input.trim()} icon={<Search className="size-4" />} onClick={() => void inspect()}>
          {t('hf.inspect')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        <a className="text-neon-cyan hover:underline" href="https://huggingface.co/models?library=mlc-llm&sort=trending" target="_blank" rel="noopener noreferrer">
          {t('hf.browseMlc')}
        </a>
        <a className="text-neon-cyan hover:underline" href="https://huggingface.co/models?library=transformers.js&pipeline_tag=text-generation&sort=trending" target="_blank" rel="noopener noreferrer">
          {t('hf.browseOnnx')}
        </a>
      </div>
      {result && !result.ok && (
        <p className="rounded-lg border border-neon-red/40 bg-neon-red/5 p-2 text-xs break-words text-neon-red">
          {t(reasons[result.reason])}
          {result.detail ? ` (${result.detail})` : ''}
        </p>
      )}
      {result?.ok && (
        <div className="space-y-2 rounded-lg border border-ink-600 bg-ink-900/70 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-white">{result.model.label}</span>
            <Badge tone={result.format === 'mlc' ? 'cyan' : 'amber'}>{result.format === 'mlc' ? 'WebGPU · MLC' : 'CPU · ONNX'}</Badge>
            <Badge>{result.model.quant}</Badge>
            {result.model.downloadMB > 0 && <Badge tone="amber">{formatMB(result.model.downloadMB)}</Badge>}
            {result.model.tags.includes('uncensored') && <Badge tone="red">{t('model.uncensored')}</Badge>}
          </div>
          <p className="text-xs text-ink-300">{result.format === 'mlc' ? t('hf.foundMlc', { lib: result.model.mlc!.libFrom }) : t('hf.foundOnnx', { dtype: result.model.dtype ?? '' })}</p>
          {result.format === 'mlc' && result.model.requiresF16 && !gpu.hasF16 && <p className="text-xs text-neon-amber">{t('hf.needsF16')}</p>}
          {result.note && <p className="text-xs text-ink-400">{result.note}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => void add(result.model, true)}>
              {t('hf.addLoad')}
            </Button>
            <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => void add(result.model, false)}>
              {t('custom.add')}
            </Button>
          </div>
        </div>
      )}
      {added.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-ink-300">{t('hf.added')}</p>
          {added.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-lg bg-ink-800 px-3 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono text-ink-200" title={m.blurb.en}>
                {m.label}
              </span>
              <IconButton
                label={t('common.delete')}
                className="size-7"
                onClick={async () => {
                  await deleteTextModel(m, s.customModels).catch(() => undefined);
                  s.set({ customModels: s.customModels.filter((x) => x.id !== m.id) });
                  invalidateModelCache();
                }}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelsTab() {
  const t = useT();
  const s = useSettings();
  return (
    <div className="space-y-5">
      <Toggle checked={s.autoLoad} onChange={(v) => s.set({ autoLoad: v })} label={t('settings.autoLoad')} hint={t('settings.autoLoadHint')} />
      <ModelPicker />
      <HfImporter />
      <ManualModelForm />
    </div>
  );
}

function InterfaceTab() {
  const t = useT();
  const s = useSettings();
  return (
    <div className="space-y-6">
      <Field group label={t('settings.language')}>
        <Segmented
          value={s.language}
          onChange={(language) => s.set({ language })}
          options={[
            { value: 'pt', label: 'Português' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Field>
      <Toggle checked={s.sandboxNetwork} onChange={(v) => s.set({ sandboxNetwork: v })} label={t('settings.sandboxNetwork')} hint={t('settings.sandboxNetworkHint')} />
      <div className="rounded-xl border border-ink-600 bg-ink-900/50 p-4 text-sm text-ink-300">
        <p className="mb-1 font-semibold text-white">Gooners AI v{__APP_VERSION__}</p>
        <p>{t('settings.about')}</p>
      </div>
      <Button
        variant="danger"
        size="sm"
        icon={<RotateCcw className="size-3.5" />}
        onClick={() => {
          if (confirm(t('settings.resetConfirm'))) s.reset();
        }}
      >
        {t('settings.reset')}
      </Button>
    </div>
  );
}

export function SettingsModal() {
  const t = useT();
  const { settingsOpen, settingsTab, closeSettings, openSettings } = useUi();
  const tabs: { value: SettingsTab; label: string }[] = [
    { value: 'generation', label: t('settings.tab.generation') },
    { value: 'models', label: t('settings.tab.models') },
    { value: 'cloud', label: t('settings.tab.cloud') },
    { value: 'storage', label: t('settings.tab.storage') },
    { value: 'interface', label: t('settings.tab.interface') },
  ];
  return (
    <Modal
      open={settingsOpen}
      onClose={closeSettings}
      wide
      title={
        <span className="flex items-center gap-2">
          <Settings2 className="size-4.5 text-neon-cyan" /> {t('settings.title')}
        </span>
      }
    >
      <div className="-mx-5 -mt-4 mb-5 overflow-x-auto border-b border-ink-700 px-5 py-3">
        <Segmented value={settingsTab} onChange={(tab) => openSettings(tab)} options={tabs} size="sm" />
      </div>
      {settingsTab === 'generation' && <GenerationTab />}
      {settingsTab === 'models' && <ModelsTab />}
      {settingsTab === 'cloud' && <CloudPanel />}
      {settingsTab === 'storage' && <StoragePanel />}
      {settingsTab === 'interface' && <InterfaceTab />}
    </Modal>
  );
}
