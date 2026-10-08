/**
 * pingo-saavn: everything JioSaavn has, in one small regular API for PINGO Music.
 *
 * The old `pingo-music` Worker is an open-source wrapper that covers search,
 * songs, albums, artists and playlists. JioSaavn itself has a good deal more,
 * and most of what makes it feel alive is in the part that wrapper leaves out:
 * the home screen, charts, trending, new releases, moods and genres, radio that
 * never runs dry, lyrics, top searches, artist pages with their singles and
 * similar artists. This Worker speaks JioSaavn's own `api.php` directly and
 * returns all of it in the shapes in `normalize.ts`.
 *
 * ## Where the calls go
 *
 * Through the `saavn-proxy` Edge Function, pinned to Mumbai, for the reason in
 * `workers/music/README.md`: JioSaavn answers by the caller's country, and
 * Cloudflare's addresses are not Indian.
 *
 * ## Routes (all GET, all JSON as `{ data }` or `{ error }`)
 *
 *   /home?lang=hindi,punjabi      the home screen, in JioSaavn's order
 *   /charts                       the weekly charts (playlists)
 *   /trending?lang=hindi&type=song
 *   /new?lang=&page=              new releases
 *   /featured?lang=&page=         editorial playlists
 *   /top-searches
 *   /channels/:id                 a mood or genre: playlists, stations, top songs
 *
 *   /search?q=                    everything at once, as you type (top, songs, albums, artists, playlists)
 *   /search/songs?q=&page=        and one kind at a time, paged
 *   /search/albums  /search/artists  /search/playlists
 *
 *   /songs/:id[,id...]            full details, with stream addresses
 *   /songs/:id/lyrics
 *   /songs/:id/radio?n=10         a station seeded with this song, kept to its sound (the "for you" queue)
 *   /albums/:id
 *   /playlists/:id?page=&n=
 *   /artists/:id                  the artist page
 *   /artists/:id/songs?page=&sort=popularity|latest|alphabetical
 *   /artists/:id/albums?page=&sort=
 *
 *   /stations/featured?name=&lang=   start a featured station  -> { stationId }
 *   /stations/artist?name=&lang=     start an artist station   -> { stationId }
 *   /stations/:stationId/next?n=5    the next songs of a station
 *
 *   /link?url=                    a jiosaavn.com address, resolved to its song/album/playlist/artist
 */

import { album, artist, channel, items, modules, playlist, raw, song, text, type Song } from './normalize.js';
import { anchorQuery, pickAnchors, soundOf } from './sound.js';

interface Env {
  /** The Mumbai proxy; overridable for testing. */
  SAAVN_PROXY?: string;
}

const PROXY = 'https://gpijpmepzowwhvgkriqu.supabase.co/functions/v1/saavn-proxy';
const LANGS = new Set(['hindi', 'english', 'punjabi', 'tamil', 'telugu', 'marathi', 'gujarati', 'bengali', 'kannada', 'bhojpuri', 'malayalam', 'urdu', 'haryanvi', 'rajasthani', 'odia', 'assamese']);

type Raw = Record<string, unknown>;

class Upstream extends Error {}

/** One call to JioSaavn's api.php. `lang` becomes its language cookie, via the proxy. */
async function saavn(env: Env, call: string, params: Record<string, string | number> = {}, opts: { lang?: string; ctx?: string } = {}): Promise<unknown> {
  const url = new URL(env.SAAVN_PROXY || PROXY);
  url.searchParams.set('__call', call);
  url.searchParams.set('_format', 'json');
  url.searchParams.set('_marker', '0');
  url.searchParams.set('api_version', '4');
  url.searchParams.set('ctx', opts.ctx ?? 'web6dot0');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { 'x-region': 'ap-south-1' };
  if (opts.lang) headers['x-saavn-lang'] = opts.lang;
  let last: unknown;
  // One retry: the proxy is a cold Edge Function now and then.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Upstream(`JioSaavn answered ${res.status}`);
      const body = (await res.json()) as unknown;
      const err = raw.obj(raw.obj(body).error);
      if (err.msg || err.code) throw new Upstream(text(err.msg) || text(err.code));
      return body;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Upstream('JioSaavn did not answer');
}

