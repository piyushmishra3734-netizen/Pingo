/**
 * The three decisions that keep the server from re-sending what a device has.
 *
 * They live together, and outside the components and the service that use them,
 * for one reason: each was a measured bug worth several gigabytes a month, and
 * each was invisible because it was a condition buried in a scroll handler, a
 * `select('*')`, and a cache gate. Pulled out here they can be asserted - see
 * `verify-egress.ts` - and read side by side, which is how it becomes obvious
 * that they are the same rule three times: *ask only for what is missing*.
 *
 * The SQL half of the second one lives in the envelope-trim migration. This is
 * the shape it produces, so the client and the database can be checked against
 * one definition instead of agreeing by coincidence.
 */

/** How close to the top starts fetching the page before, in px. */
export const OLDER_THRESHOLD = 200;

/**
 * Whether reaching this scroll position should ask for older history.
 *
 * `fromScroll` is the part that matters. The thread runs this check once when
 * it mounts, to work out whether it is following the bottom, and at that moment
 * the container is empty: `scrollTop` is 0, which is less than the threshold,
 * which used to read as "the reader has scrolled back to the beginning of
 * time". Every conversation open therefore fetched a second page of fifty
 * messages that nobody had asked for.
 *
 * The height test is the other half: a thread shorter than its own viewport
 * never leaves `scrollTop` 0, so without it every scroll event on a short chat
 * would ask for history that does not exist.
 */
export function shouldLoadOlder(view: {
  fromScroll: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  if (!view.fromScroll) return false;
  if (view.scrollTop >= OLDER_THRESHOLD) return false;
  return view.scrollHeight > view.clientHeight + OLDER_THRESHOLD;
}

export interface Envelope {
  epk: string;
  iv: string;
  keys: Record<string, string>;
}

/**
 * The same envelope, carrying only the wrapped key this device can open.
 *
 * A message is encrypted once and its content key wrapped once per recipient
 * device - 15.46 of them on average here. A reader uses exactly one, and the
 * other fifteen were 95% of every message row the server sent.
 *
 * Nothing about the encryption changes: same ciphertext, same ephemeral public
 * key, same iv. `epk` and `iv` stay because the one remaining wrap cannot be
 * opened without them.
 *
 * An envelope with no wrap for this device keeps an empty `keys` rather than
 * losing the field, so the reader sees a well-formed envelope it cannot open -
 * "sent before you added this device" - instead of a parse failure.
 */
export function trimEnvelopeKeys(
  envelope: Envelope | undefined,
  deviceId: string,
): Envelope | undefined {
  if (!envelope) return undefined;
  const wrap = envelope.keys?.[deviceId];
  return {
    epk: envelope.epk,
    iv: envelope.iv,
    keys: wrap === undefined ? {} : { [deviceId]: wrap },
  };
}

/**
 * Whether the page on disk may be believed.
 *
 * A cached page holding "sent before you added this device" was refused for
 * ever, on the reasoning that a refetch would replace it with the real message.
 * That is true of a temporary decryption failure and false of the case that
 * produces nearly all of them: a message sent before this device existed
 * carries no wrapped key for it anywhere, so the bytes to open it do not exist
 * and never will.
 *
 * The consequence was not a stale page - it was no page at all. The cache was
 * never written, the sync cursor was never set, and every open of that
 * conversation fetched two full pages from the network for ever: 610 kB to
 * rediscover something the device already knew.
 *
 * One refetch, then. Enough to clear a placeholder that can be cleared, and
 * after that the local copy is accepted for what it is.
 */
export function shouldTrustCache(state: {
  hasPlaceholder: boolean;
  alreadyRetried: boolean;
}): boolean {
  return !state.hasPlaceholder || state.alreadyRetried;
}

/**
 * What a list row becomes when a message lands in it.
 *
 * The realtime handler used to answer this by refetching the conversation -
 * fourteen queries, once per arriving message, on every recipient's device.
 * Measured over 15.8 hours of ordinary production traffic that path ran about
 * 450 times an hour, roughly 4 GB a month, to rebuild rows whose title, roster
 * and settings had not changed.
 *
 * Only three things move: the preview, the position, and the unread count.
 * Returns `undefined` when the device has never loaded this conversation,
 * because then there is genuinely nothing to patch and a refetch is right.
 */
export function bumpedRow<T extends { unreadCount: number; updatedAt: number }>(
  known: T | undefined,
  message: { createdAt: number },
  mine: boolean,
): T | undefined {
  if (!known) return undefined;
  return {
    ...known,
    lastMessage: message,
    updatedAt: message.createdAt,
    unreadCount: mine ? known.unreadCount : known.unreadCount + 1,
  };
}
