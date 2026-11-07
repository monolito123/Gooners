/**
 * Back up every downloaded model (and optionally the gallery) to a folder on this computer and
 * restore it later, so models survive clearing the browser data or moving to another browser
 * profile without downloading gigabytes again. Uses the File System Access API (Chrome, Edge,
 * Opera, Brave on desktop).
 */
import * as store from './blobStore.ts';

const FOLDER = 'gooners-ai-models';
const MANIFEST = 'manifest.json';
const WEBLLM_DBS = ['webllm/model', 'webllm/config', 'webllm/wasm'];

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
};

interface BlobEntry {
  kind: 'blob';
  file: string;
  key: string;
  url: string;
  group: string;
  contentType: string;
  size: number;
  meta?: Record<string, unknown>;
}

interface WebLLMEntry {
  kind: 'webllm';
  file: string;
  db: string;
  url: string;
  type: 'arraybuffer' | 'text' | 'json';
  size: number;
}

export interface BackupManifest {
  app: 'gooners-ai';
  version: 1;
  created: string;
  entries: (BlobEntry | WebLLMEntry)[];
}

export interface BackupProgress {
  done: number;
  total: number;
  bytes: number;
  item: string;
}

export function canBackup(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

async function pickFolder(mode: 'read' | 'readwrite'): Promise<DirHandle> {
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
  return picker({ id: 'gooners-ai-models', mode, startIn: 'documents' });
}

function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => {
      // The database did not exist: do not create an empty one.
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('urls')) {
        db.close();
        resolve(null);
      } else resolve(db);
    };
    req.onerror = () => resolve(null);
  });
}

function openForRestore(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('urls')) req.result.createObjectStore('urls', { keyPath: 'url' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`Could not open ${name}`));
  });
}

function idb<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

/** Writes all models (and the gallery when `includeAssets`) into <picked folder>/gooners-ai-models. */
export async function backupModels(options: { includeAssets: boolean; onProgress?: (p: BackupProgress) => void; signal?: AbortSignal }): Promise<BackupManifest> {
  const root = await pickFolder('readwrite');
  const dir = await root.getDirectoryHandle(FOLDER, { create: true });
  const entries: BackupManifest['entries'] = [];
  const files = (await store.listFiles()).filter((f) => f.complete && (options.includeAssets || f.group !== 'assets'));
  const webllm: { db: IDBDatabase; name: string; urls: string[] }[] = [];
  for (const name of WEBLLM_DBS) {
    const db = await openExisting(name);
    if (db) webllm.push({ db, name, urls: (await idb(db.transaction('urls').objectStore('urls').getAllKeys())) as string[] });
  }
  const total = files.length + webllm.reduce((n, w) => n + w.urls.length, 0);
  let done = 0;
  let bytes = 0;
  const step = (item: string, size: number) => {
    done++;
    bytes += size;
    options.onProgress?.({ done, total, bytes, item });
  };
  try {
    for (const f of files) {
      if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const name = `blob-${String(entries.length).padStart(5, '0')}.bin`;
      await writeFile(dir, name, await store.readBlob(f.key));
      entries.push({ kind: 'blob', file: name, key: f.key, url: f.url, group: f.group, contentType: f.contentType, size: f.size, meta: f.meta });
      step(f.key, f.size);
    }
    for (const { db, name: dbName, urls } of webllm) {
      for (const url of urls) {
        if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        const record = (await idb(db.transaction('urls').objectStore('urls').get(url))) as { url: string; data: unknown } | undefined;
        if (!record || record.data == null) continue;
        const name = `webllm-${String(entries.length).padStart(5, '0')}.bin`;
        const data = record.data;
        const type: WebLLMEntry['type'] = data instanceof ArrayBuffer ? 'arraybuffer' : typeof data === 'string' ? 'text' : 'json';
        const blob = type === 'arraybuffer' ? new Blob([data as ArrayBuffer]) : new Blob([type === 'text' ? (data as string) : JSON.stringify(data)]);
        await writeFile(dir, name, blob);
        entries.push({ kind: 'webllm', file: name, db: dbName, url, type, size: blob.size });
        step(url, blob.size);
      }
    }
  } finally {
    for (const { db } of webllm) db.close();
  }
  const manifest: BackupManifest = { app: 'gooners-ai', version: 1, created: new Date().toISOString(), entries };
  await writeFile(dir, MANIFEST, JSON.stringify(manifest, null, 1));
  return manifest;
}

/** Reads a backup folder (the gooners-ai-models folder or its parent) back into the browser. */
export async function restoreModels(options: { onProgress?: (p: BackupProgress) => void; signal?: AbortSignal } = {}): Promise<number> {
  const picked = await pickFolder('read');
  let dir: FileSystemDirectoryHandle = picked;
  try {
    await picked.getFileHandle(MANIFEST);
  } catch {
    dir = await picked.getDirectoryHandle(FOLDER);
  }
  const manifest = JSON.parse(await (await (await dir.getFileHandle(MANIFEST)).getFile()).text()) as BackupManifest;
  if (manifest.app !== 'gooners-ai') throw new Error('This folder is not a Gooners AI backup');
  const dbs = new Map<string, IDBDatabase>();
  let done = 0;
  let bytes = 0;
  try {
    for (const entry of manifest.entries) {
      if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const file = await (await dir.getFileHandle(entry.file)).getFile();
      if (entry.kind === 'blob') {
        await store.importFile({ key: entry.key, url: entry.url, group: entry.group, contentType: entry.contentType, meta: entry.meta }, file);
      } else {
        let db = dbs.get(entry.db);
        if (!db) {
          db = await openForRestore(entry.db);
          dbs.set(entry.db, db);
        }
        const data = entry.type === 'arraybuffer' ? await file.arrayBuffer() : entry.type === 'text' ? await file.text() : JSON.parse(await file.text());
        const tx = db.transaction('urls', 'readwrite');
        tx.objectStore('urls').put({ url: entry.url, data });
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('Restore aborted (storage full?)'));
        });
      }
      done++;
      bytes += entry.size;
      options.onProgress?.({ done, total: manifest.entries.length, bytes, item: entry.kind === 'blob' ? entry.key : entry.url });
    }
  } finally {
    for (const db of dbs.values()) db.close();
  }
  return done;
}
