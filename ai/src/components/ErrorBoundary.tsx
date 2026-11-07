import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { translate } from '../i18n/index.ts';
import { useSettings } from '../state/settings.ts';

interface Props {
  children: ReactNode;
  /** Shown in the fallback, e.g. the name of the panel that crashed. */
  area?: string;
  compact?: boolean;
}

interface State {
  error: Error | null;
}

/** Catches render errors so one broken panel never blanks the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI error', this.props.area ?? '', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const lang = useSettings.getState().language;
    return (
      <div className={this.props.compact ? 'p-4' : 'flex h-full items-center justify-center p-6'}>
        <div className="max-w-md rounded-2xl border border-neon-red/40 bg-ink-850 p-5 text-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold text-neon-red">
            <AlertTriangle className="size-4" />
            {translate(lang, 'error.title')}
            {this.props.area ? ` · ${this.props.area}` : ''}
          </div>
          <p className="mb-4 font-mono text-xs break-words text-ink-300">{error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="inline-flex items-center gap-2 rounded-lg border border-ink-500 px-3 py-1.5 text-ink-100 hover:border-neon-cyan/60"
          >
            <RotateCcw className="size-3.5" />
            {translate(lang, 'error.retry')}
          </button>
        </div>
      </div>
    );
  }
}