const langOf = (v: string | null): string | undefined => {
  const list = (v ?? '').toLowerCase().split(',').map((s) => s.trim()).filter((s) => LANGS.has(s));
  return list.length ? list.join(',') : undefined;
};
const page = (v: string | null) => Math.max(1, Math.min(50, Number(v) || 1));
const size = (v: string | null, d: number, max = 50) => Math.max(1, Math.min(max, Number(v) || d));

/* ---------- search ---------- */

/**
 * Ask the way people type: when JioSaavn finds nothing, try again with the
 * spelling loosened the way Hinglish varies (doubled letters, ee/i, oo/u, w/v).
 * JioSaavn already forgives a lot; this catches the rest.
 */
function loosen(q: string): string {
  return q
    .toLowerCase()
    .replace(/(.)\1+/g, '$1')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/w/g, 'v')
    .replace(/\s+/g, ' ')
    .trim();
}

async function searchAll(env: Env, q: string) {
  const run = async (query: string) => raw.obj(await saavn(env, 'autocomplete.get', { query }));
  let d = await run(q);
  const empty = (x: Raw) => ['songs', 'albums', 'artists', 'playlists', 'topquery'].every((k) => !raw.arr(raw.obj(x[k]).data).length);
  let corrected: string | undefined;
  if (empty(d) && loosen(q) !== q.toLowerCase()) {
    d = await run(loosen(q));
    if (!empty(d)) corrected = loosen(q);
  }
  const part = (k: string) => items(raw.obj(d[k]).data);
  // Autocomplete songs carry no stream; fetch the top few fully so the first tap plays at once.
  const songIds = raw.arr(raw.obj(d.songs).data).map((s) => text(s.id)).filter(Boolean).slice(0, 6);
  const full = songIds.length ? await songsById(env, songIds).catch(() => [] as Song[]) : [];
  return {
    ...(corrected ? { corrected } : {}),
    top: part('topquery'),
    songs: full.length ? full : part('songs'),
    albums: part('albums'),
    artists: part('artists'),
    playlists: part('playlists'),
  };
}

const SEARCH_CALLS: Record<string, string> = { songs: 'search.getResults', albums: 'search.getAlbumResults', artists: 'search.getArtistResults', playlists: 'search.getPlaylistResults' };

async function searchKind(env: Env, kind: string, q: string, p: number, n: number) {
  const call = SEARCH_CALLS[kind];
  if (!call) throw new Upstream('Unknown search kind');
  const run = async (query: string) => raw.obj(await saavn(env, call, { q: query, p, n }));
  let d = await run(q);
  let corrected: string | undefined;
  if (!raw.arr(d.results).length && p === 1 && loosen(q) !== q.toLowerCase()) {
    d = await run(loosen(q));
    if (raw.arr(d.results).length) corrected = loosen(q);
  }
  const results = raw.arr(d.results);
  const list = kind === 'songs' ? results.map(song) : kind === 'albums' ? results.map(album) : kind === 'artists' ? results.map(artist) : results.map(playlist);
  return { ...(corrected ? { corrected } : {}), total: raw.num(d.total), page: p, items: list, more: p * n < raw.num(d.total) };
}

/* ---------- entities ---------- */

async function songsById(env: Env, ids: string[]): Promise<Song[]> {
  const d = raw.obj(await saavn(env, 'song.getDetails', { pids: ids.join(',') }));
  const list = raw.arr(d.songs).length ? raw.arr(d.songs) : ids.map((id) => raw.obj(d[id])).filter((x) => x.id);
  return list.map(song);
}

async function lyrics(env: Env, id: string) {
  const d = raw.obj(await saavn(env, 'lyrics.getLyrics', { lyrics_id: id }));
  const body = text(d.lyrics);
  if (!body) throw new Upstream('No lyrics for this song');
  return { lines: body.split(/<br\s*\/?>/i).map((l) => l.trim()), copyright: text(d.lyrics_copyright), snippet: text(d.snippet) };
}

/**
 * A radio seeded with one or more songs: JioSaavn's own "more like this",
 * kept to the seeds' sound (`sound.ts` says why and how).
 */
