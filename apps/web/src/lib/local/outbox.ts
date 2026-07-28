import type { OutgoingMessage } from '@pingo/core';

import { STORE, localAll, localDelete, localSet } from './db.js';

/**
 * Messages written while offline, waiting to go.
 *
 * ## Why an outbox rather than a retry
 *
 * A failed send that only lives in React state is lost the moment the tab is
 * closed — and a message typed on a train, in a tunnel, is exactly the message
 * somebody assumes was sent. Persisting the intent is the difference between
 * "we will send this when we can" and "that never happened".
 *
 * ## Ordering is the whole design
 *
 * Entries carry the time they were queued and are flushed oldest first, one at
 * a time. Sending them in parallel would be faster and would deliver a
 * conversation out of order, which is worse than slow — the server stamps
 * `created_at` on arrival, so whatever order they land in is the order they are
 * read in forever.
 *
 * ## Sent once, or not at all
 *
 * An entry is deleted only after the send resolves. If the app dies mid-flush
 * the entry survives and is retried, which risks a duplicate; the alternative —
 * deleting first — risks silently losing the message. A duplicate is visible
 * and annoying, a loss is invisible and unrecoverable, so this errs toward the
 * one you can see.
 */

export interface OutboxEntry {
  /** Client-generated, so the optimistic bubble and the queue agree. */
  id: string;
  draft: OutgoingMessage;
  queuedAt: number;
  /** Bumped each time a flush fails, so a poisoned entry can be spotted. */
  attempts: number;
}

/**
 * How many times an entry is retried before it is set aside.
 *
 * Not infinite. A message the server refuses — a conversation the user was
 * removed from, a body that violates a constraint — would otherwise be retried
 * on every reconnect forever, blocking everything queued behind it.
 */
const MAX_ATTEMPTS = 5;

export async function enqueue(draft: OutgoingMessage): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    id: crypto.randomUUID(),
    draft,
    queuedAt: Date.now(),
    attempts: 0,
  };
  await localSet(STORE.outbox, entry.id, entry);
  return entry;
}

/** Everything waiting, oldest first. */
export async function pending(): Promise<OutboxEntry[]> {
  const all = await localAll<OutboxEntry>(STORE.outbox);
  return all
    .filter((entry) => entry.attempts < MAX_ATTEMPTS)
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function forget(id: string): Promise<void> {
  await localDelete(STORE.outbox, id);
}

async function fail(entry: OutboxEntry): Promise<void> {
  await localSet(STORE.outbox, entry.id, { ...entry, attempts: entry.attempts + 1 });
}

/**
 * Sends everything queued, in order, stopping at the first refusal.
 *
 * Stopping matters. If the network dropped again halfway through, every
 * remaining entry would fail too — and marking them all as attempted would burn
 * five reconnections' worth of retries on one bad moment. So a failure ends the
 * pass and the rest keep their attempts for next time.
 *
 * Returns how many actually went, so a caller can tell the difference between
 * "nothing was waiting" and "nothing could be sent".
 */
export async function flush(
  send: (draft: OutgoingMessage) => Promise<unknown>,
): Promise<number> {
  const queue = await pending();
  let sent = 0;

  for (const entry of queue) {
    try {
      await send(entry.draft);
      await forget(entry.id);
      sent += 1;
    } catch {
      await fail(entry);
      break;
    }
  }

  return sent;
}
