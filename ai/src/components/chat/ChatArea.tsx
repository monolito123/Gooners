import { ArrowDown, Bot, CircleStop, SendHorizontal, Sparkles } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { extractCode } from '../../appBuilder/extractCode.ts';
import { detectAppIntent } from '../../appBuilder/intent.ts';
import { textEngine } from '../../engines/TextEngine.ts';
import type { ChatTurn } from '../../engines/textTypes.ts';
import { useTextEngine } from '../../hooks.ts';
import { type TKey, useT } from '../../i18n/index.ts';
import { titleFrom, useChats } from '../../state/chats.ts';
import { useProjects } from '../../state/projects.ts';
import { useSettings } from '../../state/settings.ts';
import { useUi } from '../../state/ui.ts';
import { ModelGate } from '../ModelGate.tsx';
import { IconButton, cx } from '../ui/primitives.tsx';
import { Markdown, MessageBubble } from './MessageBubble.tsx';

const SUGGESTIONS: TKey[] = ['chat.suggest.1', 'chat.suggest.2', 'chat.suggest.3', 'chat.suggest.4'];

interface Streaming {
  sessionId: string;
  text: string;
}

export default function ChatArea() {
  const t = useT();
  const chats = useChats();
  const engine = useTextEngine();
  const setMode = useUi((s) => s.setMode);
  const requestApp = useUi((s) => s.requestApp);
  const toast = useUi((s) => s.toast);
  const session = chats.sessions.find((c) => c.id === chats.activeId);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [pinned, setPinned] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const ready = engine.status === 'ready';
  const busy = engine.status === 'generating' || streaming !== null;

  const scrollToEnd = useCallback((smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const hasMessages = (session?.messages.length ?? 0) > 0 || streaming !== null;
  useLayoutEffect(() => {
    if (pinned && hasMessages) scrollToEnd();
  }, [streaming?.text, session?.messages.length, pinned, hasMessages, scrollToEnd]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(220, el.scrollHeight)}px`;
  }, [draft]);

  const run = async (sessionId: string) => {
    const settings = useSettings.getState();
    const history = useChats.getState().sessions.find((c) => c.id === sessionId)?.messages ?? [];
    const lastUser = [...history].reverse().find((m) => m.role === 'user');
    const messages: ChatTurn[] = [
      { role: 'system', content: settings.systemPrompt },
      ...history.filter((m) => !m.error || m.content).map((m) => ({ role: m.role, content: m.content })),
    ];
    const appIntent = lastUser ? detectAppIntent(lastUser.content) : false;
    let buffer = '';
    let frame = 0;
    setStreaming({ sessionId, text: '' });
    setPinned(true);
    try {
      const { text, stats } = await textEngine.generate(messages, {
        params: { temperature: settings.temperature, topP: settings.topP, maxTokens: settings.maxTokens },
        onDelta: (delta) => {
          buffer += delta;
          if (!frame) {
            frame = requestAnimationFrame(() => {
              frame = 0;
              setStreaming({ sessionId, text: buffer });
            });
          }
        },
      });
      cancelAnimationFrame(frame);
      useChats.getState().append(sessionId, { role: 'assistant', content: text, stats, modelLabel: textEngine.getState().model?.label, appIntent });
    } catch (error) {
      cancelAnimationFrame(frame);
      useChats.getState().append(sessionId, { role: 'assistant', content: buffer, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setStreaming(null);
    }
  };

  const send = (text = draft) => {
    const content = text.trim();
    if (!content || busy) return;
    if (!ready) {
      toast(t('chat.loadFirst'), 'error');
      return;
    }
    const sessionId = chats.activeId && session ? session.id : chats.create();
    useChats.getState().append(sessionId, { role: 'user', content });
    setDraft('');
    void run(sessionId);
  };

  const regenerate = () => {
    if (!session || busy || !ready) return;
    const lastUser = [...session.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    chats.truncateAfter(session.id, lastUser.id);
    void run(session.id);
  };

  const openPreview = (code: string) => {
    useProjects.getState().create(t('builder.fromChat'), code);
    setMode('builder');
  };

  const buildApp = (index: number) => {
    if (!session) return;
    const message = session.messages[index];
    const code = extractCode(message.content);
    if (code.found) return openPreview(code.code);
    const prompt = [...session.messages.slice(0, index)].reverse().find((m) => m.role === 'user')?.content;
    if (!prompt) return;
    useProjects.getState().create(titleFrom(prompt));
    requestApp(prompt);
    setMode('builder');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const messages = session?.messages ?? [];
  const isStreamingHere = streaming && streaming.sessionId === session?.id;
  const empty = messages.length === 0 && !isStreamingHere;

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
      >
        {empty ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-8 px-4 py-10">
            <div className="text-center">
              <img src="icon.svg" alt="" className="mx-auto mb-4 size-16 drop-shadow-[0_0_24px_rgb(34_230_255/0.45)]" />
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {t('chat.hero.title')} <span className="neon-text">{t('chat.hero.accent')}</span>
              </h1>
              <p className="mx-auto mt-2 max-w-md text-sm text-ink-300">{t('chat.hero.subtitle')}</p>
            </div>
            {!ready && <ModelGate purpose="chat" />}
            <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={!ready}
                  onClick={() => send(t(key))}
                  className="flex items-start gap-2 rounded-xl border border-ink-600 bg-ink-850/70 px-3.5 py-3 text-left text-sm text-ink-200 transition-colors hover:border-neon-cyan/50 hover:text-white disabled:opacity-50"
                >
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-neon-pink" />
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
            {!ready && engine.status !== 'generating' && <ModelGate purpose="chat" />}
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                isLast={i === messages.length - 1 && !isStreamingHere}
                onRegenerate={m.role === 'assistant' ? regenerate : undefined}
                onPreview={openPreview}
                onBuild={() => buildApp(i)}
              />
            ))}
            {isStreamingHere && (
              <div className="flex gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/50 bg-ink-800 text-neon-cyan shadow-neon">
                  <Bot className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  {streaming.text ? (
                    <Markdown content={streaming.text} streaming />
                  ) : (
                    <p className="caret font-mono text-xs text-ink-400">{t('chat.thinking')}</p>
                  )}
                  {engine.live?.tokensPerSec !== undefined && (
                    <p className="mt-1 font-mono text-[10px] text-ink-400">
                      <span className="text-neon-cyan">{engine.live.tokensPerSec.toFixed(1)} tok/s</span> · {engine.live.tokens} tok
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {!pinned && !empty && (
          <button
            type="button"
            onClick={() => {
              setPinned(true);
              scrollToEnd(true);
            }}
            className="sticky bottom-3 left-full mr-4 ml-auto flex size-9 items-center justify-center rounded-full border border-ink-500 bg-ink-800 text-ink-200 shadow-lg hover:text-white"
            aria-label={t('chat.scrollDown')}
          >
            <ArrowDown className="size-4" />
          </button>
        )}
      </div>

      <div className="border-t border-ink-700/70 bg-ink-950/60 px-3 py-3 backdrop-blur sm:px-4">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-ink-600 bg-ink-850 p-2 focus-within:border-neon-cyan/50 focus-within:shadow-neon">
          <textarea
            ref={input}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder={ready ? t('chat.placeholder') : t('chat.placeholderNoModel')}
            aria-label={t('chat.placeholder')}
            className="max-h-[220px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-white placeholder:text-ink-400 focus:outline-none"
          />
          {busy ? (
            <IconButton label={t('chat.stop')} onClick={() => textEngine.stop()} className="size-10 rounded-xl border border-neon-red/50 text-neon-red hover:bg-neon-red/10">
              <CircleStop className="size-5" />
            </IconButton>
          ) : (
            <IconButton
              label={t('chat.send')}
              onClick={() => send()}
              disabled={!draft.trim() || !ready}
              className={cx('size-10 rounded-xl', draft.trim() && ready ? 'bg-neon-cyan text-ink-950 hover:bg-[#6ff0ff] hover:text-ink-950' : 'bg-ink-700')}
            >
              <SendHorizontal className="size-5" />
            </IconButton>
          )}
        </div>
        <p className="mx-auto mt-1.5 max-w-3xl px-2 text-center text-[11px] text-ink-400">{t('chat.disclaimer')}</p>
      </div>
    </div>
  );
}
