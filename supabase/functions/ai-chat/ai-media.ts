/**
 * Songs and titles PINGO AI can put in a chat as cards.
 *
 * ## What the model does and does not do
 *
 * The model names things it knows: "Tum Hi Ho Arijit Singh", "Inception 2010".
 * This file asks the catalogues whether they exist and what they look like. A
 * song or film the model invented finds nothing and is dropped, so a card is
 * always something that can actually be played. The model never writes an id,
 * an address or a picture URL.
 *
 * ## Cost
 *
 * Searches are plain HTTP to the music Worker and TMDB, in parallel, with a
 * short timeout, so they add no model tokens. What goes back to the model is a
 * line per result (a few tokens each), not the catalogue's answer. The tools are
 * only offered on a turn that looks like it wants music or something to watch
 * (`wantsMedia`), so every other turn pays nothing for them.
 *
 * ## What a card carries
 *
 * Only what it needs to draw itself, in short keys, so a reply with a dozen of
 * them stays well under the 16 KB the message meta allows. A song's playable
 * address is not stored: JioSaavn's change, so the app looks the song up by id
 * when it is tapped.
 */

export interface SongCard {
  t: 'song';
  id: string;
  /** Name. */
  n: string;
  /** Artists, joined. */
  a: string;
  /** Cover. */
  i: string;
  /** Seconds. */
  s: number;
}

export interface TitleCard {
  t: 'title';
  /** TMDB id. */
  id: number;
  y: 'movie' | 'tv';
  n: string;
  /** Year. */
  yr: number;
  /** Backdrop path (16:9). */
  b: string;
  /** Poster path, for when there is no backdrop. */
  p: string;
  /** Rating, one decimal. */
  r: number;
  /** A short overview. */
  o: string;
}

export type AiCard = SongCard | TitleCard;

export interface MediaIntent {
  music: boolean;
  watch: boolean;
}

const MUSIC = /\b(songs?|gaan[ae]|gana|music|musics|playlist|album|singer|sunao|sunna|suna\s?do|lyrics|tracks?|beats|lofi|bgm|ringtone|spotify)\b/i;
const WATCH = /\b(movies?|films?|series|web\s?series|shows?|anime|watch|watching|dekh(na|ne|u|enge)?|netflix|prime|season|episode|kdrama|k-drama|cartoon|documentary|trailer)\b/i;
const MOOD = /\b(mood|udaas|sad|bore|bored|boring|happy|romantic|workout|gym|study|sleep|party|breakup|lonely|nostalgic|vibe|vibes|relax|chill|recommend|suggest|sujhao|suggestion)\b/i;

/**
 * Whether this turn looks like a request for something to listen to or watch.
 * The tools (and their instructions) are offered only when it does.
 */
export function wantsMedia(text: string): MediaIntent {
  const t = text.slice(0, 600);
  const music = MUSIC.test(t);
  const watch = WATCH.test(t);
  if (music || watch) return { music: music || (!watch && MOOD.test(t)), watch: watch || (!music && MOOD.test(t)) };
  // A mood or "suggest something" with no noun: both are possible, the model chooses.
  if (MOOD.test(t)) return { music: true, watch: true };
  return { music: false, watch: false };
}

/* ---------- songs ---------- */

