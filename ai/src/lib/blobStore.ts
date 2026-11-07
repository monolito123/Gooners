/**
 * Chunked, resumable file store in IndexedDB for model weights (SD-Turbo ONNX files, CPU
 * fallback LLMs) and generated media.
 *
 * Files are split in 16 MB chunks stored as Blobs, so a 1.7 GB UNet never has to sit in
 * memory twice while downloading, an interrupted download resumes with an HTTP Range request,
 * and reading back assembles a Blob by reference (the browser keeps the bytes on disk).
 * IndexedDB, unlike Cache Storage, is not wiped by other service workers on the same origin.
 */
import { isQuotaError, openDatabase, request, transactionDone } from './idb.ts';

const DB_NAME = 'gooners-ai-files';
const CHUNK_BYTES = 16 * 1024 * 1024;

export interface StoredFile {
  key: string;
  url: string;
  group: string;
  size: number;
  received: number;
  chunkCount: number;
  complete: boolean;
  contentType: string;
  updatedAt: number;
  meta?: Record<string, unknown>;
}

interface ChunkRecord {
  key: string;
  index: number;
  data: Blob;
}

export interface TransferProgress {
  key: string;
  loaded: number;
  total: number;
}

export class StorageFullError extends Error {
  constructor() {
    super('Browser storage is full. Free space in Storage settings or allow more storage for this site.');
    this.name = 'StorageFullError';
  }
}

function db(): Promise<IDBDatabase> {
  return openDatabase(DB_NAME, 1, (database) => {
    const files = database.createObjectStore('files', { keyPath: 'key' });
    files.createIndex('group', 'group');
    database.createObjectStore('chunks', { keyPath: ['key', 'index'] });
  });
}

export async function getFile(key: string): Promise<StoredFile | undefined> {
  const tx = (await db()).transaction('files', 'readonly');
  return request<StoredFile | undefined>(tx.objectStore('files').get(key));
}

export async function listFiles(group?: string): Promise<StoredFile[]> {
  const tx = (await db()).transaction('files', 'readonly');
  const store = tx.objectStore('files');
  const all = await request<StoredFile[]>(group ? store.index('group').getAll(group) : store.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function putChunk(file: StoredFile, chunk: Blob): Promise<StoredFile> {
  const next: StoredFile = {
    ...file,
    received: file.received + chunk.size,
    chunkCount: file.chunkCount + 1,
    updatedAt: Date.now(),
  };
  const tx = (await db()).transaction(['files', 'chunks'], 'readwrite');
  tx.objectStore('chunks').put({ key: file.key, index: file.chunkCount, data: chunk } satisfies ChunkRecord);
  tx.objectStore('files').put(next);
  try {
    await transactionDone(tx);
  } catch (error) {
    if (isQuotaError(error)) throw new StorageFullError();
    throw error;
  }
  return next;
}

async function saveMeta(file: StoredFile): Promise<void> {
  const tx = (await db()).transaction('files', 'readwrite');
  tx.objectStore('files').put(file);
  await transactionDone(tx);
}

export async function deleteFile(key: string): Promise<void> {
  const tx = (await db()).transaction(['files', 'chunks'], 'readwrite');
  tx.objectStore('files').delete(key);
  tx.objectStore('chunks').delete(IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]));
  await transactionDone(tx);
}

export async function deleteGroup(group: string): Promise<void> {
  for (const file of await listFiles(group)) await deleteFile(file.key);
}

export async function groupSize(group: string): Promise<number> {
  return (await listFiles(group)).reduce((sum, f) => sum + f.received, 0);
}

/** Returns the stored file as a Blob assembled from its chunks (no copy into memory). */
export async function readBlob(key: string): Promise<Blob> {
  const file = await getFile(key);
  if (!file?.complete) throw new Error(`${key} is not fully downloaded`);
  const tx = (await db()).transaction('chunks', 'readonly');
  const chunks = await request<ChunkRecord[]>(
    tx.objectStore('chunks').getAll(IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER])),
  );
  chunks.sort((a, b) => a.index - b.index);
  return new Blob(
    chunks.map((c) => c.data),
    { type: file.contentType },
  );
}

/** Reads the whole file into one Uint8Array, copying chunk by chunk to keep peak memory low. */
export async function readBytes(key: string, onProgress?: (p: TransferProgress) => void): Promise<Uint8Array> {
  const file = await getFile(key);
  if (!file?.complete) throw new Error(`${key} is not fully downloaded`);
  const out = new Uint8Array(file.size);
  let offset = 0;
  const database = await db();
  for (let index = 0; index < file.chunkCount; index++) {
    const tx = database.transaction('chunks', 'readonly');
    const record = await request<ChunkRecord | undefined>(tx.objectStore('chunks').get([key, index]));
    if (!record) throw new Error(`${key} is corrupted (missing chunk ${index}); delete it and download again`);
    out.set(new Uint8Array(await record.data.arrayBuffer()), offset);
    offset += record.data.size;
    onProgress?.({ key, loaded: offset, total: file.size });
  }
  if (offset !== file.size) throw new Error(`${key} is corrupted (size mismatch); delete it and download again`);
  return out;
}

