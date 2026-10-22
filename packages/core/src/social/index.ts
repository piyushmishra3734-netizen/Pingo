import { findLinks } from '../video/detect.js';
import { linkify } from '../linkify.js';

/**
 * Posts from X and Pinterest, recognised from a link.
 *
 * Videos have their own module because a video is something you play. These are
 * something you read or look at, so they get a card that looks like the post
 * rather than a player, and they are found the same way: from the URL alone,
 * offline, with nothing fetched until the card is drawn.
 *
 * Everything the card will ever ask the edge for is a value matched against a
 * fixed character class here, so a hostile link cannot choose a host or a path.
 */

export type SocialPlatform = 'x' | 'pinterest';

export interface SocialLink {
  platform: SocialPlatform;
  /** The link as written, for "open on" and for dropping it from the text. */
  url: string;
  /** The same post under one address, so two spellings of a link are one post. */
  canonicalUrl: string;
  /** X: the numeric status id. Pinterest: the pin id, or the pin.it short code. */
  id: string;
  /** X only: the handle in the link. `i` when the link had none. */
  user?: string;
  /** Pinterest only: a pin.it short link, which has to be resolved before the pin is known. */
  short?: boolean;
}

const X_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.twitter.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com']);
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const STATUS_ID = /^\d{5,25}$/;
const PIN_ID = /^\d{5,25}$/;
const SHORT_CODE = /^[A-Za-z0-9]{4,20}$/;

function bare(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

export function identifySocial(url: URL): SocialLink | undefined {
  const host = bare(url.hostname);
  const parts = url.pathname.split('/').filter(Boolean);

  if (X_HOSTS.has(host)) {
    // /user/status/123, or /i/status/123 and /i/web/status/123 for the share-sheet form.
    const at = parts.indexOf('status');
    const id = at >= 0 ? parts[at + 1] : undefined;
    if (!id || !STATUS_ID.test(id)) return undefined;
    const first = parts[0];
    const user = first && at >= 1 && HANDLE.test(first) ? first : 'i';
    return {
      platform: 'x',
      url: url.toString(),
      canonicalUrl: `https://x.com/${user}/status/${id}`,
      id,
      user,
    };
  }

  // pinterest.com, in.pinterest.com, pinterest.co.uk and the rest of the regional hosts.
  if (/(^|\.)pinterest\.[a-z.]{2,6}$/.test(host)) {
    if (parts[0] !== 'pin') return undefined;
    // /pin/123/ and the older /pin/some-title--123/ form.
    const id = parts[1]?.match(/(\d{5,25})$/)?.[1];
    if (!id || !PIN_ID.test(id)) return undefined;
    return { platform: 'pinterest', url: url.toString(), canonicalUrl: `https://www.pinterest.com/pin/${id}/`, id };
  }

  if (host === 'pin.it') {
    const code = parts[0];
    if (!code || !SHORT_CODE.test(code)) return undefined;
    return { platform: 'pinterest', url: url.toString(), canonicalUrl: `https://pin.it/${code}`, id: code, short: true };
  }

  return undefined;
}

/** The first X or Pinterest post in a message, if there is one. */
export function detectSocialLink(text: string): SocialLink | undefined {
  for (const url of findLinks(text)) {
    const found = identifySocial(url);
    if (found) return found;
  }
  return undefined;
}

/** The message with that post's link taken out, because the card is the link. */
export function withoutSocialLink(text: string, link: SocialLink): string {
  let dropped = false;
  const kept = linkify(text).filter((segment) => {
    if (dropped || segment.kind !== 'link') return true;
    const same = detectSocialLink(segment.href)?.canonicalUrl === link.canonicalUrl;
    if (same) dropped = true;
    return !same;
  });
  return kept.map((segment) => segment.value).join('').replace(/[ \t]{2,}/g, ' ').trim();
}
