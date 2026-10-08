import { useSyncExternalStore } from 'react';

import { playerState, watchPlayer } from './player.js';

/**
 * "Listening on PINGO Music": what a friend is playing, right now.
 *
 * ## Carried by presence, not stored
 *
 * The song rides on the same Realtime presence that lights the green dot
 * (`lib/supabase/presence.ts`): the tracked payload gains a `music` field
 * while something is playing. It is true for minutes and wrong forever after,
 * exactly like "online", so it lives on the socket and goes when the socket
 * does. Nothing is written to the database, and closing the app or pausing
 * takes it away from everybody's screen on its own.
 *
 * ## Whose it is to share
 *
 * It is published only while activity status is on, and only while this
 * switch (Music settings, on unless turned off) is on. Turning either off
 * stops it within the same tap.
 *
 * Kept apart from the music app's own settings, which pull in the catalogue:
 * the presence hub loads at startup and should not carry PINGO Music with it.
 */

export interface Listening {
  /** Song. */
  n: string;
  /** Artist. */
  a: string;
  /** A small cover, https only. */
  i?: string;
  /*
   * What a friend needs to listen along (`listen-along.ts`): the song itself,
   * and where in it this person was, when.
   */
  /** The stream: JioSaavn's CDN or PINGO's own uploads, nothing else. */
  u?: string;
  /** JioSaavn's id: how a downloaded song, which plays from the phone, is found again. */
  d?: string;
  /** Seconds in, at `t`. */
  p?: number;
  /** When `p` was true, in epoch milliseconds. */
  t?: number;
  /** Length in seconds. */
  s?: number;
  /** Whom this person is listening along with, if anyone: two people cannot follow each other round in a circle. */
  w?: string;
}

/** Addresses a friend's phone may be asked to play. */
export const PLAYABLE = /^https:\/\/(([a-z0-9-]+\.)*saavncdn\.com|pingo-songs\.[a-z0-9-]+\.workers\.dev)\//i;

const SHARE_KEY = 'pingo:music-share-listening:v1';

export function shareListeningOn(): boolean {
  try {
    return localStorage.getItem(SHARE_KEY) !== 'off';
  } catch {
    return true;
  }
}

const shareListeners = new Set<() => void>();
export function setShareListening(on: boolean) {
  try {
    if (on) localStorage.removeItem(SHARE_KEY);
    else localStorage.setItem(SHARE_KEY, 'off');
  } catch {
    // Private mode: the switch holds for this visit.
  }
  shareListeners.forEach((fn) => fn());
  sayNow();
}

export function useShareListening(): boolean {
  return useSyncExternalStore(
    (fn) => {
      shareListeners.add(fn);
      return () => {
        shareListeners.delete(fn);
      };
    },
    shareListeningOn,
    shareListeningOn,
  );
}

/* ---------- mine ---------- */

/** A cover small enough to send to everybody online: JioSaavn's 50px, not its 500px. */
function smallCover(url: string | undefined): string | undefined {
  if (!url || !/^https:\/\//.test(url)) return undefined;
  return url.replace(/-(150x150|500x500)\./, '-50x50.');
}

let syncingWith: string | undefined;
/** Set by `listen-along.ts`, and said at once: it changes what this person's friends may do. */
export function setSyncingWith(userId: string | undefined) {
  if (syncingWith === userId) return;
  syncingWith = userId;
  if (watching) sayNow();
}

/** What this person is playing, to publish; nothing while paused, stopped or switched off. */
export function myListening(): Listening | undefined {
  const s = playerState();
  if (!s.song || !(s.playing || s.loading) || !shareListeningOn()) return undefined;
  const i = smallCover(s.song.img);
  const len = Math.round(s.length || s.song.secs || 0);
  return {
    n: s.song.name.slice(0, 80),
    a: s.song.artist.slice(0, 80),
    ...(i ? { i } : {}),
    ...(PLAYABLE.test(s.song.url) ? { u: s.song.url } : {}),
    ...(s.song.id ? { d: s.song.id } : {}),
    p: Math.round(s.at * 10) / 10,
    t: Date.now(),
    ...(len ? { s: len } : {}),
    ...(syncingWith ? { w: syncingWith } : {}),
  };
}

const mineListeners = new Set<() => void>();
/** What was last said, and what is waiting to be said once it settles. */
let lastKey = '';
let pendingKey = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let watching: (() => void) | undefined;
/** Where the song was when last said, to tell a seek from ordinary playing. */
let said: { p: number; t: number } | undefined;

const keyOf = (l: Listening | undefined) => (l ? `${l.n}|${l.a}|${l.d ?? l.u ?? ''}` : '');

/** Whether the song is no longer where the last word said it would be: somebody seeked. */
function jumped(): boolean {
  const s = playerState();
  if (!said || !s.playing) return false;
  const expected = said.p + ((Date.now() - said.t) / 1000) * (s.speed || 1);
  return Math.abs(s.at - expected) > 3;
}

/*
 * The player reports every few hundred milliseconds while it plays, so only a
 * change of answer restarts the wait; otherwise the clock would never run out.
 */
function settle() {
  const key = keyOf(myListening());
  if (key === pendingKey) {
    // Same song, moved within it: said once the dragging stops, so a friend listening along follows.
    if (!timer && key && key === lastKey && jumped()) timer = setTimeout(sayNow, 800);
    return;
  }
  pendingKey = key;
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (key === lastKey) return;
  timer = setTimeout(() => {
    timer = undefined;
    if (pendingKey === lastKey) return;
    lastKey = pendingKey;
    remember();
    mineListeners.forEach((l) => l());
  }, 1500);
}

function remember() {
  const s = playerState();
  said = { p: s.at, t: Date.now() };
}

/** Says it now: the switch was thrown, and a switch should answer at once. */
function sayNow() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  lastKey = pendingKey = keyOf(myListening());
  remember();
  mineListeners.forEach((l) => l());
}

