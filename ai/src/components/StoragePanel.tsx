import { Box, CloudOff, Database, Download, FolderDown, FolderUp, HardDrive, Image as ImageIcon, Lock, MessageSquare, RefreshCw, Trash2, Zap } from 'lucide-react';
import { type BackupProgress, backupModels, canBackup, restoreModels } from '../lib/backup.ts';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { imageEngine } from '../engines/ImageEngine.ts';
import { cpuModelFiles, deleteAllWebLLMData, deleteTextModel } from '../engines/modelCache.ts';
import { DIFFUSION_MODELS, TEXT_MODELS } from '../engines/models.ts';
import { textEngine } from '../engines/TextEngine.ts';
import { invalidateModelCache, useCachedModels } from '../hooks.ts';
import { useT } from '../i18n/index.ts';
import * as store from '../lib/blobStore.ts';
import { formatBytes, formatMB } from '../lib/format.ts';
import { refreshOfflineStatus, warmOfflineCache } from '../lib/sw.ts';
import { ASSET_GROUP, useAssets } from '../state/assets.ts';
import { useChats } from '../state/chats.ts';
import { usePlatform } from '../state/platform.ts';
import { useProjects } from '../state/projects.ts';
import { useSettings } from '../state/settings.ts';
import { useUi } from '../state/ui.ts';
import { Badge, Button, IconButton, ProgressBar, Toggle } from './ui/primitives.tsx';

interface Row {
  id: string;
  icon: ReactNode;
  label: string;
  detail: string;
  bytes?: number;
  estimated?: boolean;
  remove?: () => Promise<void>;
}

async function cacheStorageBytes(): Promise<number> {
  let total = 0;
  for (const name of await caches.keys()) {
    if (!name.startsWith('gooners-ai-')) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      const length = Number(res?.headers.get('content-length') ?? 0);
      total += length || (res ? (await res.clone().blob()).size : 0);
    }
  }
  return total;
}

