/**
 * Optional cloud models through OpenAI-compatible chat APIs (OpenRouter, Pollinations, Hugging
 * Face, Groq, or any compatible server such as Ollama / LM Studio on this computer).
 * Unlike the local engines, prompts are sent to the provider. Keys stay in this browser and are
 * only sent to the provider they belong to.
 */
import type { Localized, TextModelInfo } from './models.ts';
import type { ChatTurn, GenerationParams } from './textTypes.ts';

export type CloudProviderId = 'openrouter' | 'pollinations' | 'huggingface' | 'groq' | 'custom';

export interface CloudProvider {
  id: CloudProviderId;
  label: string;
  /** Base URL of the OpenAI-compatible API (the custom provider uses the user's URL). */
  baseUrl: string;
  /** Chat completions endpoint, relative to baseUrl unless absolute. */
  chatPath: string;
  modelsUrl?: string;
  needsKey: boolean;
  keyUrl?: string;
  defaultModel: string;
  /** Sends stream_options.include_usage (some servers reject unknown fields). */
  usageInStream: boolean;
  blurb: Localized;
}

export const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    chatPath: '/chat/completions',
    modelsUrl: 'https://openrouter.ai/api/v1/models',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'openrouter/free',
    usageInStream: true,
    blurb: {
      en: 'Hundreds of models, including free ones (marked FREE). Connect in one click or paste a key from openrouter.ai.',
      pt: 'Centenas de modelos, incluindo gratuitos (marcados GRÁTIS). Conecte com um clique ou cole uma chave do openrouter.ai.',
    },
  },
  {
    id: 'pollinations',
    label: 'Pollinations (free, no key)',
    baseUrl: 'https://text.pollinations.ai',
    chatPath: '/openai',
    modelsUrl: 'https://text.pollinations.ai/models',
    needsKey: false,
    defaultModel: 'openai',
    usageInStream: false,
    blurb: {
      en: 'Free, no account or key needed. Rate-limited and slower at busy times.',
      pt: 'Gratuito, sem conta nem chave. Tem limite de uso e fica mais lento em horários de pico.',
    },
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    baseUrl: 'https://router.huggingface.co/v1',
    chatPath: '/chat/completions',
    modelsUrl: 'https://router.huggingface.co/v1/models',
    needsKey: true,
    keyUrl: 'https://huggingface.co/settings/tokens',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    usageInStream: true,
    blurb: {
      en: 'Open models served by Hugging Face partners. A free account includes monthly credits; use an access token.',
      pt: 'Modelos abertos servidos por parceiros do Hugging Face. A conta gratuita inclui créditos mensais; use um token de acesso.',
    },
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    chatPath: '/chat/completions',
    modelsUrl: 'https://api.groq.com/openai/v1/models',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile',
    usageInStream: false,
    blurb: {
      en: 'Very fast open models with a free tier (rate-limited). Create a key at console.groq.com.',
      pt: 'Modelos abertos muito rápidos com plano gratuito (com limites). Crie uma chave em console.groq.com.',
    },
  },
  {
    id: 'custom',
    label: 'OpenAI-compatible server',
    baseUrl: 'http://localhost:11434/v1',
    chatPath: '/chat/completions',
    needsKey: false,
    defaultModel: '',
    usageInStream: false,
    blurb: {
      en: 'Any OpenAI-compatible API, e.g. Ollama (http://localhost:11434/v1) or LM Studio (http://localhost:1234/v1) on this computer.',
      pt: 'Qualquer API compatível com OpenAI, por exemplo Ollama (http://localhost:11434/v1) ou LM Studio (http://localhost:1234/v1) neste computador.',
    },
  },
];

export function findProvider(id: string): CloudProvider {
  return CLOUD_PROVIDERS.find((p) => p.id === id) ?? CLOUD_PROVIDERS[0];
}

export interface CloudConnection {
  provider: CloudProviderId;
  key?: string;
  /** Base URL for the custom provider. */
  baseUrl?: string;
}

function baseOf(c: CloudConnection): string {
  const provider = findProvider(c.provider);
  return (provider.id === 'custom' && c.baseUrl ? c.baseUrl : provider.baseUrl).replace(/\/+$/, '');
}

function headersFor(c: CloudConnection): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (c.key?.trim()) headers.Authorization = `Bearer ${c.key.trim()}`;
  if (c.provider === 'openrouter') {
    // Attribution headers OpenRouter asks apps to send.
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://monolito123.github.io';
    headers['X-Title'] = 'Gooners AI';
  }
  return headers;
}

