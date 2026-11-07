/** Sandboxed live preview of a generated app (opaque origin, offline CSP, console bridge). */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { buildSandboxDocument, isSandboxMessage } from '../../appBuilder/sandboxDoc.ts';
import { uid } from '../../lib/format.ts';

export interface ConsoleEntry {
  id: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
  time: number;
}

export interface AppSandboxHandle {
  fullscreen: () => void;
}

let tailwindSource: Promise<string> | null = null;
/** The Tailwind browser build, bundled with the app (no CDN) and loaded on first preview. */
export function loadTailwind(): Promise<string> {
  tailwindSource ??= import('@tailwindcss/browser?raw').then((m) => m.default);
  return tailwindSource;
}

interface Props {
  code: string;
  reloadKey: number;
  allowNetwork: boolean;
  assets: Record<string, string>;
  storage: Record<string, string>;
  onStorage: (storage: Record<string, string>) => void;
  onConsole: (entry: Omit<ConsoleEntry, 'id'>) => void;
  title: string;
}

export const AppSandbox = forwardRef<AppSandboxHandle, Props>(function AppSandbox(
  { code, reloadKey, allowNetwork, assets, storage, onStorage, onConsole, title },
  ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [tailwind, setTailwind] = useState<string>();
  const channel = useMemo(() => uid('sb_'), []);
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const handlers = useRef({ onStorage, onConsole });
  handlers.current = { onStorage, onConsole };

  useImperativeHandle(ref, () => ({ fullscreen: () => void frame.current?.requestFullscreen?.() }), []);

  useEffect(() => {
    void loadTailwind().then(setTailwind).catch(() => setTailwind(''));
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !isSandboxMessage(event.data, channel)) return;
      const msg = event.data;
      if (msg.type === 'console') {
        const data = msg.data as { level: ConsoleEntry['level']; args: string[] };
        handlers.current.onConsole({ level: data.level, text: data.args.join(' '), time: Date.now() });
      } else if (msg.type === 'storage') {
        handlers.current.onStorage(msg.data as Record<string, string>);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [channel]);

  const srcDoc = useMemo(
    () =>
      tailwind === undefined
        ? ''
        : buildSandboxDocument(code, { channel, tailwind: tailwind || undefined, allowNetwork, assets, storage: storageRef.current }),
    // reloadKey forces a fresh document even when the code is unchanged.
    [code, tailwind, allowNetwork, assets, channel, reloadKey],
  );

  return (
    <iframe
      ref={frame}
      key={`${reloadKey}`}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups allow-downloads"
      allow="fullscreen; clipboard-write; gamepad"
      referrerPolicy="no-referrer"
      className="size-full border-0 bg-white"
    />
  );
});
