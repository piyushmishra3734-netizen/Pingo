import { decryptMediaUrl } from './des.js';

/**
 * JioSaavn's raw answers, turned into one small, regular shape.
 *
 * The raw API is a decade of clients layered on each other: the same song
 * comes back with its artists as a string in one call and an `artistMap` in
 * another, numbers arrive as strings, titles carry HTML entities, and images
 * are 150px thumbnails with the size baked into the address. Everything the
 * app reads goes through here, so the app only ever sees these types.
 */

export interface Artist {
  type: 'artist';
  id: string;
  name: string;
  image: string;
  role?: string;
}

export interface Stream {
  /** kbps -> address. 12 and 48 are for very poor networks; 160 is the usual; 320 is high. */
  [kbps: string]: string;
}

export interface Song {
  type: 'song';
  id: string;
  name: string;
  album: { id: string; name: string };
  artists: Artist[];
  /** Music director, lyricist and the rest, for a song's credits. */
  credits: Artist[];
  image: string;
  secs: number;
  year: number;
  language: string;
  explicit: boolean;
  plays: number;
  hasLyrics: boolean;
  label: string;
  copyright: string;
  url: string;
  /** Empty when JioSaavn will not stream it (rights). */
  stream: Stream;
}

export interface Album {
  type: 'album';
  id: string;
  name: string;
  subtitle: string;
  artists: Artist[];
  image: string;
  year: number;
  language: string;
  songCount: number;
  url: string;
  songs?: Song[];
}

export interface Playlist {
  type: 'playlist';
  id: string;
  name: string;
  subtitle: string;
  image: string;
  songCount: number;
  followers: number;
  url: string;
  songs?: Song[];
}

export interface Station {
  type: 'station';
  /** What to ask for when starting it: a featured station's name, or an artist's. */
  id: string;
  kind: 'featured' | 'artist' | 'song';
  name: string;
  subtitle: string;
  image: string;
  language: string;
  /** For an artist station, the artist's id. */
  artistId?: string;
  color?: string;
}

export interface Channel {
  type: 'channel';
  id: string;
  name: string;
  /** mood, genre, era... */
  kind: string;
  image: string;
  video?: string;
}

export type Item = Song | Album | Playlist | Artist | Station | Channel;

export interface Module {
  key: string;
  title: string;
  subtitle: string;
  items: Item[];
}

type Raw = Record<string, unknown>;

/* ---------- small readers ---------- */

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', '#039': "'", '#39': "'" };
export const text = (v: unknown): string =>
  typeof v === 'string'
    ? v.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : m)).trim()
    : typeof v === 'number'
      ? String(v)
      : '';
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const bool = (v: unknown): boolean => v === true || v === 'true' || v === '1' || v === 1;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

/** Every JioSaavn image comes as 50 or 150 px; the same address serves 500. */
export const image = (v: unknown): string =>
  text(v)
    .replace(/^http:/, 'https:')
    .replace(/(\d{2,3})x\1(?=\.|_)/, '500x500')
    .replace(/_(50|150)x(50|150)\./, '_500x500.');

const STREAMS = ['12', '48', '96', '160', '320'];
function stream(encrypted: unknown, has320: boolean): Stream {
  const e = text(encrypted);
  if (!e) return {};
  try {
    const base = decryptMediaUrl(e).replace(/^http:/, 'https:');
    if (!/_\d+\.mp4$/.test(base)) return {};
    const out: Stream = {};
    for (const k of STREAMS) if (k !== '320' || has320) out[k] = base.replace(/_\d+\.mp4$/, `_${k}.mp4`);
    return out;
  } catch {
    return {};
  }
}

function artistList(map: unknown, fallback?: unknown): Artist[] {
  const m = obj(map);
  const list = arr(m.primary_artists).length ? arr(m.primary_artists) : arr(m.artists);
  if (list.length) return list.map(artist);
  // Older shapes: a comma-separated string, and sometimes ids alongside.
  const names = text(fallback).split(/,\s*/).filter(Boolean);
  return names.map((name) => ({ type: 'artist', id: '', name, image: '' }));
}

/* ---------- entities ---------- */

export function artist(r: Raw): Artist {
  return {
    type: 'artist',
    id: text(r.id ?? r.artistId),
    name: text(r.name ?? r.title),
    image: image(r.image),
    ...(r.role ? { role: text(r.role) } : {}),
  };
}

