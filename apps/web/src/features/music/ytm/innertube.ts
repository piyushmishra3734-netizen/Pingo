import { Capacitor, CapacitorHttp } from '@capacitor/core';

import type { Artist, Module, Song, Stream } from '../saavn/types.js';

/**
 * YouTube Music, spoken to directly from the phone.
 *
 * ## Why on the phone and nowhere else
 *
 * A YouTube audio address is tied to the IP that asked for it, and YouTube
 * turns away datacenter addresses, so a Worker cannot resolve a song for a
 * phone. The phone asks for itself. Inside the app that goes through
 * Capacitor's native HTTP, which has no CORS; in a browser the same request is
 * refused, so `available()` is false there and PINGO Music stays on JioSaavn.
 *
 * ## What it is
 *
 * YouTube's own "InnerTube" JSON API, the one its apps use. Unofficial: it can
 * change without notice, which is why nothing here may be the only way a song
 * plays. Every failure is a thrown `YtmError`, and `provider.ts` turns that
 * into a JioSaavn answer rather than a broken screen.
 *
 * ## Two clients
 *
 * Browsing (search, home, up next) speaks as the YouTube Music web client,
 * whose answers carry the music-specific shelves. Playing speaks as the Quest
 * (ANDROID_VR) client, the one that returns plain `url`s with no signature
 * cipher and needs no proof-of-origin token.
 */

export class YtmError extends Error {}

const ORIGIN = 'https://music.youtube.com';
const API = 'https://music.youtube.com/youtubei/v1';
const PLAYER_API = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

const WEB_REMIX = { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'en', gl: 'IN' };
const VR_VERSION = '1.60.19';
const VR_UA = `com.google.android.apps.youtube.vr.oculus/${VR_VERSION} (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip`;
const VR_CLIENT = {
  clientName: 'ANDROID_VR',
  clientVersion: VR_VERSION,
  deviceMake: 'Oculus',
  deviceModel: 'Quest 3',
  androidSdkVersion: 32,
  osName: 'Android',
  osVersion: '12L',
  hl: 'en',
  gl: 'IN',
};

/** Only the native app can ask: a browser's request is refused by CORS. */
let forcedNative: boolean | undefined;
export const available = (): boolean => forcedNative ?? Capacitor.isNativePlatform();

/** Tests (and nothing else) pretend to be the app. */
export function setNativeForTests(value: boolean | undefined) {
  forcedNative = value;
}

type Json = Record<string, any>;

let transport: (url: string, headers: Record<string, string>, body: unknown) => Promise<Json> = async (url, headers, body) => {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({ url, headers: { 'content-type': 'application/json', ...headers }, data: body, connectTimeout: 10_000, readTimeout: 15_000 });
    if (res.status < 200 || res.status >= 300) throw new YtmError(`YouTube answered ${res.status}`);
    return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as Json;
  }
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new YtmError(`YouTube answered ${res.status}`);
  return (await res.json()) as Json;
};