interface SaavnSong {
  id?: unknown;
  name?: unknown;
  artists?: { name?: unknown; role?: unknown }[];
  image?: unknown;
  secs?: unknown;
  explicit?: unknown;
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const decodeEntities = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function toSongCard(s: SaavnSong): SongCard | undefined {
  const id = clean(s.id, 32);
  const n = decodeEntities(clean(s.name, 100));
  if (!id || !n) return undefined;
  const artists = (s.artists ?? [])
    .filter((a) => !a.role || a.role === 'primary_artists')
    .map((a) => decodeEntities(clean(a.name, 40)))
    .filter(Boolean)
    .slice(0, 2)
    .join(', ');
  const image = clean(s.image, 300);
  return {
    t: 'song',
    id,
    n,
    a: artists,
    i: /^https:\/\//.test(image) ? image : '',
    s: Math.max(0, Math.round(Number(s.secs) || 0)),
  };
}

async function getJson<T>(url: string, init: RequestInit, ms: number): Promise<T | undefined> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

/**
 * Songs for a handful of searches. The best match of each, in the order asked,
 * without repeats; a search that finds nothing is skipped.
 */
export async function findSongs(queries: string[], opts: { base: string; max?: number; perQuery?: number }): Promise<SongCard[]> {
  const max = Math.min(opts.max ?? 6, 20);
  const per = Math.min(opts.perQuery ?? 1, 3);
  const asked = [...new Set(queries.map((q) => clean(q, 80)).filter((q) => q.length >= 2))].slice(0, max);
  const base = opts.base.replace(/\/+$/, '');
  const found = await Promise.all(
    asked.map(async (q) => {
      const body = await getJson<{ data?: { items?: SaavnSong[] } }>(`${base}/search/songs?q=${encodeURIComponent(q)}&page=1`, {}, 5000);
      return (body?.data?.items ?? []).slice(0, per).map(toSongCard).filter((c): c is SongCard => !!c);
    }),
  );
  const seen = new Set<string>();
  const out: SongCard[] = [];
  for (const group of found) {
    for (const card of group) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      out.push(card);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/* ---------- films and series ---------- */

export interface TitleAsk {
  title: string;
  type?: 'movie' | 'tv';
  year?: number;
}

interface TmdbResult {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  backdrop_path?: string | null;
  poster_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  overview?: string;
  original_language?: string;
}

const path = (v: unknown) => (typeof v === 'string' && /^\/[\w.-]+\.(jpg|png|webp)$/i.test(v) ? v : '');

function toTitleCard(r: TmdbResult, fallbackType?: 'movie' | 'tv'): TitleCard | undefined {
  const y = r.media_type === 'movie' || r.media_type === 'tv' ? r.media_type : fallbackType;
  if (!y || typeof r.id !== 'number') return undefined;
  const n = clean(r.title ?? r.name, 100);
  if (!n) return undefined;
  const b = path(r.backdrop_path);
  const p = path(r.poster_path);
  // Nothing to show: a card with no picture at all is not worth the room.
  if (!b && !p) return undefined;
  const date = r.release_date ?? r.first_air_date ?? '';
  return {
    t: 'title',
    id: r.id,
    y,
    n,
    yr: Number(date.slice(0, 4)) || 0,
    b,
    p,
    r: Math.round((Number(r.vote_average) || 0) * 10) / 10,
    o: clean(r.overview, 140),
  };
}

/**
 * The best match for each title: the same type if one was named, the year if
 * one was, otherwise the most popular. Adult titles are never searched.
 */
export async function findTitles(asks: TitleAsk[], opts: { token: string; max?: number }): Promise<TitleCard[]> {
  const max = Math.min(opts.max ?? 4, 10);
  const jwt = opts.token.length > 40;
  const headers: Record<string, string> = { accept: 'application/json', ...(jwt ? { authorization: `Bearer ${opts.token}` } : {}) };
  const key = jwt ? '' : `&api_key=${encodeURIComponent(opts.token)}`;

  const wanted = asks
    .map((a) => ({ title: clean(a.title, 80), type: a.type, year: a.year }))
    .filter((a) => a.title.length >= 1)
    .slice(0, max);

  const found = await Promise.all(
    wanted.map(async (a) => {
      const kind = a.type ?? 'multi';
      const yearParam = a.year && a.year > 1900 ? `&${a.type === 'tv' ? 'first_air_date_year' : 'year'}=${Math.round(a.year)}` : '';
      const body = await getJson<{ results?: TmdbResult[] }>(
        `https://api.themoviedb.org/3/search/${kind}?query=${encodeURIComponent(a.title)}&include_adult=false&page=1${kind === 'multi' ? '' : yearParam}${key}`,
        { headers },
        5000,
      );
      const results = (body?.results ?? []).filter((r) => kind !== 'multi' || r.media_type === 'movie' || r.media_type === 'tv');
      // The first result is TMDB's own relevance; prefer one that has a picture and some votes.
      const best = results.find((r) => (r.backdrop_path || r.poster_path) && (r.vote_count ?? 0) >= 20) ?? results.find((r) => r.backdrop_path || r.poster_path);
      return best ? toTitleCard(best, a.type) : undefined;
    }),
  );

  const seen = new Set<string>();
  const out: TitleCard[] = [];
  for (const card of found) {
    if (!card) continue;
    const k = `${card.y}:${card.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(card);
  }
  return out;
}

/* ---------- what goes back to the model ---------- */

/** One short line per card: enough for the model to say something true about them, nothing more. */
export function describeCards(cards: AiCard[]): string {
  if (!cards.length) return 'Nothing was found for those. Tell them briefly and offer to try different names.';
  return cards
    .map((c) => (c.t === 'song' ? `- song: ${c.n}${c.a ? ` by ${c.a}` : ''}` : `- ${c.y === 'tv' ? 'series' : 'film'}: ${c.n}${c.yr ? ` (${c.yr})` : ''}${c.r ? `, ${c.r}/10` : ''}`))
    .join('\n');
}

/**
 * The songs of a playlist as the app keeps them (`Kept` in the music library):
 * what a list row draws, and the id the playable address is looked up by.
 */
export function keptFrom(card: SongCard) {
  return {
    id: card.id,
    name: card.n,
    artists: card.a ? card.a.split(', ').map((name) => ({ id: '', name })) : [],
    album: '',
    image: card.i,
    secs: card.s,
    language: '',
  };
}
