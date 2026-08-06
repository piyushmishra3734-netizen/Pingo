import { isNative } from './shell.js';

/**
 * Saving a picture to the phone, from inside the app.
 *
 * The web way is an anchor carrying `download`, and inside an Android WebView
 * that does nothing at all - no file, no error, no download notification. Save
 * on a Ping looked like it worked and produced nothing, which is the worst
 * shape a bug can take: the person believes they have the photo.
 *
 * On the web the anchor is still correct and still used. This only takes over
 * where it does not work.
 */

declare global {
  interface Window {
    AndroidShare?: {
      flushShare?: () => void;
      saveToGallery?: (base64: string, mime: string) => boolean;
    };
  }
}

/** A Blob to the base64 the native side expects, without the data: prefix. */
async function toBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked: `String.fromCharCode(...bytes)` on a whole photo overflows the
  // argument limit and throws, which is a crash on large images only.
  for (let i = 0; i < buffer.length; i += 8192) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/**
 * Saves the image, whichever way this platform supports.
 *
 * @returns false only when a save was attempted and failed, so a caller can
 * tell the person something honest rather than guessing.
 */
export async function saveImage(blob: Blob, filename: string): Promise<boolean> {
  if (isNative() && window.AndroidShare?.saveToGallery) {
    try {
      return window.AndroidShare.saveToGallery(await toBase64(blob), blob.type || 'image/jpeg');
    } catch {
      return false;
    }
  }

  // The browser path, unchanged: an anchor that downloads. On a phone browser
  // this lands in Photos exactly as a saved image should.
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked on the next frame: revoking immediately can cancel the download in
  // some browsers before it has started reading.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
  return true;
}
