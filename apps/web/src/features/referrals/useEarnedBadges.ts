import { useEffect, useState } from 'react';

import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * Who has which server-earned badge, asked once for everybody at a time.
 *
 * ## Why this is not a query per row
 *
 * A chat list draws sixty names and a group draws twenty, and the obvious
 * implementation asks the server about each one as it renders. That is the
 * exact shape of the problem that put this project's egress at 286% of its
 * plan: a small request per row, on every render, for something that changes
 * about once in an account's lifetime.
 *
 * So ids are collected, asked for in one query, and remembered for the session.
 * A badge is unlocked once and never revoked, which is what makes a cache with
 * no expiry the honest choice rather than a shortcut - there is no staleness to
 * manage, only an arrival, and the owner's own unlock refreshes through
 * `refreshEarnedBadges`.
 */

/** One earned badge: which, when, and whether it is the one on show. */
export interface EarnedBadge {
  id: string;
  /** ISO, from `user_badges.unlocked_at`. */
  at: string;
  /**
   * The badge this account wears beside its name.
   *
   * Server-side and public, because the chat list draws *other people's*
   * badges - a local preference could only ever be right on one device and for
   * one viewer. At most one per account; all false means fall back to the
   * registry order.
   */
  displayed: boolean;
}

/** user id → badges. Session-lived: unlocking is rare, revoking never happens. */
const known = new Map<string, EarnedBadge[]>();

/** Ids asked for but not yet answered, so a burst of rows becomes one query. */
let pending = new Set<string>();
let inFlight: Promise<void> | undefined;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

async function flush(): Promise<void> {
  const ids = [...pending];
  pending = new Set();
  if (ids.length === 0) return;

  /*
   * `unlocked_at` rides along in the same select. It costs one more column on a
   * query that already runs, and it is what lets a badge say when it was earned
   * rather than only that it was - which is the difference between a record and
   * a flag.
   */
  const { data } = await getSupabaseClient()
    .from('user_badges')
    .select('user_id,badge_id,unlocked_at,displayed')
    .in('user_id', ids);

  // Everybody asked about gets an entry, including the empty ones - otherwise
  // a user with no badges is asked about again on every render for ever.
  for (const id of ids) known.set(id, known.get(id) ?? []);
  for (const row of (data ?? []) as {
    user_id: string;
    badge_id: string;
    unlocked_at: string;
    displayed: boolean;
  }[]) {
    known.set(row.user_id, [
      ...(known.get(row.user_id) ?? []),
      { id: row.badge_id, at: row.unlocked_at, displayed: row.displayed === true },
    ]);
  }

  announce();
}

function request(ids: string[]): void {
  let added = false;
  for (const id of ids) {
    if (!id || known.has(id) || pending.has(id)) continue;
    pending.add(id);
    added = true;
  }
  if (!added || inFlight) return;

  /*
   * A microtask, not a timer: every row of a list renders in the same tick, so
   * this collects the whole screen and asks once - without adding a delay
   * anybody could see.
   */
  inFlight = Promise.resolve()
    .then(flush)
    .catch(() => undefined)
    .finally(() => {
      inFlight = undefined;
      if (pending.size > 0) request([]);
    });
}

/** Drops what is remembered about one account, so the next render re-asks. */
export function refreshEarnedBadges(userId?: string): void {
  if (userId) known.delete(userId);
  else known.clear();
  announce();
}

/**
 * The badges these accounts have earned on the server.
 *
 * Returns a lookup rather than a list so a caller can ask about one id without
 * caring whether the answer has arrived - an unknown account reads as "no
 * badges", which is what should be drawn while the query is in flight anyway.
 */
export function useEarnedBadges(userIds: (string | undefined)[]): (id?: string) => EarnedBadge[] {
  const key = userIds.filter(Boolean).sort().join(',');
  const [, bump] = useState(0);

  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    request(key ? key.split(',') : []);
    return () => {
      listeners.delete(listener);
    };
  }, [key]);

  return (id?: string) => (id ? (known.get(id) ?? []) : []);
}
