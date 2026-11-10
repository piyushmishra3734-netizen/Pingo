/**
 * PINGO Explore: photos from Pexels and GIFs and stickers from GIPHY, for the
 * chat's Explore tab.
 *
 * ## Why a function
 *
 * Both services want an API key. In the app it would be readable by anyone, so
 * the key lives here as a secret (PEXELS_API_KEY, GIPHY_API_KEY) and the app
 * asks this. The answers are also trimmed to what the grid draws, which keeps
 * what crosses the wire small, and kept for a few minutes so a trending page
 * costs one upstream call however many people open it.
 *
 * ## Who may ask
 *
 * A signed-in person (the gateway checks the token, and the `authenticated`
 * role is checked here, because the public anon key is also a valid token), a
 * minute's worth of requests each, so the keys cannot be borrowed.
 *
 * ## What is shown
 *
 * Pexels photos always carry the photographer and the page they came from, as
 * its terms ask. GIPHY is asked for PG and below. Nothing here is saved.
 *
 * Sounds come from Freesound (FREESOUND_API_KEY): the preview each one has on
 * Freesound's own CDN, which the app plays directly.
 *
 * Body: { src: 'pexels' | 'giphy' | 'freesound', kind?: 'gifs' | 'stickers', q?: string, page?: number }
 * Answer: { items: Item[], next: number | null }
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pingo-client, x-pingo-gen',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export interface Item {
  id: string;
  src: 'pexels' | 'giphy' | 'freesound';
  kind: 'photo' | 'gif' | 'sticker' | 'sound' | 'clip';
  /** Length in seconds, for sounds and clips. */
  secs?: number;
  /** The grid's picture. */
  thumb: string;
  /** What is sent. */
  url: string;
  w: number;
  h: number;
  title: string;
  /** Who to credit, and where the original is. */
  by?: { name: string; url: string };
}

const PER_PAGE = 24;
const FRESH_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: { items: Item[]; next: number | null } }>();
const buckets = new Map<string, { n: number; until: number }>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=60' },
  });

