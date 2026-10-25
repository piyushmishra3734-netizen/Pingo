import { openRecord, sealRecord } from '../crypto/session.js';
import { STORE, localGet, localSet } from './db.js';

/**
 * The last good answer for a screen, kept on this device.
 *
 * PINGO is meant to work on a bad connection, and a screen that starts empty and
 * waits for the server is the opposite of that: opened offline it showed
 * "Loading activity" for ever, a profile showed blank counts and an empty post
 * grid, and none of it survived closing the app. These are the answers those
 * screens had the last time they reached the server, written to the same sealed
 * store as everything else on disk and read before the network is asked.
 *
 * A screen shows what is kept at once and replaces it when the fresh answer
 * arrives; a failed fetch leaves it where it is instead of blanking it. Keyed by
 * account, so the next person to sign in on this device never sees it, and
 * dropped with the rest of the local data on sign-out and on "Clear cache".
 *
 * Best effort by design: a failed read is "nothing kept", a failed write is a
 * missed save, and neither is ever an error on screen.
 */

const keyOf = (userId: string, name: string) => `kept:${userId}:${name}`;

/** What was last kept under this name for this account, if anything. */
export async function readKept<T>(userId: string | undefined, name: string): Promise<T | undefined> {
  if (!userId) return undefined;
  try {
    return await openRecord<T>(await localGet<unknown>(STORE.meta, keyOf(userId, name)));
  } catch {
    return undefined;
  }
}

/** Remembers this answer for next time. Never throws. */
export function keepAnswer(userId: string | undefined, name: string, value: unknown): void {
  if (!userId) return;
  void sealRecord(value)
    .then((sealed) => localSet(STORE.meta, keyOf(userId, name), sealed))
    .catch(() => undefined);
}