export interface CloudModelOption {
  id: string;
  label: string;
  contextWindow: number;
  free: boolean;
}

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
}

/** Parses a provider's model list into options (free models first). Pure, for tests. */
export function parseModelList(providerId: CloudProviderId, body: unknown): CloudModelOption[] {
  const list: CloudModelOption[] = [];
  if (providerId === 'pollinations' && Array.isArray(body)) {
    for (const m of body as { name?: string; description?: string; output_modalities?: string[] }[]) {
      if (!m.name || (m.output_modalities && !m.output_modalities.includes('text'))) continue;
      list.push({ id: m.name, label: m.description ? `${m.name} · ${m.description}` : m.name, contextWindow: 32768, free: true });
    }
    return list;
  }
  const data = (body as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return list;
  for (const raw of data as (OpenRouterModel & { context_window?: number; providers?: { context_length?: number }[] })[]) {
    if (!raw?.id) continue;
    const outputs = raw.architecture?.output_modalities;
    if (outputs && !outputs.includes('text')) continue;
    const free =
      providerId === 'openrouter' && (raw.id.endsWith(':free') || (raw.pricing?.prompt === '0' && raw.pricing?.completion === '0'));
    const context =
      raw.context_length ?? raw.context_window ?? Math.max(0, ...(raw.providers ?? []).map((p) => p.context_length ?? 0)) ?? 0;
    list.push({ id: raw.id, label: raw.name ?? raw.id, contextWindow: context || 8192, free });
  }
  return list.sort((a, b) => Number(b.free) - Number(a.free) || a.label.localeCompare(b.label));
}

export async function listCloudModels(c: CloudConnection, signal?: AbortSignal): Promise<CloudModelOption[]> {
  const provider = findProvider(c.provider);
  const url = provider.id === 'custom' ? `${baseOf(c)}/models` : provider.modelsUrl;
  if (!url) return [];
  const res = await fetch(url, { headers: headersFor(c), signal });
  if (!res.ok) throw new Error(await describeHttpError(res, provider));
  return parseModelList(provider.id, await res.json());
}

export function cloudModelId(provider: CloudProviderId, model: string): string {
  return `cloud:${provider}:${model}`;
}

/** Catalog entry for a cloud model (no download, no VRAM). */
export function cloudModelInfo(provider: CloudProviderId, option: CloudModelOption): TextModelInfo {
  const p = findProvider(provider);
  return {
    id: cloudModelId(provider, option.id),
    backend: 'cloud',
    label: option.label.length > 48 ? option.id : option.label,
    params: 'cloud',
    quant: option.free ? 'free' : 'api',
    downloadMB: 0,
    vramMB: 0,
    // Keep requests well inside the provider's window; small local budgets are not needed here.
    contextWindow: Math.max(4096, Math.min(option.contextWindow || 8192, 131072)),
    tags: ['chat', 'cloud'],
    requiresF16: false,
    cloud: { provider, model: option.id },
    blurb: { en: `${p.label} · ${option.id}`, pt: `${p.label} · ${option.id}` },
  };
}

async function describeHttpError(res: Response, provider: CloudProvider): Promise<string> {
  let detail = '';
  try {
    const text = await res.text();
    const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    detail = (typeof json.error === 'string' ? json.error : json.error?.message) ?? json.message ?? text;
  } catch {
    /* not JSON */
  }
  detail = detail.slice(0, 300);
  if (res.status === 401 || res.status === 403) return `${provider.label}: the API key was rejected (${res.status}). Check it in Settings → Cloud. ${detail}`;
  if (res.status === 402) return `${provider.label}: no credits left for this model. Pick a free model or add credits. ${detail}`;
  if (res.status === 429) {
    const retry = res.headers.get('retry-after');
    return `${provider.label}: rate limit reached${retry ? `, try again in ${retry} s` : ''}. Free tiers allow a limited number of requests. ${detail}`;
  }
  return `${provider.label} error ${res.status}: ${detail || res.statusText}`;
}

export interface StreamEvent {
  content?: string;
  reasoning?: string;
  finish?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Splits an SSE byte stream into JSON events (`data: {...}` lines, `[DONE]` terminates). */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue; // comments (": keep-alive"), event names, blank lines
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        if (!data) continue;
        try {
          yield JSON.parse(data) as Record<string, unknown>;
        } catch {
          /* partial or non-JSON line */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Streams a chat completion from a cloud provider. */
export async function* streamCloudChat(
  c: CloudConnection,
  model: string,
  messages: ChatTurn[],
  params: GenerationParams,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const provider = findProvider(c.provider);
  if (provider.needsKey && !c.key?.trim()) throw new Error(`${provider.label} needs an API key: add it in Settings → Cloud.`);
  const url = provider.chatPath.startsWith('http') ? provider.chatPath : `${baseOf(c)}${provider.chatPath}`;
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    temperature: params.temperature,
    top_p: params.topP,
    max_tokens: params.maxTokens,
  };
  if (provider.usageInStream) body.stream_options = { include_usage: true };
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: headersFor(c), body: JSON.stringify(body), signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(`Could not reach ${provider.label} (${error instanceof Error ? error.message : String(error)}). Cloud models need an internet connection.`);
  }
  if (!res.ok || !res.body) throw new Error(await describeHttpError(res, provider));
  for await (const event of parseSse(res.body)) {
    const error = event.error as { message?: string } | undefined;
    if (error) throw new Error(`${provider.label}: ${error.message ?? 'error'}`);
    const choice = (event.choices as { delta?: Record<string, unknown>; finish_reason?: string | null }[] | undefined)?.[0];
    const delta = choice?.delta ?? {};
    const reasoning = (delta.reasoning ?? delta.reasoning_content) as string | undefined;
    const content = delta.content as string | undefined;
    yield {
      reasoning: typeof reasoning === 'string' && reasoning ? reasoning : undefined,
      content: typeof content === 'string' && content ? content : undefined,
      finish: choice?.finish_reason ?? undefined,
      usage: event.usage as StreamEvent['usage'],
    };
  }
}

// ─── OpenRouter one-click connect (OAuth PKCE) ──────────────────────────────────────────

const PKCE_KEY = 'gooners-ai:openrouter-pkce';

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of array) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Redirects to OpenRouter; the user signs in and is sent back with ?code=… */
export async function startOpenRouterConnect(): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const callback = `${location.origin}${location.pathname}`;
  const url = new URL('https://openrouter.ai/auth');
  url.searchParams.set('callback_url', callback);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('key_label', 'Gooners AI');
  location.assign(url.toString());
}