/** The `sub` of a token the gateway has already verified, and only if it is a person's. */
export function personOf(authorization: string | null): string | undefined {
  try {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string; sub?: string };
    return payload.role === 'authenticated' && payload.sub ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

function allowed(user: string): boolean {
  const now = Date.now();
  const b = buckets.get(user);
  if (!b || b.until < now) {
    buckets.set(user, { n: 1, until: now + 60_000 });
    return true;
  }
  b.n += 1;
  return b.n <= 60;
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const https = (v: unknown) => (typeof v === 'string' && /^https:\/\//.test(v) ? v : '');

async function upstream(url: string, headers: Record<string, string> = {}): Promise<unknown | undefined> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

interface PexelsPhoto {
  id?: number;
  width?: number;
  height?: number;
  url?: string;
  alt?: string;
  photographer?: string;
  photographer_url?: string;
  src?: { medium?: string; large?: string };
}

async function pexels(q: string, page: number, key: string) {
  const base = q ? `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&` : 'https://api.pexels.com/v1/curated?';
  const body = (await upstream(`${base}per_page=${PER_PAGE}&page=${page}`, { Authorization: key })) as { photos?: PexelsPhoto[]; next_page?: string } | undefined;
  if (!body) return undefined;
  const items: Item[] = [];
  for (const p of body.photos ?? []) {
    const thumb = https(p.src?.medium);
    const url = https(p.src?.large);
    if (!thumb || !url || typeof p.id !== 'number') continue;
    items.push({
      id: `pexels-${p.id}`,
      src: 'pexels',
      kind: 'photo',
      thumb,
      url,
      w: p.width ?? 3,
      h: p.height ?? 2,
      title: clip(p.alt, 100) || 'Photo',
      by: { name: clip(p.photographer, 60) || 'Pexels', url: https(p.photographer_url) || https(p.url) || 'https://www.pexels.com' },
    });
  }
  return { items, next: body.next_page ? page + 1 : null };
}

interface GiphyImage {
  url?: string;
  webp?: string;
  width?: string;
  height?: string;
  size?: string;
}
interface GiphyGif {
  id?: string;
  title?: string;
  username?: string;
  url?: string;
  images?: Record<string, GiphyImage | undefined>;
}

async function giphy(kind: 'gifs' | 'stickers', q: string, page: number, key: string) {
  const offset = (page - 1) * PER_PAGE;
  const path = q ? `${kind}/search` : `${kind}/trending`;
  const query = `api_key=${encodeURIComponent(key)}&limit=${PER_PAGE}&offset=${offset}&rating=pg${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const body = (await upstream(`https://api.giphy.com/v1/${path}?${query}`)) as { data?: GiphyGif[]; pagination?: { total_count?: number } } | undefined;
  if (!body) return undefined;
  const items: Item[] = [];
  for (const g of body.data ?? []) {
    const im = g.images ?? {};
    const small = im.fixed_width;
    const thumb = https(small?.webp) || https(small?.url);
    // A sticker keeps its transparency in WebP; a GIF is sent as the lighter of GIPHY's own sizes.
    const send = kind === 'stickers' ? https(im.fixed_height?.webp) || https(im.fixed_height?.url) : https(im.downsized_medium?.url) || https(im.fixed_width?.url);
    if (!thumb || !send || !g.id) continue;
    items.push({
      id: `giphy-${g.id}`,
      src: 'giphy',
      kind: kind === 'stickers' ? 'sticker' : 'gif',
      thumb,
      url: send,
      w: Number(small?.width) || 1,
      h: Number(small?.height) || 1,
      title: clip(g.title, 100) || (kind === 'stickers' ? 'Sticker' : 'GIF'),
      ...(g.url ? { by: { name: clip(g.username, 40) || 'GIPHY', url: https(g.url) || 'https://giphy.com' } } : {}),
    });
  }
  const total = body.pagination?.total_count ?? 0;
  return { items, next: offset + PER_PAGE < Math.min(total, 500) ? page + 1 : null };
}

interface GiphyClip {
  id?: string;
  title?: string;
  username?: string;
  url?: string;
  duration?: string | number;
  images?: Record<string, GiphyImage | undefined>;
  video?: { assets?: Record<string, { url?: string; width?: number | string; height?: number | string } | undefined> };
}

/**
 * GIPHY Clips: GIFs with sound, as MP4. GIPHY gives Clips only to keys it has
 * approved, so a key without access comes back empty here and the app says
 * "coming soon". The video is played from GIPHY's own CDN; nothing is copied.
 */
async function giphyClips(q: string, page: number, key: string) {
  const offset = (page - 1) * PER_PAGE;
  const query = `api_key=${encodeURIComponent(key)}&limit=${PER_PAGE}&offset=${offset}&rating=pg&country_code=IN${q ? `&q=${encodeURIComponent(q.slice(0, 50))}` : ''}`;
  const body = (await upstream(`https://api.giphy.com/v1/clips/${q ? 'search' : 'trending'}?${query}`)) as { data?: GiphyClip[]; pagination?: { total_count?: number } } | undefined;
  if (!body) return undefined;
  const items: Item[] = [];
  for (const c of body.data ?? []) {
    const assets = c.video?.assets ?? {};
    // The smallest rendition that always exists: this plays on somebody's mobile data.
    const rendition = assets['360p'];
    const url = https(rendition?.url);
    if (!url || !c.id) continue;
    const im = c.images ?? {};
    const thumb = https(im.fixed_width?.webp) || https(im.fixed_width?.url) || https(im.fixed_width_still?.url) || https(im.original_still?.url) || '';
    items.push({
      id: `giphy-clip-${c.id}`,
      src: 'giphy',
      kind: 'clip',
      thumb,
      url,
      w: Number(rendition?.width) || 9,
      h: Number(rendition?.height) || 16,
      title: clip(c.title, 100) || 'Clip',
      secs: Math.max(0, Math.round((Number(c.duration) || 0) * 10) / 10),
      ...(c.url ? { by: { name: clip(c.username, 40) || 'GIPHY', url: https(c.url) || 'https://giphy.com' } } : {}),
    });
  }
  const total = body.pagination?.total_count ?? 0;
  return { items, next: offset + PER_PAGE < Math.min(total, 500) ? page + 1 : null };
}

interface FreesoundHit {
  id?: number;
  name?: string;
  username?: string;
  duration?: number;
  previews?: Record<string, string | undefined>;
  images?: Record<string, string | undefined>;
}

/**
 * Sounds from Freesound: CC0 only (no credit owed), 15 seconds or shorter, the
 * most downloaded first. What is sent on is the preview Freesound serves from
 * its own CDN; Pingo copies and stores nothing.
 */
async function freesound(q: string, page: number, key: string) {
  const query = new URLSearchParams({
    query: q || 'meme',
    filter: 'license:"Creative Commons 0" duration:[0 TO 15]',
    sort: 'downloads_desc',
    fields: 'id,name,username,duration,previews,images',
    page_size: String(PER_PAGE),
    page: String(page),
    token: key,
  });
  const body = (await upstream(`https://freesound.org/apiv2/search/text/?${query}`)) as { results?: FreesoundHit[]; next?: string | null } | undefined;
  if (!body) return undefined;
  const items: Item[] = [];
  for (const h of body.results ?? []) {
    const url = https(h.previews?.['preview-hq-mp3']) || https(h.previews?.['preview-lq-mp3']);
    if (!url || typeof h.id !== 'number') continue;
    items.push({
      id: `freesound-${h.id}`,
      src: 'freesound',
      kind: 'sound',
      thumb: https(h.images?.waveform_m),
      url,
      w: 1,
      h: 1,
      title: clip(h.name, 100).replace(/\.(wav|mp3|ogg|flac|aif+)$/i, '') || 'Sound',
      secs: Math.max(0, Math.round((h.duration ?? 0) * 10) / 10),
      by: { name: clip(h.username, 40) || 'Freesound', url: `https://freesound.org/s/${h.id}/` },
    });
  }
  return { items, next: body.next ? page + 1 : null };
}

export async function handle(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405);

  const user = personOf(request.headers.get('Authorization'));
  if (!user) return json({ error: 'Sign in required.' }, 401);
  if (!allowed(user)) return json({ error: 'Slow down for a moment.' }, 429);

  let ask: { src?: string; kind?: string; q?: string; page?: number };
  try {
    ask = await request.json();
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }
  const q = clip(ask.q, 80);
  const page = Math.min(Math.max(Math.round(Number(ask.page) || 1), 1), 20);
  const src = ask.src === 'giphy' ? 'giphy' : ask.src === 'pexels' ? 'pexels' : ask.src === 'freesound' ? 'freesound' : undefined;
  if (!src) return json({ error: 'Unknown source.' }, 400);
  const kind = ask.kind === 'stickers' ? 'stickers' : ask.kind === 'clips' ? 'clips' : 'gifs';

  const key = Deno.env.get(src === 'pexels' ? 'PEXELS_API_KEY' : src === 'freesound' ? 'FREESOUND_API_KEY' : 'GIPHY_API_KEY');
  if (!key) return json({ error: 'not_configured' }, 503);

  const cacheKey = `${src}|${kind}|${q.toLowerCase()}|${page}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < FRESH_MS) return json(hit.value);

  const value = src === 'pexels' ? await pexels(q, page, key) : src === 'freesound' ? await freesound(q, page, key) : kind === 'clips' ? await giphyClips(q, page, key) : await giphy(kind, q, page, key);
  // GIPHY refuses Clips to a key it has not approved: told apart from an outage by being the only thing that fails.
  if (!value) return json({ error: kind === 'clips' && src === 'giphy' ? 'not_configured' : 'upstream' }, kind === 'clips' && src === 'giphy' ? 503 : 502);

  cache.set(cacheKey, { at: Date.now(), value });
  if (cache.size > 400) cache.delete(cache.keys().next().value!);
  return json(value);
}

Deno.serve(handle);
