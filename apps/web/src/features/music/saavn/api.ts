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

export const home = (lang?: string[], signal?: AbortSignal) => get<{ modules: Module[] }>(`/home${qs({ lang: langs(lang) })}`, signal);
export const charts = (lang?: string[]) => get<Item[]>(`/charts${qs({ lang: langs(lang) })}`);
export const trending = (lang = 'hindi', type: 'song' | 'album' | 'playlist' = 'song') => get<Item[]>(`/trending${qs({ lang, type })}`);
export const newReleases = (page = 1, lang?: string[]) => get<Paged<Item>>(`/new${qs({ page, lang: langs(lang) })}`);
export const featuredPlaylists = (page = 1, lang?: string[]) => get<Paged<Item>>(`/featured${qs({ page, lang: langs(lang) })}`);
export const topSearches = () => get<Item[]>('/top-searches');
export const channel = (id: string) => get<ChannelPage>(`/channels/${enc(id)}`);

/* ---------- search ---------- */

export const searchAll = (q: string, signal?: AbortSignal) => get<SearchAll>(`/search${qs({ q: q.trim() })}`, signal);
export const searchSongs = (q: string, page = 1, signal?: AbortSignal) => get<Paged<Song>>(`/search/songs${qs({ q: q.trim(), page })}`, signal);
export const searchAlbums = (q: string, page = 1) => get<Paged<Album>>(`/search/albums${qs({ q: q.trim(), page })}`);
export const searchArtists = (q: string, page = 1) => get<Paged<Artist>>(`/search/artists${qs({ q: q.trim(), page })}`);
export const searchPlaylists = (q: string, page = 1) => get<Paged<Playlist>>(`/search/playlists${qs({ q: q.trim(), page })}`);

/* ---------- things ---------- */

export const songs = (ids: string[]) => get<Song[]>(`/songs/${ids.map(enc).join(',')}`);
export const song = async (id: string) => (await songs([id]))[0];
export const lyrics = (id: string) => get<Lyrics>(`/songs/${enc(id)}/lyrics`);
export const album = (id: string) => get<Album>(`/albums/${enc(id)}`);
export const playlist = (id: string, page = 1, n = 50) => get<Playlist & { page: number; more: boolean }>(`/playlists/${enc(id)}${qs({ page, n })}`);
export const artist = (id: string) => get<ArtistPage>(`/artists/${enc(id)}`);
export const artistSongs = (id: string, page = 1, sort: 'popularity' | 'latest' | 'alphabetical' = 'popularity') => get<Paged<Song>>(`/artists/${enc(id)}/songs${qs({ page, sort })}`);
export const artistAlbums = (id: string, page = 1, sort: 'popularity' | 'latest' | 'alphabetical' = 'popularity') => get<Paged<Album>>(`/artists/${enc(id)}/albums${qs({ page, sort })}`);
export const resolveLink = (url: string) => get<Item>(`/link${qs({ url })}`);

/* ---------- radio ---------- */

/** JioSaavn's "more like this": a station seeded with these songs, and its first few. */
export const songRadio = (ids: string[], n = 10) => get<StationStart>(`/songs/${ids.map(enc).join(',')}/radio${qs({ n })}`);
export const featuredStation = (name: string, lang?: string) => get<StationStart>(`/stations/featured${qs({ name, lang })}`);
export const artistStation = (name: string, lang?: string) => get<StationStart>(`/stations/artist${qs({ name, lang })}`);
export const stationNext = (stationId: string, n = 5) => get<Song[]>(`/stations/${enc(stationId)}/next${qs({ n })}`);

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
