/**
 * An Instagram post's or reel's cover picture, and who posted it.
 *
 * Instagram publishes no thumbnail URL a client can build, so a reel in a chat
 * was a coloured box. It does describe every public post to link-preview
 * crawlers - `og:image`, `og:title` - which is how WhatsApp and iMessage show
 * one. This does the same, from the edge.
 *
 * ## The picture comes through here, not from Instagram
 *
 * Handing the reader Instagram's CDN URL would put their browser on Meta's
 * servers for every reel merely scrolled past - the leak `/api/unfurl` exists
 * to avoid. So the bytes are fetched here and passed on, and Instagram sees
 * Cloudflare, once a day per post, rather than every reader.
 *
 * ## Only Instagram, only a post
 *
 * `path` must be `p/`, `reel/` or `tv/` and a shortcode; the page is always
 * www.instagram.com and the image must be on Instagram's own CDN. Nothing a
 * sender typed chooses the host, so this cannot be used as an open proxy.
 *
 *   GET /api/ig-thumb?path=reel/CODE          -> the image
 *   GET /api/ig-thumb?path=reel/CODE&meta=1   -> { author?, title? }
 */

/** Pages' HTML parser, which has no types installed here. */
declare const HTMLRewriter: {
  new (): {
    on(selector: string, handlers: Record<string, unknown>): unknown;
    transform(response: Response): Response;
  };
};

const PATH = /^(p|reel|tv)\/[A-Za-z0-9_-]{5,40}$/;
const DAY = 86_400;
const TIMEOUT_MS = 6000;

/** The page and image hosts this will ever fetch. */
export function isInstagramImage(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return new URL(url).protocol === 'https:' && (host.endsWith('.cdninstagram.com') || host.endsWith('.fbcdn.net'));
  } catch {
    return false;
  }
}

/** "Name on Instagram: "caption"" -> the two halves. */
export function splitTitle(raw: string): { author?: string; title?: string } {
  const text = raw.replace(/\s+/g, ' ').trim();
  const match = /^(.*?) on Instagram(?::\s*["“](.*)["”]?)?$/s.exec(text);
  if (!match) return { title: text.slice(0, 200) };
  const author = match[1]?.trim();
  const title = match[2]?.replace(/["”]\s*$/, '').trim();
  return { ...(author ? { author } : {}), ...(title ? { title: title.slice(0, 200) } : {}) };
}

function decode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const headers = (type: string, maxAge: number) => ({
  'Content-Type': type,
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
  'X-Content-Type-Options': 'nosniff',
});

const nothing = (maxAge: number) => new Response(null, { status: 404, headers: headers('text/plain', maxAge) });

export const onRequestGet = async (context: { request: Request }): Promise<Response> => {
  const params = new URL(context.request.url).searchParams;
  const path = params.get('path') ?? '';
  if (!PATH.test(path)) return nothing(DAY);

  const found: Record<string, string> = {};
  try {
    const page = await fetch(`https://www.instagram.com/${path}/`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // The crawler Instagram answers with the post's card, as it does for link previews in chats.
      headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', Accept: 'text/html' },
    });
    if (!page.ok) return nothing(300);
    const grab = (key: string) => ({
      element(element: { getAttribute(name: string): string | null }) {
        const value = element.getAttribute('content');
        if (value && !found[key]) found[key] = decode(value);
      },
    });
    const rewriter = new HTMLRewriter();
    rewriter.on('meta[property="og:image"]', grab('image'));
    rewriter.on('meta[property="og:title"]', grab('title'));
    await rewriter.transform(page).text();
  } catch {
    return nothing(300);
  }

  if (params.get('meta')) {
    return new Response(JSON.stringify(found.title ? splitTitle(found.title) : {}), { headers: headers('application/json; charset=utf-8', DAY) });
  }

  const image = found.image;
  if (!image || !isInstagramImage(image)) return nothing(3600);
  try {
    const bytes = await fetch(image, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const type = bytes.headers.get('content-type') ?? '';
    if (!bytes.ok || !type.startsWith('image/')) return nothing(3600);
    return new Response(bytes.body, { headers: headers(type, DAY) });
  } catch {
    return nothing(300);
  }
};
