import { Cpu, ShieldAlert } from 'lucide-react';
import { DEFAULT_CPU_MODEL } from '../engines/models.ts';
import { useT } from '../i18n/index.ts';
import { usePlatform } from '../state/platform.ts';
import { useSettings } from '../state/settings.ts';
import { Button, Modal } from './ui/primitives.tsx';

/** Shown at startup when WebGPU is unavailable: explains requirements and offers CPU mode. */
export function WebGPUWarning() {
  const t = useT();
  const info = usePlatform((s) => s.info);
  const dismissed = useSettings((s) => s.gpuWarningDismissed);
  const set = useSettings((s) => s.set);
  const open = Boolean(info && !info.gpu.supported && !dismissed);
  const reason = info?.gpu.reason;
  const close = () => set({ gpuWarningDismissed: true });

  return (
    <Modal
      open={open}
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <ShieldAlert className="size-4.5 text-neon-amber" /> {t('gpu.title')}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('gpu.continue')}
          </Button>
          <Button
            variant="primary"
            icon={<Cpu className="size-4" />}
            onClick={() => {
              set({ chatModelId: DEFAULT_CPU_MODEL, codeModelId: DEFAULT_CPU_MODEL, gpuWarningDismissed: true });
            }}
          >
            {t('gpu.useCpu')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-ink-200">
        <p>{reason === 'insecure-context' ? t('gpu.reason.insecure') : reason === 'no-adapter' ? t('gpu.reason.adapter') : t('gpu.reason.api')}</p>
        {info?.gpu.error && <p className="rounded-lg bg-ink-900 p-2 font-mono text-xs text-ink-300">{info.gpu.error}</p>}
        <div className="rounded-xl border border-ink-600 bg-ink-900/60 p-3">
          <p className="mb-2 font-semibold text-white">{t('gpu.browsers')}</p>
          <ul className="list-disc space-y-1 pl-5 text-ink-300">
            <li>{t('gpu.browser.chrome')}</li>
            <li>{t('gpu.browser.android')}</li>
            <li>{t('gpu.browser.safari')}</li>
            <li>{t('gpu.browser.firefox')}</li>
            <li>{t('gpu.browser.linux')}</li>
          </ul>
        </div>
        <p className="text-ink-300">{t('gpu.fallback')}</p>
        <p className="font-mono text-xs text-ink-400">
          {info?.browser} · {info?.os} · WebGL2 {info?.webgl2 ? '✓' : '✗'} · {info?.threads} threads
        </p>
      </div>
    </Modal>
  );
}