/**
 * Calls `fn` when what this person is playing changes: a new song, a pause,
 * a stop. Settled for a moment first, so skipping through five songs is one
 * update and a buffering blip is none.
 */
export function watchMyListening(fn: () => void): () => void {
  mineListeners.add(fn);
  if (!watching) {
    lastKey = pendingKey = keyOf(myListening());
    remember();
    watching = watchPlayer(settle);
  }
  return () => {
    mineListeners.delete(fn);
    if (!mineListeners.size && watching) {
      watching();
      watching = undefined;
      if (timer) clearTimeout(timer);
      timer = undefined;
    }
  };
}

/* ---------- friends ---------- */

const friends = new Map<string, Listening>();
const friendListeners = new Set<() => void>();

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined);

/** Reads somebody else's payload: drawn straight from another client, so nothing is trusted. */
export function parseListening(raw: unknown): Listening | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const n = clip(r.n, 80);
  if (!n) return undefined;
  const i = clip(r.i, 300);
  const u = clip(r.u, 400);
  const d = clip(r.d, 40);
  const w = clip(r.w, 64);
  const p = num(r.p, 6 * 3600);
  const t = num(r.t, 8.64e15);
  const s = num(r.s, 6 * 3600);
  return {
    n,
    a: clip(r.a, 80),
    ...(/^https:\/\//.test(i) ? { i } : {}),
    ...(PLAYABLE.test(u) ? { u } : {}),
    ...(/^[A-Za-z0-9_-]{1,40}$/.test(d) ? { d } : {}),
    ...(p !== undefined && t !== undefined ? { p, t } : {}),
    ...(s ? { s } : {}),
    ...(w ? { w } : {}),
  };
}

export function setFriendListening(userId: string, l: Listening | undefined) {
  const cur = friends.get(userId);
  if (JSON.stringify(cur) === JSON.stringify(l)) return;
  if (l) friends.set(userId, l);
  else friends.delete(userId);
  friendListeners.forEach((fn) => fn());
}

/** What this person is playing right now, outside React. */
export const friendListening = (userId: string) => friends.get(userId);

/** For code outside React (listening along) that follows friends. */
export const watchFriends = (fn: () => void) => subscribeFriends(fn);

export function clearFriendsListening() {
  if (!friends.size) return;
  friends.clear();
  friendListeners.forEach((fn) => fn());
}

const subscribeFriends = (fn: () => void) => {
  friendListeners.add(fn);
  return () => {
    friendListeners.delete(fn);
  };
};

/** What this person is listening to on PINGO Music, if anything. */
export function useListening(userId: string | undefined): Listening | undefined {
  const get = () => (userId ? friends.get(userId) : undefined);
  return useSyncExternalStore(subscribeFriends, get, get);
}

/** "Kesariya · Arijit Singh" */
export const listeningLine = (l: Listening) => (l.a ? `${l.n} · ${l.a}` : l.n);
