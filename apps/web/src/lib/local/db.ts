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

/**
 * Bumped when a store is added, because `onupgradeneeded` fires on a version
 * *increase* and on nothing else.
 *
 * The `keys` store was added at version 1 without this being raised, so every
 * device that had ever opened PINGO already held a version-1 database without
 * it. The store was therefore never created, `deviceIdentity` could not
 * persist, and a fresh keypair was minted on every page load — one dead
 * `device_keys` row per visit, and a database key that was gone before the
 * cache it sealed could be read back.
 *
 * `openDatabase` no longer depends on anyone remembering to change this. It is
 * still correct to change it, and it saves the reopen.
 */
const DB_VERSION = 4;

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
  /**
   * This device's keys — identity and database — as non-extractable handles.
   *
   * Cleared on sign-out with everything else, which is correct: the identity
   * belongs to that session's account, and a new sign-in publishes a new device
   * rather than inheriting one.
   */
  keys: 'keys',
  /**
   * The startup snapshot: who you are, who you know, and your conversations,
   * as of the last successful load.
   *
   * One record rather than three, because the first frame needs all of it or
   * none of it — a list with no current user renders nothing useful, so there
   * is no value in being able to read the pieces apart.
   */
  meta: 'meta',
  /**
   * One record per message, beside the page-per-conversation blob rather than
   * instead of it.
   *
   * Keys are `conversationId|paddedCreatedAt|messageId`, which sorts
   * chronologically as a string, so a range over one conversation is a single
   * indexed read. The key is deliberately plaintext and the value sealed — a
   * range query has to be answerable without decrypting anything to find out
   * what to decrypt, and the server already knows every id and timestamp in
   * that key.
   *
   * Dual-written for now. The blob stays authoritative until the two are shown
   * to agree on real data.
   */
  messageRows: 'message-rows',
} as const;

/** Zero-padded so lexicographic order is chronological order. */
export function messageRowKey(conversationId: string, createdAt: number, id: string): string {
  return `${conversationId}|${String(createdAt).padStart(15, '0')}|${id}`;
}

/** Every key belonging to one conversation, in time order. */
export function messageRowRange(conversationId: string): IDBKeyRange {
  return IDBKeyRange.bound(`${conversationId}|`, `${conversationId}|￿`);
}

export type StoreName = (typeof STORE)[keyof typeof STORE];

let open: Promise<IDBDatabase | undefined> | undefined;

/** One open attempt at a given version. Creates whatever stores are missing. */
function openAt(version?: number): Promise<IDBDatabase | undefined> {
  return new Promise<IDBDatabase | undefined>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(undefined);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, version);
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
}

/**
 * Opens the database and guarantees every store in `STORE` exists.
 *
 * The guarantee is checked rather than assumed. A missing store is not a
 * theoretical case — it is what happens to every existing device the moment a
 * store is added, and the symptom is silent: reads and writes fail into the
 * harmless-value path and the feature simply never works. So if anything is
 * missing after the open, this reopens one version higher, which is the only
 * thing that runs `onupgradeneeded`.
 *
 * Costs one extra round trip exactly once per device per added store, and
 * removes a whole class of bug that is invisible in code review.
 */
function openDatabase(): Promise<IDBDatabase | undefined> {
  open ??= (async () => {
    const db = await openAt(DB_VERSION);
    if (!db) return undefined;

    const missing = Object.values(STORE).filter((name) => !db.objectStoreNames.contains(name));
    if (missing.length === 0) return db;

    // A database already at or above DB_VERSION but short a store — someone
    // added one without raising the constant, or a newer tab got there first.
    const next = db.version + 1;
    db.close();
    return openAt(next);
  })();

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

/**
 * Values under a key range, newest last, capped.
 *
 * The cap is applied by the cursor rather than after the fact, so opening a
 * conversation with ten thousand cached messages reads fifty records instead
 * of ten thousand — which is the entire reason for storing them separately.
 */
export async function localRange<T>(
  store: StoreName,
  range: IDBKeyRange,
  limit: number,
): Promise<T[]> {
  const db = await openDatabase();
  if (!db) return [];

  return new Promise<T[]>((resolve) => {
    let request: IDBRequest<IDBCursorWithValue | null>;
    try {
      // Backwards, so the cap keeps the newest rather than the oldest.
      request = db.transaction(store, 'readonly').objectStore(store).openCursor(range, 'prev');
    } catch {
      resolve([]);
      return;
    }

    const out: T[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || out.length >= limit) {
        resolve(out.reverse());
        return;
      }
      out.push(cursor.value as T);
      cursor.continue();
    };
    request.onerror = () => resolve(out.reverse());
  });
}

/** Writes many records in one transaction. Separate puts would be one each. */
export async function localPutMany(
  store: StoreName,
  entries: Array<[string, unknown]>,
): Promise<void> {
  const db = await openDatabase();
  if (!db || entries.length === 0) return;

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const objectStore = tx.objectStore(store);
      for (const [key, value] of entries) objectStore.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Keys alongside values, for passes that have to delete what they inspect. */
export async function localEntries<T>(store: StoreName): Promise<Array<[string, T]>> {
  const keys = await withStore<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());
  const values = await withStore<T[]>(store, 'readonly', (s) => s.getAll());
  if (!keys || !values) return [];
  return keys.map((key, i) => [String(key), values[i] as T]);
}

/**
 * Ask the browser not to evict this origin.
 *
 * Without it, storage is "best-effort": under disk pressure the browser may
 * discard the whole origin, taking the sealed cache, the outbox, and — because
 * they live in the same database — this device's keys. Losing keys silently is
 * indistinguishable from a reinstall, and after it there is no way to read
 * encrypted history back.
 *
 * Granting is the browser's decision, not ours. Chrome grants it to installed
 * apps and to sites people actually use; Firefox prompts; Safari decides on
 * engagement. So this is a request that can be refused, and the return value
 * says which happened rather than pretending it always works.
 *
 * Called once at startup. Never blocks anything.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    // Already granted on a previous run: asking again would be a second prompt
    // for an answer we have.
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Wipes everything. Called on sign-out — one device, one account's cache. */
export async function localClear(): Promise<void> {
  for (const name of Object.values(STORE)) {
    await withStore(name, 'readwrite', (s) => s.clear());
  }
}
