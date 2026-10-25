import { useSyncExternalStore } from 'react';

/**
 * PINGO lock: the whole app behind the PIN.
 *
 * Separate from locked chats on purpose. The PIN is the same one (a device has
 * one), but opening the app does not open the locked chats, and unlocking a chat
 * does not unlock the app. Nothing here touches the lock list.
 *
 * ## What is kept, and where
 *
 * One small record on this device: whether the lock is on, for which account,
 * and how long the app may be left before it asks again. It is read
 * synchronously when this file loads, so a cold start is locked from the first
 * frame and the app is never drawn before the pad. A different account signing
 * in on the same device is not locked by somebody else's setting.
 *
 * ## When it asks
 *
 * On every cold start. After that, when the app comes back to the front after
 * being away longer than the chosen delay. "Right away" still allows a few
 * seconds, because a photo picker, a permission prompt or a call screen takes
 * the app out of the front for a moment and locking in the middle of those would
 * make the app unusable.
 */

export type AppLockDelay = 0 | 60 | 300;

interface Stored {
  uid: string;
  delay: AppLockDelay;
}

const KEY = 'pingo:applock';
/** "Right away" is this long, in milliseconds. */
const GRACE_MS = 5_000;

function read(): Stored | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : undefined;
  } catch {
    return undefined;
  }
}

function write(value: Stored | undefined): void {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: the lock lasts until the page closes at best.
  }
}

interface State {
  /** The account the lock belongs to, when it is on. */
  uid: string | undefined;
  delay: AppLockDelay;
  locked: boolean;
}

const saved = read();
let state: State = { uid: saved?.uid, delay: saved?.delay ?? 60, locked: Boolean(saved) };
const listeners = new Set<() => void>();

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The lock for this account, or nothing: another account's setting does not apply. */
export function appLockFor(uid: string | undefined): { on: boolean; delay: AppLockDelay; locked: boolean } {
  const on = Boolean(uid && state.uid === uid);
  return { on, delay: state.delay, locked: on && state.locked };
}

export function useAppLock(uid: string | undefined): { on: boolean; delay: AppLockDelay; locked: boolean } {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  const on = Boolean(uid && snapshot.uid === uid);
  return { on, delay: snapshot.delay, locked: on && snapshot.locked };
}

/** Turns the lock on. The caller has made sure there is a PIN. The person is already in, so it starts unlocked. */
export function enableAppLock(uid: string, delay: AppLockDelay = state.delay): void {
  write({ uid, delay });
  set({ uid, delay, locked: false });
}

export function disableAppLock(): void {
  write(undefined);
  set({ uid: undefined, locked: false });
}

export function setAppLockDelay(delay: AppLockDelay): void {
  if (state.uid) write({ uid: state.uid, delay });
  set({ delay });
}

export function unlockApp(): void {
  set({ locked: false });
}

let hiddenAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    if (!state.uid || !hiddenAt) return;
    const away = Date.now() - hiddenAt;
    hiddenAt = 0;
    if (away > Math.max(state.delay * 1000, GRACE_MS)) set({ locked: true });
  });
}