/** Stores an in-memory Blob (generated images, videos) as a complete file. */
export async function putBlob(key: string, group: string, blob: Blob, meta?: Record<string, unknown>): Promise<StoredFile> {
  await deleteFile(key);
  let file: StoredFile = {
    key,
    url: '',
    group,
    size: blob.size,
    received: 0,
    chunkCount: 0,
    complete: false,
    contentType: blob.type,
    updatedAt: Date.now(),
    meta,
  };
  for (let start = 0; start < blob.size || (start === 0 && blob.size === 0); start += CHUNK_BYTES) {
    file = await putChunk(file, blob.slice(start, start + CHUNK_BYTES));
    if (blob.size === 0) break;
  }
  file = { ...file, complete: true };
  await saveMeta(file);
  return file;
}

export interface DownloadOptions {
  key: string;
  url: string;
  group: string;
  /** Expected size in bytes, when known in advance; used for progress before headers arrive. */
  size?: number;
  signal?: AbortSignal;
  onProgress?: (p: TransferProgress) => void;
  meta?: Record<string, unknown>;
}

function totalFromHeaders(res: Response, offset: number): number | undefined {
  const range = res.headers.get('content-range');
  const total = range?.match(/\/(\d+)\s*$/)?.[1];
  if (total) return Number(total);
  const length = res.headers.get('content-length');
  return length ? Number(length) + offset : undefined;
}

/**
 * Downloads `url` into the store, resuming a partial download when the server honours Range.
 * Uses `cache: 'no-store'` so the browser does not keep a second copy in its HTTP cache.
 */
export async function download(options: DownloadOptions): Promise<StoredFile> {
  const { key, url, group, signal, onProgress } = options;
  let file = await getFile(key);
  if (file?.complete && file.url === url) return file;
  if (file && file.url !== url) {
    await deleteFile(key);
    file = undefined;
  }
  if (!file) {
    file = {
      key,
      url,
      group,
      size: options.size ?? 0,
      received: 0,
      chunkCount: 0,
      complete: false,
      contentType: 'application/octet-stream',
      updatedAt: Date.now(),
      meta: options.meta,
    };
    await saveMeta(file);
  }

  const headers: Record<string, string> = {};
  if (file.received > 0) headers.Range = `bytes=${file.received}-`;
  let res = await fetch(url, { headers, signal, cache: 'no-store', credentials: 'omit' });
  if (file.received > 0 && res.status === 200) {
    // The server ignored the Range header: start over.
    await deleteFile(key);
    file = { ...file, received: 0, chunkCount: 0, updatedAt: Date.now() };
    await saveMeta(file);
  } else if (res.status === 416 && file.size && file.received >= file.size) {
    file = { ...file, complete: true };
    await saveMeta(file);
    return file;
  }
  if (!res.ok) {
    if (res.status === 416) {
      await deleteFile(key);
      res = await fetch(url, { signal, cache: 'no-store', credentials: 'omit' });
      file = { ...file, received: 0, chunkCount: 0 };
      await saveMeta(file);
    }
    if (!res.ok) throw new Error(`Download failed (${res.status} ${res.statusText}) for ${url}`);
  }
  // Prefer the catalog size: Content-Length is the compressed size when the server gzips.
  const total = options.size ?? totalFromHeaders(res, file.received) ?? 0;
  file = { ...file, size: total, contentType: res.headers.get('content-type') ?? file.contentType };
  await saveMeta(file);
  onProgress?.({ key, loaded: file.received, total });

  return writeBody(file, res, total, options.size !== undefined, onProgress, signal);
}

/** Streams a response body into chunks, appending to `file` (which may already hold a prefix). */
async function writeBody(
  start: StoredFile,
  res: Response,
  total: number,
  exact: boolean,
  onProgress?: (p: TransferProgress) => void,
  signal?: AbortSignal,
): Promise<StoredFile> {
  if (!res.body) throw new Error('This browser cannot stream downloads');
  let file = start;
  const reader = res.body.getReader();
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  const flush = async () => {
    if (!pendingBytes) return;
    const chunk = new Blob(pending as BlobPart[]);
    pending = [];
    pendingBytes = 0;
    file = await putChunk(file, chunk);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending.push(value);
      pendingBytes += value.byteLength;
      onProgress?.({ key: file.key, loaded: file.received + pendingBytes, total: Math.max(total, file.received + pendingBytes) });
      if (pendingBytes >= CHUNK_BYTES) await flush();
    }
    await flush();
  } catch (error) {
    // Keep what was written so the next attempt resumes.
    if (signal?.aborted) await flush().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (total && (exact ? file.received !== total : file.received < total)) {
    throw new Error(`Download of ${file.url} ended early (${file.received} of ${total} bytes); try again to resume`);
  }
  file = { ...file, size: file.received, complete: true, updatedAt: Date.now() };
  await saveMeta(file);
  onProgress?.({ key: file.key, loaded: file.size, total: file.size });
  return file;
}

/** Stores a fetched Response (used as the Transformers.js custom cache). */
export async function storeResponse(
  key: string,
  group: string,
  res: Response,
  onProgress?: (p: TransferProgress) => void,
): Promise<StoredFile> {
  await deleteFile(key);
  const file: StoredFile = {
    key,
    url: key,
    group,
    size: Number(res.headers.get('content-length') ?? 0),
    received: 0,
    chunkCount: 0,
    complete: false,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    updatedAt: Date.now(),
  };
  await saveMeta(file);
  return writeBody(file, res, file.size, false, onProgress);
}
