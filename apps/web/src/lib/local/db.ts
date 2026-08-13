/**
 * The local database.
 *
 * ## Why IndexedDB and not localStorage
 *
 * `localStorage` is synchronous - every read blocks the main thread - and caps
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
 * persist, and a fresh keypair was minted on every page load - one dead
 * `device_keys` row per visit, and a database key that was gone before the
 * cache it sealed could be read back.
 *
 * `openDatabase` no longer depends on anyone remembering to change this. It is
 * still correct to change it, and it saves the reopen.
 */
const DB_VERSION = 5;

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
   * This device's keys - identity and database - as non-extractable handles.
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
   * none of it - a list with no current user renders nothing useful, so there
   * is no value in being able to read the pieces apart.
   */
  meta: 'meta',
  /**
   * One record per message, beside the page-per-conversation blob rather than
   * instead of it.
   *
   * Keys are `conversationId|paddedCreatedAt|messageId`, which sorts
   * chronologically as a string, so a range over one conversation is a single
   * indexed read. The key is deliberately plaintext and the value sealed - a
   * range query has to be answerable without decrypting anything to find out
   * what to decrypt, and the server already knows every id and timestamp in
   * that key.
   *
   * Dual-written for now. The blob stays authoritative until the two are shown
   * to agree on real data.
   */
  messageRows: 'message-rows',
  /**
   * Files kept whole, exactly as they were chosen. The chat wallpaper so far.
   *
   * Blobs rather than strings, which is the reason this is not in
   * `localStorage` with the rest of the wallpaper settings: a photograph
   * straight off a phone is several megabytes, base64 adds a third to that,
   * and the whole origin gets about five. Re-encoding it small enough to fit
   * is what this store exists to stop - it costs the quality the person picked
   * the picture for, and on an animated GIF it costs the animation.
   */
  media: 'media',
} as const;

/** Zero-padded so lexicographic order is chronological order. */
export function messageRowKey(conversationId: string, createdAt: number, id: string): string {
  return `${conversationId}|${String(createdAt).padStart(15, '0')}|${id}`;
}

/** Every key belonging to one conversation, in time order. */
export function messageRowRange(conversationId: string): IDBKeyRange {
  return IDBKeyRange.bound(`${conversationId}|`, `${conversationId}|￿`);
}

/**
 * The key bounds covering everything stored *before* one message.
 *
 * Paging asks for "fifty older than this id", and the id alone is not a key -
 * the key carries the timestamp too. So the anchor is found among the keys the
 * conversation already has, and the range runs from the start of the
 * conversation up to it, exclusive.
 *
 * Separated from IndexedDB on purpose. Everything interesting here is string
 * ordering, and string ordering can be checked in a test runner; `IDBKeyRange`
 * cannot. The caller turns the result into a range.
 *
 * `undefined` means this device cannot answer and the caller must ask the
 * server. Two things cause it, and both matter:
 *
 * - The anchor was never stored, so what comes before it is unknown. A range
 *   from the newest end would hand back the wrong page and let the caller
 *   believe it had paged.
 * - The anchor is at or below `floor`, the oldest key of the run this device
 *   knows to be gapless. Rows exist below a floor - an older session's page, a
 *   partial backfill - but nothing proves they *join*, and serving across a gap
 *   would drop real messages out of the middle of a conversation without any
 *   symptom to notice.
 */
export function rowKeyBoundsBefore(
  conversationId: string,
  keys: string[],
  beforeId: string,
  floor?: string,
): { lower: string; upper: string } | undefined {
  const prefix = `${conversationId}|`;
  const anchor = keys.find((key) => key.startsWith(prefix) && key.endsWith(`|${beforeId}`));
  if (anchor === undefined) return undefined;

  const lower = floor ?? prefix;
  return anchor <= lower ? undefined : { lower, upper: anchor };
}

/**
 * The stretch of a conversation this device holds without a gap in it.
 *
 * Keys, not ids, because the whole question is one of ordering. The run always
 * reaches the newest end of what has been fetched; `from` is how far back it
 * goes, and is the only point below which local paging is trustworthy.
 */
export interface RowRun {
  from: string;
  to: string;
}

/**
 * Merges a freshly stored stretch into the known-gapless run.
 *
 * Two stretches join only if they touch or overlap. Otherwise there is
 * something between them that this device has never seen - a month away from
 * the app, a socket that was down - and the newer stretch replaces the run
 * rather than being welded onto it across the hole.
 *
 * Replacing rather than keeping the longer one is deliberate. The run has to
 * stay anchored to the newest end to mean anything, and the older stretch's
 * rows are not deleted: they stay on disk for the backup builder, and the next
 * page fetched will re-extend the run down through them.
 */
export function extendRun(run: RowRun | undefined, next: RowRun): RowRun {
  if (!run) return next;
  if (next.from > run.to || next.to < run.from) return next;
  return {
    from: run.from < next.from ? run.from : next.from,
    to: run.to > next.to ? run.to : next.to,
  };
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
 * theoretical case - it is what happens to every existing device the moment a
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

    // A database already at or above DB_VERSION but short a store - someone
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
 * of ten thousand - which is the entire reason for storing them separately.
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

/**
 * How many records fall in a range, without reading any of them.
 *
 * The completeness proof asks this once per conversation, and an account can
 * hold tens of thousands of rows. Counting by reading — the only thing the
 * helpers above could do — would decrypt every row to answer a question about
 * how many there are, which is the opposite of what the proof is for.
 */
export async function localCount(store: StoreName, range: IDBKeyRange): Promise<number> {
  const db = await openDatabase();
  if (!db) return 0;

  return new Promise<number>((resolve) => {
    try {
      const request = db.transaction(store, 'readonly').objectStore(store).count(range);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

/**
 * The keys in a range, without reading a value.
 *
 * Keys are deliberately plaintext, so this answers "what does this device
 * hold" without decrypting anything - the same reason `localCount` exists.
 */
export async function localKeys(store: StoreName, range?: IDBKeyRange): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys(range));
  return (keys ?? []).map(String);
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
 * discard the whole origin, taking the sealed cache, the outbox, and - because
 * they live in the same database - this device's keys. Losing keys silently is
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

/**
 * Wipes the account's cache. Called on sign-out - one device, one account.
 *
 * `media` is left alone, because it is not cache. What is in it is a display
 * setting that belongs to the device: the chat wallpaper, which has always
 * survived signing out - it lived in `localStorage` before it was large enough
 * to need a store - and which nobody asked to start losing.
 */
const KEEP_ON_SIGN_OUT: StoreName[] = [STORE.media];

export async function localClear(): Promise<void> {
  for (const name of Object.values(STORE)) {
    if (KEEP_ON_SIGN_OUT.includes(name)) continue;
    await withStore(name, 'readwrite', (s) => s.clear());
  }
}