async function radio(env: Env, ids: string[], n: number) {
  const seeds = await songsById(env, ids).catch(() => [] as Song[]);
  const sound = soundOf(seeds);
  let anchors: Song[] = [];
  if (sound) {
    const found = await saavn(env, 'search.getResults', { q: anchorQuery(sound, seeds), p: 1, n: 30 }).catch(() => ({}));
    anchors = pickAnchors(sound, raw.arr(raw.obj(found).results).map(song), seeds) as Song[];
  }

  const start = async (entity: string[]) => {
    const st = raw.obj(await saavn(env, 'webradio.createEntityStation', { entity_id: JSON.stringify(entity), entity_type: 'queue' }, { ctx: 'android' }));
    const stationId = text(st.stationid);
    if (!stationId) throw new Upstream('No station for this song');
    return { stationId, songs: await stationNext(env, stationId, n) };
  };
  let st = await start([...ids, ...anchors.map((a) => a.id)]);

  // Nothing came: a song from a small label with no station behind it. Its singer's station, then.
  const lead = seeds[0]?.artists[0]?.name;
  if (!st.songs.length && lead) {
    const lang = seeds[0]?.language && seeds[0].language !== 'unknown' ? seeds[0].language : 'hindi';
    const a = raw.obj(await saavn(env, 'webradio.createArtistStation', { name: lead, language: lang }, { ctx: 'android' }).catch(() => ({})));
    const id = text(a.stationid);
    if (id) st = { stationId: id, songs: await stationNext(env, id, n).catch(() => [] as Song[]) };
  }

  // The anchors are this sound's surest songs: they play early too, so the queue is in the sound from the second song.
  const seen = new Set(ids);
  const songs = [...st.songs.slice(0, 1), ...anchors.slice(0, 1), ...st.songs.slice(1, 3), ...anchors.slice(1), ...st.songs.slice(3)].filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  return { stationId: st.stationId, songs, ...(sound ? { sound: sound.tag } : {}) };
}

async function stationNext(env: Env, stationId: string, n: number): Promise<Song[]> {
  const d = raw.obj(await saavn(env, 'webradio.getSong', { stationid: stationId, k: n, next: 1 }, { ctx: 'android' }));
  return Object.values(d)
    .map((v) => raw.obj(raw.obj(v).song))
    .filter((s) => s.id)
    .map(song);
}

async function artistPage(env: Env, id: string) {
  const d = raw.obj(await saavn(env, 'artist.getArtistPageDetails', { artistId: id, n_song: 20, n_album: 20, page: 0, sub_type: '', category: '', sort_order: '' }));
  let bio: { title: string; text: string }[] = [];
  try {
    bio = (JSON.parse(text(d.bio) || '[]') as Raw[]).map((b) => ({ title: text(b.title), text: text(b.text) })).filter((b) => b.text);
  } catch {
    bio = [];
  }
  const urls = raw.obj(d.urls);
  return {
    ...artist({ ...d, id: d.artistId }),
    followers: raw.num(d.follower_count),
    fans: raw.num(d.fan_count),
    verified: d.isVerified === true || d.isVerified === 'true',
    language: text(d.dominantLanguage),
    languages: (Array.isArray(d.availableLanguages) ? d.availableLanguages.map(text) : Object.keys(raw.obj(d.availableLanguages))).filter((l) => l && l !== 'unknown'),
    hasRadio: d.isRadioPresent === true || d.isRadioPresent === 'true',
    bio,
    born: text(d.dob),
    links: { wiki: text(d.wiki), facebook: text(d.fb), twitter: text(d.twitter) },
    topSongs: raw.arr(d.topSongs).map(song),
    topAlbums: raw.arr(d.topAlbums).map(album),
    singles: raw.arr(d.singles).map(album),
    latest: raw.arr(d.latest_release).map(album),
    playlists: [...raw.arr(d.dedicated_artist_playlist), ...raw.arr(d.featured_artist_playlist)].map(playlist),
    similar: raw.arr(d.similarArtists).map((a) => artist({ ...a, image: a.image_url ?? a.image })),
    more: { songs: Boolean(urls.songs), albums: Boolean(urls.albums) },
  };
}

const SORTS = new Set(['popularity', 'latest', 'alphabetical']);

