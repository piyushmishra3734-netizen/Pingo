/**
 * PINGO TV — source lookups that a browser cannot do itself.
 *
 * Two jobs, both of them CORS work that must happen server-side:
 *
 *   kind=download  A title's download page on ToonWorld4All. Their archive is a
 *                  single-page app that answers 200 for every path, so a slug
 *                  cannot be guessed — it has to be found through their own
 *                  WordPress search first. The file itself lives behind mega.nz,
 *                  so this returns the PAGE, never a direct link.
 *
 *   kind=anime     A TMDB title's MAL id, which is what FrameXTV's anime
 *                  endpoint is keyed by. AniList's external links carry no TMDB
 *                  id, so the match is made on title + year + format — and the
 *                  confidence comes back with it, because a wrong match means
 *                  the wrong show plays.
 *
 * Both are cached for a day: neither changes often, and both cost an outbound
 * request to somebody else's server.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'public, max-age=86400, s-maxage=86400',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });

const text = async (url: string, init?: RequestInit): Promise<Response | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, {
      ...init,
      headers: { 'user-agent': UA, ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** lowercase, accents off, punctuation collapsed — the same shape their slugs use. */
const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * The ToonWorld4All post for a title, or null.
 *
 * Their search page is the only honest way to find the slug: the archive
 * answers 200 to everything, so a guessed URL is indistinguishable from a real
 * one until the page renders.
 */
async function findDownload(title: string, year: string): Promise<{ url: string; post: string } | null> {
  const response = await text(`https://toonworld4all.me/?s=${encodeURIComponent(title)}`);
  if (!response?.ok) return null;

  const html = await response.text();
  const want = slugify(`${title}-${year}`);
  const wantTitle = slugify(title);

  const links = [...new Set([...html.matchAll(/https:\/\/toonworld4all\.me\/([a-z0-9-]{8,80})\//g)].map((m) => m[1] as string))]
    .filter((slug) => !/^(wp-|feed|tag|category|author|page|anime-shows|exclusive)/.test(slug));

  // Exact "title-year" first; then a slug that starts with the title; then any.
  const exact = links.find((slug) => slug === want);
  const startsWith = links.find((slug) => slug.startsWith(`${wantTitle}-`) || slug.startsWith(wantTitle));
  const slug = exact ?? startsWith ?? null;
  if (!slug) return null;

  return { url: `https://archive.toonworld4all.me/movie/${slug}`, post: slug };
}

interface AniListMedia {
  idMal?: number;
  title?: { romaji?: string; english?: string; native?: string };
  startDate?: { year?: number };
  format?: string;
}

/**
 * The MAL id for a TMDB title, with a confidence the caller can act on.
 *
 * AniList's external links do not carry TMDB ids, so this is a search: the
 * title has to match, and the year has to be close, or the answer is 'maybe'
 * and the app asks instead of playing something else.
 */
async function findMalId(title: string, year: string, isShow: boolean) {
  const query = `query($search:String){Page(perPage:5){media(search:$search,type:ANIME){idMal title{romaji english} startDate{year} format}}}`;

  const response = await text('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables: { search: title } }),
  });
  if (!response?.ok) return { malId: null, confidence: 'none' as const, candidates: [] };

  const body = (await response.json()) as { data?: { Page?: { media?: AniListMedia[] } } };
  const media = body.data?.Page?.media ?? [];
  if (!media.length) return { malId: null, confidence: 'none' as const, candidates: [] };

  const wanted = slugify(title);
  const yearNumber = Number(year) || 0;

  let best: { id: number; score: number; label: string } | null = null;
  for (const item of media) {
    if (!item.idMal) continue;
    const names = [item.title?.romaji, item.title?.english].filter(Boolean) as string[];
    const matchesName = names.some((name) => {
      const candidate = slugify(name);
      return candidate === wanted || candidate.startsWith(wanted) || wanted.startsWith(candidate);
    });
    const itemYear = item.startDate?.year ?? 0;
    const yearClose = yearNumber && itemYear ? Math.abs(itemYear - yearNumber) <= 1 : false;

    // A show should match a TV shape; a film should not match an OVA.
    const shapeOk = isShow
      ? /TV|ONA/i.test(item.format ?? '')
      : /MOVIE|SPECIAL/i.test(item.format ?? '') || !item.format;

    const score = (matchesName ? 2 : 0) + (yearClose ? 1 : 0) + (shapeOk ? 1 : 0);
    if (score < 3) continue;
    const label = names[0] ?? `MAL ${item.idMal}`;
    if (!best || score > best.score) best = { id: item.idMal, score, label };
  }

  const candidates = media
    .filter((item) => item.idMal)
    .map((item) => ({ malId: item.idMal as number, title: item.title?.romaji ?? '', year: item.startDate?.year ?? 0 }))
    .slice(0, 3);

  if (!best) return { malId: null, confidence: 'low' as const, candidates };
  return {
    malId: best.id,
    confidence: best.score >= 4 ? ('high' as const) : ('medium' as const),
    label: best.label,
    candidates,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? '';
  const title = (url.searchParams.get('title') ?? '').trim();
  const year = (url.searchParams.get('year') ?? '').trim();

  if (!title) return json({ error: 'title is required' }, 400);

  try {
    if (kind === 'download') {
      const found = await findDownload(title, year);
      return json({ found: Boolean(found), ...(found ?? {}) });
    }

    if (kind === 'anime') {
      const isShow = (url.searchParams.get('type') ?? 'movie') === 'tv';
      return json(await findMalId(title, year, isShow));
    }

    return json({ error: 'kind must be download or anime' }, 400);
  } catch {
    return json({ error: 'lookup failed' }, 502);
  }
});
