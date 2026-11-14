import type { TmdbMedia, TmdbResponse } from '../types.js';
import { INDIAN_LANGUAGES, tmdbGet } from './tmdb.js';

/**
 * Trending in India.
 *
 * TMDB has no "trending in a country" list. Its `/trending` is worldwide, and in
 * a normal week two or three Indian titles reach its first sixty. So this builds
 * one from the signals TMDB does have, the way a streaming home page would:
 *
 *  1. Candidates come from six places:
 *     - worldwide trending (day, and week for films and series),
 *     - films in Indian cinemas now (`/movie/now_playing?region=IN`),
 *     - Indian films of the last 120 days, by popularity,
 *     - Indian series with an episode in the last 45 days (on air now),
 *     - Indian series that began in the last 180 days (new on streaming).
 *  2. Each candidate gets a score:
 *       ln(1 + TMDB popularity)          how much it is being looked at, all sources agree on this
 *     x freshness                        a film fades after its first three weeks; on-air series stay fresh
 *     x buzz                             in worldwide trending today x1.5, this week x1.3; in Indian cinemas x1.2
 *     x agreement                        +8% for every further source that also found it
 *     x quality                          a damped rating (few votes count for little), 0.85 to 1.15
 *     x home                             Hindi x1.15, other Indian languages x1, a Hollywood film in Indian cinemas x0.45
 *  3. The list is then picked one at a time so it does not read like one
 *     language or one format: each pick of a language already picked costs 15%,
 *     a third film or series in a row costs 15%, at most two non-Indian titles
 *     and two long-running daily soaps or reality shows make the twenty.
 *
 * Every title carries `trend_note` (why it is here: "In cinemas now", "New
 * episodes") and `trend_rank`.
 */

const INDIAN = new Set<string>(INDIAN_LANGUAGES);
const DAY = 86_400_000;

type Source = 'day' | 'week' | 'cinema' | 'newFilm' | 'onAir' | 'newSeries';

interface Candidate {
  media: TmdbMedia;
  sources: Set<Source>;
}

const LIMIT = 20;
const MAX_FOREIGN = 2;
const MAX_LONG_RUNNERS = 2;
/** Soap (10766), reality (10764) and talk (10767): India's evening TV. */
const TV_FORMATS = [10766, 10764, 10767];

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
}

function daysSince(date: string | undefined): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / DAY) : null;
}

async function list(endpoint: string, params: Record<string, string | number>, type?: 'movie' | 'tv'): Promise<TmdbMedia[]> {
  const resp = await tmdbGet<TmdbResponse>(endpoint, params);
  const results = resp && Array.isArray(resp.results) ? resp.results : [];
  return results
    .map((m) => ({ ...m, media_type: type ?? m.media_type ?? (m.title ? 'movie' : 'tv') }))
    .filter((m) => m.media_type === 'movie' || m.media_type === 'tv');
}

async function gather(): Promise<Map<string, Candidate>> {
  const recentFilm = { 'primary_release_date.gte': isoDaysAgo(120), 'primary_release_date.lte': isoDaysAgo(-7) };
  const india = { with_origin_country: 'IN', include_adult: 'false', sort_by: 'popularity.desc' };
  const batches: Array<[Source, Promise<TmdbMedia[]>]> = [
    ['day', list('/trending/all/day', {})],
    ['week', list('/trending/movie/week', {}, 'movie')],
    ['week', list('/trending/movie/week', { page: 2 }, 'movie')],
    ['week', list('/trending/tv/week', {}, 'tv')],
    ['cinema', list('/movie/now_playing', { region: 'IN' }, 'movie')],
    ['newFilm', list('/discover/movie', { ...india, ...recentFilm, region: 'IN' }, 'movie')],
    ['newFilm', list('/discover/movie', { ...india, ...recentFilm, region: 'IN', page: 2 }, 'movie')],
    ['onAir', list('/discover/tv', { ...india, 'air_date.gte': isoDaysAgo(45), 'air_date.lte': isoDaysAgo(0) }, 'tv')],
    ['newSeries', list('/discover/tv', { ...india, 'first_air_date.gte': isoDaysAgo(180), 'vote_count.gte': 1 }, 'tv')],
  ];

  const all = new Map<string, Candidate>();
  const settled = await Promise.all(batches.map(([source, p]) => p.then((items) => [source, items] as const, () => [source, []] as const)));
  for (const [source, items] of settled) {
    for (const media of items) {
      if (!media.backdrop_path) continue; // the rail and the banner are both pictures
      const key = `${media.media_type}:${media.id}`;
      const had = all.get(key);
      if (had) {
        had.sources.add(source);
        // keep the richest copy (discover results carry origin_country, trending ones do not always)
        if ((media.popularity ?? 0) > (had.media.popularity ?? 0)) had.media = { ...had.media, ...media };
      } else {
        all.set(key, { media, sources: new Set([source]) });
      }
    }
  }
  return all;
}

