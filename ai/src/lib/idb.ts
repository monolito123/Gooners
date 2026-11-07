/** Minimal promise helpers around IndexedDB. */

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

const connections = new Map<string, Promise<IDBDatabase>>();

/** Opens (and caches) a database connection, running `upgrade` on version changes. */
export function openDatabase(name: string, version: number, upgrade: (db: IDBDatabase, oldVersion: number) => void): Promise<IDBDatabase> {
  const key = `${name}@${version}`;
  let pending = connections.get(key);
  if (!pending) {
    pending = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available in this browser'));
        return;
      }
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = (event) => upgrade(req.result, event.oldVersion);
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          connections.delete(key);
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error(`Could not open ${name}`));
      req.onblocked = () => reject(new Error(`${name} is open in another tab with an older version; close it and retry`));
    });
    pending.catch(() => connections.delete(key));
    connections.set(key, pending);
  }
  return pending;
}

export async function closeDatabase(name: string): Promise<void> {
  for (const [key, pending] of connections) {
    if (key.startsWith(`${name}@`)) {
      connections.delete(key);
      (await pending.catch(() => null))?.close();
    }
  }
}

export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`Could not delete ${name}`));
    req.onblocked = () => resolve(); // finishes once other tabs close their connections
  });
}

export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22);
}
