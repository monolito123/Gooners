/** Hosts the WebLLM engine (WebGPU) off the UI thread. */
import './installFetchFallback.ts';
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message: MessageEvent) => handler.onmessage(message);
