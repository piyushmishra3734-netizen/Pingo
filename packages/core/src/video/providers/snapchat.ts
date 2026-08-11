import type { VideoProvider } from '../types.js';

/**
 * Snapchat: recognised, opened, not played.
 *
 * Only Spotlight is public video. Everything else on the domain - `/add/`,
 * profile links, and the `t.snapchat.com` short links the app itself shares -
 * is either not a video or cannot be told apart from one without following the
 * redirect, and following a sender's link from our side is the arbitrary
 * server-side fetch this whole design exists to avoid.
 *
 * No oEmbed endpoint answers, and no documented embed path is published, so
 * there is nothing to frame and nothing to describe. This provider therefore
 * exists to make a Spotlight link *recognisable* - a proper card with the
 * platform on it and a way out to Snapchat - rather than to play anything. That
 * is the graceful fallback rather than a gap: a link that PINGO knows is a
 * video reads very differently from a bare URL, even when it opens elsewhere.
 *
 * If Snapchat publishes an embed later, this file gains one line and nothing
 * else in the app changes.
 */

const HOSTS = new Set(['snapchat.com', 'www.snapchat.com']);

const CODE = /^[A-Za-z0-9_-]+$/;

export const snapchat: VideoProvider = {
  name: 'snapchat',

  canHandle(url) {
    return HOSTS.has(url.hostname.toLowerCase());
  },

  identify(url) {
    const [first, second] = url.pathname.split('/').filter(Boolean);
    if (first?.toLowerCase() !== 'spotlight' || !second || !CODE.test(second)) {
      return undefined;
    }

    // No `embedUrl`: nothing here may be framed, and the card reads that
    // absence as "offer the original" without needing to know why.
    return {
      platform: 'snapchat',
      originalUrl: url.href,
      canonicalUrl: `https://www.snapchat.com/spotlight/${second}`,
    };
  },
};
