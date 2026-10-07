import type { SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';

import { getSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase/client.js';
import { taste as readTaste, type PlayRecord, type Taste } from './taste.js';
import type { Artist, Song } from './types.js';

/**
 * Somebody's own music: liked songs, what they played, artists they follow,
 * their playlists and their recent searches.
 *
 * ## Local first
 *
 * Every change lands on the phone at once (localStorage) and the screen
 * updates in the same frame; Supabase (`20261007100655_music_library.sql`) is
 * told afterwards, in the background. A like never waits on the network, and
 * the library opens with no spinner. When the person is signed in, `sync()`
 * pulls the server copy once and merges it, so a new phone has their library.
 *
 * A song is stored as a small snapshot (`Kept`), enough to draw a row. The
 * address to play it is fetched fresh at play time, since JioSaavn's change.
 */

export interface Kept {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album: string;
  image: string;
  secs: number;
  language: string;
}

export interface KeptPlaylist {
  id: string;
  name: string;
  songs: Kept[];
  updatedAt: number;
}

interface State {
  likes: { song: Kept; at: number }[];
  plays: (PlayRecord & { song: Kept })[];
  follows: { artist: { id: string; name: string; image: string }; at: number }[];
  playlists: KeptPlaylist[];
  searches: string[];
}

const KEY = 'pingo:music-library:v1';
const MAX_PLAYS = 500;
const MAX_SEARCHES = 12;

const blank = (): State => ({ likes: [], plays: [], follows: [], playlists: [], searches: [] });

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...blank(), ...(JSON.parse(raw) as Partial<State>) } : blank();
  } catch {
    return blank();
  }
}

let state: State = typeof localStorage === 'undefined' ? blank() : load();
let tasteCache: { for: State; value: Taste } | undefined;
const listeners = new Set<() => void>();

function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the session still works, it just will not persist.
  }
  listeners.forEach((l) => l());
}

export const keep = (s: Song): Kept => ({
  id: s.id,
  name: s.name,
  artists: s.artists.map((a) => ({ id: a.id, name: a.name })),
  album: s.album.name,
  image: s.image,
  secs: s.secs,
  language: s.language,
});

/* ---------- the server copy ---------- */

function db(): SupabaseClient | undefined {
  if (!isSupabaseConfigured()) return undefined;
  return getSupabaseClient() as unknown as SupabaseClient;
}

async function signedIn(): Promise<SupabaseClient | undefined> {
  const client = db();
  if (!client) return undefined;
  const { data } = await client.auth.getSession();
  return data.session ? client : undefined;
}

/** Fire and forget: a failed write is retried by the next sync, which merges both ways. */
function remote(job: (c: SupabaseClient) => PromiseLike<unknown>) {
  void signedIn()
    .then((c) => (c ? job(c) : undefined))
    .catch(() => undefined);
}

/* ---------- likes ---------- */

export const isLiked = (id: string) => state.likes.some((l) => l.song.id === id);

export function toggleLike(s: Song | Kept): boolean {
  const k = 'stream' in s ? keep(s) : s;
  const liked = isLiked(k.id);
  if (liked) {
    commit({ ...state, likes: state.likes.filter((l) => l.song.id !== k.id) });
    remote((c) => c.from('music_likes').delete().eq('song_id', k.id));
  } else {
    commit({ ...state, likes: [{ song: k, at: Date.now() }, ...state.likes] });
    remote((c) => c.from('music_likes').upsert({ song_id: k.id, song: k }));
  }
  return !liked;
}

/* ---------- plays ---------- */

/**
 * A song was listened to. `finished` when it played (nearly) to the end; a
 * skip is a play without it. Counted once per listen, not per second.
 */
export function recordPlay(s: Song | Kept, finished: boolean) {
  const k = 'stream' in s ? keep(s) : s;
  const now = Date.now();
  const old = state.plays.find((p) => p.id === k.id);
  const entry = {
    id: k.id,
    name: k.name,
    artists: k.artists,
    language: k.language,
    song: k,
    plays: (old?.plays ?? 0) + 1,
    finished: (old?.finished ?? 0) + (finished ? 1 : 0),
    lastPlayedAt: now,
  };
  commit({ ...state, plays: [entry, ...state.plays.filter((p) => p.id !== k.id)].slice(0, MAX_PLAYS) });
  remote((c) => c.rpc('music_record_play', { p_song_id: k.id, p_song: k, p_finished: finished }));
}

