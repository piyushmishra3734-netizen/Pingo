/**
 * The local database.
 *
 * ## Why IndexedDB and not localStorage
 *
 * `localStorage` is synchronous — every read blocks the main thread — and caps
 * at about 5MB of strings. A conversation history is neither small nor worth
 * blocking a render for. IndexedDB is asynchronous, holds structured values
 * without serialising by hand, and is measured in hundreds of megabytes.
 *
 * ## Why it is written out rather than installed
 *
 * The IndexedDB API is unpleasant but small, and what this needs is four
 * operations. A wrapper library would be another dependency in the critical
 * path of opening the app, for an event-to-promise adapter that fits on one
 * screen.
 *
 * ## Every failure is survivable
 *
 * Private browsing refuses IndexedDB outright, Safari evicts it under storage
 * pressure, and a corrupted database throws on open. None of that may stop the
 * app: the cache is an optimisation, and an optimisation that can break the
 * product is a liability. So every method resolves to a harmless value rather
 * than rejecting, and the caller carries on to the network.
 */

const DB_NAME = 'pingo';
const DB_VERSION = 1;

/**
 * The stores, and what each is for.
 *
 * Keyed by their natural id rather than an autoincrement, so writing the same
 * conversation twice updates it instead of accumulating copies.
 */
export const STORE = {
  /** One record per conversation, as the list last saw it. */
  conversations: 'conversations',
  /** One record per conversation holding its most recent page of messages. */
  messages: 'messages',
  /** Composed but not yet sent. Survives a reload and a force-quit. */
  outbox: 'outbox',
  /** Unsent text per conversation, saved as you type. */
  drafts: 'drafts',
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

let open: Promise<IDBDatabase | undefined> | undefined;

function openDatabase(): Promise<IDBDatabase | undefined> {
  open ??= new Promise<IDBDatabase | undefined>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(undefined);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      // Private browsing on some engines throws here rather than erroring.
      resolve(undefined);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of Object.values(STORE)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
    /*
     * Blocked means another tab holds an older version open. Resolving rather
     * than hanging matters: the alternative is an app that never finishes
     * starting because a forgotten tab is open in another window.
     */
    request.onblocked = () => resolve(undefined);
  });

  return open;
}

async function withStore<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T | undefined> {
  const db = await openDatabase();
  if (!db) return undefined;

  return new Promise<T | undefined>((resolve) => {
    let request: IDBRequest;
    try {
      request = run(db.transaction(name, mode).objectStore(name));
    } catch {
      resolve(undefined);
      return;
    }
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => resolve(undefined);
  });
}

export function localGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  return withStore<T>(store, 'readonly', (s) => s.get(key));
}

export function localSet(store: StoreName, key: string, value: unknown): Promise<unknown> {
  return withStore(store, 'readwrite', (s) => s.put(value, key));
}

export function localDelete(store: StoreName, key: string): Promise<unknown> {
  return withStore(store, 'readwrite', (s) => s.delete(key));
}

export function localAll<T>(store: StoreName): Promise<T[]> {
  return withStore<T[]>(store, 'readonly', (s) => s.getAll()).then((rows) => rows ?? []);
}

/** Wipes everything. Called on sign-out — one device, one account's cache. */
export async function localClear(): Promise<void> {
  for (const name of Object.values(STORE)) {
    await withStore(name, 'readwrite', (s) => s.clear());
  }
}
