/**
 * Configures ONNX Runtime Web before anything else imports it: the .wasm binary is served from
 * this app's own build (never a CDN) so it works offline and under the service worker.
 */
import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };
// Threads need cross-origin isolation (SharedArrayBuffer), which static hosts rarely provide.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.wasm.proxy = false;
ort.env.logLevel = 'warning';

export { ort };
