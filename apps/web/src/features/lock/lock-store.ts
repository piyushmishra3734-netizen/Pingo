import { useSyncExternalStore } from 'react';

import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * Locked chats, from this device's side.
 *
 * Two separate things live here, on purpose:
 *
 *   - WHICH chats are locked is the account's: a row in `locked_chats`, so a
 *     chat locked on one phone is locked on the next one too.
 *   - THE PIN is the device's. It is never sent anywhere. Only a salted
 *     PBKDF2 hash is kept, in this browser's storage, under the account's id.
 *
 * A PIN that left the device would be a password somebody could read from a
 * database; a lock list that stayed on one device would unlock itself on every
 * other. Each lives where it is safe.
 *
 * ## What "unlocked" means
 *
 * A session, not a setting: unlocked for a few minutes, and put back by leaving
 * the app for half a minute. It is memory only, so a reload locks everything.
 */

type Reply<T> = Promise<{ data: T | null; error: { message: string } | null }>;
interface Loose {
  from: (table: string) => {
    select: (cols: string) => Reply<{ conversation_id: string }[]>;
    insert: (rows: { user_id: string; conversation_id: string }[]) => Reply<unknown>;
    delete: () => { eq: (c: string, v: string) => { in: (c: string, v: string[]) => Reply<unknown> } };
  };
}
const db = () => getSupabaseClient() as unknown as Loose;

/** Unlocked for this long, refreshed whenever a locked screen is used. */
const UNLOCK_MS = 5 * 60_000;
/** Away from the app this long and it locks again. */
const AWAY_MS = 30_000;
export const PIN_LENGTH = 6;

// ---------------------------------------------------------------- the lock list

interface Snapshot {
  ids: ReadonlySet<string>;
  loaded: boolean;
  /** When the session ends; 0 means locked. */
  unlockedUntil: number;
}

let state: Snapshot = { ids: new Set(), loaded: false, unlockedUntil: 0 };
let userId: string | undefined;
const listeners = new Set<() => void>();

function set(next: Partial<Snapshot>): void {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

async function me(): Promise<string | undefined> {
  if (userId) return userId;
  userId = (await getSupabaseClient().auth.getUser()).data.user?.id;
  return userId;
}

let loading: Promise<void> | undefined;
/** Read the account's locked chats, once per session of the app. */
export function loadLocks(): Promise<void> {
  loading ??= (async () => {
    const uid = await me();
    if (!uid) {
      loading = undefined;
      return;
    }
    const { data } = await db().from('locked_chats').select('conversation_id');
    set({ ids: new Set((data ?? []).map((r) => r.conversation_id)), loaded: true });
  })().catch(() => {
    loading = undefined;
  });
  return loading;
}

/** Forget everything about the account that just left, so the next one starts clean. */
export function resetLocks(): void {
  loading = undefined;
  userId = undefined;
  state = { ids: new Set(), loaded: false, unlockedUntil: 0 };
  listeners.forEach((fn) => fn());
}

export async function lockChats(ids: string[]): Promise<void> {
  const uid = await me();
  if (!uid || !ids.length) return;
  const before = state.ids;
  set({ ids: new Set([...before, ...ids]) });
  const { error } = await db().from('locked_chats').insert(ids.map((conversation_id) => ({ user_id: uid, conversation_id })));
  if (error && !/duplicate/i.test(error.message)) {
    set({ ids: before });
    throw new Error('Could not lock that chat.');
  }
}

export async function unlockChats(ids: string[]): Promise<void> {
  const uid = await me();
  if (!uid || !ids.length) return;
  const before = state.ids;
  set({ ids: new Set([...before].filter((id) => !ids.includes(id))) });
  const { error } = await db().from('locked_chats').delete().eq('user_id', uid).in('conversation_id', ids);
  if (error) {
    set({ ids: before });
    throw new Error('Could not unlock that chat.');
  }
}

/** Whether a chat is locked right now, for code that is not a component. */
export const isLockedNow = (id: string): boolean => state.ids.has(id);

/** The ids of the locked chats, re-rendering when they change. */
export function useLockedIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => state.ids, () => state.ids);
}

// ---------------------------------------------------------------- the session

export const isUnlocked = (): boolean => Date.now() < state.unlockedUntil;

export function unlockSession(): void {
  set({ unlockedUntil: Date.now() + UNLOCK_MS });
}
/** Keep the session going while a locked screen is in use. */
export function touchSession(): void {
  if (isUnlocked()) state = { ...state, unlockedUntil: Date.now() + UNLOCK_MS };
}
export function relock(): void {
  set({ unlockedUntil: 0 });
}

/** Whether the session is open, re-rendering the moment it closes. */
export function useUnlocked(): boolean {
  return useSyncExternalStore(subscribe, () => isUnlocked(), () => false);
}

let hiddenAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) relock();
  });
}

// ---------------------------------------------------------------- the PIN

interface StoredPin {
  salt: string;
  hash: string;
  iterations: number;
}
const ITERATIONS = 150_000;
const pinKey = (uid: string) => `pingo:lock:pin:${uid}`;
const tryKey = (uid: string) => `pingo:lock:tries:${uid}`;

const toHex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string): Uint8Array<ArrayBuffer> => new Uint8Array((hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)));

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}
function write(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the PIN lasts until the page closes at best.
  }
}

export async function hasPin(): Promise<boolean> {
  const uid = await me();
  return Boolean(uid && read<StoredPin>(pinKey(uid)));
}

export async function createPin(pin: string): Promise<void> {
  const uid = await me();
  if (!uid) throw new Error('Sign in first.');
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  write(pinKey(uid), { salt: toHex(salt), hash: await derive(pin, salt, ITERATIONS), iterations: ITERATIONS } satisfies StoredPin);
  write(tryKey(uid), undefined);
}

export type PinResult = { ok: true } | { ok: false; wait: number };

/**
 * Checks a PIN. Wrong answers slow down: five in a row and the pad waits 30
 * seconds, then a minute, then longer, so a thumb cannot grind through a
 * million combinations.
 */
export async function checkPin(pin: string): Promise<PinResult> {
  const uid = await me();
  const stored = uid ? read<StoredPin>(pinKey(uid)) : undefined;
  if (!uid || !stored) return { ok: false, wait: 0 };

  const tries = read<{ count: number; until: number }>(tryKey(uid)) ?? { count: 0, until: 0 };
  if (Date.now() < tries.until) return { ok: false, wait: Math.ceil((tries.until - Date.now()) / 1000) };

  const hash = await derive(pin, fromHex(stored.salt), stored.iterations);
  if (hash === stored.hash) {
    write(tryKey(uid), undefined);
    return { ok: true };
  }
  const count = tries.count + 1;
  const wait = count >= 5 ? Math.min(30 * 2 ** Math.floor((count - 5) / 5), 600) : 0;
  write(tryKey(uid), { count, until: wait ? Date.now() + wait * 1000 : 0 });
  return { ok: false, wait };
}

/** How long the pad is still waiting from earlier wrong answers, in seconds. */
export async function pinWait(): Promise<number> {
  const uid = await me();
  const tries = uid ? read<{ until: number }>(tryKey(uid)) : undefined;
  return tries && Date.now() < tries.until ? Math.ceil((tries.until - Date.now()) / 1000) : 0;
}

/** Forgotten: gone from this device. The account's lock list stays; a new PIN is asked for next time. */
export async function clearPin(): Promise<void> {
  const uid = await me();
  if (!uid) return;
  write(pinKey(uid), undefined);
  write(tryKey(uid), undefined);
  relock();
}
