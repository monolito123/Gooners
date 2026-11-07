import { Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { TextModelInfo } from '../engines/models.ts';
import { useT } from '../i18n/index.ts';
import { PERSONAS, useSettings } from '../state/settings.ts';
import { type SettingsTab, useUi } from '../state/ui.ts';
import { ModelPicker } from './ModelPicker.tsx';
import { StoragePanel } from './StoragePanel.tsx';
import { Button, Field, IconButton, Modal, Segmented, Slider, Toggle, inputClass } from './ui/primitives.tsx';

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

function CustomModels() {
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
    <div className="space-y-3 rounded-xl border border-ink-600 bg-ink-900/50 p-4">
      <div>
        <h4 className="text-sm font-semibold text-white">{t('custom.title')}</h4>
        <p className="mt-1 text-xs text-ink-400">{t('custom.hint')}</p>
      </div>
      {s.customModels.map((m) => (
        <div key={m.id} className="flex items-center gap-2 rounded-lg bg-ink-800 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 truncate font-mono text-ink-200">{m.id}</span>
          <IconButton label={t('common.delete')} className="size-7" onClick={() => s.set({ customModels: s.customModels.filter((x) => x.id !== m.id) })}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      ))}
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
  );
}

function ModelsTab() {
  const t = useT();
  const s = useSettings();
  return (
    <div className="space-y-5">
      <Toggle checked={s.autoLoad} onChange={(v) => s.set({ autoLoad: v })} label={t('settings.autoLoad')} hint={t('settings.autoLoadHint')} />
      <ModelPicker />
      <CustomModels />
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
      {settingsTab === 'storage' && <StoragePanel />}
      {settingsTab === 'interface' && <InterfaceTab />}
    </Modal>
  );
}
