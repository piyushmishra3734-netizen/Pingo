/**
 * A video's best available source, preferring the copy on this device.
 *
 * Returns the local object URL once there is one, and the server URL until
 * then, so a video is watchable the moment it arrives and keeps working after
 * PINGO's copy has been deleted. Those are the two ends of the same lifecycle
 * and the bubble should not have to know which one it is in.
 */

import { useEffect, useState } from 'react';

import { keepVideo, storedVideo } from './video-vault.js';

export interface OfflineVideo {
  /** What to hand `<video src>`. Undefined only if there is nothing to play. */
  src: string | undefined;
  /** A copy exists on this device; it will play with the network off. */
  offline: boolean;
}

export function useOfflineVideo(
  messageId: string,
  remoteUrl: string | undefined,
  /**
   * Told once the whole file is on this device.
   *
   * This is what releases the server's buffer copy, so it fires from the
   * completion of the write and from nowhere else - not from a play event, not
   * from the bubble appearing. See `video-vault.ts`.
   */
  onStored?: () => void,
): OfflineVideo {
  const [local, setLocal] = useState<string>();

  useEffect(() => {
    if (!remoteUrl) return;

    let live = true;
    let url: string | undefined;

    const publish = (blob: Blob) => {
      if (!live) return false;
      url = URL.createObjectURL(blob);
      setLocal(url);
      return true;
    };

    void (async () => {
      const already = await storedVideo(messageId);
      if (already) {
        publish(already);
        return;
      }

      const fetched = await keepVideo(messageId, remoteUrl);
      if (!fetched) return;
      publish(fetched);
      /*
       * Reported even if this component unmounted while the download ran. The
       * bytes are on the device either way, and a confirmation that depends on
       * the user still looking at the message would leave the server holding
       * copies of videos that were delivered perfectly well.
       */
      onStored?.();
    })();

    return () => {
      live = false;
      // Revoked on the way out; an object URL pins the whole blob in memory.
      if (url) URL.revokeObjectURL(url);
    };
    // `onStored` is deliberately not a dependency - a caller passing an inline
    // arrow would otherwise re-run this effect, and re-downloading a video is
    // the most expensive possible way to react to a new function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, remoteUrl]);

  return { src: local ?? remoteUrl, offline: local !== undefined };
}
