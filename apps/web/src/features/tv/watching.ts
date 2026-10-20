import { useSyncExternalStore } from 'react';

/**
 * "Watching on Pingo TV": what a friend is watching, right now.
 *
 * The same idea as "Listening on PINGO Music" (`music/listening.ts`), and the
 * same carrier: the title rides on the Realtime presence that lights the green
 * dot, as a `tv` field while the player is open. It is true for as long as the
 * socket and wrong forever after, so nothing is written to the database: close
 * the player or the app and it leaves everybody's screen by itself.
 *
 * Published only while activity status is on and the "Show what I'm watching"
 * switch (My List, on unless turned off) is on.
 *
 * ## What "watch along" can and cannot do
 *
 * The picture comes from third-party embedded players that give a page no
 * clock to read and no controls to drive, so this cannot hold two people at
 * the same second the way music can. Watch along puts a friend in the same
 * title, season and episode, follows them when they move on to the next one,
 * and leaves the play button to each of you.
 */

export interface Watching {
  /** Title. */
  n: string;
  /** movie or tv. */
  y: 'movie' | 'tv';
  /** TMDB id: enough to open the same title. */
  id: number;
  /** A small poster, https only. */
  i?: string;
  /** Season and episode, for a series. */
  s?: number;
  e?: number;
  /** Whom this person is watching along with, so two people do not follow each other in a circle. */
  w?: string;
}

const SHARE_KEY = 'pingo:tv-share-watching:v1';

export function shareWatchingOn(): boolean {
  try {
    return localStorage.getItem(SHARE_KEY) !== 'off';
  } catch {
    return true;
  }
}

const shareListeners = new Set<() => void>();
export function setShareWatching(on: boolean) {
  try {
    if (on) localStorage.removeItem(SHARE_KEY);
    else localStorage.setItem(SHARE_KEY, 'off');
  } catch {
    // Private mode: the switch holds for this visit.
  }
  shareListeners.forEach((fn) => fn());
  mineListeners.forEach((fn) => fn());
}

export function useShareWatching(): boolean {
  return useSyncExternalStore(
    (fn) => {
      shareListeners.add(fn);
      return () => {
        shareListeners.delete(fn);
      };
    },
    shareWatchingOn,
    shareWatchingOn,
  );
}

/* ---------- mine ---------- */

let mine: Watching | undefined;
const mineListeners = new Set<() => void>();

/** Set while the player is open; `undefined` when it closes. */
export function setMyWatching(w: Watching | undefined) {
  if (JSON.stringify(mine) === JSON.stringify(w)) return;
  mine = w;
  mineListeners.forEach((fn) => fn());
}

/** What this person is watching, to publish; nothing when it is switched off. */
export function myWatching(): Watching | undefined {
  return mine && shareWatchingOn() ? mine : undefined;
}

/** Calls `fn` when what this person is watching, or the switch, changes. */
export function watchMyWatching(fn: () => void): () => void {
  mineListeners.add(fn);
  return () => {
    mineListeners.delete(fn);
  };
}

/** A small poster for everybody online: TMDB's 92px, not the full one. */
export const smallPoster = (path: string | null | undefined) => (path ? `https://image.tmdb.org/t/p/w92${path}` : undefined);

/* ---------- friends ---------- */

const friends = new Map<string, Watching>();
const friendListeners = new Set<() => void>();

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined);

/** Reads somebody else's payload: drawn straight from another client, so nothing is trusted. */
export function parseWatching(raw: unknown): Watching | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const n = clip(r.n, 120);
  const id = int(r.id, 1e10);
  if (!n || id === undefined || (r.y !== 'movie' && r.y !== 'tv')) return undefined;
  const i = clip(r.i, 300);
  const s = int(r.s, 500);
  const e = int(r.e, 5000);
  const w = clip(r.w, 64);
  return {
    n,
    y: r.y,
    id,
    ...(/^https:\/\/image\.tmdb\.org\//.test(i) ? { i } : {}),
    ...(s ? { s } : {}),
    ...(e ? { e } : {}),
    ...(w ? { w } : {}),
  };
}

export function setFriendWatching(userId: string, w: Watching | undefined) {
  const cur = friends.get(userId);
  if (JSON.stringify(cur) === JSON.stringify(w)) return;
  if (w) friends.set(userId, w);
  else friends.delete(userId);
  friendListeners.forEach((fn) => fn());
}

export function clearFriendsWatching() {
  if (!friends.size) return;
  friends.clear();
  friendListeners.forEach((fn) => fn());
}

export const friendWatching = (userId: string) => friends.get(userId);

const subscribeFriends = (fn: () => void) => {
  friendListeners.add(fn);
  return () => {
    friendListeners.delete(fn);
  };
};

/** For code outside React (watching along) that follows a friend. */
export const watchFriendsWatching = subscribeFriends;

/** What this person is watching on Pingo TV, if anything. */
export function useWatching(userId: string | undefined): Watching | undefined {
  const get = () => (userId ? friends.get(userId) : undefined);
  return useSyncExternalStore(subscribeFriends, get, get);
}

/** "Dune: Part Two" or "Arcane · S1 E3" */
export const watchingLine = (w: Watching) => (w.y === 'tv' && w.s && w.e ? `${w.n} · S${w.s} E${w.e}` : w.n);

/** The route that opens exactly what they are watching. */
export const watchingPath = (w: Watching, along?: string) =>
  `/tv/watch/${w.y}/${w.id}?s=${w.s ?? 1}&e=${w.e ?? 1}${along ? `&along=${encodeURIComponent(along)}` : ''}`;

/** The full-page player for a title, optionally following a friend. */
export const watchPathFor = (type: 'movie' | 'tv', id: number, season = 1, episode = 1, along?: string) =>
  `/tv/watch/${type}/${id}?s=${season}&e=${episode}${along ? `&along=${encodeURIComponent(along)}` : ''}`;