/* ---------- follows ---------- */

export const isFollowing = (id: string) => state.follows.some((f) => f.artist.id === id);

export function toggleFollow(a: Pick<Artist, 'id' | 'name' | 'image'>): boolean {
  const following = isFollowing(a.id);
  const artist = { id: a.id, name: a.name, image: a.image };
  if (following) {
    commit({ ...state, follows: state.follows.filter((f) => f.artist.id !== a.id) });
    remote((c) => c.from('music_follows').delete().eq('artist_id', a.id));
  } else {
    commit({ ...state, follows: [{ artist, at: Date.now() }, ...state.follows] });
    remote((c) => c.from('music_follows').upsert({ artist_id: a.id, artist }));
  }
  return !following;
}

/* ---------- playlists ---------- */

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function createPlaylist(name: string, songs: (Song | Kept)[] = []): KeptPlaylist {
  const p: KeptPlaylist = { id: newId(), name: name.trim().slice(0, 80) || 'My playlist', songs: songs.map((s) => ('stream' in s ? keep(s) : s)), updatedAt: Date.now() };
  commit({ ...state, playlists: [p, ...state.playlists] });
  remote(async (c) => {
    await c.from('music_playlists').insert({ id: p.id, name: p.name });
    if (p.songs.length) await c.from('music_playlist_songs').insert(p.songs.map((s, i) => ({ playlist_id: p.id, song_id: s.id, song: s, position: i })));
  });
  return p;
}

export function renamePlaylist(id: string, name: string) {
  const n = name.trim().slice(0, 80);
  if (!n) return;
  commit({ ...state, playlists: state.playlists.map((p) => (p.id === id ? { ...p, name: n, updatedAt: Date.now() } : p)) });
  remote((c) => c.from('music_playlists').update({ name: n, updated_at: new Date().toISOString() }).eq('id', id));
}

export function deletePlaylist(id: string) {
  commit({ ...state, playlists: state.playlists.filter((p) => p.id !== id) });
  remote((c) => c.from('music_playlists').delete().eq('id', id));
}

export function addToPlaylist(id: string, s: Song | Kept) {
  const k = 'stream' in s ? keep(s) : s;
  const p = state.playlists.find((x) => x.id === id);
  if (!p || p.songs.some((x) => x.id === k.id)) return;
  commit({ ...state, playlists: state.playlists.map((x) => (x.id === id ? { ...x, songs: [...x.songs, k], updatedAt: Date.now() } : x)) });
  remote((c) => c.from('music_playlist_songs').upsert({ playlist_id: id, song_id: k.id, song: k, position: p.songs.length }));
}

export function removeFromPlaylist(id: string, songId: string) {
  commit({ ...state, playlists: state.playlists.map((x) => (x.id === id ? { ...x, songs: x.songs.filter((s) => s.id !== songId), updatedAt: Date.now() } : x)) });
  remote((c) => c.from('music_playlist_songs').delete().eq('playlist_id', id).eq('song_id', songId));
}

/* ---------- searches ---------- */

export function rememberSearch(q: string) {
  const t = q.trim();
  if (t.length < 2) return;
  commit({ ...state, searches: [t, ...state.searches.filter((s) => s.toLowerCase() !== t.toLowerCase())].slice(0, MAX_SEARCHES) });
}
export const forgetSearch = (q: string) => commit({ ...state, searches: state.searches.filter((s) => s !== q) });
export const clearSearches = () => commit({ ...state, searches: [] });

/* ---------- reading ---------- */

export const snapshot = () => state;

