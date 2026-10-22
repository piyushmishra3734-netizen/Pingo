/**
 * A picture from a post, fetched here so the reader never meets X or Pinterest.
 *
 *   GET /api/social-img?u=https%3A%2F%2Fpbs.twimg.com%2F...
 *
 * Only an https picture on a short list of image hosts is fetched, only an
 * `image/*` answer under a size cap is passed on, and it is kept for a day at
 * the edge and in the browser. Nothing a sender typed picks the host: the URL
 * arrives from `/api/social`, which built it from the platform's own answer.
 */

declare const caches: { default: { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> } };

const DAY = 86_400;
const TIMEOUT_MS = 7000;
/** A post's picture, not a download. */
const MAX_BYTES = 6_000_000;
const HOSTS = ['pbs.twimg.com', 'abs.twimg.com', 'i.pinimg.com', 's.pinimg.com'];

export function isAllowedImage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && HOSTS.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const headers = (type: string, maxAge: number) => ({
  'Content-Type': type,
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}, immutable`,
  'X-Content-Type-Options': 'nosniff',
});
const nothing = (maxAge: number) => new Response(null, { status: 404, headers: headers('text/plain', maxAge) });

async function answer(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('u') ?? '';
  if (!isAllowedImage(target)) return nothing(DAY);
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    const type = res.headers.get('content-type') ?? '';
    const length = Number(res.headers.get('content-length') ?? 0);
    if (!res.ok || !type.startsWith('image/') || length > MAX_BYTES) return nothing(3600);
    return new Response(res.body, { headers: headers(type, DAY) });
  } catch {
    return nothing(300);
  }
}

export const onRequestGet = async (context: { request: Request; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const key = new Request(new URL(context.request.url).toString(), { method: 'GET' });
  const cache = typeof caches === 'undefined' ? undefined : caches.default;
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return hit;
  const response = await answer(context.request);
  if (response.ok && cache) {
    const kept = cache.put(key, response.clone()).catch(() => undefined);
    if (context.waitUntil) context.waitUntil(kept);
    else await kept;
  }
  return response;
};
