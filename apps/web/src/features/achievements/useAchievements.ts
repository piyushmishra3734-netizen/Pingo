import { useEffect, useState } from 'react';

import { useEarnedBadges } from '../referrals/useEarnedBadges.js';
import {
  achievementById,
  hasTier,
  leadAchievement,
  type Achievement,
  type AchievementTier,
} from './registry.js';

/**
 * What these accounts have earned, in a shape the UI can draw.
 *
 * ## Built on the existing query, not beside it
 *
 * `useEarnedBadges` already collects every id a screen asks about into one
 * request and remembers the answer for the session. That batching is not an
 * optimisation here, it is the reason this feature is affordable at all: a
 * badge lookup per chat row is the exact shape of the problem that put this
 * project's egress at 286% of its plan. So this adds meaning on top of that
 * query and never makes one of its own.
 *
 * ## The rare layer is asked for by tier, never by name
 *
 * Callers ask `isMythic(id)`, not `badges.includes('mythic_pioneer')`. The
 * difference matters the day a second rare badge exists: every surface already
 * behaves correctly, because none of them knows which badge it is looking at.
 */
export interface AchievementView {
  /** Every achievement this account has earned, rare first. */
  all: (id?: string) => Achievement[];
  /** The one to show beside a name. Undefined for an ordinary account. */
  lead: (id?: string) => Achievement | undefined;
  /** Whether this account has anything in the rare tier. */
  isMythic: (id?: string) => boolean;
  /** Raw ids, for anything that needs them. */
  ids: (id?: string) => string[];
  /** When one badge was earned, ISO. Undefined if this account has not. */
  earnedAt: (badgeId: string, id?: string) => string | undefined;
  /**
   * The badge this account chose to wear, if it chose one.
   *
   * Separate from `lead` on purpose: `lead` always answers with something to
   * draw, and this answers whether the answer was a decision. The achievements
   * screen needs the second to know which tile to mark.
   */
  displayed: (id?: string) => string | undefined;
}

export function useAchievements(userIds: (string | undefined)[]): AchievementView {
  const badges = useEarnedBadges(userIds);
  const idsOf = (id?: string) => badges(id).map((b) => b.id);
  const displayedOf = (id?: string) => badges(id).find((b) => b.displayed)?.id;

  return {
    ids: idsOf,
    all: (id) => {
      const earned = idsOf(id);
      return earned.length === 0 ? [] : orderedFor(earned);
    },
    lead: (id) => leadAchievement(idsOf(id), displayedOf(id)),
    isMythic: (id) => hasTier(idsOf(id), 'mythic'),
    earnedAt: (badgeId, id) => badges(id).find((b) => b.id === badgeId)?.at,
    displayed: displayedOf,
  };
}

/** Earned achievements in the order a collection should read: rare first. */
function orderedFor(earnedIds: string[]): Achievement[] {
  const lead = leadAchievement(earnedIds);
  const rest = earnedIds
    .map((id) => achievementById(id))
    .filter((a): a is Achievement => !!a && a.id !== lead?.id);
  return lead ? [lead, ...rest] : rest;
}

/**
 * The signed-in account's own achievements, kept readable offline.
 *
 * ## Why this one is cached to disk and the others are not
 *
 * Everybody else's badges are a decoration on a row: if they have not arrived
 * yet, the row draws without them and nothing is lost. Your own drive the
 * profile you are looking at, the accent on it and whether the customisation
 * exists at all - and PINGO is local-first, so opening it on a plane must not
 * quietly demote you to an ordinary account.
 *
 * The cache is written whenever the server answers and read before it does, so
 * the first paint is already right and the network only ever confirms it. A
 * badge is never revoked, which is what makes a cache with no expiry honest
 * here rather than a shortcut.
 */
const OWN_CACHE_KEY = 'pingo:achievements:own';

export function useOwnAchievements(userId: string | undefined): AchievementView & {
  /** True once either the cache or the server has answered. */
  settled: boolean;
} {
  const view = useAchievements([userId]);
  const live = view.ids(userId);
  /*
   * Dates are not cached to disk, and deliberately.
   *
   * The cache exists so the first paint is already a rare account - a badge
   * beside a name, an aura on a profile. A date appears on one screen, below
   * the fold, after the query has answered anyway. Storing it would widen the
   * cache's shape and its migration surface to buy nothing anybody sees.
   */
  const earnedAt = (badgeId: string) => view.earnedAt(badgeId, userId);

  const liveDisplayed = view.displayed(userId);

  /** What disk said last time, so the first paint is not an ordinary account. */
  const [cached, setCached] = useState<Cached>(() => readCache(userId));
  const [settled, setSettled] = useState(() => readCache(userId).ids.length > 0);

  useEffect(() => {
    setCached(readCache(userId));
  }, [userId]);

  useEffect(() => {
    if (!userId || live.length === 0) return;
    const next: Cached = { ids: live, ...(liveDisplayed ? { displayed: liveDisplayed } : {}) };
    writeCache(userId, next);
    setCached(next);
    setSettled(true);
    // `live.join` rather than `live`: a new array with the same ids must not
    // rewrite storage on every render.
  }, [userId, live.join(','), liveDisplayed]);

  const ids = live.length > 0 ? live : cached.ids;
  /*
   * The choice is cached with the ids, and for the same reason.
   *
   * Without it the first paint after a launch falls back to "rare tier first",
   * so somebody who chose FOUNDER would watch MYTHIC PIONEER appear beside
   * their own name for a frame and then swap - on every launch, for exactly the
   * people who bothered to choose.
   */
  const displayed = live.length > 0 ? liveDisplayed : cached.displayed;

  return {
    settled: settled || live.length > 0,
    ids: () => ids,
    all: () => orderedFor(ids),
    lead: () => leadAchievement(ids, displayed),
    isMythic: () => hasTier(ids, 'mythic'),
    earnedAt,
    displayed: () => displayed,
  };
}

/** What the first paint reads off disk. */
interface Cached {
  ids: string[];
  displayed?: string;
}

/**
 * `localStorage`, not the IndexedDB store the rest of the cache uses.
 *
 * This is read during the first render of a profile, and IndexedDB is
 * asynchronous - reading it there would mean one frame as an ordinary account
 * followed by a pop into the rare one, on every launch, for exactly the people
 * who earned it. A few bytes of synchronous storage buys a first paint that is
 * already correct.
 */
const asIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Reads both shapes.
 *
 * This used to be a bare array of ids, and every launch on every device that
 * has run PINGO before still has one on disk. Treating it as `{ ids }` with no
 * choice is exactly right for it: nobody could have chosen before the column
 * existed, and the next answer from the server rewrites it in the new shape.
 */
function readCache(userId: string | undefined): Cached {
  if (!userId) return { ids: [] };
  try {
    const raw = localStorage.getItem(`${OWN_CACHE_KEY}:${userId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : undefined;
    if (Array.isArray(parsed)) return { ids: asIds(parsed) };

    const record = (parsed ?? {}) as { ids?: unknown; displayed?: unknown };
    return {
      ids: asIds(record.ids),
      ...(typeof record.displayed === 'string' ? { displayed: record.displayed } : {}),
    };
  } catch {
    return { ids: [] };
  }
}

function writeCache(userId: string, value: Cached): void {
  try {
    localStorage.setItem(`${OWN_CACHE_KEY}:${userId}`, JSON.stringify(value));
  } catch {
    // Private-mode Safari, or a full quota. The network answer still works for
    // this session; only the head start is lost.
  }
}

export type { Achievement, AchievementTier };
