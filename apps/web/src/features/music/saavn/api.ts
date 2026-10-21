import * as yt from '../ytm/innertube.js';
import { noteYtmFailure, noteYtmOk, ytmActive } from '../ytm/source.js';
import type { ArtistPage, ChannelPage, Item, Lyrics, Module, Paged, Playlist, SearchAll, Song, Album, Artist, StationStart, Stream } from './types.js';

/**
 * PINGO Music's catalogue: one function per thing JioSaavn has.
 *
 * Every call goes to the `pingo-saavn` Worker (workers/saavn), which speaks
 * JioSaavn's own API from Mumbai and hands back the shapes in `types.ts`.
 *
 * ## Fast on purpose
 *
 * - Answers are kept in memory for a while, so going back to a screen costs
 *   nothing, and the same request in flight twice is made once.
 * - `prefetch` warms a call before it is needed (the album under a thumb, the
 *   next song's details) without anybody waiting on it.
 * - A failed call is retried once after a short pause: phones drop requests.
 */

const BASE = ((import.meta.env.VITE_SAAVN_URL as string | undefined) ?? 'https://pingo-saavn.dubesminecraft.workers.dev').replace(/\/$/, '');

export class MusicError extends Error {}

interface Entry {
  at: number;
  value?: unknown;
  pending?: Promise<unknown>;
}

const memory = new Map<string, Entry>();
const MAX_ENTRIES = 300;

/** How long an answer is fresh, by route. Stations are never kept: each answer is the next song. */
function freshFor(path: string): number {
  if (path.startsWith('/stations') || path.includes('/radio')) return 0;
  if (path.startsWith('/search') || path === '/top-searches') return 5 * 60_000;
  if (['/home', '/trending', '/new', '/featured', '/charts'].some((p) => path.startsWith(p))) return 10 * 60_000;
  return 60 * 60_000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(BASE + path, signal ? { signal } : undefined);
      const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
      if (!res.ok || body.data === undefined) {
        // A 404 is an answer ("no lyrics", "nothing found"), not a hiccup: no retry.
        if (res.status === 404) throw new MusicError(body.error || 'Not found');
        throw new Error(body.error || `Music service answered ${res.status}`);
      }
      return body.data;
    } catch (e) {
      if (e instanceof MusicError || (e as { name?: string }).name === 'AbortError') throw e;
      lastError = e;
      if (attempt === 0) await sleep(400);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Music service unreachable');
}

/** A cached GET. */
export function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const ttl = freshFor(path);
  if (!ttl) return request<T>(path, signal);
  const hit = memory.get(path);
  const now = Date.now();
  if (hit?.pending) return hit.pending as Promise<T>;
  if (hit && 'value' in hit && now - hit.at < ttl) return Promise.resolve(hit.value as T);
  const pending = request<T>(path, signal).then(
    (value) => {
      memory.set(path, { at: Date.now(), value });
      if (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value!);
      return value;
    },
    (e) => {
      memory.delete(path);
      throw e;
    },
  );
  memory.set(path, { at: now, pending });
  return pending;
}

/** Warm a call without waiting for it, and without an error surfacing anywhere. */
export function prefetch(path: string): void {
  void get(path).catch(() => undefined);
}

