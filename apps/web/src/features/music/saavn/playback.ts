import { useSyncExternalStore } from 'react';

import { musicPlayer, playerState, setQueueControls, watchPlayer } from '../player.js';
import type { SharedSong } from '../song-share.js';
import * as api from './api.js';
import { currentTaste, recordPlay, type Kept } from './library.js';
import * as Q from './queue.js';
import type { Song } from './types.js';

/**
 * PINGO Music's playback: the queue, wired to the one app-wide player.
 *
 * `player.ts` plays a single song (it is also what plays a song card in a
 * chat). This adds what a music app needs on top: a queue that moves on by
 * itself, radio that never runs dry, shuffle and repeat, "play next", the
 * phone's next/previous buttons, and a record of what was listened to (which
 * is what "for you" is built from).
 *
 * Anything that plays music in PINGO Music calls one of the `play*` functions
 * here; nothing else touches the queue.
 */

let queue: Q.QueueState = Q.empty();
/** The quality setting, for `streamUrl`. */
let quality: 'auto' | 'high' | 'normal' | 'saver' = 'auto';
const listeners = new Set<() => void>();
let refilling = false;
/** The song the player was last given by the queue, to tell its songs from a chat card's. */
let playingUrl: string | undefined;

function setQueue(next: Q.QueueState) {
  queue = next;
  listeners.forEach((l) => l());
}

const toShared = (s: Song, url: string): SharedSong => ({ name: s.name, artist: api.artistNames(s), img: s.image, url, secs: s.secs });

/* ---------- listening record ---------- */

/** Records the song that was playing before a change: finished if it got to 90 percent. */
function recordOutgoing(ended: boolean) {
  const cur = Q.current(queue);
  const p = playerState();
  if (!cur || !p.song || p.song.url !== playingUrl) return;
  // Under ten seconds is a skip past, not a listen: it says nothing either way.
  if (!ended && p.at < 10) return;
  const length = p.length || cur.secs || 1;
  recordPlay(cur, ended || p.at / length >= 0.9);
}

/* ---------- playing the current song ---------- */

async function withStream(s: Song): Promise<Song> {
  if (api.streamUrl(s, quality)) return s;
  // A song kept in the library or found by autocomplete carries no address: look it up.
  return (await api.song(s.id)) ?? s;
}

async function playCurrent() {
  const cur = Q.current(queue);
  if (!cur) return;
  const full = await withStream(cur);
  const url = api.streamUrl(full, quality);
  if (!url) {
    // Not streamable (rights): skip it rather than stop the music.
    if (!Q.atEnd(queue)) {
      setQueue(Q.next(queue));
      void playCurrent();
    }
    return;
  }
  if (full !== cur) setQueue({ ...queue, items: queue.items.map((s) => (s.id === full.id ? full : s)) });
  playingUrl = url;
  setQueueControls(controls);
  void musicPlayer.play(toShared(full, url));
  void refill();
  prefetchNext();
}

/** The next song's address, looked up ahead so it starts the moment this one ends. */
function prefetchNext() {
  const next = Q.upcoming(queue, 1)[0];
  if (next && !api.streamUrl(next, quality)) api.prefetch(`/songs/${encodeURIComponent(next.id)}`);
}

/** Tops a radio queue up from its JioSaavn station before it runs out. */
async function refill() {
  if (refilling || !Q.wantsMore(queue)) return;
  refilling = true;
  try {
    let more: Song[] = [];
    let stationId = queue.stationId;
    if (stationId) more = await api.stationNext(stationId, 8).catch(() => []);
    if (!more.length) {
      // No station yet, or it dried up: seed a new one from the last few songs.
      const seeds = queue.order.slice(Math.max(0, queue.at - 2), queue.at + 1).map((i) => queue.items[i]!.id);
      const st = await api.songRadio(seeds, 10).catch(() => undefined);
      stationId = st?.stationId;
      more = st?.songs ?? [];
    }
    if (more.length) setQueue(Q.extend(queue, more, stationId));
  } finally {
    refilling = false;
  }
}

const controls = {
  next(auto: boolean) {
    recordOutgoing(auto);
    if (Q.atEnd(queue)) {
      if (auto) musicPlayer.pause();
      return;
    }
    const before = queue.at;
    setQueue(Q.next(queue, auto));
    // Repeat-one: the same song again from the top.
    if (queue.at === before) musicPlayer.seek(0);
    void playCurrent();
  },
  prev() {
    const r = Q.prev(queue, playerState().at);
    if (r.restart) {
      musicPlayer.seek(0);
      return;
    }
    recordOutgoing(false);
    setQueue(r.q);
    void playCurrent();
  },
};

/*
 * The player was given a song that is not this queue's (a song card in a
 * chat), or was closed: the queue steps aside, and the phone's next/previous
 * buttons stop pointing at it.
 */
