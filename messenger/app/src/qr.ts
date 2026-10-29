import qrcode from 'qrcode-generator';

/** Renders `text` as a QR code on a canvas (dark modules on white, 4-module quiet zone). */
export function qrCanvas(text: string, sizePx = 260): HTMLCanvasElement {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const scale = Math.max(2, Math.floor(sizePx / (n + 2 * quiet)));
  const px = (n + 2 * quiet) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  canvas.className = 'qr';
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
  return canvas;
}

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

export function canScanQr(): boolean {
  return 'BarcodeDetector' in globalThis && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Opens the rear camera in `video` and resolves with the first QR code found. */
export async function scanQr(video: HTMLVideoElement, signal: AbortSignal): Promise<string> {
  const Ctor = (globalThis as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  const detector = new Ctor({ formats: ['qr_code'] });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();
  try {
    while (!signal.aborted) {
      const codes = await detector.detect(video).catch(() => []);
      if (codes[0]?.rawValue) return codes[0].rawValue;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('cancelled');
  } finally {
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  }
}
