/**
 * What you sent, in your own words.
 *
 * `openRow` decrypts every row it reads - including ones sealed by this very
 * device. When the seal predates this device's publish (new phone, failed
 * publish, restored backup), the envelope holds no wrap for the current
 * identity and your own message reads back as "Sent before you added this
 * device." The fix is to not ask cryptography a question you already know the
 * answer to: you typed it, so the plaintext is remembered at send time and
 * served back on every later read without touching a key.
 *
 * Memory-first: rows are opened dozens at a time, and an IndexedDB read per
 * row would tax every thread open. The whole store is small (capped below),
 * so it is primed once per tab into a Map and read synchronously after that.
 * A hit means this device wrote it, which is the entire authorship check -
 * nothing else ever writes here.
 */

import { STORE, localDelete, localEntries, localSet } from './db.js';

/** Enough for months of sends; text is light. Older entries fall off first. */
const MAX_ENTRIES = 3000;

interface Entry {
  body: string;
  at: number;
}

const memory = new Map<string, Entry>();
let primed: Promise<void> | undefined;

async function prime(): Promise<void> {
  if (!primed) {
    primed = (async () => {
      try {
        const pairs = await localEntries<Entry>(STORE.sentText).catch(() => []);
        // Newest wins the cap: entries carry their own clock.
        const ordered = [...pairs].sort((a, b) => a[1].at - b[1].at);
        for (const [id, entry] of ordered.slice(-MAX_ENTRIES)) {
          if (entry && typeof entry.body === 'string') memory.set(id, entry);
        }
      } catch {
        // An unreadable store degrades to decrypt-as-usual, never to a throw.
      }
    })();
  }
  return primed;
}

export async function rememberOwnText(id: string, body: string): Promise<void> {
  if (!body) return;
  const entry: Entry = { body, at: Date.now() };
  memory.set(id, entry);
  if (memory.size > MAX_ENTRIES) {
    const oldest = memory.keys().next();
    if (!oldest.done) {
      memory.delete(oldest.value);
      void localDelete(STORE.sentText, oldest.value).catch(() => undefined);
    }
  }
  void localSet(STORE.sentText, id, entry).catch(() => undefined);
}

/** The plaintext you sent under this id, or undefined. Never throws. */
export async function ownText(id: string): Promise<string | undefined> {
  const hit = memory.get(id);
  if (hit) return hit.body;
  await prime();
  return memory.get(id)?.body;
}

/** Dropped with the rest of the account's content on sign-out and switch. */
export function forgetOwnTexts(): void {
  memory.clear();
  primed = undefined;
}