/** Inspect and clear everything Gooners AI keeps in this browser. */
export function StoragePanel() {
  const t = useT();
  const { storage, offline, refreshStorage, persist, installPrompt, install } = usePlatform();
  const [withAssets, setWithAssets] = useState(false);
  const [backupBusy, setBackupBusy] = useState<'backup' | 'restore'>();
  const [backupProgress, setBackupProgress] = useState<BackupProgress>();
  const cached = useCachedModels();
  const customModels = useSettings((s) => s.customModels);
  const assets = useAssets();
  const chats = useChats();
  const projects = useProjects();
  const toast = useUi((s) => s.toast);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string>();
  const [warming, setWarming] = useState(false);

  const collect = useCallback(async () => {
    const next: Row[] = [];
    for (const m of [...TEXT_MODELS, ...customModels]) {
      if (!cached.has(m.id)) continue;
      const files = m.backend === 'wasm' ? await cpuModelFiles(m) : [];
      next.push({
        id: `model:${m.id}`,
        icon: m.backend === 'wasm' ? <Box className="size-4 text-neon-amber" /> : <Zap className="size-4 text-neon-cyan" />,
        label: m.label,
        detail: m.backend === 'wasm' ? t('storage.cpuModel') : t('storage.gpuModel'),
        bytes: m.backend === 'wasm' ? files.reduce((s, f) => s + f.received, 0) : m.downloadMB * 2 ** 20,
        estimated: m.backend === 'webgpu',
        remove: async () => {
          if (textEngine.getState().model?.id === m.id) await textEngine.unload();
          await deleteTextModel(m, customModels);
          invalidateModelCache();
        },
      });
    }
    for (const m of DIFFUSION_MODELS) {
      const bytes = await store.groupSize(m.id);
      if (bytes > 0) {
        next.push({
          id: `image:${m.id}`,
          icon: <ImageIcon className="size-4 text-neon-pink" />,
          label: m.label,
          detail: t('storage.imageModel'),
          bytes,
          remove: () => imageEngine.remove(m.id),
        });
      }
    }
    const assetBytes = await store.groupSize(ASSET_GROUP);
    if (assetBytes > 0) {
      next.push({
        id: 'assets',
        icon: <ImageIcon className="size-4 text-neon-lime" />,
        label: t('storage.assets'),
        detail: t('storage.assetsDetail', { n: useAssets.getState().assets.length }),
        bytes: assetBytes,
        remove: () => useAssets.getState().clear(),
      });
    }
    const appBytes = ['gooners-ai:chats', 'gooners-ai:projects'].reduce((s, k) => s + (localStorage.getItem(k)?.length ?? 0) * 2, 0);
    next.push({
      id: 'app-data',
      icon: <MessageSquare className="size-4 text-neon-violet" />,
      label: t('storage.appData'),
      detail: t('storage.appDataDetail', { chats: useChats.getState().sessions.length, apps: useProjects.getState().projects.length }),
      bytes: appBytes,
      remove: async () => {
        useChats.getState().clear();
        useProjects.setState({ projects: [], activeId: undefined });
      },
    });
    try {
      const swBytes = await cacheStorageBytes();
      if (swBytes > 0) {
        next.push({
          id: 'runtime',
          icon: <CloudOff className="size-4 text-ink-200" />,
          label: t('storage.runtime'),
          detail: t('storage.runtimeDetail'),
          bytes: swBytes,
        });
      }
    } catch {
      /* Cache Storage unavailable */
    }
    setRows(next);
    void refreshStorage();
  }, [cached, customModels, refreshStorage, t]);

  useEffect(() => {
    void collect();
  }, [collect, assets.assets.length, chats.sessions.length, projects.projects.length]);

  const remove = async (row: Row) => {
    if (!row.remove) return;
    setBusy(row.id);
    try {
      await row.remove();
      toast(t('storage.removed', { name: row.label }), 'success');
    } catch (error) {
      toast(String(error), 'error');
    } finally {
      setBusy(undefined);
      void collect();
    }
  };

  const clearAll = async () => {
    if (!confirm(t('storage.clearAllConfirm'))) return;
    setBusy('all');
    try {
      await textEngine.unload();
      for (const m of DIFFUSION_MODELS) await imageEngine.remove(m.id);
      await deleteAllWebLLMData();
      await store.deleteGroup('transformers');
      await useAssets.getState().clear();
      useChats.getState().clear();
      useProjects.setState({ projects: [], activeId: undefined });
      invalidateModelCache();
      toast(t('storage.cleared'), 'success');
    } finally {
      setBusy(undefined);
      void collect();
    }
  };

  const runBackup = async () => {
    setBackupBusy('backup');
    try {
      const manifest = await backupModels({ includeAssets: withAssets, onProgress: setBackupProgress });
      toast(t('backup.saved', { n: manifest.entries.length }), 'success');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBackupBusy(undefined);
      setBackupProgress(undefined);
    }
  };

  const runRestore = async () => {
    setBackupBusy('restore');
    try {
      const n = await restoreModels({ onProgress: setBackupProgress });
      invalidateModelCache();
      await imageEngine.refresh();
      await useAssets.getState().load();
      toast(t('backup.restored', { n }), 'success');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBackupBusy(undefined);
      setBackupProgress(undefined);
      void collect();
    }
  };

  const usagePct = storage.usage && storage.quota ? storage.usage / storage.quota : undefined;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-ink-600 bg-ink-900/60 p-4">
        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 font-semibold text-white">
            <HardDrive className="size-4 text-neon-cyan" /> {t('storage.used')}
          </span>
          <span className="font-mono text-xs text-ink-200">
            {formatBytes(storage.usage)} / {formatBytes(storage.quota)}
          </span>
        </div>
        <ProgressBar value={usagePct} tone={usagePct && usagePct > 0.85 ? 'pink' : 'cyan'} />
      </div>

      <div className="space-y-3 rounded-xl border border-neon-lime/30 bg-neon-lime/5 p-4" data-testid="permanent-storage">
        <div className="flex flex-wrap items-center gap-2">
          <Lock className="size-4 text-neon-lime" />
          <p className="flex-1 text-sm font-semibold text-white">{t('storage.permanent')}</p>
          {storage.persisted ? (
            <Badge tone="lime">
              <Lock className="size-2.5" /> {t('storage.persisted')}
            </Badge>
          ) : (
            <Badge tone="amber">{t('storage.notPersisted')}</Badge>
          )}
        </div>
        <p className="text-xs text-ink-300">{storage.persisted ? t('storage.persistedHint') : t('storage.persistHint')}</p>
        <div className="flex flex-wrap gap-2">
          {!storage.persisted && (
            <Button
              size="sm"
              variant="primary"
              icon={<Lock className="size-3.5" />}
              onClick={async () => {
                const ok = await persist();
                toast(ok ? t('storage.persistOk') : t('storage.persistNo'), ok ? 'success' : 'info');
              }}
            >
              {t('storage.persist')}
            </Button>
          )}
          {installPrompt && (
            <Button size="sm" variant="outline" icon={<Download className="size-3.5" />} onClick={() => void install()}>
              {t('storage.install')}
            </Button>
          )}
        </div>

        <div className="border-t border-neon-lime/20 pt-3">
          <p className="text-sm font-semibold text-white">{t('backup.title')}</p>
          <p className="mt-1 text-xs text-ink-300">{t('backup.hint')}</p>
          {canBackup() ? (
            <>
              <div className="mt-2 max-w-xs">
                <Toggle checked={withAssets} onChange={setWithAssets} label={t('backup.includeGallery')} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" busy={backupBusy === 'backup'} disabled={Boolean(backupBusy)} icon={<FolderDown className="size-3.5" />} onClick={() => void runBackup()}>
                  {t('backup.save')}
                </Button>
                <Button size="sm" variant="outline" busy={backupBusy === 'restore'} disabled={Boolean(backupBusy)} icon={<FolderUp className="size-3.5" />} onClick={() => void runRestore()}>
                  {t('backup.restore')}
                </Button>
              </div>
              {backupProgress && (
                <div className="mt-2 space-y-1">
                  <ProgressBar value={backupProgress.done / Math.max(1, backupProgress.total)} tone="lime" />
                  <p className="truncate font-mono text-[10px] text-ink-400">
                    {backupProgress.done}/{backupProgress.total} · {formatBytes(backupProgress.bytes)} · {backupProgress.item}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs text-neon-amber">{t('backup.unsupported')}</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-ink-600 bg-ink-900/60 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <CloudOff className="size-4 text-neon-lime" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">{t('storage.offline')}</p>
            <p className="text-xs text-ink-400">
              {offline.shellReady
                ? offline.missing.length
                  ? t('storage.offlineMissing', { n: offline.missing.length })
                  : t('storage.offlineAll')
                : t('storage.offlineNoSw')}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            busy={warming}
            disabled={!offline.shellReady || offline.missing.length === 0}
            icon={<RefreshCw className="size-3.5" />}
            onClick={async () => {
              setWarming(true);
              const missing = await warmOfflineCache();
              setWarming(false);
              await refreshOfflineStatus();
              toast(missing.length ? t('storage.warmPartial') : t('storage.warmDone'), missing.length ? 'error' : 'success');
              void collect();
            }}
          >
            {t('storage.warm')}
          </Button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          <Database className="size-4 text-neon-amber" /> {t('storage.items')}
        </h3>
        <div className="divide-y divide-ink-700 rounded-xl border border-ink-600">
          {rows.length === 0 && <p className="p-4 text-sm text-ink-400">{t('storage.empty')}</p>}
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-3 px-3 py-2.5">
              {row.icon}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">{row.label}</p>
                <p className="truncate text-xs text-ink-400">{row.detail}</p>
              </div>
              <span className="font-mono text-xs text-ink-200">
                {row.estimated ? '≈' : ''}
                {row.bytes !== undefined ? (row.estimated ? formatMB(row.bytes / 2 ** 20) : formatBytes(row.bytes)) : '–'}
              </span>
              {row.remove && (
                <IconButton label={t('common.delete')} disabled={busy === row.id} className="hover:text-neon-red" onClick={() => void remove(row)}>
                  <Trash2 className="size-4" />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neon-red/30 p-3">
        <p className="text-xs text-ink-300">{t('storage.clearAllHint')}</p>
        <Button variant="danger" size="sm" busy={busy === 'all'} icon={<Trash2 className="size-3.5" />} onClick={() => void clearAll()}>
          {t('storage.clearAll')}
        </Button>
      </div>
    </div>
  );
}
