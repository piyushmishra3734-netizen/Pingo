/**
 * Where a private session's temporary key pair waits between launches.
 *
 * The browser keeps the pair as an opaque handle: the private half is not
 * exportable, so this code, and anything that got into it, can use the key but
 * not read it out. It lives here only as long as its session. Ending a session,
 * its expiry, or the next launch after either one drops it, and a launch also
 * drops any pair whose session is no longer live.
 *
 * Not in the sealed stores the rest of the app uses: those are for things that
 * should outlast a session, and this must not.
 */

export interface StoredPair {
  pair: CryptoKeyPair;
  /** The public half as sent to the server, to tell a pair from another device's. */
  pub: string;
}

const DB_NAME = 'pingo-private';
const STORE = 'keys';

/** Used when IndexedDB is unavailable (some private windows): lasts until the tab closes. */
const memory = new Map<string, StoredPair>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveKeys(sessionId: string, rec: StoredPair): Promise<void> {
  memory.set(sessionId, rec);
  try {
    await run('readwrite', (s) => s.put(rec, sessionId));
  } catch {
    /* kept in memory only */
  }
}

export async function loadKeys(sessionId: string): Promise<StoredPair | undefined> {
  const held = memory.get(sessionId);
  if (held) return held;
  try {
    const rec = await run<StoredPair | undefined>('readonly', (s) => s.get(sessionId));
    if (rec) memory.set(sessionId, rec);
    return rec;
  } catch {
    return undefined;
  }
}

export async function dropKeys(sessionId: string): Promise<void> {
  memory.delete(sessionId);
  try {
    await run('readwrite', (s) => s.delete(sessionId));
  } catch {
    /* nothing stored */
  }
}

/** Drops every pair whose session is not in `live`. */
export async function keepOnly(live: ReadonlySet<string>): Promise<void> {
  for (const id of [...memory.keys()]) if (!live.has(id)) memory.delete(id);
  try {
    const keys = await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    for (const k of keys) if (!live.has(String(k))) await dropKeys(String(k));
  } catch {
    /* nothing stored */
  }
}
