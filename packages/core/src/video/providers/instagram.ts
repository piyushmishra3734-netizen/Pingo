import type { VideoProvider } from '../types.js';

/**
 * Instagram: framed, but never described.
 *
 * There is no legitimate way left to read a reel's title, author or thumbnail.
 * The public `api.instagram.com/oembed` endpoint was withdrawn, and its
 * replacement (`instagram_oembed` on the Graph API) needs an app token and app
 * review. Both were checked against the live endpoints before this was written:
 * the old one no longer answers a browser at all, and the new one rejects an
 * unauthenticated caller.
 *
 * Anything that *would* produce a thumbnail from here - reading the page,
 * following the media URL - means scraping content the platform has chosen not
 * to publish through an API. That is off the table regardless of how well it
 * would work, so the card is drawn without a picture rather than with a stolen
 * one.
 *
 * What remains is Instagram's own `/embed/` path, which is the mechanism their
 * own Embed button produces and is meant to be framed. A private or removed
 * post renders as their "unavailable" notice inside the frame, which is the
 * platform enforcing its own access control - exactly where that decision
 * belongs, rather than in a check we would have to make and could get wrong.
 */

const HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);

/** Shortcodes are base64url-ish and never punctuation, which is the guard. */
const CODE = /^[A-Za-z0-9_-]+$/;

/**
 * The four paths that hold a video.
 *
 * `p` is in the list even though it is the generic post path: a post may be a
 * video, and Instagram gives no way to know which from the URL. Framing it is
 * correct either way - a still post simply frames as a still post.
 */
const VIDEO_PATHS = new Set(['reel', 'reels', 'p', 'tv']);

export const instagram: VideoProvider = {
  name: 'instagram',

  canHandle(url) {
    return HOSTS.has(url.hostname.toLowerCase());
  },

  identify(url) {
    const [first, second] = url.pathname.split('/').filter(Boolean);
    if (!first || !second) return undefined;
    if (!VIDEO_PATHS.has(first.toLowerCase())) return undefined;
    if (!CODE.test(second)) return undefined;

    // `reels` and `reel` are the same thing; canonicalised so the cache does
    // not hold two entries for one video.
    const path = first.toLowerCase() === 'reels' ? 'reel' : first.toLowerCase();

    return {
      platform: 'instagram',
      originalUrl: url.href,
      canonicalUrl: `https://www.instagram.com/${path}/${second}/`,
      embedUrl: `https://www.instagram.com/${path}/${second}/embed/`,
    };
  },
};
