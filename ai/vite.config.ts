import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { serviceWorker } from './build/serviceWorker.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // Relative base: the same build works at /, /Gooners/ai/ or any static sub-path.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss(), serviceWorker()],
  worker: { format: 'es' },
  optimizeDeps: {
    // These packages locate their own workers and .wasm files through import.meta.url,
    // which only resolves correctly when Vite serves them untouched.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'onnxruntime-web', '@huggingface/transformers', '@mlc-ai/web-llm'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 8000,
  },
});
