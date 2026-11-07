/** Minimal observable state container for engine singletons (React reads it via useSyncExternalStore). */
import { useSyncExternalStore } from 'react';

export class Observable<S extends object> {
  private readonly listeners = new Set<() => void>();
  protected state: S;

  constructor(initial: S) {
    this.state = initial;
  }

  getState = (): S => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  protected setState(patch: Partial<S>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export function useObservable<S extends object>(source: Observable<S>): S {
  return useSyncExternalStore(source.subscribe, source.getState, source.getState);
}
