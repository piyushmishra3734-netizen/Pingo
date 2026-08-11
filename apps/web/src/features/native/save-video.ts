import { isNative } from './shell.js';

/**
 * Saving a video to the phone.
 *
 * ## Why this is not `saveImage`
 *
 * That one hands its bytes to `MediaStore.Images`, which is the right shelf for
 * a picture and the wrong one for a video: the file lands, the gallery indexes
 * it as an image, and what the person gets is a broken thumbnail they cannot
 * play. It would look like a save that worked. So videos go to
 * `MediaStore.Video` through a bridge method of their own.
 *
 * ## Why a size limit
 *
 * The bridge takes base64, which is a third larger than the bytes and has to
 * exist as a JavaScript string, a decoded array, and a file all at once. That
 * is fine for a clip and is how a phone runs out of memory on a long one. Past
 * the limit the URL is handed to the system instead, which streams it to
 * Downloads without any of it passing through this page.
 */

/*
 * The `AndroidShare` bridge is declared once, in `save-image.ts`. A second
 * `declare global` for the same interface is a conflict rather than an
 * addition, which is why `saveVideoToGallery` is declared over there.
 */

/**
 * Above this, the platform downloads it rather than this page.
 *
 * 40 MB is comfortably more than a reel or a clip anybody sends in a chat, and
 * comfortably less than the point where holding three copies of it hurts.
 */
const INLINE_LIMIT = 40 * 1024 * 1024;

async function toBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked: spreading a whole video into `fromCharCode` overflows the
  // argument limit and throws - a crash on large files only.
  for (let i = 0; i < buffer.length; i += 8192) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/**
 * Saves the video, whichever way this platform and this file allow.
 *
 * Never throws. Every failure ends at the same place - the system is given the
 * URL and does what it does with a video link - because there is nothing useful
 * to tell somebody about a CORS header, and "it opened instead of saving" is a
 * far better outcome than an error they cannot act on.
 */
export async function saveVideo(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) return handOff(url);

    /*
     * Read before the body is. `content-length` is free at this point and is
     * the only chance to decline a file that is too big *without* having
     * already pulled it into memory to find out.
     */
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > INLINE_LIMIT) return handOff(url);

    const blob = await response.blob();
    if (blob.size > INLINE_LIMIT) return handOff(url);

    if (isNative()) {
      const saved = window.AndroidShare?.saveVideoToGallery?.(
        await toBase64(blob),
        blob.type || 'video/mp4',
      );
      // An older build has no bridge method. Rather than fail, let Android's
      // own downloader have it - the app updates, the saving keeps working.
      if (!saved) handOff(url);
      return;
    }

    const object = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = object;
    link.download = filename;
    link.click();
    // Next frame: revoking at once cancels the download in some browsers
    // before it has started reading.
    requestAnimationFrame(() => URL.revokeObjectURL(object));
  } catch {
    // Cross-origin without CORS, offline, or a host that refused. All the
    // same answer.
    handOff(url);
  }
}

/**
 * Give up gracefully: let the platform deal with the URL.
 *
 * On Android that reaches the system browser and its download manager, which
 * streams straight to storage. In a desktop browser it opens the video in a
 * tab, where saving is one menu away. Neither is as good as one tap, and both
 * beat a button that appears to do nothing.
 */
function handOff(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
