import { Check, Cloud, ExternalLink, Eye, EyeOff, LogIn, Search, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CLOUD_PROVIDERS, type CloudModelOption, cloudModelInfo, findProvider, listCloudModels, startOpenRouterConnect } from '../engines/cloud.ts';
import { loadTextModel, useTextEngine } from '../hooks.ts';
import { useLocalized, useT } from '../i18n/index.ts';
import { useSettings } from '../state/settings.ts';
import { useUi } from '../state/ui.ts';
import { Badge, Button, Field, IconButton, Spinner, Toggle, cx, inputClass } from './ui/primitives.tsx';

/** Picks a cloud model and makes it the active model for the chat and the App Builder. */
export async function activateCloudModel(providerId: Parameters<typeof cloudModelInfo>[0], option: CloudModelOption): Promise<boolean> {
  const info = cloudModelInfo(providerId, option);
  const s = useSettings.getState();
  s.set({
    cloudModels: [info, ...s.cloudModels.filter((m) => m.id !== info.id)].slice(0, 20),
    chatModelId: info.id,
    codeModelId: info.id,
  });
  return loadTextModel(info, { showModal: false });
}

/** One-click free model that needs no account (Pollinations). */
export const FREE_CLOUD_MODEL: CloudModelOption = { id: 'openai', label: 'GPT-OSS 20B · Pollinations', contextWindow: 32768, free: true };

export function CloudPanel() {
  const t = useT();
  const loc = useLocalized();
  const s = useSettings();
  const engine = useTextEngine();
  const toast = useUi((u) => u.toast);
  const provider = findProvider(s.cloudProvider);
  const key = s.cloudKeys[provider.id] ?? '';
  const [models, setModels] = useState<CloudModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [freeOnly, setFreeOnly] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(undefined);
      listCloudModels({ provider: provider.id, key, baseUrl: s.cloudBaseUrl }, controller.signal)
        .then(setModels)
        .catch((e: unknown) => {
          if (!controller.signal.aborted) {
            setModels([]);
            setError(e instanceof Error ? e.message : String(e));
          }
        })
        .finally(() => !controller.signal.aborted && setLoading(false));
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [provider.id, key, s.cloudBaseUrl]);

  const hasFree = models.some((m) => m.free) && models.some((m) => !m.free);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => (!hasFree || !freeOnly || m.free) && (!q || `${m.id} ${m.label}`.toLowerCase().includes(q))).slice(0, 80);
  }, [models, query, freeOnly, hasFree]);

  const activeId = engine.model?.backend === 'cloud' && engine.status !== 'error' ? engine.model.cloud?.model : undefined;
  const choose = async (option: CloudModelOption) => {
    setBusy(option.id);
    const ok = await activateCloudModel(provider.id, option);
    setBusy(undefined);
    if (ok) toast(t('cloud.active', { name: option.label }), 'success');
  };

  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-xl border border-neon-amber/40 bg-neon-amber/5 p-3 text-sm text-ink-200">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-neon-amber" />
        <p>{t('cloud.privacy')}</p>
      </div>

      <Field group label={t('cloud.provider')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {CLOUD_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => s.set({ cloudProvider: p.id })}
              className={cx(
                'rounded-xl border p-3 text-left transition-colors',
                p.id === provider.id ? 'border-neon-cyan/60 bg-neon-cyan/5' : 'border-ink-600 bg-ink-900/50 hover:border-ink-400',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                <Cloud className="size-3.5 text-neon-cyan" /> {p.label}
                {!p.needsKey && p.id !== 'custom' && <Badge tone="lime">{t('cloud.noKey')}</Badge>}
                {s.cloudKeys[p.id] && <Check className="size-3.5 text-neon-lime" />}
              </span>
              <span className="mt-1 block text-xs text-ink-400">{loc(p.blurb)}</span>
            </button>
          ))}
        </div>
      </Field>

      {provider.id === 'custom' && (
        <Field label={t('cloud.baseUrl')} hint={t('cloud.baseUrlHint')}>
          <input className={`${inputClass} font-mono`} value={s.cloudBaseUrl} onChange={(e) => s.set({ cloudBaseUrl: e.target.value.trim() })} placeholder="http://localhost:11434/v1" />
        </Field>
      )}

      {(provider.needsKey || provider.id === 'custom') && (
        <div className="space-y-2">
          <Field label={provider.id === 'custom' ? t('cloud.keyOptional') : t('cloud.key')} hint={t('cloud.keyHint')}>
            <div className="flex gap-2">
              <input
                className={`${inputClass} font-mono`}
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={key}
                placeholder={provider.id === 'openrouter' ? 'sk-or-v1-…' : provider.id === 'huggingface' ? 'hf_…' : provider.id === 'groq' ? 'gsk_…' : ''}
                onChange={(e) => s.set({ cloudKeys: { ...s.cloudKeys, [provider.id]: e.target.value.trim() } })}
              />
              <IconButton label={showKey ? t('cloud.hideKey') : t('cloud.showKey')} className="size-10 border border-ink-600" onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </IconButton>
            </div>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            {provider.id === 'openrouter' && (
              <Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} onClick={() => void startOpenRouterConnect()}>
                {t('cloud.connectOpenRouter')}
              </Button>
            )}
            {provider.keyUrl && (
              <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-neon-cyan hover:underline">
                {t('cloud.getKey')} <ExternalLink className="size-3" />
              </a>
            )}
            {key && (
              <button type="button" className="text-xs text-ink-400 hover:text-neon-red" onClick={() => s.set({ cloudKeys: { ...s.cloudKeys, [provider.id]: '' } })}>
                {t('cloud.forgetKey')}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-white">{t('cloud.models')}</h3>
          {loading && <Spinner className="size-3.5 text-neon-cyan" />}
          <span className="flex-1" />
          {hasFree && (
            <div className="w-56">
              <Toggle checked={freeOnly} onChange={setFreeOnly} label={t('cloud.freeOnly')} />
            </div>
          )}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
          <input className={`${inputClass} pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('cloud.search')} aria-label={t('cloud.search')} />
        </div>
        {error && <p className="text-xs break-words text-neon-red">{error}</p>}
        <div className="max-h-80 divide-y divide-ink-700 overflow-y-auto rounded-xl border border-ink-600">
          {!loading && visible.length === 0 && <p className="p-3 text-xs text-ink-400">{provider.id === 'custom' && !error ? t('cloud.customEmpty') : t('cloud.noModels')}</p>}
          {visible.map((m) => (
            <div key={m.id} className={cx('flex items-center gap-2 px-3 py-2', activeId === m.id && 'bg-neon-cyan/5')}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">
                  {m.label} {m.free && <Badge tone="lime">{t('cloud.free')}</Badge>}
                </p>
                <p className="truncate font-mono text-[10px] text-ink-400">
                  {m.id} · ctx {m.contextWindow >= 1000 ? `${Math.round(m.contextWindow / 1000)}k` : m.contextWindow}
                </p>
              </div>
              {activeId === m.id ? (
                <Badge tone="cyan">
                  <Check className="size-2.5" /> {t('cloud.inUse')}
                </Badge>
              ) : (
                <Button size="sm" variant="outline" busy={busy === m.id} disabled={(provider.needsKey && !key) || Boolean(busy)} onClick={() => void choose(m)}>
                  {t('cloud.use')}
                </Button>
              )}
            </div>
          ))}
        </div>
        {provider.needsKey && !key && <p className="text-xs text-neon-amber">{t('cloud.needKey')}</p>}
      </div>
    </div>
  );
}
