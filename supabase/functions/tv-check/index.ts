/**
 * tv-check: does this server actually have the title?
 *
 * Pingo TV's servers are other sites' players in a frame, and from the browser a
 * frame is a black box: the app could only tell "the site answered", which is
 * true even when the page inside says "not found". One server gives a straight
 * answer to a plain request from here, measured on 2026-11-14:
 *
 *   NontonGo  /embed/movie/<id>        200 when it has the film, 502 when not
 *             /embed/tv/<id>/<s>/<e>   200 for any episode of a show it has, so for
 *                                      series it can only say "the show exists"
 *
 * EmbedMaster gives the same kind of answer (200 with the title's name, 404 when
 * missing, per episode) to a home connection, but 403 to every request from
 * Supabase's servers, so it is not asked. VidFast, VidRock, AutoEmbed and
 * EmbedWave are single-page apps that answer 200 to anything.
 *
 * GET ?type=movie|tv&id=<tmdb id>[&s=<season>&e=<episode>]
 *  -> { "sources": { "nontongo": "has" | "show" | "missing" | "unknown" },
 *       "status":  { "nontongo": <http status or null> } }
 *
 * Only that one fixed host is fetched; the request decides nothing but numbers
 * in its path, so this is not a proxy.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

type Answer = 'has' | 'show' | 'missing' | 'unknown';

async function statusOf(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: controller.signal });
    // The body is not needed; let the connection go.
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function nontongo(type: string, id: string, s: string, e: string): Promise<{ answer: Answer; status: number | null }> {
  const status = await statusOf(
    type === 'movie' ? `https://www.nontongo.win/embed/movie/${id}` : `https://www.nontongo.win/embed/tv/${id}/${s}/${e}`,
  );
  if (status === 200) return { answer: type === 'movie' ? 'has' : 'show', status };
  if (status === 502 || status === 404) return { answer: 'missing', status };
  return { answer: 'unknown', status };
}

const json = (body: unknown, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': cache },
  });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(request.url);
  const type = url.searchParams.get('type') ?? '';
  const id = url.searchParams.get('id') ?? '';
  const s = url.searchParams.get('s') ?? '1';
  const e = url.searchParams.get('e') ?? '1';
  if (!/^(movie|tv)$/.test(type) || !/^\d{1,9}$/.test(id) || !/^\d{1,4}$/.test(s) || !/^\d{1,5}$/.test(e)) {
    return json({ error: 'type=movie|tv and a numeric id (and s, e for tv) are required' }, 400);
  }

  const ng = await nontongo(type, id, s, e);
  // An answer is good for a few hours: a server that gains a title is found again soon enough.
  return json({ sources: { nontongo: ng.answer }, status: { nontongo: ng.status } }, 200, 'public, max-age=21600, s-maxage=21600');
});