/** The cached answer, if there is a fresh one: lets a screen paint before it asks. */
export function peek<T>(path: string): T | undefined {
  const hit = memory.get(path);
  return hit && 'value' in hit && Date.now() - hit.at < freshFor(path) ? (hit.value as T) : undefined;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const langs = (l?: string[]) => (l?.length ? l.join(',') : undefined);
const enc = encodeURIComponent;

/* ---------- discover ---------- */

const saavnHome = (lang?: string[], signal?: AbortSignal) => get<{ modules: Module[] }>(`/home${qs({ lang: langs(lang) })}`, signal);

export async function home(lang?: string[], signal?: AbortSignal): Promise<{ modules: Module[] }> {
  if (ytmActive()) {
    try {
      const modules = await yt.home();
      noteYtmOk();
      for (const m of modules) for (const s of m.items) if (s.type === 'song') remember(s);
      return { modules };
    } catch {
      noteYtmFailure();
    }
  }
  return saavnHome(lang, signal);
}
export const charts = (lang?: string[]) => get<Item[]>(`/charts${qs({ lang: langs(lang) })}`);
export const trending = (lang = 'hindi', type: 'song' | 'album' | 'playlist' = 'song') => get<Item[]>(`/trending${qs({ lang, type })}`);
export const newReleases = (page = 1, lang?: string[]) => get<Paged<Item>>(`/new${qs({ page, lang: langs(lang) })}`);
export const featuredPlaylists = (page = 1, lang?: string[]) => get<Paged<Item>>(`/featured${qs({ page, lang: langs(lang) })}`);
export const topSearches = () => get<Item[]>('/top-searches');
export const channel = (id: string) => get<ChannelPage>(`/channels/${enc(id)}`);

/* ---------- search ---------- */

const saavnSearchAll = (q: string, signal?: AbortSignal) => get<SearchAll>(`/search${qs({ q: q.trim() })}`, signal);
const saavnSearchSongs = (q: string, page = 1, signal?: AbortSignal) => get<Paged<Song>>(`/search/songs${qs({ q: q.trim(), page })}`, signal);

/** YouTube Music's songs for a query, or undefined when it cannot answer (the caller uses JioSaavn's). */
async function ytSearch(q: string): Promise<Song[] | undefined> {
  if (!ytmActive()) return undefined;
  try {
    const found = await yt.searchSongs(q.trim());
    noteYtmOk();
    found.forEach(remember);
    return found;
  } catch {
    noteYtmFailure();
    return undefined;
  }
}

/** Songs from YouTube Music when it is the choice; albums, artists and playlists stay JioSaavn's. */
export async function searchAll(q: string, signal?: AbortSignal): Promise<SearchAll> {
  const [fromYt, fromSaavn] = await Promise.all([ytSearch(q), saavnSearchAll(q, signal).catch((e) => (ytmActive() ? undefined : Promise.reject(e)))]);
  if (!fromYt) {
    if (!fromSaavn) throw new MusicError('Nothing found');
    return fromSaavn;
  }
  const base: SearchAll = fromSaavn ?? { top: [], songs: [], albums: [], artists: [], playlists: [] };
  return { ...base, top: fromYt.slice(0, 1), songs: fromYt };
}

export async function searchSongs(q: string, page = 1, signal?: AbortSignal): Promise<Paged<Song>> {
  if (page === 1) {
    const fromYt = await ytSearch(q);
    if (fromYt) return { items: fromYt, page: 1, more: false };
  }
  return saavnSearchSongs(q, page, signal);
}
export const searchAlbums = (q: string, page = 1) => get<Paged<Album>>(`/search/albums${qs({ q: q.trim(), page })}`);
export const searchArtists = (q: string, page = 1) => get<Paged<Artist>>(`/search/artists${qs({ q: q.trim(), page })}`);
export const searchPlaylists = (q: string, page = 1) => get<Paged<Playlist>>(`/search/playlists${qs({ q: q.trim(), page })}`);

/* ---------- things ---------- */

const saavnSongs = (ids: string[]) => get<Song[]>(`/songs/${ids.map(enc).join(',')}`);

/** What YouTube Music songs seen so far looked like, so an id alone can be played with its name and cover. */
const seen = new Map<string, Song>();
function remember(s: Song) {
  seen.set(s.id, s);
  if (seen.size > 500) seen.delete(seen.keys().next().value!);
}

const norm = (t: string) => t.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The same song on JioSaavn, for when YouTube Music cannot play it.
 *
 * Searched by name and artist; a result is taken only if its title agrees, so
 * a failure never turns into the wrong song. Carries the original's id's
 * absence on purpose: it is a different catalogue entry.
 */
export async function equivalent(name: string, artist: string): Promise<Song | undefined> {
  try {
    const found = await saavnSearchSongs(`${name} ${artist}`.trim(), 1);
    const want = norm(name);
    const pick = found.items.find((s) => norm(s.name) === want) ?? found.items.find((s) => norm(s.name).includes(want) || want.includes(norm(s.name)));
    if (!pick) return undefined;
    return (await saavnSongs([pick.id]))[0] ?? pick;
  } catch {
    return undefined;
  }
}

/** One YouTube Music song with a stream; JioSaavn's version of it if YouTube cannot. */
async function ytSong(id: string): Promise<Song | undefined> {
  const meta = seen.get(id);
  try {
    const stream = await yt.resolveStream(yt.videoIdOf(id));
    noteYtmOk();
    return { ...(meta ?? yt.song(yt.videoIdOf(id), '', [], '', 0, '')), stream };
  } catch {
    noteYtmFailure();
    return meta ? equivalent(meta.name, meta.artists.map((a) => a.name).join(' ')) : undefined;
  }
}

export async function songs(ids: string[]): Promise<Song[]> {
  const ytIds = ids.filter(yt.isYtId);
  if (!ytIds.length) return saavnSongs(ids);
  const rest = ids.filter((i) => !yt.isYtId(i));
  const out = new Map<string, Song>();
  const [saavn, resolved] = await Promise.all([rest.length ? saavnSongs(rest) : Promise.resolve([] as Song[]), Promise.all(ytIds.map(ytSong))]);
  saavn.forEach((s) => out.set(s.id, s));
  ytIds.forEach((id, i) => resolved[i] && out.set(id, resolved[i]!));
  return ids.map((i) => out.get(i)).filter((s): s is Song => Boolean(s));
}
export const song = async (id: string) => (await songs([id]))[0];

/**
 * A YouTube Music song's address, looked up ahead of its turn.
 *
 * `resolveStream` keeps what it finds for an hour, so when the queue reaches
 * the song the answer is already there and "next" does not wait on a round
 * trip. Undefined for anything else, or when YouTube cannot answer: the song is
 * then resolved at its turn as before.
 */
export async function warmStream(id: string, prefer: 'auto' | 'high' | 'normal' | 'saver' = 'auto'): Promise<string | undefined> {
  if (!yt.isYtId(id) || !ytmActive()) return undefined;
  try {
    return streamUrl({ stream: await yt.resolveStream(yt.videoIdOf(id)) }, prefer);
  } catch {
    return undefined;
  }
}
export const lyrics = (id: string) => get<Lyrics>(`/songs/${enc(id)}/lyrics`);
export const album = (id: string) => get<Album>(`/albums/${enc(id)}`);
export const playlist = (id: string, page = 1, n = 50) => get<Playlist & { page: number; more: boolean }>(`/playlists/${enc(id)}${qs({ page, n })}`);
export const artist = (id: string) => get<ArtistPage>(`/artists/${enc(id)}`);
export const artistSongs = (id: string, page = 1, sort: 'popularity' | 'latest' | 'alphabetical' = 'popularity') => get<Paged<Song>>(`/artists/${enc(id)}/songs${qs({ page, sort })}`);
export const artistAlbums = (id: string, page = 1, sort: 'popularity' | 'latest' | 'alphabetical' = 'popularity') => get<Paged<Album>>(`/artists/${enc(id)}/albums${qs({ page, sort })}`);
export const resolveLink = (url: string) => get<Item>(`/link${qs({ url })}`);

/* ---------- radio ---------- */

/** JioSaavn's "more like this": a station seeded with these songs, and its first few. */
const saavnSongRadio = (ids: string[], n = 10) => get<StationStart>(`/songs/${ids.map(enc).join(',')}/radio${qs({ n })}`);

/** Where each YouTube Music radio has got to: the last song handed out seeds the next batch. */
const ytCursor = new Map<string, string>();

export async function songRadio(ids: string[], n = 10): Promise<StationStart> {
  const seed = [...ids].reverse().find(yt.isYtId) ?? (ytmActive() ? ids[ids.length - 1] : undefined);
  if (seed && yt.isYtId(seed) && ytmActive()) {
    try {
      const vid = yt.videoIdOf(seed);
      const next = await yt.upNext(vid, Math.max(n, 12));
      noteYtmOk();
      next.forEach(remember);
      const stationId = `yt:${vid}`;
      ytCursor.set(stationId, next[next.length - 1]!.id);
      return { stationId, songs: next };
    } catch {
      noteYtmFailure();
    }
  }
  // A YouTube seed with YouTube resting: radio from JioSaavn's version of it.
  if (ids.some(yt.isYtId)) {
    const meta = seen.get(ids[ids.length - 1]!);
    const twin = meta ? await equivalent(meta.name, meta.artists.map((a) => a.name).join(' ')) : undefined;
    if (twin) return saavnSongRadio([twin.id], n);
    throw new MusicError('No radio for this song right now');
  }
  return saavnSongRadio(ids, n);
}
export const featuredStation = (name: string, lang?: string) => get<StationStart>(`/stations/featured${qs({ name, lang })}`);
export const artistStation = (name: string, lang?: string) => get<StationStart>(`/stations/artist${qs({ name, lang })}`);
const saavnStationNext = (stationId: string, n = 5) => get<Song[]>(`/stations/${enc(stationId)}/next${qs({ n })}`);

export async function stationNext(stationId: string, n = 5): Promise<Song[]> {
  if (!stationId.startsWith('yt:')) return saavnStationNext(stationId, n);
  const seed = ytCursor.get(stationId) ?? stationId;
  try {
    const next = await yt.upNext(yt.videoIdOf(seed), Math.max(n, 12));
    noteYtmOk();
    next.forEach(remember);
    if (next.length) ytCursor.set(stationId, next[next.length - 1]!.id);
    return next;
  } catch {
    noteYtmFailure();
    return [];
  }
}

/* ---------- playing ---------- */

type Kbps = keyof Stream;
const ORDER: Kbps[] = ['320', '160', '96', '48', '12'];

/**
 * The address to play, at a quality the connection can carry.
 *
 * 160 kbps is what JioSaavn itself plays by default and is indistinguishable
 * from 320 on phone speakers and most earphones. 320 when asked for on a good
 * connection; 96 on a slow one or with Data Saver on; 48 on 2G.
 */
export function streamUrl(s: Pick<Song, 'stream'>, prefer: 'auto' | 'high' | 'normal' | 'saver' = 'auto'): string | undefined {
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  let want: Kbps = '160';
  if (prefer === 'high') want = '320';
  else if (prefer === 'saver') want = '96';
  else if (prefer === 'auto' && conn) {
    if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') want = '48';
    else if (conn.saveData || conn.effectiveType === '3g') want = '96';
  }
  const from = ORDER.indexOf(want);
  // The wanted rate, else the nearest lower one, else anything there is.
  for (const k of [...ORDER.slice(from), ...ORDER.slice(0, from).reverse()]) {
    const u = s.stream[k];
    if (u) return u;
  }
  return undefined;
}

export const artistNames = (s: Pick<Song, 'artists'>) => s.artists.map((a) => a.name).filter(Boolean).join(', ');
