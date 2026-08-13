/**
 * Received videos, kept on this device rather than on PINGO's servers.
 *
 * PINGO's storage is a delivery buffer and nothing more: a video sits there
 * only until everyone it was sent to has a complete copy of their own, and is
 * then deleted. This module is the other half of that bargain - the part that
 * makes the recipient's device the place the video actually lives.
 *
 * ## Why the whole file, and why before confirming
 *
 * A `<video src>` streams. It fetches the ranges it needs to show the frames
 * being watched and nothing more, so a video that has been opened, played to
 * the end and closed may still never have existed in one piece anywhere on the
 * receiving device. Confirming delivery from a play event would therefore
 * delete the server's copy of something the recipient cannot watch again, and
 * it would do it at exactly the moment they look most likely to be finished
 * with it.
 *
 * So the download here is deliberately *not* the playback path. It is one
 * `fetch` of the entire object, written to IndexedDB, and only once that write
 * has resolved is the server told it may let go. Until then the buffer copy
 * stays, which is the whole point of it.
 *
 * ## Why IndexedDB and not the Cache API
 *
 * The Cache API is explicitly a cache: the browser is free to evict it under
 * storage pressure and owes nobody a warning. IndexedDB under a granted
 * persistence request is the only web storage the platform agrees to keep, and
 * "keeps working with the internet off" is the entire feature.
 */

import { localDelete, localGet, localSet, requestPersistentStorage, STORE } from '../../lib/local/db.js';

/**
 * One namespace inside the shared media store, alongside the wallpaper.
 *
 * Still "video:" although photographs, documents and voice notes live here too:
 * a message carries at most one object, so the message id is the whole key, and
 * renaming the prefix would orphan every video already on a device for no gain.
 * The prefix is a namespace, not a type.
 */
const key = (messageId: string) => `video:${messageId}`;

/**
 * Downloads in flight, so two bubbles for the same video fetch it once.
 *
 * Both copies of a message can be on screen at the same time - the thread and
 * the media grid - and a video large enough to be worth this module is large
 * enough that fetching it twice is worth avoiding.
 */
const inFlight = new Map<string, Promise<Blob | undefined>>();

/** The local copy, if this device has one. */
export function storedVideo(messageId: string): Promise<Blob | undefined> {
  return localGet<Blob>(STORE.media, key(messageId)).catch(() => undefined);
}

/**
 * Fetches the whole video and persists it. Resolves once it is safely stored.
 *
 * Resolving to `undefined` means the copy was not made - offline, a refused
 * quota, a dead URL. The caller must treat that as "not delivered" and leave
 * the server copy alone; a failed download that reported success is the one
 * outcome this whole design exists to prevent.
 */
export async function keepVideo(messageId: string, url: string): Promise<Blob | undefined> {
  const existing = await storedVideo(messageId);
  if (existing) return existing;

  const running = inFlight.get(messageId);
  if (running) return running;

  const work = (async () => {
    try {
      /*
       * Asked for once per device, not once per video. The browser prompts at
       * most once and remembers; a refusal is not fatal, it only means the
       * copy is evictable, which is still better than no copy.
       */
      void requestPersistentStorage();

      const response = await fetch(url);
      if (!response.ok) return undefined;

      const blob = await response.blob();
      // A zero-length body is a failed transfer that returned 200. Storing it
      // would satisfy every later `storedVideo` check with a broken file.
      if (blob.size === 0) return undefined;

      await localSet(STORE.media, key(messageId), blob);
      return blob;
    } catch {
      // Out of quota, offline, or the object is already gone. Either way this
      // device does not have it, and must not say that it does.
      return undefined;
    } finally {
      inFlight.delete(messageId);
    }
  })();

  inFlight.set(messageId, work);
  return work;
}

/**
 * Keeps bytes this device already holds, without fetching them again.
 *
 * A voice note is materialised in full before it can play - the player needs a
 * typed blob, not a stream - so by the time it is audible the whole file is in
 * memory. Downloading it a second time to persist it would be paying twice for
 * the same bytes. Returns whether the write succeeded, because that is what
 * the receipt is allowed to be based on.
 */
export async function putMedia(messageId: string, blob: Blob): Promise<boolean> {
  if (blob.size === 0) return false;
  try {
    void requestPersistentStorage();
    await localSet(STORE.media, key(messageId), blob);
    return true;
  } catch {
    return false;
  }
}

/** Drops the local copy - used when the message itself is deleted. */
export function forgetVideo(messageId: string): Promise<unknown> {
  return localDelete(STORE.media, key(messageId)).catch(() => undefined);
}

/*
 * The same three functions, named for what they now hold.
 *
 * Photographs, documents and voice notes go through this module too - the
 * server's copy of any of them is a delivery buffer, and the receipt that
 * releases it means the same thing for all four. Aliases rather than a second
 * module, so there is one store, one in-flight map and one definition of "this
 * device has it".
 */
export const storedMedia = storedVideo;
export const keepMedia = keepVideo;
export const forgetMedia = forgetVideo;
