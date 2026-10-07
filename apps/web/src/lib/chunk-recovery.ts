/**
 * Telling a missing chunk from everything else, and getting it back.
 *
 * ## Why "reload and hope" was not enough
 *
 * On the custom domain Cloudflare stamps every `.js`/`.css` response with a
 * four-hour browser cache (`max-age=14400`), and Pages answers a file that is
 * not there with the app's `index.html` and a 200. So the first time a phone
 * asks for a chunk that is missing - a deploy in flight, a build older than
 * the three days `keep-old-assets` carries - the *browser's own HTTP cache*
 * keeps that HTML under the chunk's name for four hours. Unregistering the
 * worker and deleting every Cache Storage entry does not touch it, so every
 * reload, and every "Try again", asked the HTTP cache, got the same page of
 * HTML, and failed the same way. Three reloads later: "That screen did not
 * open", on any screen whose chunk had been poisoned, until the four hours ran
 * out. (Checked with curl: `/assets/<missing>.js` comes back `text/html`,
 * `cache-control: public, max-age=14400`.)
 *
 * Two repairs here, both aimed at that:
 *
 * - `importWithRetry` asks for the failed chunk again under a new query
 *   string, which is a different URL to every cache between here and Pages,
 *   before anything is reloaded. Most failures end there, with no reload.
 * - `healPoisonedAssets` finds every asset this page has loaded whose cached
 *   copy is HTML and fetches it again with `cache: 'reload'`, which replaces
 *   the HTTP cache entry. A reload after that loads real files.
 */

/**
 * Every phrasing the browsers use for "the module would not load".
 *
 * There is no error type to check - Chrome, Safari and Firefox each throw a
 * plain `Error` with their own sentence, and the sentence is the only signal.
 * `ChunkLoadError` is the name `importWithRetry` gives a failure it has
 * already retried, so its own errors never depend on the wording.
 *
 * Bare "Failed to fetch" and "NetworkError" are deliberately *not* here any
 * more. They are what every `fetch()` throws offline, and a screen that let a
 * Supabase call's error reach render was being treated as a stale build:
 * three reloads that could never help, then the "did not open" page with the
 * real message hidden under it. A dynamic import's own network failure still
 * says "dynamically imported module", so nothing real is lost.
 */
export function looksLikeMissingChunk(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ChunkLoadError|dynamically imported module|Importing a module script failed|error loading dynamically|Unable to preload CSS|Failed to load module script/i.test(
    message,
  );
}

/** The asset an import error names, as an absolute URL - or undefined (Safari names none). */
export function chunkUrlFrom(error: unknown, base = typeof location === 'undefined' ? 'https://pingochat.xyz/' : location.href): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = /(?:https?:\/\/[^\s'"]+?)?\/assets\/[^\s'"?#]+\.(?:m?js|css)/.exec(message);
  if (!match) return undefined;
  try {
    return new URL(match[0], base).href;
  } catch {
    return undefined;
  }
}

function withBust(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `load()`, and if the chunk fails, the chunk again - twice - under a fresh URL.
 *
 * The retry has to change the URL. The browser remembers a module that failed
 * to load for the life of the page, and React.lazy remembers a rejected
 * factory forever, so calling `load()` again (what lazyNamed used to do) asked
 * nobody anything. A query string is a new module to the browser and a new key
 * to the HTTP cache, the worker's cache and Cloudflare's edge.
 *
 * Only the chunk the error names is renamed. If one of *its* imports is the
 * missing file, the retry fails too, and the error goes up marked as a
 * `ChunkLoadError` for RouteBoundary - which heals the cache and reloads.
 *
 * ponytail: a renamed chunk is a second module instance. Safe because the
 * original never evaluated (that is why we are here); if a chunk ever holds
 * shared state imported by URL from elsewhere, this is where it would split.
 */
export async function importWithRetry<M>(
  load: () => Promise<M>,
  importUrl: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url),
): Promise<M> {
  try {
    return await load();
  } catch (first) {
    if (!looksLikeMissingChunk(first)) throw first;
    const url = chunkUrlFrom(first);
    let last: unknown = first;
    if (url && /\.m?js$/.test(url)) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        await wait(attempt * 400);
        try {
          return (await importUrl(withBust(url))) as M;
        } catch (error) {
          last = error;
        }
      }
    }
    const marked = new Error(last instanceof Error ? last.message : String(last), { cause: last });
    marked.name = 'ChunkLoadError';
    throw marked;
  }
}

/**
 * Replaces every asset this page has loaded whose cached copy is HTML.
 *
 * Asked with `force-cache` first, which answers from the HTTP cache (or the
 * worker's) without a round trip for anything already there - so a healthy
 * page costs a few dozen local reads. Only the poisoned ones go to the
 * network, with `cache: 'reload'`, which stores what comes back in place of
 * the HTML. Returns how many were replaced.
 */
export async function healPoisonedAssets(extra: Array<string | undefined> = []): Promise<number> {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return 0;
  const urls = new Set<string>();
  const add = (href: string | undefined) => {
    if (!href) return;
    try {
      const url = new URL(href, location.href);
      if (url.origin === location.origin && url.pathname.startsWith('/assets/')) urls.add(url.href);
    } catch {
      /* not a URL */
    }
  };
  extra.forEach(add);
  document.querySelectorAll<HTMLLinkElement>('link[href*="/assets/"]').forEach((link) => add(link.href));
  document.querySelectorAll<HTMLScriptElement>('script[src*="/assets/"]').forEach((script) => add(script.src));
  try {
    performance.getEntriesByType('resource').forEach((entry) => add(entry.name));
  } catch {
    /* no resource timing: the links and the error's own URL still get checked */
  }

  const isHtml = (response: Response) => (response.headers.get('content-type') ?? '').includes('text/html');
  let healed = 0;
  await Promise.all(
    [...urls].slice(0, 200).map(async (url) => {
      try {
        if (!isHtml(await fetch(url, { cache: 'force-cache' }))) return;
        await fetch(url, { cache: 'reload' });
        healed += 1;
      } catch {
        /* offline or gone: the reload that follows finds out properly */
      }
    }),
  );
  return healed;
}
