import { AnimatePresence, motion } from 'motion/react';
import {
  AppWindow,
  Clapperboard,
  HardDrive,
  House,
  Image as ImageIcon,
  MessageSquare,
  Pencil,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { type TKey, useT } from '../i18n/index.ts';
import { type Asset, assetUrl, useAssets } from '../state/assets.ts';
import { useChats } from '../state/chats.ts';
import { useProjects } from '../state/projects.ts';
import { type Mode, useUi } from '../state/ui.ts';
import { IconButton, cx } from './ui/primitives.tsx';

const NAV: { mode: Mode; icon: ReactNode; label: TKey; hint: TKey; accent: string }[] = [
  { mode: 'chat', icon: <MessageSquare className="size-4.5" />, label: 'mode.chat', hint: 'mode.chat.hint', accent: 'text-neon-cyan' },
  { mode: 'image', icon: <ImageIcon className="size-4.5" />, label: 'mode.image', hint: 'mode.image.hint', accent: 'text-neon-pink' },
  { mode: 'video', icon: <Clapperboard className="size-4.5" />, label: 'mode.video', hint: 'mode.video.hint', accent: 'text-neon-amber' },
  { mode: 'builder', icon: <AppWindow className="size-4.5" />, label: 'mode.builder', hint: 'mode.builder.hint', accent: 'text-neon-lime' },
];

function relativeTime(ts: number, lang: string): string {
  const diff = (Date.now() - ts) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang === 'pt' ? 'pt-BR' : 'en', { numeric: 'auto' });
  if (diff < 60) return rtf.format(-Math.round(diff), 'second');
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  return rtf.format(-Math.round(diff / 86400), 'day');
}

function HistoryItem({
  title,
  subtitle,
  active,
  onSelect,
  onRename,
  onDelete,
  renameLabel,
  deleteLabel,
}: {
  title: string;
  subtitle: string;
  active: boolean;
  onSelect: () => void;
  onRename?: (title: string) => void;
  onDelete: () => void;
  renameLabel: string;
  deleteLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  return (
    <div
      className={cx(
        'group relative flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors',
        active ? 'bg-ink-700/80 shadow-[inset_2px_0_0_var(--color-neon-cyan)]' : 'hover:bg-ink-800',
      )}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft.trim()) onRename?.(draft.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="min-w-0 flex-1 rounded border border-neon-cyan/50 bg-ink-900 px-1.5 py-0.5 text-sm text-white outline-none"
        />
      ) : (
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <span className={cx('block truncate text-sm', active ? 'text-white' : 'text-ink-200')}>{title}</span>
          <span className="block truncate font-mono text-[10px] text-ink-400">{subtitle}</span>
        </button>
      )}
      {!editing && (
        <div className="flex opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {onRename && (
            <IconButton
              label={renameLabel}
              className="size-7"
              onClick={() => {
                setDraft(title);
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" />
            </IconButton>
          )}
          <IconButton label={deleteLabel} className="size-7 hover:text-neon-red" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      )}
    </div>
  );
}

function AssetThumb({ asset }: { asset: Asset }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    void assetUrl(asset.id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [asset.id]);
  return (
    <div className="aspect-square overflow-hidden rounded-lg border border-ink-600 bg-ink-800" title={asset.prompt}>
      {url && asset.kind === 'image' && <img src={url} alt={asset.prompt} className="size-full object-cover" loading="lazy" />}
      {url && asset.kind === 'video' && <video src={url} muted playsInline className="size-full object-cover" />}
    </div>
  );
}

