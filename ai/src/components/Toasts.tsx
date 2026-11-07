import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useUi } from '../state/ui.ts';
import { cx } from './ui/primitives.tsx';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-12 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-14" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            className={cx(
              'pointer-events-auto flex max-w-lg items-start gap-2.5 rounded-xl border bg-ink-850/95 px-3.5 py-2.5 text-sm shadow-xl backdrop-blur',
              t.kind === 'error' ? 'border-neon-red/50' : t.kind === 'success' ? 'border-neon-lime/40' : 'border-ink-500',
            )}
            role={t.kind === 'error' ? 'alert' : 'status'}
          >
            {t.kind === 'error' ? (
              <XCircle className="mt-0.5 size-4 shrink-0 text-neon-red" />
            ) : t.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-neon-lime" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-neon-cyan" />
            )}
            <span className="min-w-0 flex-1 break-words text-ink-100">{t.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-ink-400 hover:text-white">
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
