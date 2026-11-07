import { AppWindow, Bot, Check, Copy, RefreshCw, TriangleAlert } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { extractCode } from '../../appBuilder/extractCode.ts';
import type { GenerationStats } from '../../engines/textTypes.ts';
import { useT } from '../../i18n/index.ts';
import { formatMs } from '../../lib/format.ts';
import { renderMarkdown } from '../../lib/markdown.ts';
import type { ChatMessage } from '../../state/chats.ts';
import { IconButton, copyText, cx } from '../ui/primitives.tsx';

export function StatsLine({ stats, model }: { stats: GenerationStats; model?: string }) {
  return (
    <span className="font-mono text-[10px] text-ink-400">
      <span className="text-neon-cyan">{stats.tokensPerSec.toFixed(1)} tok/s</span> · TTFT {formatMs(stats.ttftMs)} · {stats.completionTokens} tok
      {stats.finishReason === 'length' ? ' · max' : stats.finishReason === 'abort' ? ' · ■' : ''}
      {model ? ` · ${model}` : ''}
    </span>
  );
}

export const Markdown = memo(function Markdown({ content, streaming, onPreview }: { content: string; streaming?: boolean; onPreview?: (code: string) => void }) {
  const t = useT();
  const html = useMemo(
    () => renderMarkdown(content, { copy: t('common.copy'), preview: t('chat.preview'), reasoning: t('chat.reasoning') }),
    [content, t],
  );
  return (
    <div
      className={cx('md text-[15px] text-ink-100', streaming && 'caret')}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const button = (e.target as HTMLElement).closest('button[data-action]');
        if (!button) return;
        const code = button.closest('.code-block')?.querySelector('code')?.textContent ?? '';
        if (button.getAttribute('data-action') === 'copy') {
          void copyText(code).then(() => {
            button.textContent = '✓';
            setTimeout(() => (button.textContent = t('common.copy')), 1200);
          });
        } else if (button.getAttribute('data-action') === 'preview') onPreview?.(code);
      }}
    />
  );
});

export function MessageBubble({
  message,
  isLast,
  onRegenerate,
  onPreview,
  onBuild,
}: {
  message: ChatMessage;
  isLast: boolean;
  onRegenerate?: () => void;
  onPreview: (code: string) => void;
  onBuild: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-neon-pink/25 bg-ink-700/80 px-4 py-2.5 text-[15px] whitespace-pre-wrap text-white shadow-[0_0_24px_-12px_rgb(255_43_214/0.6)]">
          {message.content}
        </div>
      </div>
    );
  }
  const hasApp = message.appIntent || extractCode(message.content).found;
  return (
    <div className="group flex gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/30 bg-ink-800 text-neon-cyan">
        <Bot className="size-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        {message.content ? <Markdown content={message.content} onPreview={onPreview} /> : null}
        {message.error && (
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-neon-red/40 bg-neon-red/5 px-3 py-2 text-sm text-neon-red">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">{message.error}</span>
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {message.stats && <StatsLine stats={message.stats} model={message.modelLabel} />}
          <span className="flex-1" />
          {hasApp && (
            <button
              type="button"
              onClick={onBuild}
              className="mr-1 inline-flex items-center gap-1.5 rounded-lg border border-neon-lime/40 px-2 py-1 text-xs text-neon-lime hover:bg-neon-lime/10"
            >
              <AppWindow className="size-3.5" /> {t('chat.openBuilder')}
            </button>
          )}
          <IconButton
            label={t('common.copy')}
            className="size-7"
            onClick={() =>
              void copyText(message.content).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              })
            }
          >
            {copied ? <Check className="size-3.5 text-neon-lime" /> : <Copy className="size-3.5" />}
          </IconButton>
          {isLast && onRegenerate && (
            <IconButton label={t('chat.regenerate')} className="size-7" onClick={onRegenerate}>
              <RefreshCw className="size-3.5" />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}