/** Completes the redirect: exchanges ?code for a key. Returns the key, or null if not a callback. */
export async function completeOpenRouterConnect(): Promise<string | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const saved = sessionStorage.getItem(PKCE_KEY);
  if (!code || !saved) return null;
  sessionStorage.removeItem(PKCE_KEY);
  const clean = () => history.replaceState(null, '', `${location.pathname}${location.hash}`);
  const { verifier, state } = JSON.parse(saved) as { verifier: string; state: string };
  if (params.get('state') && params.get('state') !== state) {
    clean();
    throw new Error('OpenRouter sign-in did not match this browser session; try connecting again.');
  }
  const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  clean();
  if (!res.ok) throw new Error(await describeHttpError(res, findProvider('openrouter')));
  const { key } = (await res.json()) as { key?: string };
  if (!key) throw new Error('OpenRouter did not return a key');
  return key;
}

// ─── Cloud images (Pollinations, free, no key) ───────────────────────────────────────────

export const CLOUD_IMAGE_MODELS_URL = 'https://image.pollinations.ai/models';

export async function listCloudImageModels(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(CLOUD_IMAGE_MODELS_URL, { signal });
  if (!res.ok) throw new Error(`Pollinations error ${res.status}`);
  const body = (await res.json()) as unknown;
  return Array.isArray(body) ? body.filter((m): m is string => typeof m === 'string') : [];
}

export function cloudImageUrl(prompt: string, options: { width: number; height: number; seed: number; model?: string }): string {
  const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.trim())}`);
  url.searchParams.set('width', String(options.width));
  url.searchParams.set('height', String(options.height));
  url.searchParams.set('seed', String(options.seed));
  if (options.model) url.searchParams.set('model', options.model);
  url.searchParams.set('nologo', 'true');
  url.searchParams.set('private', 'true');
  url.searchParams.set('referrer', 'gooners-ai');
  return url.toString();
}

/** Generates an image on Pollinations' servers and returns it as a Blob. */
export async function generateCloudImage(
  prompt: string,
  options: { width: number; height: number; seed: number; model?: string },
  signal?: AbortSignal,
): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(cloudImageUrl(prompt, options), { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`Could not reach Pollinations (${error instanceof Error ? error.message : String(error)}). Cloud images need an internet connection.`);
  }
  if (!res.ok) {
    const retry = res.headers.get('retry-after');
    throw new Error(res.status === 429 ? `Pollinations rate limit reached${retry ? `, try again in ${retry} s` : ''}.` : `Pollinations error ${res.status}`);
  }
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Pollinations did not return an image');
  return blob;
}
