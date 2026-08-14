/**
 * What a link says about itself, fetched by us rather than by the reader.
 *
 * ## Why the server does it
 *
 * A preview needs somebody to fetch the page. If that somebody is the reader's
 * browser, then every site linked in a chat learns the IP address of everyone
 * the link was sent to, before anybody has decided to open it. That is the
 * exact leak `VideoLinkCard` refuses for embeds, and it applies just as much to
 * a title tag.
 *
 * So this edge function fetches it instead. One address - Cloudflare's - reads
 * the page, and the answer is cached at the edge for a day, so a link shared in
 * fifty chats is fetched once.
 *
 * ## No image, deliberately
 *
 * `og:image` is the obvious next field and it is not returned, because a card
 * showing it would put the reader's browser straight back on the site's server
 * for the picture - the leak this whole function exists to avoid, arriving
 * through the back door. Proxying the bytes would fix that and needs a signing
 * secret this deployment does not have. Title, description and site name are
 * what makes a link legible; the picture is decoration.
 *
 * ## What is refused
 *
 * Anything that is not a public http(s) URL. The host checks below are a trust
 * boundary - this endpoint fetches a URL a stranger chose, and without them it
 * is an open proxy into whatever the runtime can reach.
 */

interface Unfurled {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
}

/** Loose local declaration: Pages' HTML parser, which has no types installed here. */
declare const HTMLRewriter: {
  new (): {
    on(selector: string, handlers: Record<string, unknown>): unknown;
    transform(response: Response): Response;
  };
};

const TIMEOUT_MS = 5000;
/** Big enough for any real `<head>`, small enough not to swallow a video file. */
const MAX_BYTES = 2_000_000;
const DAY = 86_400;

/**
 * Hosts nothing on the public web should ever resolve to.
 *
 * Exported so it can be asserted - this is the guard that keeps the endpoint
 * from being an open proxy, and it is the one part of this file worth a test.
 */
export function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (name.endsWith('.local') || name.endsWith('.internal') || name.endsWith('.home.arpa')) {
    return true;
  }
  // IPv6 loopback and unique-local / link-local ranges.
  if (name === '::1' || name.startsWith('fc') || name.startsWith('fd') || name.startsWith('fe80')) {
    return true;
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Carrier-grade NAT, and the cloud metadata address that lives in 169.254.
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * HTML entities, back into the characters they stand for.
 *
 * The parser hands back attribute values exactly as written, so GitHub's own
 * description arrives as "the world&#39;s most widely adopted" and a card would
 * print it that way. Only the five named entities that are required to be
 * escaped, plus numeric escapes, which is what actually appears in a `content`
 * attribute - this is a title, not a document.
 *
 * Exported for the same reason as the host guard: it is the other thing here
 * that can be quietly wrong.
 */
export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Last, so "&amp;#39;" does not become an apostrophe - it is a literal
    // "&#39;" that somebody escaped on purpose.
    .replace(/&amp;/g, '&');
}

function json(body: unknown, maxAge: number): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Public data, no credentials - the Android build is not same-origin.
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const onRequestGet = async (context: { request: Request }): Promise<Response> => {
  const asked = new URL(context.request.url).searchParams.get('url');
  if (!asked) return json({ error: 'no url' }, 60);

  let target: URL;
  try {
    target = new URL(asked);
  } catch {
    return json({ error: 'bad url' }, DAY);
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return json({ error: 'unsupported scheme' }, DAY);
  }
  if (isPrivateHost(target.hostname)) {
    return json({ error: 'unsupported host' }, DAY);
  }

  const found: Unfurled = { url: target.toString() };

  try {
    const page = await fetch(target.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Named, so a site that would rather not be read can say so in robots
        // terms and block it.
        'User-Agent': 'PingoBot/1.0 (+https://pingochat.pages.dev)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en',
      },
    });

    const type = page.headers.get('content-type') ?? '';
    if (!page.ok || !type.includes('html')) return json(found, DAY);

    const length = Number(page.headers.get('content-length') ?? '0');
    if (length > MAX_BYTES) return json(found, DAY);

    /*
     * Read the metadata off the stream rather than buffering the page.
     *
     * `text()` on the transformed response is what drives the parser; the
     * handlers below have already filled `found` by the time it resolves.
     */
    /*
     * Every candidate is collected and the winner picked afterwards, because
     * handlers fire in document order, not in the order they are registered -
     * a page with `<title>` above `<meta og:title>` would otherwise keep the
     * weaker of the two.
     */
    const raw: Record<string, string> = {};
    const meta = (key: string) => ({
      element(element: { getAttribute(name: string): string | null }) {
        const value = element.getAttribute('content');
        if (value && !raw[key]) raw[key] = value;
      },
    });

    const rewriter = new HTMLRewriter();
    rewriter.on('meta[property="og:title"]', meta('ogTitle'));
    rewriter.on('meta[property="og:description"]', meta('ogDescription'));
    rewriter.on('meta[property="og:site_name"]', meta('siteName'));
    rewriter.on('meta[name="twitter:title"]', meta('twitterTitle'));
    rewriter.on('meta[name="twitter:description"]', meta('twitterDescription'));
    rewriter.on('meta[name="description"]', meta('description'));
    rewriter.on('title', {
      // Text arrives in chunks, so a long title is appended rather than
      // replaced - taking the first chunk would cut it mid-word.
      text(chunk: { text: string }) {
        raw['docTitle'] = (raw['docTitle'] ?? '') + chunk.text;
      },
    });

    await rewriter.transform(page).text();

    const tidy = (value: string | undefined): string | undefined => {
      const clean = decodeEntities(value ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 300);
      return clean ? clean : undefined;
    };

    const title = tidy(raw['ogTitle'] ?? raw['twitterTitle'] ?? raw['docTitle']);
    const description = tidy(
      raw['ogDescription'] ?? raw['twitterDescription'] ?? raw['description'],
    );
    const siteName = tidy(raw['siteName']);
    if (title) found.title = title;
    if (description) found.description = description;
    if (siteName) found.siteName = siteName;
  } catch {
    // A site that is slow, gone, or refusing us is not an error here - the card
    // simply falls back to the host name, which is what a bare link showed
    // anyway. Cached briefly so a dead link is not refetched on every render.
    return json(found, 300);
  }

  return json(found, DAY);
};
