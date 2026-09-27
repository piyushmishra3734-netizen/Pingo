import { useSyncExternalStore } from 'react';

/**
 * Who this account has blocked, known on the device.
 *
 * The `blocks` table records a block and nothing on the server acts on it, so
 * blocking somebody used to change nothing you could see: their messages kept
 * arriving, their calls rang, their stories sat in the tray. This is what the
 * app enforces the block with, on the blocker's side, the way WhatsApp does:
 *
 * - their new messages are dropped before they reach a thread, the list, a
 *   banner or a sound - their side still sends, and is not told;
 * - their calls are declined without ringing;
 * - their stories leave the tray;
 * - a chat with them shows "You blocked …" instead of the composer.
 *
 * What was said before the block stays, as it does on WhatsApp: `since` is
 * when the block began, and only messages after it are hidden.
 *
 * Kept in localStorage so it holds from the first frame and offline, and
 * refreshed from the server (`syncBlocks`) whenever the app opens.
 */

const KEY = 'pingo:blocked-v1';

type Entry = { id: string; since: number };

let entries = new Map<string, number>(read());
const listeners = new Set<() => void>();

function read(): [string, number][] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Entry[];
    return raw.filter((e) => typeof e?.id === 'string').map((e) => [e.id, Number(e.since) || 0]);
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify([...entries].map(([id, since]) => ({ id, since }))));
  } catch {
    /* private mode: holds for this session */
  }
  listeners.forEach((fn) => fn());
}

export function isBlocked(userId: string | undefined): boolean {
  return !!userId && entries.has(userId);
}

/** When the block began, epoch ms - or undefined when not blocked. */
export function blockedSince(userId: string | undefined): number | undefined {
  return userId ? entries.get(userId) : undefined;
}

/** Whether a message from `authorId`, sent at `at`, is one the block hides. */
export function hiddenByBlock(authorId: string | undefined, at: number): boolean {
  const since = blockedSince(authorId);
  return since !== undefined && at >= since;
}

export function setBlockedHere(userId: string, blocked: boolean, since = Date.now()) {
  if (blocked === entries.has(userId)) return;
  if (blocked) entries.set(userId, since);
  else entries.delete(userId);
  save();
}

/** The server's list replaces the device's. */
export function replaceBlocks(list: Entry[]) {
  entries = new Map(list.map((e) => [e.id, e.since]));
  save();
}

export function onBlocksChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Forget everything, on sign-out: the next account's blocks are its own. */
export function clearBlocks() {
  entries = new Map();
  save();
}

/**
 * Refresh the list from the server. Called when the app opens signed in; a
 * failure keeps the device's list, which is the safe direction to be wrong in.
 */
export async function syncBlocks(): Promise<void> {
  try {
    const { getSupabaseClient } = await import('../../lib/supabase/client.js');
    const client = getSupabaseClient();
    const { data: auth } = await client.auth.getUser();
    const me = auth.user?.id;
    if (!me) return;
    const { data, error } = await client.from('blocks').select('blocked_id, created_at').eq('blocker_id', me);
    if (error || !data) return;
    replaceBlocks(data.map((r) => ({ id: r.blocked_id, since: Date.parse(r.created_at) || 0 })));
  } catch {
    /* offline, or no backend: keep what the device knows */
  }
}

/** Whether `userId` is blocked, kept current as blocks change. */
export function useIsBlocked(userId: string | undefined): boolean {
  return useSyncExternalStore(onBlocksChange, () => isBlocked(userId), () => false);
}
