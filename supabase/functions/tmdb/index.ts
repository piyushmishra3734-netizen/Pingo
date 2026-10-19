/**
 * PINGO TV — TMDB API Gateway Edge Function.
 *
 * Keeps the TMDB secret token entirely server-side.
 * Allows only authorized endpoints (trending, popular, search, details, credits, videos, genres).
 * Enforces caching for at least 1 hour to save bandwidth and egress.
 *
 * Secret configuration:
 *   supabase secrets set TMDB_TOKEN=your_v4_read_access_token
 *   (or TMDB_API_KEY=your_v3_api_key)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_ENDPOINT_REGEX =
  /^\/(trending\/(all|movie|tv)\/(day|week)|(movie|tv)\/(popular|top_rated|now_playing|upcoming|on_the_air|airing_today|\d+(\/(videos|credits|similar|recommendations))?)|tv\/\d+\/season\/\d+|search\/(multi|movie|tv)|discover\/(movie|tv)|genre\/(movie|tv)\/list)$/;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  let endpoint = url.searchParams.get('endpoint');

  if (!endpoint) {
    // If not query param, look at subpath: e.g. /tmdb/trending/all/day
    const pathname = url.pathname.replace(/^\/tmdb/, '');
    if (pathname && pathname !== '/') {
      endpoint = pathname;
    }
  }

  if (!endpoint || !ALLOWED_ENDPOINT_REGEX.test(endpoint)) {
    return new Response(
      JSON.stringify({
        error: 'Invalid or disallowed TMDB endpoint',
        allowed: 'trending, movie, tv, search, discover, genre',
      }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  const tmdbToken = Deno.env.get('TMDB_TOKEN') || Deno.env.get('TMDB_API_KEY');
  if (!tmdbToken) {
    return new Response(
      JSON.stringify({
        error: 'TMDB_TOKEN secret is not set in Supabase Edge Functions',
        tip: 'Run: supabase secrets set TMDB_TOKEN=...',
      }),
      {
        status: 503,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  // Forward extra query params (e.g. query, page, with_genres, append_to_response)
  const upstreamUrl = new URL(`https://api.themoviedb.org/3${endpoint}`);
  for (const [key, value] of url.searchParams.entries()) {
    if (key !== 'endpoint') {
      upstreamUrl.searchParams.set(key, value);
    }
  }

  const isJwtBearer = tmdbToken.length > 40;
  if (!isJwtBearer) {
    upstreamUrl.searchParams.set('api_key', tmdbToken);
  }

  try {
    const upstreamRes = await fetch(upstreamUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        ...(isJwtBearer ? { 'Authorization': `Bearer ${tmdbToken}` } : {}),
      },
    });

    const body = await upstreamRes.text();
    return new Response(body, {
      status: upstreamRes.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=7200',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to communicate with TMDB', details: String(err) }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }
});