if (typeof window !== 'undefined') {
  watchPlayer(() => {
    const p = playerState();
    if (!queue.items.length) return;
    if (!p.song || (playingUrl && p.song.url !== playingUrl)) {
      playingUrl = undefined;
      setQueueControls(undefined);
      setQueue(Q.empty());
    }
  });
}

/* ---------- what screens call ---------- */

/** Plays a list from one song: an album, a playlist, search results, liked songs. */
export function playList(songs: Song[], index: number, source: Q.QueueSource) {
  recordOutgoing(false);
  setQueue(Q.start(queue, songs, index, source));
  void playCurrent();
}

/** One song, then JioSaavn's radio from it: "play this and keep going". */
export function playSong(song: Song, label = song.name) {
  playList([song], 0, { kind: 'song', label, id: song.id });
}

/** A JioSaavn featured station (moods, eras, "Hindi Jhankar Beats"...). */
export async function playStation(name: string, language?: string) {
  const st = await api.featuredStation(name, language);
  if (!st.songs.length) throw new api.MusicError('This station is quiet right now');
  playList(st.songs, 0, { kind: 'station', label: name });
  setQueue({ ...queue, stationId: st.stationId });
}

/** An artist's radio: their songs and others like them. */
export async function playArtistRadio(name: string, language?: string) {
  const st = await api.artistStation(name, language);
  if (!st.songs.length) throw new api.MusicError('No radio for this artist');
  playList(st.songs, 0, { kind: 'artist', label: `${name} Radio` });
  setQueue({ ...queue, stationId: st.stationId });
}

/**
 * "For you": a station seeded with the songs somebody listens to most, right
 * now. Somebody new to PINGO Music gets today's trending songs instead.
 */
export async function playForYou() {
  const seeds = currentTaste().seeds;
  if (seeds.length) {
    const st = await api.songRadio(seeds.slice(0, 3), 12);
    if (st.songs.length) {
      playList(st.songs, 0, { kind: 'station', label: 'For you' });
      setQueue({ ...queue, stationId: st.stationId });
      return;
    }
  }
  const trending = (await api.trending('hindi', 'song')).filter((i): i is Song => i.type === 'song');
  playList(trending, 0, { kind: 'song', label: 'For you' });
}

/** Plays a kept song (from the library), looking up its address first. */
export async function playKept(list: Kept[], index: number, source: Q.QueueSource) {
  const ids = list.map((k) => k.id);
  // Up to 50 at a time is what the Worker takes in one call; the rest are looked up as they come.
  const found = await api.songs(ids.slice(Math.max(0, index - 5), index + 45)).catch(() => [] as Song[]);
  const byId = new Map(found.map((s) => [s.id, s]));
  const songs: Song[] = list.map(
    (k) =>
      byId.get(k.id) ?? {
        type: 'song',
        id: k.id,
        name: k.name,
        album: { id: '', name: k.album },
        artists: k.artists.map((a) => ({ type: 'artist' as const, ...a, image: '' })),
        credits: [],
        image: k.image,
        secs: k.secs,
        year: 0,
        language: k.language,
        explicit: false,
        plays: 0,
        hasLyrics: false,
        label: '',
        copyright: '',
        url: '',
        stream: {},
      },
  );
  playList(songs, index, source);
}

export const playNext = (songs: Song[]) => setQueue(Q.playNext(queue, songs));
export const addToQueue = (songs: Song[]) => setQueue(Q.append(queue, songs));
export const removeFromQueue = (orderIndex: number) => setQueue(Q.remove(queue, orderIndex));
export const moveInQueue = (from: number, to: number) => setQueue(Q.move(queue, from, to));
export function jumpTo(orderIndex: number) {
  recordOutgoing(false);
  setQueue(Q.jump(queue, orderIndex));
  void playCurrent();
}
export const toggleShuffle = () => setQueue(Q.toggleShuffle(queue));
export const isShuffling = () => queue.shuffle;

/** Pauses the queue's song, or carries on with it. */
export function toggleCurrent() {
  const p = playerState();
  if (p.song && p.song.url === playingUrl) {
    if (p.playing) musicPlayer.pause();
    else void musicPlayer.resume();
    return;
  }
  // The player moved on to something else (a chat card): pick the queue's song back up.
  void playCurrent();
}
export const cycleRepeat = () => setQueue(Q.cycleRepeat(queue));
export const next = () => controls.next(false);
export const prev = () => controls.prev();

export function setQuality(q: typeof quality) {
  quality = q;
}

/* ---------- reading ---------- */

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const snap = () => queue;

/** The queue, live: what is playing, what is next, shuffle, repeat, where it came from. */
export function useQueue(): Q.QueueState {
  return useSyncExternalStore(subscribe, snap, snap);
}

export { Q };
