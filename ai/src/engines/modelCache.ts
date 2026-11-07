/** Which text models are already on disk, and deleting them (WebLLM IndexedDB + CPU model files). */
import type { AppConfig, ModelRecord } from '@mlc-ai/web-llm';
import * as store from '../lib/blobStore.ts';
import { TEXT_MODELS, TRANSFORMERS_GROUP, type TextModelInfo, resolveWebLLMId } from './models.ts';

let lib: Promise<typeof import('@mlc-ai/web-llm')> | undefined;
export function webllmLib(): Promise<typeof import('@mlc-ai/web-llm')> {
  lib ??= import('@mlc-ai/web-llm');
  return lib;
}

export async function webllmAppConfig(customModels: TextModelInfo[]): Promise<AppConfig> {
  const { prebuiltAppConfig } = await webllmLib();
  const custom: ModelRecord[] = customModels
    .filter((m) => m.custom)
    .map((m) => ({
      model: m.custom!.modelUrl,
      model_id: m.id,
      model_lib: m.custom!.modelLib,
      vram_required_MB: m.vramMB || undefined,
      low_resource_required: false,
      overrides: { context_window_size: m.contextWindow },
    }));
  // Catalog models with community weights reuse the official record (library, overrides,
  // memory figures) of the same architecture; the official integrity hashes do not apply.
  const derived: ModelRecord[] = TEXT_MODELS.filter((m) => m.mlc).flatMap((m) => {
    const base = prebuiltAppConfig.model_list.find((r) => r.model_id === m.mlc!.libFrom);
    if (!base) return [];
    const { integrity: _integrity, model_manifest: _manifest, ...rest } = base;
    void _integrity;
    void _manifest;
    return [{ ...rest, model: m.mlc!.modelUrl, model_id: m.id }];
  });
  // IndexedDB rather than Cache Storage: other service workers on this origin clear caches.
  return { model_list: [...prebuiltAppConfig.model_list, ...derived, ...custom], cacheBackend: 'indexeddb' };
}

const hfPrefix = (repo: string) => `https://huggingface.co/${repo}/resolve/`;

export async function cpuModelFiles(model: TextModelInfo): Promise<store.StoredFile[]> {
  if (!model.repo) return [];
  const prefix = hfPrefix(model.repo);
  return (await store.listFiles(TRANSFORMERS_GROUP)).filter((f) => f.key.startsWith(prefix));
}

export async function isTextModelCached(model: TextModelInfo, hasF16: boolean, customModels: TextModelInfo[] = []): Promise<boolean> {
  try {
    if (model.backend === 'wasm') {
      const files = await cpuModelFiles(model);
      return files.some((f) => f.complete && f.key.includes(`onnx/model_${model.dtype ?? 'q4'}.onnx`));
    }
    const { hasModelInCache } = await webllmLib();
    return await hasModelInCache(resolveWebLLMId(model, hasF16), await webllmAppConfig(customModels));
  } catch {
    return false;
  }
}

export async function deleteTextModel(model: TextModelInfo, customModels: TextModelInfo[] = []): Promise<void> {
  if (model.backend === 'wasm') {
    for (const f of await cpuModelFiles(model)) await store.deleteFile(f.key);
    return;
  }
  const { deleteModelAllInfoInCache } = await webllmLib();
  const config = await webllmAppConfig(customModels);
  for (const id of new Set([model.id, model.f32Variant].filter((x): x is string => Boolean(x)))) {
    if (config.model_list.some((r) => r.model_id === id)) await deleteModelAllInfoInCache(id, config).catch(() => undefined);
  }
}

/** Ids of catalog/custom models with weights on disk. */
export async function cachedTextModels(hasF16: boolean, customModels: TextModelInfo[]): Promise<Set<string>> {
  const all = [...TEXT_MODELS, ...customModels];
  const results = await Promise.all(all.map(async (m) => [m.id, await isTextModelCached(m, hasF16, customModels)] as const));
  return new Set(results.filter(([, cached]) => cached).map(([id]) => id));
}

/** Removes every WebLLM database (including models no longer in the catalog). */
export async function deleteAllWebLLMData(): Promise<void> {
  const list = (await indexedDB.databases?.()) ?? [];
  for (const db of list) {
    if (db.name && /webllm|tvmjs/i.test(db.name)) {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(db.name!);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    }
  }
}