function ContextPanel({ mode }: { mode: Mode }) {
  const t = useT();
  const lang = t('lang.code');
  const chats = useChats();
  const projects = useProjects();
  const assets = useAssets((s) => s.assets);
  const setMode = useUi((s) => s.setMode);

  if (mode === 'chat') {
    return (
      <>
        <button
          type="button"
          onClick={() => chats.create()}
          className="mb-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-ink-500 px-3 py-2 text-sm text-ink-200 transition-colors hover:border-neon-cyan/60 hover:text-neon-cyan"
        >
          <Plus className="size-4" /> {t('chat.new')}
        </button>
        <div className="space-y-0.5">
          {chats.sessions.length === 0 && <p className="px-2 py-3 text-xs text-ink-400">{t('chat.noHistory')}</p>}
          {chats.sessions.map((c) => (
            <HistoryItem
              key={c.id}
              title={c.title || t('chat.untitled')}
              subtitle={`${c.messages.length} · ${relativeTime(c.updatedAt, lang)}`}
              active={c.id === chats.activeId}
              onSelect={() => chats.select(c.id)}
              onRename={(title) => chats.rename(c.id, title)}
              onDelete={() => chats.remove(c.id)}
              renameLabel={t('common.rename')}
              deleteLabel={t('common.delete')}
            />
          ))}
        </div>
      </>
    );
  }
  if (mode === 'builder') {
    return (
      <>
        <button
          type="button"
          onClick={() => projects.create()}
          className="mb-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-ink-500 px-3 py-2 text-sm text-ink-200 transition-colors hover:border-neon-lime/60 hover:text-neon-lime"
        >
          <Plus className="size-4" /> {t('builder.new')}
        </button>
        <div className="space-y-0.5">
          {projects.projects.length === 0 && <p className="px-2 py-3 text-xs text-ink-400">{t('builder.noProjects')}</p>}
          {projects.projects.map((p) => (
            <HistoryItem
              key={p.id}
              title={p.title || t('builder.untitled')}
              subtitle={`v${p.versions.length} · ${relativeTime(p.updatedAt, lang)}`}
              active={p.id === projects.activeId}
              onSelect={() => projects.select(p.id)}
              onRename={(title) => projects.patch(p.id, { title })}
              onDelete={() => projects.remove(p.id)}
              renameLabel={t('common.rename')}
              deleteLabel={t('common.delete')}
            />
          ))}
        </div>
      </>
    );
  }
  const kind = mode === 'image' ? 'image' : 'video';
  const list = assets.filter((a) => a.kind === kind).slice(0, 12);
  return (
    <>
      {list.length === 0 ? (
        <p className="px-2 py-3 text-xs text-ink-400">{t(kind === 'image' ? 'image.noGallery' : 'video.noGallery')}</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 px-1">
          {list.map((a) => (
            <button key={a.id} type="button" onClick={() => setMode(mode)} className="block">
              <AssetThumb asset={a} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function Sidebar() {
  const t = useT();
  const { mode, setMode, sidebarOpen, setSidebar, openSettings } = useUi();
  const body = (
    <div className="flex h-full w-[272px] flex-col border-r border-ink-700 bg-ink-900/95 backdrop-blur">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <img src="icon.svg" alt="" className="size-8" />
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-white">
            Gooners <span className="neon-text">AI</span>
          </div>
          <div className="font-mono text-[10px] tracking-widest text-ink-400 uppercase">{t('app.tagline')}</div>
        </div>
      </div>
      <nav className="space-y-0.5 px-2" aria-label={t('nav.modes')}>
        {NAV.map((item) => (
          <button
            key={item.mode}
            type="button"
            onClick={() => setMode(item.mode)}
            aria-current={mode === item.mode ? 'page' : undefined}
            className={cx(
              'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
              mode === item.mode ? 'bg-ink-700 text-white shadow-[inset_0_0_0_1px_rgb(34_230_255/0.25)]' : 'text-ink-300 hover:bg-ink-800 hover:text-white',
            )}
          >
            <span className={cx(mode === item.mode ? item.accent : '')}>{item.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t(item.label)}</span>
              <span className="block truncate text-[11px] text-ink-400">{t(item.hint)}</span>
            </span>
          </button>
        ))}
      </nav>
      <div className="mt-4 mb-1 px-4 font-mono text-[10px] tracking-widest text-ink-400 uppercase">
        {mode === 'chat' ? t('nav.history') : mode === 'builder' ? t('nav.projects') : t('nav.gallery')}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <ContextPanel mode={mode} />
      </div>
      <div className="space-y-0.5 border-t border-ink-700 p-2">
        <button type="button" onClick={() => openSettings('generation')} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 hover:text-white">
          <Settings className="size-4" /> {t('nav.settings')}
        </button>
        <button type="button" onClick={() => openSettings('storage')} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 hover:text-white">
          <HardDrive className="size-4" /> {t('nav.storage')}
        </button>
        <a href="../" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 hover:text-white">
          <House className="size-4" /> {t('nav.hub')}
        </a>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden h-full shrink-0 lg:block">{body}</aside>
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div className="fixed inset-0 z-40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setSidebar(false)} aria-hidden="true" />
            <motion.aside
              className="relative h-full w-[272px]"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 400, damping: 38 }}
            >
              {body}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