function isIndian(m: TmdbMedia): boolean {
  return INDIAN.has(m.original_language ?? '');
}

function isLongRunner(m: TmdbMedia): boolean {
  const age = daysSince(m.first_air_date);
  return m.media_type === 'tv' && age !== null && age > 3 * 365 && Boolean(m.genre_ids?.some((g) => TV_FORMATS.includes(g)));
}

function freshness(c: Candidate): number {
  const m = c.media;
  if (m.media_type === 'tv') {
    const age = daysSince(m.first_air_date);
    if (age !== null && age <= 180) return 1; // a new series
    return c.sources.has('onAir') ? 0.75 : 0.45; // an older series: fresh only while episodes come out
  }
  const age = daysSince(m.release_date);
  if (age === null) return 0.4;
  if (age < -7) return 0; // not out yet
  if (age <= 21) return 1;
  return Math.max(0.25, Math.exp(-(age - 21) / 75));
}

function quality(m: TmdbMedia): number {
  const votes = m.vote_count ?? 0;
  const damped = ((m.vote_average ?? 0) * votes + 6.4 * 25) / (votes + 25);
  return 0.85 + 0.3 * Math.min(1, Math.max(0, (damped - 5) / 3.5));
}

function score(c: Candidate): number {
  const m = c.media;
  const indian = isIndian(m);
  // Something from abroad is only "trending in India" when Indian cinemas are showing it.
  if (!indian && !c.sources.has('cinema')) return 0;
  let s = Math.log1p(m.popularity ?? 0) * freshness(c) * quality(m);
  if (indian && c.sources.has('day')) s *= 1.5;
  else if (indian && c.sources.has('week')) s *= 1.3;
  if (c.sources.has('cinema')) s *= 1.2;
  s *= 1 + 0.08 * (c.sources.size - 1);
  if (!indian) s *= 0.45;
  if (m.original_language === 'hi') s *= 1.15; // Hindi first: Pingo's audience
  if (isLongRunner(m)) s *= 0.7;
  return s;
}

function note(c: Candidate): string {
  const m = c.media;
  if (c.sources.has('cinema')) return 'In cinemas now';
  if (m.media_type === 'tv') {
    const age = daysSince(m.first_air_date);
    if (age !== null && age <= 180) return 'New series';
    return 'New episodes';
  }
  if (c.sources.has('day') || c.sources.has('week')) return 'Trending worldwide';
  const age = daysSince(m.release_date);
  return age !== null && age > 35 ? 'New on streaming' : 'New release';
}

/** Pick the list one title at a time, so it mixes languages and formats. */
function pick(cands: Array<{ c: Candidate; s: number }>): TmdbMedia[] {
  const pool = cands.filter((x) => x.s > 0);
  const out: TmdbMedia[] = [];
  const langCount = new Map<string, number>();
  let foreign = 0;
  let longRunners = 0;
  while (out.length < LIMIT && pool.length > 0) {
    let bestI = -1;
    let best = 0;
    for (let i = 0; i < pool.length; i++) {
      const { c, s } = pool[i]!;
      const m = c.media;
      if (!isIndian(m) && foreign >= MAX_FOREIGN) continue;
      if (isLongRunner(m) && longRunners >= MAX_LONG_RUNNERS) continue;
      let adjusted = s * Math.pow(0.85, langCount.get(m.original_language ?? '') ?? 0);
      const lastTwo = out.slice(-2);
      if (lastTwo.length === 2 && lastTwo.every((x) => x.media_type === m.media_type)) adjusted *= 0.85;
      if (adjusted > best) {
        best = adjusted;
        bestI = i;
      }
    }
    if (bestI < 0) break;
    const { c } = pool.splice(bestI, 1)[0]!;
    const m = c.media;
    langCount.set(m.original_language ?? '', (langCount.get(m.original_language ?? '') ?? 0) + 1);
    if (!isIndian(m)) foreign++;
    if (isLongRunner(m)) longRunners++;
    out.push({ ...m, trend_note: note(c), trend_rank: out.length + 1 });
  }
  return out;
}

let inflight: { at: number; list: Promise<TmdbMedia[]> } | null = null;

/** Twenty titles, best first. Worked out once an hour per session (the TMDB answers are cached as long). */
export function fetchTrendingIndia(): Promise<TmdbMedia[]> {
  if (inflight && Date.now() - inflight.at < 60 * 60 * 1000) return inflight.list;
  const list = gather()
    .then((all) => pick([...all.values()].map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s)))
    .then((items) => {
      if (items.length === 0) inflight = null; // try again next time rather than keep an empty answer
      return items;
    });
  inflight = { at: Date.now(), list };
  return list;
}
