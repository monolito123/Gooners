/** Shared UI primitives in the neon/terminal style. */
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  forwardRef,
  useEffect,
  useId,
  useRef,
} from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-neon-cyan text-ink-950 font-semibold shadow-[0_0_20px_-4px_rgb(34_230_255/0.7)] hover:bg-[#6ff0ff] disabled:shadow-none',
  secondary: 'bg-ink-700 text-ink-100 hover:bg-ink-600 border border-ink-600',
  outline: 'border border-ink-500 text-ink-100 hover:border-neon-cyan/70 hover:text-neon-cyan bg-ink-900/60',
  ghost: 'text-ink-200 hover:bg-ink-700/70 hover:text-white',
  danger: 'border border-neon-red/50 text-neon-red hover:bg-neon-red/10',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-3.5 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, busy, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      className={cx(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {busy ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-ink-700 hover:text-white disabled:opacity-40',
        active && 'bg-ink-700 text-neon-cyan',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className ?? 'size-4')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ProgressBar({ value, indeterminate, tone = 'cyan', className }: { value?: number; indeterminate?: boolean; tone?: 'cyan' | 'pink' | 'lime'; className?: string }) {
  const color = tone === 'pink' ? 'bg-neon-pink' : tone === 'lime' ? 'bg-neon-lime' : 'bg-neon-cyan';
  const pct = Math.max(0, Math.min(100, (value ?? 0) * 100));
  return (
    <div
      className={cx('relative h-2 overflow-hidden rounded-full bg-ink-700', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      {indeterminate ? (
        <div className={cx('absolute inset-y-0 w-1/3 animate-scan rounded-full', color)} />
      ) : (
        <div className={cx('h-full rounded-full transition-[width] duration-300', color)} style={{ width: `${pct}%`, boxShadow: '0 0 12px currentColor' }} />
      )}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: string;
}) {
  const id = useId();
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-ink-100">
          {label}
        </label>
        <span className="font-mono text-xs text-neon-cyan">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        className="slider w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0">
        <span className="block text-sm font-medium text-ink-100">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-400">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          checked ? 'border-neon-cyan/60 bg-neon-cyan/25' : 'border-ink-500 bg-ink-800',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 size-4.5 rounded-full transition-all',
            checked ? 'left-[22px] bg-neon-cyan shadow-[0_0_10px_rgb(34_230_255/0.8)]' : 'left-0.5 bg-ink-300',
          )}
        />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div className={cx('inline-flex rounded-xl border border-ink-600 bg-ink-900 p-1', className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:opacity-40',
            size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
            value === o.value ? 'bg-ink-600 text-white shadow-[inset_0_0_0_1px_rgb(34_230_255/0.35)]' : 'text-ink-300 hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = 'default', className }: { children: ReactNode; tone?: 'default' | 'cyan' | 'pink' | 'lime' | 'amber' | 'red'; className?: string }) {
  const tones = {
    default: 'border-ink-500 text-ink-200',
    cyan: 'border-neon-cyan/40 text-neon-cyan',
    pink: 'border-neon-pink/40 text-neon-pink',
    lime: 'border-neon-lime/40 text-neon-lime',
    amber: 'border-neon-amber/40 text-neon-amber',
    red: 'border-neon-red/50 text-neon-red',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] leading-none font-semibold uppercase tracking-wide', tones[tone], className)}>{children}</span>;
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-2xl border border-ink-600/80 bg-ink-850/80 backdrop-blur-sm', className)}>{children}</div>;
}

/**
 * A labelled form row. Wraps a single input in <label>; with `group`, renders a labelled
 * group instead (for segmented controls and other multi-button widgets).
 */
export function Field({ label, hint, children, group }: { label: string; hint?: string; children: ReactNode; group?: boolean }) {
  const content = (
    <>
      <span className="block text-sm font-medium text-ink-100">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-400">{hint}</span>}
    </>
  );
  return group ? (
    <div role="group" aria-label={label} className="block space-y-1.5">
      {content}
    </div>
  ) : (
    <label className="block space-y-1.5">{content}</label>
  );
}

export const inputClass =
  'w-full rounded-xl border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-neon-cyan/60 focus:outline-none focus:ring-2 focus:ring-neon-cyan/15';

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
  dismissible?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose();
    };
    document.addEventListener('keydown', onKey);
    const timer = setTimeout(() => panel.current?.focus(), 30);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose, dismissible]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={dismissible ? onClose : undefined} aria-hidden="true" />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={cx(
              'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-ink-600 bg-ink-850 shadow-2xl outline-none sm:rounded-2xl',
              wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
            )}
          >
            <div className="flex items-center gap-3 border-b border-ink-700 px-5 py-3.5">
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-white">{title}</h2>
              {dismissible && (
                <IconButton label="Close" onClick={onClose}>
                  <X className="size-4.5" />
                </IconButton>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-700 px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-ink-600 bg-ink-800 text-neon-cyan shadow-neon">{icon}</div>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      {children && <div className="text-sm text-ink-300">{children}</div>}
    </div>
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