async function artistMore(env: Env, id: string, kind: 'songs' | 'albums', p: number, sort: string) {
  const call = kind === 'songs' ? 'artist.getArtistMoreSong' : 'artist.getArtistMoreAlbum';
  const d = raw.obj(await saavn(env, call, { artistId: id, page: p - 1, sort_order: '', category: SORTS.has(sort) ? sort : 'popularity' }));
  const block = raw.obj(d[kind === 'songs' ? 'topSongs' : 'topAlbums']);
  const list = raw.arr(block[kind]);
  const total = raw.num(block.total);
  return { total, page: p, items: kind === 'songs' ? list.map(song) : list.map(album), more: list.length > 0 && (total ? p * list.length < total : true) };
}

async function channelPage(env: Env, id: string) {
  const d = raw.obj(await saavn(env, 'channel.getDetails', { channel_id: id, p: 1, n: 20 }));
  return { ...channel(d), description: text(d.header_desc), modules: modules(d) };
}

/** Resolves a jiosaavn.com address (song, album, playlist, artist) to the thing itself. */
async function link(env: Env, address: string) {
  const u = new URL(address);
  if (!/(^|\.)(jiosaavn|saavn)\.com$/.test(u.hostname)) throw new Upstream('Not a JioSaavn link');
  const parts = u.pathname.split('/').filter(Boolean);
  const token = parts[parts.length - 1] ?? '';
  const kind = parts.includes('song') ? 'song' : parts.includes('album') ? 'album' : parts.includes('artist') ? 'artist' : parts.includes('featured') || parts.includes('playlist') ? 'playlist' : '';
  if (!kind || !token) throw new Upstream('Unknown JioSaavn link');
  const d = raw.obj(await saavn(env, 'webapi.get', { token, type: kind, n: 50, p: 1, includeMetaTags: 0 }));
  if (kind === 'song') return raw.arr(d.songs).map(song)[0];
  if (kind === 'album') return album(d);
  if (kind === 'playlist') return playlist(d);
  return artistPage(env, text(d.artistId) || token);
}

/* ---------- the router ---------- */

/** How long each answer may be kept, in seconds. Station answers never are: each one is the next song. */
function ttl(path: string): number {
  if (path.startsWith('/stations') || path.endsWith('/radio')) return 0;
  if (path.startsWith('/search') || path === '/top-searches') return 600;
  if (path === '/home' || path === '/trending' || path === '/new' || path === '/featured' || path === '/charts') return 900;
  return 6 * 3600;
}

