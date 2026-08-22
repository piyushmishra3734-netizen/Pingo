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

/** user id → badge ids. Session-lived: unlocking is rare, revoking never happens. */
const known = new Map<string, string[]>();

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

  const { data } = await getSupabaseClient()
    .from('user_badges')
    .select('user_id,badge_id')
    .in('user_id', ids);

  // Everybody asked about gets an entry, including the empty ones - otherwise
  // a user with no badges is asked about again on every render for ever.
  for (const id of ids) known.set(id, known.get(id) ?? []);
  for (const row of (data ?? []) as { user_id: string; badge_id: string }[]) {
    known.set(row.user_id, [...(known.get(row.user_id) ?? []), row.badge_id]);
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
export function useEarnedBadges(userIds: (string | undefined)[]): (id?: string) => string[] {
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

/** The one badge this task is about, by the id the mission hands out. */
export const MYTHIC_PIONEER = 'mythic_pioneer';

/**
 * The state the future Mythic experience layer will read.
 *
 * Named as the brief asks for it - `hasBadge('MYTHIC_PIONEER')` - so the
 * animation, the chest and the sound can be built against something that
 * already exists and is already true.
 */
export function hasBadge(badges: string[], badgeId: string): boolean {
  return badges.includes(badgeId.toLowerCase());
}

/**
 * What the mission asks for, for the line under the badge.
 *
 * A profile says "Pioneer · 5 Friends", and the five has to come from the same
 * row Controlling edits - a number typed into the copy would be a second place
 * it lives, and it would still say five the day it becomes three.
 *
 * Read once per session and held: a mission requirement changes when an
 * operator decides it does, which is not often enough to ask again per profile.
 */
let requirement: number | undefined;
let requirementRead: Promise<void> | undefined;

export function useMissionRequirement(): number | undefined {
  const [, bump] = useState(0);

  useEffect(() => {
    if (requirement !== undefined) return;

    requirementRead ??= (async () => {
      const { data } = await getSupabaseClient()
        .from('missions')
        .select('required_count')
        .eq('kind', 'referral')
        .eq('enabled', true)
        .order('created_at')
        .limit(1);
      const row = (data ?? [])[0] as { required_count: number } | undefined;
      if (row) requirement = row.required_count;
    })().catch(() => undefined);

    let alive = true;
    void requirementRead.then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  return requirement;
}
