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

export async function searchSongs(query: string): Promise<Song[]> {
  const res = await music('search', { query, params: SONGS_ONLY });
  const out: Song[] = [];
  const seen = new Set<string>();
  for (const row of collect(res, 'musicResponsiveListItemRenderer')) {
    const s = fromRow(row);
    if (s && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  if (!out.length) throw new YtmError('Nothing found');
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
 * The clients to ask for an audio address, in order.
 *
 * One client is not enough. YouTube answers some videos with
 * `LOGIN_REQUIRED` / "Sign in to confirm you're not a bot" for one client and
 * hands the same video over to another — which is why clients like Flow and
 * PipePipe ship a set of them plus BotGuard attestation rather than a single
 * call. The Quest client below is still first because it returns plain `url`s
 * with no signature cipher, and it is the one that has needed nothing else so
 * far; the rest are what a song falls back to when that stops being true.
 *
 * A client's headers and its `context.client` have to agree, or YouTube treats
 * the request as the wrong app and refuses it.
 */
interface PlayerClient {
  label: string;
  name: string;
  version: string;
  userAgent: string;
  context: Json;
}

const PLAYER_CLIENTS: PlayerClient[] = [
  {
    label: 'android_vr',
    name: '28',
    version: VR_VERSION,
    userAgent: VR_UA,
    context: VR_CLIENT,
  },
  {
    // iOS still gets plain urls for most tracks and is rarely challenged.
    label: 'ios',
    name: '5',
    version: '19.45.4',
    userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)',
    context: {
      clientName: 'IOS',
      clientVersion: '19.45.4',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.1.0.22B83',
      hl: 'en',
      gl: 'IN',
    },
  },
  {
    // The embedded player is what a website is allowed to use, so it is the
    // least likely to demand a sign-in.
    label: 'tv_embedded',
    name: '85',
    version: '2.0',
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    context: {
      clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      clientVersion: '2.0',
      hl: 'en',
      gl: 'IN',
      thirdParty: { embedUrl: 'https://www.youtube.com/' },
    },
  },
  {
    label: 'web_embedded',
    name: '56',
    version: '1.20250101.00.00',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    context: {
      clientName: 'WEB_EMBEDDED_PLAYER',
      clientVersion: '1.20250101.00.00',
      hl: 'en',
      gl: 'IN',
    },
  },
];

/** True when YouTube is asking for a sign-in or accusing the caller of being a bot. */
export const isBotCheck = (reason: string): boolean =>
  /sign in|not a bot|verify you|automated|captcha/i.test(reason);

/** Turn one player answer into the `Stream` slots the app already chooses from. */
function formatsToStream(res: Json): Stream | null {
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

  return Object.keys(stream).length ? stream : null;
}

/**
 * Addresses for one video: itag 139 / 140 (AAC, 48 and about 130 kbps) plays
 * everywhere; 251 (Opus, about 136 kbps) is offered where the browser has an
 * Opus decoder.
 *
 * Each client in the list is tried in turn, and only when every one of them
 * refuses does the song become unavailable. That is the difference between one
 * track being blocked and the whole catalogue looking broken.
 */
export async function resolveStream(videoId: string): Promise<Stream> {
  const hit = streams.get(videoId);
  if (hit && Date.now() - hit.at < STREAM_TTL) return hit.stream;

  const failures: string[] = [];

  for (const client of PLAYER_CLIENTS) {
    try {
      const res = await post(
        PLAYER_API,
        {
          'user-agent': client.userAgent,
          'x-youtube-client-name': client.name,
          'x-youtube-client-version': client.version,
        },
        { context: { client: client.context }, videoId, contentCheckOk: true, racyCheckOk: true },
      );

      const status = res.playabilityStatus?.status;
      const reason: string = res.playabilityStatus?.reason ?? '';

      if (status && status !== 'OK') {
        failures.push(`${client.label}: ${reason || status}`);
        /*
         * "Sign in to confirm you're not a bot" is not about the client.
         *
         * Measured: the same video is refused by ANDROID_VR and by TVHTML5 with
         * the same wording, while another video plays fine as ANDROID_VR. It is
         * the requesting address being challenged, so walking the rest of the
         * list only spends seconds to collect identical refusals.
         *
         * The real answer to it is BotGuard attestation — a PO token minted from
         * the challenged address, which is what Flow and PipePipe ship (and why
         * they list "BotGuard/PoToken attestation" in their credits). A PO token
         * cannot be minted in this component: it needs the BotGuard script and a
         * stable address, so it belongs in a service, not a browser tab.
         */
        if (isBotCheck(reason)) break;
        continue;
      }

      const stream = formatsToStream(res);
      if (!stream) {
        failures.push(`${client.label}: no audio address`);
        continue;
      }

      streams.set(videoId, { at: Date.now(), stream });
      return stream;
    } catch (e) {
      failures.push(`${client.label}: ${e instanceof Error ? e.message : 'unreachable'}`);
    }
  }

  const bot = failures.some(isBotCheck);
  throw new YtmError(
    bot
      ? `YouTube asked this device to sign in (${failures.join('; ')})`
      : `No audio address (${failures.join('; ')})`,
  );
}

export const forget = (videoId: string) => streams.delete(videoId);

export const isYtId = (id: string) => id.startsWith('yt:');
export const videoIdOf = (id: string) => id.slice(3);