export function song(r: Raw): Song {
  const mi = obj(r.more_info);
  const map = obj(mi.artistMap);
  const primary = artistList(map, mi.primary_artists ?? mi.singers ?? r.primary_artists);
  const credits = arr(map.artists).map(artist).filter((a) => !primary.some((p) => p.id === a.id && p.id));
  return {
    type: 'song',
    id: text(r.id),
    name: text(r.title ?? r.song),
    album: { id: text(mi.album_id ?? r.albumid), name: text(mi.album ?? r.album) },
    artists: primary,
    credits,
    image: image(r.image),
    secs: num(mi.duration ?? r.duration),
    year: num(r.year),
    language: text(r.language),
    explicit: bool(r.explicit_content),
    plays: num(r.play_count),
    hasLyrics: bool(mi.has_lyrics),
    label: text(mi.label),
    copyright: text(mi.copyright_text),
    url: text(r.perma_url),
    stream: stream(mi.encrypted_media_url ?? r.encrypted_media_url, bool(mi['320kbps'] ?? r['320kbps'])),
  };
}

export function album(r: Raw): Album {
  const mi = obj(r.more_info);
  const list = arr(r.list).length ? arr(r.list) : arr(r.songs);
  return {
    type: 'album',
    id: text(r.id ?? r.albumid),
    name: text(r.title),
    subtitle: text(r.subtitle ?? r.header_desc),
    artists: artistList(mi.artistMap, mi.music ?? r.music),
    image: image(r.image),
    year: num(r.year),
    language: text(r.language),
    songCount: num(mi.song_count ?? r.list_count ?? list.length),
    url: text(r.perma_url),
    ...(list.length ? { songs: list.map(song) } : {}),
  };
}

export function playlist(r: Raw): Playlist {
  const mi = obj(r.more_info);
  const list = arr(r.list);
  return {
    type: 'playlist',
    id: text(r.id ?? r.listid),
    name: text(r.title ?? r.listname),
    subtitle: text(r.subtitle ?? mi.subtitle_desc ?? r.header_desc),
    image: image(r.image),
    songCount: num(mi.song_count ?? r.list_count ?? r.count ?? list.length),
    followers: num(mi.follower_count ?? mi.fan_count),
    url: text(r.perma_url),
    ...(list.length ? { songs: list.map(song) } : {}),
  };
}

export function station(r: Raw): Station {
  const mi = obj(r.more_info);
  const artistStation = text(mi.featured_station_type) === 'artist';
  return {
    type: 'station',
    id: artistStation ? text(mi.query || r.title) : text(r.id || r.title),
    kind: artistStation ? 'artist' : 'featured',
    name: text(mi.station_display_text || r.title),
    subtitle: text(r.subtitle),
    image: image(r.image),
    language: text(mi.language ?? r.language),
    ...(artistStation ? { artistId: text(r.id) } : {}),
    ...(mi.color ? { color: text(mi.color) } : {}),
  };
}

export function channel(r: Raw): Channel {
  const mi = obj(r.more_info);
  return {
    type: 'channel',
    id: text(r.id),
    name: text(r.title),
    kind: text(mi.sub_type) || 'channel',
    image: image(r.image),
    ...(mi.video_url ? { video: text(mi.video_url).replace(/^http:/, 'https:') } : {}),
  };
}

/** Anything from a mixed list (home, search, channel), by its own `type`. */
export function item(r: Raw): Item | undefined {
  switch (text(r.type)) {
    case 'song':
      return song(r);
    case 'album':
      return album(r);
    case 'playlist':
      return playlist(r);
    case 'artist':
      return artist(r);
    case 'radio_station':
      return station(r);
    case 'channel':
      return channel(r);
    default:
      return undefined;
  }
}

export const items = (list: unknown): Item[] => arr(list).map(item).filter((x): x is Item => !!x);

/**
 * The home screen, in JioSaavn's own order, with its own titles.
 *
 * `modules` says which keys exist, what to call them and where they go; the
 * data sits beside it under the same keys. Podcast-only modules (shows,
 * episodes) are left out: the app plays music.
 */
export function modules(data: Raw): Module[] {
  const meta = obj(data.modules);
  return Object.entries(meta)
    .map(([key, m]) => ({ key, m: obj(m) }))
    .sort((a, b) => num(a.m.position) - num(b.m.position))
    .map(({ key, m }) => ({
      key: key.replace(/^promo:vx:data:/, 'promo-'),
      title: text(m.title),
      subtitle: text(m.subtitle ?? m.featured_text),
      items: items(data[key]).filter((i) => i.type !== 'artist' || i.name),
    }))
    .filter((mod) => mod.items.length > 0);
}

export const raw = { obj, arr, num, text };
