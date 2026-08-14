import { linkify, type Message } from '@pingo/core';

/**
 * Everything a conversation has carried, sorted into the three piles people
 * actually go looking through.
 *
 * ## Why a pure module
 *
 * The sheet around this is tabs and a grid. The part that can be wrong is what
 * counts as media - and one of those rules is a promise rather than a
 * preference, so it is asserted rather than trusted.
 *
 * ## What is deliberately left out
 *
 * **View-limited photos and Pings.** A picture sent to be seen once or twice
 * must not reappear in a gallery afterwards; a limit that a second screen
 * quietly ignores is not a limit. This is the one exclusion here that is not a
 * matter of taste.
 *
 * **Voice notes.** They belong to the conversation they were said in - nobody
 * browses them, and a grid of identical waveforms answers no question.
 *
 * **Deleted messages.** The tombstone stays in the thread because the thread is
 * a record of what happened. A gallery is not; it is a place to find a file,
 * and a file that was taken back is not findable.
 */

export interface MediaItem {
  messageId: string;
  kind: 'image' | 'video';
  /** May be an expired signature; the tile prefers this device's own copy. */
  url?: string;
  createdAt: number;
}

export interface DocItem {
  messageId: string;
  fileName: string;
  mimeType: string;
  url?: string;
  size?: number;
  createdAt: number;
}

export interface LinkItem {
  messageId: string;
  /** Where it goes, scheme included. */
  href: string;
  /** What was typed, which is what to show. */
  value: string;
  createdAt: number;
}

export interface SharedMedia {
  media: MediaItem[];
  docs: DocItem[];
  links: LinkItem[];
}

/**
 * Buckets a run of messages, newest first in every pile.
 *
 * `now` is an argument so the expiry rule can be asserted without waiting.
 */
export function collectSharedMedia(
  messages: readonly Message[],
  now = Date.now(),
): SharedMedia {
  const media: MediaItem[] = [];
  const docs: DocItem[] = [];
  const links: LinkItem[] = [];

  for (const message of messages) {
    if (message.deleted || message.ping) continue;
    /*
     * A message whose timer has run out, read straight off the disk.
     *
     * The thread filters these in `useMessages`; this sheet does not go through
     * it - it reads the sealed rows itself - so without this line a
     * disappearing photo would keep appearing in the gallery until the device
     * happened to refetch the conversation.
     */
    if (message.expiresAt !== undefined && message.expiresAt <= now) continue;
    const createdAt = message.createdAt;

    // An unlimited photo is a picture that was sent to be kept. A limited one
    // is not, and never enters the gallery - see the note above.
    if (message.photo && message.photo.viewLimit === undefined) {
      media.push({
        messageId: message.id,
        kind: 'image',
        ...(message.photo.url ? { url: message.photo.url } : {}),
        createdAt,
      });
    }

    for (const attachment of message.attachments) {
      if (attachment.kind === 'image' || attachment.kind === 'video') {
        media.push({
          messageId: message.id,
          kind: attachment.kind,
          ...(attachment.url ? { url: attachment.url } : {}),
          createdAt,
        });
      } else if (attachment.kind === 'file') {
        docs.push({
          messageId: message.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          ...(attachment.url ? { url: attachment.url } : {}),
          ...(attachment.size !== undefined ? { size: attachment.size } : {}),
          createdAt,
        });
      }
    }

    if (message.body.trim()) {
      for (const segment of linkify(message.body)) {
        if (segment.kind === 'link') {
          links.push({
            messageId: message.id,
            href: segment.href,
            value: segment.value,
            createdAt,
          });
        }
      }
    }
  }

  // The caller's order is whatever the row store handed back. Sorting here
  // means the sheet does not depend on that staying newest-first.
  const newestFirst = <T extends { createdAt: number }>(items: T[]) =>
    items.sort((a, b) => b.createdAt - a.createdAt);

  return {
    media: newestFirst(media),
    docs: newestFirst(docs),
    links: newestFirst(links),
  };
}
