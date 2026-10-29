/**
 * Encrypted local storage (docs/03-key-management.md §3–4).
 *
 *   IndexedDB "sma" / "kv":
 *     wrapped = sealVault(vault_key, passphrase)      Argon2id(t=3, m=64 MiB) → XChaCha20-Poly1305
 *     state   = nonce[24] ‖ XChaCha20-Poly1305(vault_key, nonce, aad, JSON app state)
 *
 * The vault key is random; the passphrase only unwraps it, so changing the passphrase never
 * re-encrypts the state, and the state is re-encrypted on every save without re-running Argon2.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import {
  ARGON2,
  bytesToUtf8,
  concatBytes,
  openVault,
  randomBytes,
  sealVault,
  utf8ToBytes,
} from '../../reference/src/index.ts';

const DB = 'sma';
const STORE = 'kv';
const STATE_AAD = utf8ToBytes('SMA/v1/app-state');

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get(key: string): Promise<Uint8Array | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Uint8Array | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function put(key: string, value: Uint8Array): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function vaultExists(): Promise<boolean> {
  return (await get('wrapped')) !== undefined;
}

export class Vault {
  private readonly key: Uint8Array;
  private saving: Promise<void> = Promise.resolve();

  private constructor(key: Uint8Array) {
    this.key = key;
  }

  static async create(passphrase: string, stateJson: string): Promise<Vault> {
    const key = randomBytes(32);
    await put('wrapped', await sealVault(key, passphrase, ARGON2.interactive));
    const v = new Vault(key);
    await v.save(stateJson);
    // Ask the browser not to evict our data under storage pressure.
    await navigator.storage?.persist?.().catch(() => false);
    return v;
  }

  /** Throws "wrong passphrase or corrupted vault" on a bad passphrase. */
  static async unlock(passphrase: string): Promise<{ vault: Vault; stateJson: string }> {
    const wrapped = await get('wrapped');
    if (!wrapped) throw new Error('no vault on this device');
    const v = new Vault(await openVault(wrapped, passphrase));
    const sealed = await get('state');
    if (!sealed) throw new Error('vault state missing');
    const pt = xchacha20poly1305(v.key, sealed.subarray(0, 24), STATE_AAD).decrypt(sealed.subarray(24));
    return { vault: v, stateJson: bytesToUtf8(pt) };
  }

  /** Saves are serialised so a slow write never overtakes a newer one. */
  save(stateJson: string): Promise<void> {
    const nonce = randomBytes(24);
    const sealed = concatBytes(nonce, xchacha20poly1305(this.key, nonce, STATE_AAD).encrypt(utf8ToBytes(stateJson)));
    this.saving = this.saving.then(() => put('state', sealed));
    return this.saving;
  }

  lock(): void {
    this.key.fill(0);
  }

  static async wipe(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  }
}