/** Somebody's taste right now, worked out once per change. */
export function currentTaste(): Taste {
  if (tasteCache?.for === state) return tasteCache.value;
  const value = readTaste(state.plays, new Set(state.likes.map((l) => l.song.id)));
  tasteCache = { for: state, value };
  return value;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** The whole library, live. Components re-render when it changes. */
export function useLibrary(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/* ---------- sync ---------- */

type Row<T> = T & { song?: Kept };

/**
 * Pulls the server copy and merges it with this phone's.
 *
 * Union for likes, follows and playlists (nothing is lost by syncing); for
 * plays, the larger count and the later time win. Anything only on the phone
 * (made while signed out, or a write that failed) is pushed up.
 */
export async function sync(): Promise<void> {
  const c = await signedIn();
  if (!c) return;
  const [likes, plays, follows, lists] = await Promise.all([
    c.from('music_likes').select('song_id, song, liked_at').order('liked_at', { ascending: false }).limit(2000),
    c.from('music_plays').select('song_id, song, plays, finished, last_played_at').order('last_played_at', { ascending: false }).limit(MAX_PLAYS),
    c.from('music_follows').select('artist_id, artist, followed_at').limit(1000),
    c.from('music_playlists').select('id, name, updated_at, music_playlist_songs(song_id, song, position)').order('updated_at', { ascending: false }).limit(200),
  ]);

  const local = state;
  const likeIds = new Set(local.likes.map((l) => l.song.id));
  const mergedLikes = [...local.likes];
  for (const r of (likes.data ?? []) as Row<{ song_id: string; liked_at: string }>[]) {
    if (r.song && !likeIds.has(r.song_id)) mergedLikes.push({ song: r.song, at: Date.parse(r.liked_at) });
  }
  mergedLikes.sort((a, b) => b.at - a.at);

  const playMap = new Map(local.plays.map((p) => [p.id, p]));
  for (const r of (plays.data ?? []) as Row<{ song_id: string; plays: number; finished: number; last_played_at: string }>[]) {
    if (!r.song) continue;
    const mine = playMap.get(r.song_id);
    const at = Date.parse(r.last_played_at);
    playMap.set(r.song_id, {
      id: r.song_id,
      name: r.song.name,
      artists: r.song.artists,
      language: r.song.language,
      song: r.song,
      plays: Math.max(mine?.plays ?? 0, r.plays),
      finished: Math.max(mine?.finished ?? 0, r.finished),
      lastPlayedAt: Math.max(mine?.lastPlayedAt ?? 0, at),
    });
  }

  const followIds = new Set(local.follows.map((f) => f.artist.id));
  const mergedFollows = [...local.follows];
  for (const r of (follows.data ?? []) as { artist_id: string; artist: { id: string; name: string; image: string }; followed_at: string }[]) {
    if (!followIds.has(r.artist_id)) mergedFollows.push({ artist: r.artist, at: Date.parse(r.followed_at) });
  }

  const listIds = new Set(local.playlists.map((p) => p.id));
  const mergedLists = [...local.playlists];
  for (const r of (lists.data ?? []) as { id: string; name: string; updated_at: string; music_playlist_songs: { song: Kept; position: number }[] }[]) {
    if (listIds.has(r.id)) continue;
    mergedLists.push({ id: r.id, name: r.name, updatedAt: Date.parse(r.updated_at), songs: [...(r.music_playlist_songs ?? [])].sort((a, b) => a.position - b.position).map((x) => x.song) });
  }

  commit({
    ...local,
    likes: mergedLikes,
    plays: [...playMap.values()].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt).slice(0, MAX_PLAYS),
    follows: mergedFollows,
    playlists: mergedLists.sort((a, b) => b.updatedAt - a.updatedAt),
  });

  // Up: what only this phone had.
  const serverLikes = new Set(((likes.data ?? []) as { song_id: string }[]).map((r) => r.song_id));
  const upLikes = local.likes.filter((l) => !serverLikes.has(l.song.id)).map((l) => ({ song_id: l.song.id, song: l.song, liked_at: new Date(l.at).toISOString() }));
  if (upLikes.length) await c.from('music_likes').upsert(upLikes);
  const serverFollows = new Set(((follows.data ?? []) as { artist_id: string }[]).map((r) => r.artist_id));
  const upFollows = local.follows.filter((f) => !serverFollows.has(f.artist.id)).map((f) => ({ artist_id: f.artist.id, artist: f.artist, followed_at: new Date(f.at).toISOString() }));
  if (upFollows.length) await c.from('music_follows').upsert(upFollows);
  const serverLists = new Set(((lists.data ?? []) as { id: string }[]).map((r) => r.id));
  for (const p of local.playlists.filter((x) => !serverLists.has(x.id))) {
    await c.from('music_playlists').upsert({ id: p.id, name: p.name });
    if (p.songs.length) await c.from('music_playlist_songs').upsert(p.songs.map((s, i) => ({ playlist_id: p.id, song_id: s.id, song: s, position: i })));
  }
}
