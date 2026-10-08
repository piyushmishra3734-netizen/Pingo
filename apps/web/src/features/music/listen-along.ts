import { useSyncExternalStore } from 'react';

import { friendListening, setSyncingWith, watchFriends, type Listening } from './listening.js';
import { musicPlayer, playerState, watchPlayer } from './player.js';
import type { SharedSong } from './song-share.js';

/**
 * Listening along: a friend's song, playing here, in step with them.
 *
 * Built entirely on what their presence already says (`listening.ts`): the
 * song, and where in it they were at what moment. Nothing new on the server.
 * Their phone says it again on a new song, a pause, a resume and a seek, and
 * this follows each one: the same song, at the same second, give or take the
 * second it takes to arrive.
 *
 * ## When it stops
 *
 * Only when the person says so: "Stop" on the card in the chat, or closing
 * the player. Pausing, or playing something else for a moment, does not; the
 * friend's next song, resume or seek brings this back in step. It is kept
 * across a restart too (`restoreListenAlong`), and the friend pausing or going
 * quiet only makes it wait.
 */

interface Sync {
  userId: string;
  name: string;
}

let sync: Sync | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** The song this is playing for them, to tell it from one chosen here. */
let playing: { key: string; url: string } | undefined;
/** Set while this module is the one moving the player, so its own moves are not read as the person's. */
let steering = false;
let stopFriends: (() => void) | undefined;
let stopPlayer: (() => void) | undefined;
/** Each follow is numbered: a slow lookup for an old song must not land after a newer one. */
let turn = 0;

const keyOf = (l: Listening) => `${l.n}|${l.a}|${l.d ?? l.u ?? ''}`;

/** JioSaavn's 50px cover, sent to keep presence small, asked for at 500px for the player. */
const bigCover = (i: string | undefined) => (i ? i.replace(/-50x50\./, '-500x500.') : '');

/** Where they are now: where they were, plus the time since. */
function positionOf(l: Listening): number {
  if (l.p === undefined || l.t === undefined) return 0;
  const at = l.p + Math.max(0, Date.now() - l.t) / 1000;
  return l.s ? Math.min(at, Math.max(0, l.s - 1)) : at;
}

async function addressOf(l: Listening): Promise<string | undefined> {
  if (l.u) return l.u;
  if (!l.d) return undefined;
  // Their copy plays from their phone; this one streams the same song from JioSaavn.
  const api = await import('./saavn/api.js');
  const song = await api.song(l.d).catch(() => undefined);
  return song ? api.streamUrl(song) : undefined;
}

function steer(run: () => void) {
  steering = true;
  try {
    run();
  } finally {
    // The player reports its pause and play a moment later; still ours then.
    setTimeout(() => {
      steering = false;
    }, 400);
  }
}

/** Their last word that was acted on: any friend's news wakes this, and only theirs matters. */
let seen: Listening | undefined | null = null;

async function follow(again = false) {
  if (!sync) return;
  const l = friendListening(sync.userId);
  if (!again && l === seen) return;
  seen = l;
  const mine = ++turn;

  // They paused, or went quiet: so does this, and waits for them.
  if (!l) {
    // Only their song: something the person put on meanwhile is theirs to stop.
    const s = playerState();
    if (s.playing && playing && s.song?.url === playing.url) steer(() => musicPlayer.pause());
    return;
  }

  const key = keyOf(l);
  if (playing?.key === key && playerState().song?.url === playing.url) {
    const s = playerState();
    const want = positionOf(l);
    steer(() => {
      if (Math.abs(s.at - want) > 2.5) musicPlayer.seek(want);
      if (!s.playing && !s.loading) void musicPlayer.resume();
    });
    return;
  }

  const url = await addressOf(l);
  if (mine !== turn || !sync) return;
  if (!url) return;
  const song: SharedSong = { name: l.n, artist: l.a, img: bigCover(l.i), url, secs: l.s ?? 0, ...(l.d ? { id: l.d } : {}) };
  playing = { key, url };
  steer(() => {
    void musicPlayer.play(song);
    musicPlayer.seek(positionOf(l));
  });
  // Looked at again once the song has had time to start: buffering costs seconds they kept playing through.
  setTimeout(() => {
    if (mine === turn) void follow(true);
  }, 2500);
}

/** Closing the player is the one thing besides "Stop" that ends it: that is the person turning music off. */
function onPlayer() {
  if (!sync || steering) return;
  if (!playerState().song) stopListeningAlong();
}

const KEY = 'pingo:listen-along:v1';
function keep(value: Sync | undefined) {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: it holds until the app closes.
  }
}

/** Picks up where it was before the app closed. Called once at startup. */
export function restoreListenAlong() {
  if (sync) return;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Sync | null;
    if (saved?.userId && typeof saved.name === 'string') listenAlong(saved.userId, saved.name);
  } catch {
    // Nothing kept, or nothing readable: nothing to pick up.
  }
}

export function listenAlong(userId: string, name: string) {
  if (sync?.userId === userId) return;
  stopListeningAlong();
  sync = { userId, name };
  seen = null;
  keep(sync);
  setSyncingWith(userId);
  stopFriends = watchFriends(() => void follow());
  stopPlayer = watchPlayer(onPlayer);
  emit();
  void follow();
}

export function stopListeningAlong() {
  if (!sync) return;
  sync = undefined;
  playing = undefined;
  keep(undefined);
  turn++;
  stopFriends?.();
  stopPlayer?.();
  stopFriends = stopPlayer = undefined;
  setSyncingWith(undefined);
  emit();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const snap = () => sync;

/** Whom this person is listening along with, if anyone. */
export function useListenAlong(): Sync | undefined {
  return useSyncExternalStore(subscribe, snap, snap);
}
