import type { VideoProvider } from '../types.js';

/**
 * A link that is a video file, not a page about one.
 *
 * This is the provider that gives back the thing the embeds cannot: a real
 * video, in PINGO's own player, that can be saved to the phone. No platform is
 * involved and no terms are being worked around - the URL points at media, and
 * playing media is what the URL is for.
 *
 * ## Why the extension, and not a request
 *
 * The honest way to know a URL is a video is to ask the server what it holds.
 * Doing that would mean fetching every link anybody sends, from their device,
 * before they had shown any interest in it - which hands every host in every
 * message a record of who is reading what, to answer a question that only
 * matters if somebody presses play.
 *
 * So the path decides. It is a guess, and it is allowed to be wrong in the
 * cheap direction: a `.mp4` that turns out not to play shows the card's error
 * state, while a video served from an extensionless URL is simply left as a
 * link. Neither loses the message, and neither costs a request nobody asked
 * for.
 *
 * ## Query strings are not part of the name
 *
 * Signed CDN links carry their signature in the query - `?X-Amz-Signature=...`
 * - and a naive `endsWith('.mp4')` fails every one of them. The extension is
 * read off the *path*, which is why `pathname` is used rather than `href`.
 */

/**
 * Containers a browser will actually play.
 *
 * `.mkv` and `.avi` are deliberately absent: they are video files, but no
 * browser plays them, so recognising one would produce a player that cannot
 * play - worse than the plain link it replaced.
 */
const PLAYABLE = /\.(mp4|webm|ogv|m4v|mov)$/i;

/*
 * `.ogg` is deliberately not on that list.
 *
 * It is a container, and in practice almost every `.ogg` in circulation is
 * audio - a voice note, a sound effect. Treating one as a video puts a player
 * with a permanently black picture into the thread, which reads as a broken
 * video rather than as the audio file it is. `.ogv` is the video spelling and
 * is unambiguous, so that is the one recognised.
 */

/**
 * `.mov` is on the list with a caveat worth knowing.
 *
 * QuickTime is a container, and the H.264 inside one plays everywhere while
 * some older codecs do not. It is included because the overwhelming majority of
 * `.mov` files in circulation come from iPhones and are H.264 or HEVC, and
 * because failing to play falls back to the same card as any other unplayable
 * source.
 */

export const direct: VideoProvider = {
  name: 'direct',

  /*
   * Any host at all, which is the one provider here that is not allowlisted.
   *
   * Safe because of where the URL ends up: a `<video src>`, not an `iframe`.
   * The scheme was already forced to https during detection, so this cannot
   * reach `file:` or `javascript:`, and a media element gives a hostile server
   * nothing to execute. It also sits last in the registry, so it only ever sees
   * URLs no real platform claimed.
   */
  canHandle() {
    return true;
  },

  identify(url) {
    if (!PLAYABLE.test(url.pathname)) return undefined;

    return {
      platform: 'direct',
      originalUrl: url.href,
      canonicalUrl: url.href,
      fileUrl: url.href,
    };
  },
};

/** The last segment of the path, for naming a saved file. */
export function fileNameFrom(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop();
    return last && PLAYABLE.test(last) ? decodeURIComponent(last) : 'video.mp4';
  } catch {
    return 'video.mp4';
  }
}