/** Tests (and nothing else) swap the network. */
export function setTransport(fn: typeof transport) {
  transport = fn;
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Json> {
  try {
    return await transport(url, headers, body);
  } catch (e) {
    throw e instanceof YtmError ? e : new YtmError(e instanceof Error ? e.message : 'YouTube Music unreachable');
  }
}

const music = (path: string, body: Json) =>
  post(`${API}/${path}?prettyPrint=false`, { origin: ORIGIN, 'x-origin': ORIGIN }, { context: { client: WEB_REMIX }, ...body });

/* ---------- reading the shelves ---------- */

/** Every object under `root` that has `key`, in order. InnerTube's nesting changes; its renderer names do not. */
function collect(root: unknown, key: string, out: Json[] = []): Json[] {
  if (Array.isArray(root)) {
    for (const v of root) collect(v, key, out);
  } else if (root && typeof root === 'object') {
    const o = root as Json;
    if (key in o) out.push(o[key] as Json);
    for (const k of Object.keys(o)) if (k !== key) collect(o[k], key, out);
  }
  return out;
}

const runsText = (node: Json | undefined): string => ((node?.runs as Json[] | undefined) ?? []).map((r) => r.text ?? '').join('');

/** "3:45" or "1:02:03" to seconds. */
function seconds(text: string): number {
  const parts = text.split(':').map(Number);
  if (!parts.length || parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

/** YouTube serves a 60px thumbnail by default; the same address takes a size. */
function bigger(url: string | undefined): string {
  if (!url) return '';
  return url.replace(/=w\d+-h\d+[^?]*$/, '=w544-h544-l90-rj').replace(/\/s\d+(-[a-z0-9-]+)?\//, '/s544/');
}

function lastThumb(node: Json | undefined): string {
  const list = (node?.thumbnails as Json[] | undefined) ?? [];
  return bigger(list[list.length - 1]?.url);
}

const artistOf = (name: string, id = ''): Artist => ({ type: 'artist', id, name, image: '' });

export function song(id: string, name: string, artists: Artist[], albumName: string, secs: number, image: string): Song {
  return {
    type: 'song',
    id: `yt:${id}`,
    name,
    album: { id: '', name: albumName },
    artists,
    credits: [],
    image,
    secs,
    year: 0,
    language: '',
    explicit: false,
    plays: 0,
    hasLyrics: false,
    label: '',
    copyright: '',
    url: `https://music.youtube.com/watch?v=${id}`,
    stream: {},
  };
}

/** A row of the music shelves, as a song. Rows that are not a song (an artist, a playlist) come back undefined. */
function fromRow(row: Json): Song | undefined {
  const videoId: string | undefined =
    row.playlistItemData?.videoId ??
    collect(row.overlay, 'watchEndpoint')[0]?.videoId ??
    collect(row.flexColumns, 'watchEndpoint')[0]?.videoId;
  if (!videoId) return undefined;
  const cols = (row.flexColumns as Json[] | undefined) ?? [];
  const title = runsText(cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
  if (!title) return undefined;

  const runs = (cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs as Json[] | undefined) ?? [];
  const artists: Artist[] = [];
  let album = '';
  let secs = 0;
  for (const run of runs) {
    const text = String(run.text ?? '').trim();
    // A podcast episode has a video id and sits among the songs in the results, but it is not one.
    if (/^(episode|podcast)$/i.test(text)) return undefined;
    if (!text || text === '•' || /^(song|video)$/i.test(text)) continue;
    const browse: string = run.navigationEndpoint?.browseEndpoint?.browseId ?? '';
    if (/^\d+:\d{2}(:\d{2})?$/.test(text)) secs = seconds(text);
    else if (browse.startsWith('MPRE')) album = text;
    else if (browse.startsWith('UC') || (!browse && !artists.length && !album)) artists.push(artistOf(text, browse));
  }
  const fixed = cols.length > 2 ? runsText(row.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text) : '';
  if (!secs && fixed) secs = seconds(fixed);
  return song(videoId, title, artists, album, secs, lastThumb(row.thumbnail?.musicThumbnailRenderer?.thumbnail));
}

/** The "Top result" card of a search: a song or a video, or undefined when it is an artist, an album or a playlist. */
function fromCard(card: Json): Song | undefined {
  const runs = (card.subtitle?.runs as Json[] | undefined) ?? [];
  if (!/^(song|video)$/i.test(String(runs[0]?.text ?? '').trim())) return undefined;
  const videoId: string | undefined = collect(card.title, 'watchEndpoint')[0]?.videoId ?? collect(card.onTap, 'watchEndpoint')[0]?.videoId;
  const title = runsText(card.title);
  if (!videoId || !title) return undefined;
  const artists: Artist[] = [];
  let album = '';
  let secs = 0;
  for (const run of runs.slice(1)) {
    const text = String(run.text ?? '').trim();
    if (!text || text === '•') continue;
    const browse: string = run.navigationEndpoint?.browseEndpoint?.browseId ?? '';
    if (/^\d+:\d{2}(:\d{2})?$/.test(text)) secs = seconds(text);
    else if (browse.startsWith('MPRE')) album = text;
    else if (browse.startsWith('UC') || (!browse && !artists.length && !album)) artists.push(artistOf(text, browse));
  }
  return song(videoId, title, artists, album, secs, lastThumb(card.thumbnail?.musicThumbnailRenderer?.thumbnail));
}

/** An "up next" entry. */
function fromPanel(p: Json): Song | undefined {
  const id: string | undefined = p.videoId;
  const title = runsText(p.title);
  if (!id || !title) return undefined;
  const runs = (p.longBylineText?.runs as Json[] | undefined) ?? [];
  const artists: Artist[] = [];
  let album = '';
  for (const run of runs) {
    const text = String(run.text ?? '').trim();
    const browse: string = run.navigationEndpoint?.browseEndpoint?.browseId ?? '';
    if (!text || text === '•' || /^\d{4}$/.test(text)) continue;
    if (browse.startsWith('MPRE')) album = text;
    else if (browse.startsWith('UC') || (!browse && !artists.length)) artists.push(artistOf(text, browse));
  }
  return song(id, title, artists, album, seconds(runsText(p.lengthText)), lastThumb(p.thumbnail));
}

/* ---------- what the app asks for ---------- */

const SONGS_ONLY = 'EgWKAQIIAWoKEAMQBBAJEAoQBQ==';

/**
 * What YouTube Music's own search box shows, then its songs list after it.
 *
 * The songs-only filter used to be the whole answer, and it hides everything
 * YouTube Music files as a video or an upload: bass-boosted and instrumental
 * versions, live takes, fan edits. Typing "jeene laga hoon" in YouTube Music
 * lists those near the top; here they never appeared. The unfiltered search is
 * what the app itself shows, so it goes first and keeps its order exactly (the
 * "Top result" card, then its own lists): nothing here reorders it, so the same
 * words give the same first song as YouTube Music. The songs filter follows to
 * add whatever the first page left out. One of the two failing is not a failed
 * search.
 */
export async function searchSongs(query: string): Promise<Song[]> {
  const [mixed, songs] = await Promise.allSettled([
    music('search', { query }),
    music('search', { query, params: SONGS_ONLY }),
  ]);
  const out: Song[] = [];
  const seen = new Set<string>();
  const add = (s: Song | undefined) => {
    if (s && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  };
  // The "Top result" card first: it is what YouTube Music itself puts on top, and it is not a list row.
  // Its own side panel ("More from YouTube": slowed, lo-fi and fan uploads) is made of list rows too,
  // but the app shows it beside the card and not in the list, so those rows wait until the end here.
  const aside: Json[] = [];
  if (mixed.status === 'fulfilled') {
    for (const card of collect(mixed.value, 'musicCardShelfRenderer')) {
      add(fromCard(card));
      aside.push(...collect(card.contents, 'musicResponsiveListItemRenderer'));
    }
  }
  for (const res of [mixed, songs]) {
    if (res.status !== 'fulfilled') continue;
    for (const row of collect(res.value, 'musicResponsiveListItemRenderer')) {
      if (!aside.includes(row)) add(fromRow(row));
    }
  }
  for (const row of aside) add(fromRow(row));
  if (!out.length) {
    const failed = [mixed, songs].find((r): r is PromiseRejectedResult => r.status === 'rejected');
    throw failed?.reason instanceof Error ? failed.reason : new YtmError('Nothing found');
  }
  return out;
}

/** "More like this": YouTube Music's own radio from one song. */
export async function upNext(videoId: string, n = 20): Promise<Song[]> {
  const res = await music('next', {
    videoId,
    playlistId: `RDAMVM${videoId}`,
    isAudioOnly: true,
    tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
  });
  const out: Song[] = [];
  const seen = new Set<string>([`yt:${videoId}`]);
  for (const panel of collect(res, 'playlistPanelVideoRenderer')) {
    const s = fromPanel(panel);
    if (s && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  if (!out.length) throw new YtmError('No radio');
  return out.slice(0, n);
}

/** Home: the carousels that are made of songs. */
export async function home(): Promise<Module[]> {
  const res = await music('browse', { browseId: 'FEmusic_home' });
  const modules: Module[] = [];
  for (const shelf of collect(res, 'musicCarouselShelfRenderer')) {
    const title = runsText(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title);
    const items: Song[] = [];
    for (const row of collect(shelf.contents, 'musicResponsiveListItemRenderer')) {
      const s = fromRow(row);
      if (s) items.push(s);
    }
    for (const two of collect(shelf.contents, 'musicTwoRowItemRenderer')) {
      const id: string | undefined = collect(two, 'watchEndpoint')[0]?.videoId;
      const name = runsText(two.title);
      if (!id || !name) continue;
      const by = runsText(two.subtitle).split('•').map((t) => t.trim()).filter(Boolean).filter((t) => !/^(song|video)$/i.test(t));
      items.push(song(id, name, by[0] ? [artistOf(by[0])] : [], '', 0, lastThumb(two.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail)));
    }
    if (title && items.length >= 3) modules.push({ key: `yt-${modules.length}`, title, subtitle: '', items: items.slice(0, 20) });
  }
  if (!modules.length) throw new YtmError('Home is empty');
  return modules;
}

/* ---------- playing ---------- */

const STREAM_TTL = 60 * 60_000;
const streams = new Map<string, { at: number; stream: Stream }>();

/**
 * Addresses for one video: itag 139 / 140 (AAC, 48 and about 130 kbps) plays
 * everywhere; 251 (Opus, about 136 kbps) is offered where the browser has an
 * Opus decoder. They go in the `Stream` slots the app already chooses from.
 */
export async function resolveStream(videoId: string): Promise<Stream> {
  const hit = streams.get(videoId);
  if (hit && Date.now() - hit.at < STREAM_TTL) return hit.stream;

  const res = await post(
    PLAYER_API,
    { 'user-agent': VR_UA, 'x-youtube-client-name': '28', 'x-youtube-client-version': VR_VERSION },
    { context: { client: VR_CLIENT }, videoId, contentCheckOk: true, racyCheckOk: true },
  );
  const status = res.playabilityStatus?.status;
  if (status && status !== 'OK') throw new YtmError(res.playabilityStatus?.reason ?? `Not playable (${status})`);

  const formats = (res.streamingData?.adaptiveFormats as Json[] | undefined) ?? [];

  const url = (itag: number) => formats.find((f) => f.itag === itag && typeof f.url === 'string')?.url as string | undefined;
  const stream: Stream = {};
  const low = url(139);
  const mid = url(140);
  const high = url(251);
  if (low) stream['48'] = low;
  if (mid) {
    stream['96'] = mid;
    stream['160'] = mid;
  }
  const opus = typeof Audio !== 'undefined' && new Audio().canPlayType('audio/webm; codecs="opus"') !== '';
  if (high && opus) stream['320'] = high;
  else if (mid) stream['320'] = mid;
  if (!Object.keys(stream).length) throw new YtmError('No audio address');

  streams.set(videoId, { at: Date.now(), stream });
  return stream;
}

export const forget = (videoId: string) => streams.delete(videoId);

export const isYtId = (id: string) => id.startsWith('yt:');
export const videoIdOf = (id: string) => id.slice(3);