async function route(env: Env, url: URL): Promise<unknown> {
  const q = url.searchParams;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean);
  const lang = langOf(q.get('lang'));

  if (path === '/home') {
    const d = raw.obj(await saavn(env, 'webapi.getLaunchData', {}, lang ? { lang } : {}));
    return { modules: modules(d) };
  }
  if (path === '/charts') return items(await saavn(env, 'content.getCharts', {}, lang ? { lang } : {}));
  if (path === '/trending') {
    const type = q.get('type') === 'album' ? 'album' : q.get('type') === 'playlist' ? 'playlist' : 'song';
    return items(await saavn(env, 'content.getTrending', { entity_type: type, entity_language: (lang ?? 'hindi').split(',')[0]! }));
  }
  if (path === '/new' || path === '/featured') {
    const p = page(q.get('page'));
    const d = raw.obj(await saavn(env, path === '/new' ? 'content.getAlbums' : 'content.getFeaturedPlaylists', { p, n: size(q.get('n'), 20) }, lang ? { lang } : {}));
    return { page: p, items: items(d.data), more: d.last_page === false || d.last_page === 'false' };
  }
  if (path === '/top-searches') return items(await saavn(env, 'content.getTopSearches'));
  if (seg[0] === 'channels' && seg[1]) return channelPage(env, seg[1]);

  if (path === '/search') {
    const term = (q.get('q') ?? '').trim();
    if (!term) throw new Upstream('Nothing to search for');
    return searchAll(env, term);
  }
  if (seg[0] === 'search' && seg[1]) {
    const term = (q.get('q') ?? '').trim();
    if (!term) throw new Upstream('Nothing to search for');
    return searchKind(env, seg[1], term, page(q.get('page')), size(q.get('n'), 20));
  }

  if (seg[0] === 'songs' && seg[1]) {
    const ids = seg[1].split(',').filter(Boolean).slice(0, 50);
    if (seg[2] === 'lyrics') return lyrics(env, ids[0]!);
    if (seg[2] === 'radio') return radio(env, ids, size(q.get('n'), 10, 30));
    return songsById(env, ids);
  }
  if (seg[0] === 'albums' && seg[1]) return album(raw.obj(await saavn(env, 'content.getAlbumDetails', { albumid: seg[1] })));
  if (seg[0] === 'playlists' && seg[1]) {
    const p = page(q.get('page'));
    const n = size(q.get('n'), 50, 100);
    const pl = playlist(raw.obj(await saavn(env, 'playlist.getDetails', { listid: seg[1], p, n })));
    return { ...pl, page: p, more: p * n < pl.songCount };
  }
  if (seg[0] === 'artists' && seg[1]) {
    if (seg[2] === 'songs' || seg[2] === 'albums') return artistMore(env, seg[1], seg[2], page(q.get('page')), q.get('sort') ?? 'popularity');
    return artistPage(env, seg[1]);
  }

  if (seg[0] === 'stations') {
    if (seg[1] === 'featured' || seg[1] === 'artist') {
      const name = (q.get('name') ?? '').trim();
      if (!name) throw new Upstream('Which station?');
      const call = seg[1] === 'featured' ? 'webradio.createFeaturedStation' : 'webradio.createArtistStation';
      const params: Record<string, string> = { name, language: (lang ?? 'hindi').split(',')[0]! };
      if (seg[1] === 'artist') params.query = name;
      const n = size(q.get('n'), 5, 20);
      const st = raw.obj(await saavn(env, call, params).catch((e: unknown) => (seg[1] === 'artist' ? {} : Promise.reject(e))));
      const stationId = text(st.stationid);
      const songs = stationId ? await stationNext(env, stationId, n) : [];
      if (songs.length) return { stationId, songs };
      // A singer JioSaavn keeps no station for (a small label's phonk channel): a radio from their own songs, kept to their sound.
      if (seg[1] === 'artist') {
        const own = raw.arr(raw.obj(await saavn(env, 'search.getResults', { q: name, p: 1, n: 20 })).results)
          .map(song)
          .filter((x) => x.artists.some((a) => a.name.toLowerCase() === name.toLowerCase()))
          .sort((a, b) => b.plays - a.plays);
        if (own.length) {
          const r = await radio(env, own.slice(0, 3).map((x) => x.id), Math.max(n, 10));
          // Their own best song first: it is their radio.
          return { stationId: r.stationId, songs: [own[0]!, ...r.songs.filter((x) => x.id !== own[0]!.id)] };
        }
      }
      if (!stationId) throw new Upstream('No such station');
      return { stationId, songs };
    }
    if (seg[1] && seg[2] === 'next') return stationNext(env, decodeURIComponent(seg[1]), size(q.get('n'), 5, 20));
  }

  if (path === '/link') return link(env, q.get('url') ?? '');
  if (path === '/') return { name: 'pingo-saavn', routes: ['/home', '/charts', '/trending', '/new', '/featured', '/top-searches', '/channels/:id', '/search', '/search/:kind', '/songs/:ids', '/songs/:id/lyrics', '/songs/:id/radio', '/albums/:id', '/playlists/:id', '/artists/:id', '/artists/:id/songs', '/artists/:id/albums', '/stations/featured', '/stations/artist', '/stations/:id/next', '/link'] };
  return undefined;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (body: unknown, status: number, maxAge: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
  });

export default {
  async fetch(request: Request, env: Env, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return json({ error: 'GET only' }, 405, 0);
    const url = new URL(request.url);
    const keep = ttl(url.pathname);
    const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : undefined;
    if (keep && cache) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    try {
      const data = await route(env, url);
      if (data === undefined) return json({ error: 'Not found' }, 404, 0);
      const res = json({ data }, 200, keep);
      if (keep && cache) ctx?.waitUntil(cache.put(request, res.clone()));
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      return json({ error: msg }, e instanceof Upstream ? 404 : 502, 0);
    }
  },
};

