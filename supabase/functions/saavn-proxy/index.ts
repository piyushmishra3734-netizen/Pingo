/**
 * JioSaavn's API, asked from India.
 *
 * JioSaavn answers by the caller's country. The music Worker runs on
 * Cloudflare, whose outgoing addresses are not Indian, so it was served the
 * thin international catalogue - "fairytail" found 10 instrumentals where the
 * app finds 358 songs. This function is invoked in ap-south-1 (Mumbai) and
 * forwards the same api.php query, so the Worker sees what people in India see.
 *
 * Only api.php, only GET, only JioSaavn's own query string - not an open proxy.
 */
Deno.serve(async (request) => {
  if (request.method !== 'GET') return new Response('GET only', { status: 405 });
  const url = new URL(request.url);
  const query = url.search;
  if (!/[?&]__call=[\w.]+/.test(query)) return new Response('Missing __call', { status: 400 });
  /*
   * The languages to answer in. JioSaavn reads them from its `L` cookie, not
   * the query, so the home screen, new releases and charts in Punjabi or Tamil
   * need it passed on. Only known language names get through.
   */
  const lang = (request.headers.get('x-saavn-lang') ?? '')
    .toLowerCase()
    .split(',')
    .filter((l) => /^[a-z]{3,12}$/.test(l))
    .join(',');
  const upstream = await fetch(`https://www.jiosaavn.com/api.php${query}`, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      ...(lang ? { cookie: `L=${encodeURIComponent(lang)}` } : {}),
    },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'public, max-age=300' },
  });
});
