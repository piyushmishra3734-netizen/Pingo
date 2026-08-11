/**
 * Turning a platform link into the video itself.
 *
 * This is the "paste a link, get a video" that those download sites do, and it
 * works the way they do because there is no other way it can: extracting a
 * media stream cannot happen in a browser. The page has no way past the origin
 * checks, and would not be allowed to read the bytes if it did. So PINGO asks a
 * service for a direct URL and plays what comes back.
 *
 * ## PINGO does not ship an extractor
 *
 * The endpoint is configuration, not code. Nothing in this repository knows how
 * to take a video apart, and nothing here talks to YouTube or Instagram - it
 * talks to whatever address `VITE_MEDIA_RESOLVER_URL` names, on the
 * widely-used cobalt request shape. Running one is a deployment decision, and
 * whoever makes it is the one accepting the platforms' terms.
 *
 * Unset, this module does nothing at all and every card behaves exactly as it
 * does today. That is the default, and it is why the feature cannot break a
 * build that never configured it.
 *
 * ## Asked on tap, never on render
 *
 * Resolving eagerly would mean a request per video link in view, and each of
 * those makes the resolver fetch from a platform - for links nobody opened.
 * Doing it when play is pressed costs one request for one video somebody
 * actually wants, which is also the same privacy line the embeds hold.
 */

const ENDPOINT = import.meta.env.VITE_MEDIA_RESOLVER_URL as string | undefined;

/**
 * An optional key for the resolver, and an honest note about what it is worth.
 *
 * This is a web build, so anything here is in the bundle and readable by anyone
 * holding the app. It is not a secret and must not be treated as one - what it
 * does is stop a stranger who finds the endpoint from using it casually, which
 * on a small private instance is most of the traffic worth stopping. Real
 * protection is the network in front of it.
 */
const KEY = import.meta.env.VITE_MEDIA_RESOLVER_KEY as string | undefined;

/** Whether a resolver is configured at all. Cheap enough to call in render. */
export function canResolveMedia(): boolean {
  return typeof ENDPOINT === 'string' && ENDPOINT.startsWith('https://');
}

/**
 * Long enough for a resolver to do real work, short enough to give up on.
 *
 * Extraction is not instant - the service fetches from the platform before it
 * can answer - so this is far more patient than the metadata timeout. Past it
 * the card falls back to the embed, which is a working video either way.
 */
const TIMEOUT_MS = 20_000;

const cache = new Map<string, Promise<string | undefined>>();

/**
 * A direct media URL for a page URL, or nothing.
 *
 * Nothing is the ordinary answer for a private post, an unavailable video, a
 * resolver that is down, or no resolver at all - so the caller has one branch,
 * and it is the one it already had.
 */
export function resolveMedia(pageUrl: string): Promise<string | undefined> {
  if (!canResolveMedia()) return Promise.resolve(undefined);

  const hit = cache.get(pageUrl);
  if (hit) return hit;

  const pending = ask(pageUrl);
  cache.set(pageUrl, pending);
  return pending;
}

async function ask(pageUrl: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT!, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(KEY ? { authorization: `Api-Key ${KEY}` } : {}),
      },
      body: JSON.stringify({ url: pageUrl }),
      signal: controller.signal,
    });
    if (!response.ok) return undefined;

    return pick((await response.json()) as unknown);
  } catch {
    // Down, blocked, timed out, or answering something that is not JSON.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The direct URL out of a resolver's answer.
 *
 * Three shapes are worth reading. `tunnel` and `redirect` both put the media at
 * `url`; `picker` means the link held several things, and the first video in it
 * is the one a chat means. Anything else - an error, a shape nobody documented -
 * is treated as no answer rather than guessed at.
 */
function pick(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const data = body as Record<string, unknown>;

  if (typeof data.url === 'string') return safe(data.url);

  if (Array.isArray(data.picker)) {
    for (const item of data.picker) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;
      if (entry.type === 'video' && typeof entry.url === 'string') return safe(entry.url);
    }
    // A picker of nothing but photos is not a video, and playing the first
    // image as one would be a black player.
  }

  return undefined;
}

/**
 * https only, even from our own resolver.
 *
 * The address is configured rather than typed by a sender, so this is not the
 * defence the providers need - it is the one that stops a misconfigured or
 * compromised resolver handing the page a `javascript:` or `data:` URL that a
 * media element would otherwise accept without complaint.
 */
function safe(url: string): string | undefined {
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}
