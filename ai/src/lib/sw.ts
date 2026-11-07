/** Service worker registration and messaging (offline shell + on-demand runtime caching). */
import { usePlatform } from '../state/platform.ts';

interface SwStatus {
  version: string;
  shell: number;
  lazy: number;
  missing: string[];
}

function ask(type: 'status' | 'warm'): Promise<SwStatus | null> {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), type === 'warm' ? 10 * 60_000 : 5000);
    channel.port1.onmessage = (event: MessageEvent<SwStatus>) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    controller.postMessage({ type }, [channel.port2]);
  });
}

export async function refreshOfflineStatus(): Promise<void> {
  const status = await ask('status');
  usePlatform.getState().setOffline({
    shellReady: Boolean(navigator.serviceWorker?.controller),
    missing: status?.missing ?? [],
    version: status?.version,
  });
}

/** Downloads the large runtimes (.wasm) into the offline cache now instead of on first use. */
export async function warmOfflineCache(): Promise<string[]> {
  const status = await ask('warm');
  await refreshOfflineStatus();
  return status?.missing ?? [];
}

let waiting: ServiceWorker | null = null;

export function applyUpdate(): void {
  if (!waiting) return location.reload();
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage({ type: 'skip-waiting' });
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    const markWaiting = (worker: ServiceWorker | null) => {
      if (worker && navigator.serviceWorker.controller) {
        waiting = worker;
        usePlatform.getState().setOffline({ updateReady: true });
      }
    };
    markWaiting(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') markWaiting(worker);
      });
    });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
        setTimeout(resolve, 4000);
      });
    }
    await refreshOfflineStatus();
    // Check for a new deploy every hour while the app stays open.
    setInterval(() => void registration.update().catch(() => undefined), 60 * 60_000);
  } catch (error) {
    console.warn('Service worker registration failed', error);
  }
}
