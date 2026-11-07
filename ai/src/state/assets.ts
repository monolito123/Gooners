/** Generated images and videos, stored as Blobs in IndexedDB and shared across modes. */
import { create } from 'zustand';
import * as store from '../lib/blobStore.ts';
import { uid } from '../lib/format.ts';
import { usePlatform } from './platform.ts';

export const ASSET_GROUP = 'assets';

export interface Asset {
  id: string;
  kind: 'image' | 'video';
  name: string;
  prompt: string;
  engine: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  createdAt: number;
  durationSec?: number;
}

interface AssetState {
  assets: Asset[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (blob: Blob, info: Omit<Asset, 'id' | 'size' | 'mime' | 'createdAt' | 'name'> & { name?: string }) => Promise<Asset>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}

const urls = new Map<string, string>();

/** A cached object URL for an asset's bytes. */
export async function assetUrl(id: string): Promise<string> {
  const hit = urls.get(id);
  if (hit) return hit;
  const url = URL.createObjectURL(await store.readBlob(`asset:${id}`));
  urls.set(id, url);
  return url;
}

export function assetBlob(id: string): Promise<Blob> {
  return store.readBlob(`asset:${id}`);
}

export async function assetDataUrl(id: string): Promise<string> {
  const blob = await assetBlob(id);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read asset'));
    reader.readAsDataURL(blob);
  });
}

/** Short, URL-safe asset name usable as asset://name in generated apps. */
export function slugName(prompt: string, kind: Asset['kind']): string {
  const base = prompt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return `${base || kind}-${Math.random().toString(36).slice(2, 6)}`;
}

export const useAssets = create<AssetState>()((set, get) => ({
  assets: [],
  loaded: false,
  load: async () => {
    try {
      const files = await store.listFiles(ASSET_GROUP);
      const assets = files.filter((f) => f.complete && f.meta).map((f) => f.meta as unknown as Asset);
      set({ assets: assets.sort((a, b) => b.createdAt - a.createdAt), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  add: async (blob, info) => {
    const asset: Asset = {
      ...info,
      id: uid('a_'),
      name: info.name ?? slugName(info.prompt, info.kind),
      mime: blob.type,
      size: blob.size,
      createdAt: Date.now(),
    };
    await store.putBlob(`asset:${asset.id}`, ASSET_GROUP, blob, asset as unknown as Record<string, unknown>);
    set({ assets: [asset, ...get().assets] });
    void usePlatform.getState().refreshStorage();
    return asset;
  },
  remove: async (id) => {
    await store.deleteFile(`asset:${id}`);
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id);
    set({ assets: get().assets.filter((a) => a.id !== id) });
    void usePlatform.getState().refreshStorage();
  },
  clear: async () => {
    await store.deleteGroup(ASSET_GROUP);
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    set({ assets: [] });
  },
}));
