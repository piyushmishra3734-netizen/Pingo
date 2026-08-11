import { findLinks } from './detect.js';
import { instagram } from './providers/instagram.js';
import { snapchat } from './providers/snapchat.js';
import { youtube } from './providers/youtube.js';
import type { VideoPreview, VideoProvider } from './types.js';

export type { VideoPreview, VideoProvider, VideoPlatform } from './types.js';
export { findLinks } from './detect.js';

/**
 * Every platform PINGO recognises, in the order they are tried.
 *
 * Adding a platform is adding a file and a line here. Nothing downstream knows
 * the difference between one provider and another - the card renders a
 * `VideoPreview`, and a `VideoPreview` from Instagram and one from YouTube
 * differ only in which optional fields are filled. That is the whole point of
 * normalising at this boundary rather than letting each platform reach the UI.
 */
const PROVIDERS: VideoProvider[] = [youtube, instagram, snapchat];

/**
 * The first video link in a message, if there is one.
 *
 * Synchronous and offline, which is what lets the sender attach this to the
 * message itself rather than every reader resolving it separately. One
 * detection, at send time, stored in `meta` - so the preview a group of forty
 * people see costs one parse rather than forty.
 *
 * First rather than all: a message is one thing. Two links means the sender was
 * writing prose, and stacking two players inside a bubble reads as an error.
 */
export function detectVideoLink(text: string): VideoPreview | undefined {
  for (const url of findLinks(text)) {
    for (const provider of PROVIDERS) {
      if (!provider.canHandle(url)) continue;
      const preview = provider.identify(url);
      // A platform URL that is not a video - a profile, a channel - stops here
      // rather than falling through to another provider that cannot own it.
      if (preview) return preview;
      break;
    }
  }

  return undefined;
}

/**
 * How long an enrichment may take before the card simply stays as it is.
 *
 * Short on purpose. Nothing is waiting on this - the card is already drawn and
 * already playable - so a slow answer is worth less than a fast surrender.
 */
const ENRICH_TIMEOUT_MS = 4_000;

/** Entries kept before the oldest is dropped. Bounded so a long session cannot grow without limit. */
const CACHE_LIMIT = 200;

const cache = new Map<string, Promise<VideoPreview>>();

/**
 * Title and author, added to a card that is already on screen.
 *
 * Resolves to the preview either way. A failure here is not an error state - it
 * is the ordinary case for Instagram and Snapchat, which publish nothing - so
 * the caller has nothing to handle and no branch to write.
 *
 * The cache holds the *promise*, not the result, which is what makes a thread
 * that renders the same link twenty times issue one request. The second caller
 * arrives while the first is still in flight and waits on it rather than
 * starting a race that both would win.
 */
export async function enrichVideoPreview(preview: VideoPreview): Promise<VideoPreview> {
  const provider = PROVIDERS.find((candidate) => candidate.name === preview.platform);
  if (!provider?.enrich) return preview;

  const key = preview.canonicalUrl;
  const hit = cache.get(key);
  if (hit) return hit;

  const enrich = provider.enrich.bind(provider);

  const pending = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ENRICH_TIMEOUT_MS);

    try {
      const extra = await enrich(preview, controller.signal);
      return { ...preview, ...extra };
    } catch {
      /*
       * Kept in the cache despite failing, deliberately.
       *
       * A platform that refuses once refuses for the same reason every time -
       * no token, no endpoint, blocked at the network. Retrying on each render
       * would turn one dead endpoint into a request per scroll, which is the
       * spam this cache exists to prevent. A reload is a cheap enough reset.
       */
      return preview;
    } finally {
      clearTimeout(timer);
    }
  })();

  if (cache.size >= CACHE_LIMIT) {
    // Oldest first: Map iterates in insertion order, so this is the eldest key.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, pending);

  return pending;
}
