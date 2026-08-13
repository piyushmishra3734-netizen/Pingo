/**
 * How large a file PINGO will carry, and what to say when it will not.
 *
 * ## Why a ceiling exists at all
 *
 * The server's copy is a delivery buffer with a lifetime measured in days, so a
 * huge file is not a storage problem for ever - but it is one for a month, and
 * it is a *delivery* problem immediately: the recipient's device has to hold the
 * whole thing before the buffer copy may go, and a phone that cannot finish the
 * download never confirms, which keeps the buffer copy alive to its ceiling.
 * The limit is therefore about what can actually complete the round trip.
 *
 * ## Three places, one number
 *
 * The composer refuses early with a sentence somebody can act on; the service
 * refuses again before uploading, because not every path goes through the
 * composer; and the bucket refuses last, which is what stops a modified client.
 * They are all this file, so they cannot drift apart.
 */

/** Bytes in a megabyte, spelled out once. */
const MB = 1024 * 1024;

export const MEDIA_LIMITS = {
  /** A photograph, a GIF, a sticker somebody sent as a file. */
  photo: 25 * MB,
  /** A voice note. Five minutes of mono WAV is about 15 MB - see `wav.ts`. */
  voice: 25 * MB,
  /** A Ping. Camera stills, never a gallery pick. */
  snap: 25 * MB,
  /**
   * Documents, which is also where video arrives.
   *
   * A hundred megabytes is roughly two minutes of phone video at full quality.
   * Past that the recipient's download is the thing that fails, and it fails
   * after a long wait rather than immediately.
   */
  file: 100 * MB,
} as const;

export type MediaKind = keyof typeof MEDIA_LIMITS;

/** "100 MB", "25 MB" - for a sentence, not a table. */
export function formatLimit(kind: MediaKind): string {
  return `${Math.round(MEDIA_LIMITS[kind] / MB)} MB`;
}

/**
 * What is wrong with this file, in words the sender can act on.
 *
 * Returns nothing when the file is fine. The message names the limit and the
 * file's own size, because "too large" without either is a dead end - the
 * person cannot tell whether to trim a second off a video or give up.
 */
export function mediaTooLarge(size: number, kind: MediaKind): string | undefined {
  const limit = MEDIA_LIMITS[kind];
  if (size <= limit) return undefined;

  const mb = size / MB;
  // Rounded *up*: a file one byte over a 25 MB limit rounding to "25 MB" reads
  // as the app refusing something it says is allowed.
  const shown = mb >= 10 ? Math.ceil(mb) : Math.ceil(mb * 10) / 10;
  return `That file is ${shown} MB. The limit is ${formatLimit(kind)}.`;
}
