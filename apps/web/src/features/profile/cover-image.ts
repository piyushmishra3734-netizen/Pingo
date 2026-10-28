/**
 * A cover photo, shrunk to what a cover can show before it goes anywhere.
 *
 * ## Why this exists
 *
 * A picked photo used to be staged and uploaded exactly as it came off the
 * phone: three, five, thirty megabytes of a picture that is drawn into a strip
 * 150 pixels tall. That cost twice. The person waited on Save while it went up,
 * and every visitor to the profile then downloaded all of it - the two covers
 * on the old bucket that were 2.7 MB and 3.1 MB were this.
 *
 * It also made the reposition drag heavy: the browser re-scaled a twelve
 * megapixel bitmap on every pointer move.
 *
 * ## What it does
 *
 * Draws the photo at 1280 pixels wide - the widest a phone shows it, at 3x -
 * keeping its whole height, because the drag chooses which part of it is seen
 * and cropping here would take that choice away. Encoded as WebP, which is
 * ordinarily a hundred kilobytes for a cover.
 *
 * A GIF is never touched: drawing it on a canvas would keep one frame.
 * Anything that cannot be decoded, or that comes out no smaller, goes through
 * unchanged - an upload that works and is large beats one that fails.
 */

/** Widest edge of a stored cover, in pixels. */
export const COVER_MAX_WIDTH = 1280;
/** A tall photo keeps its height for the drag, up to this. */
const COVER_MAX_HEIGHT = 1920;

export async function shrinkCoverPhoto(file: File): Promise<File> {
  if (file.type === 'image/gif') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, COVER_MAX_WIDTH / bitmap.width, COVER_MAX_HEIGHT / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await encodeCover(canvas);
    if (!blob || blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^.]+$/, '') || 'cover';
    return new File([blob], `${base}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type });
  } catch {
    return file;
  }
}

/** WebP where the browser can write it, JPEG where it cannot; the type is read back off the blob. */
export async function encodeCover(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const webp = await toBlob(canvas, 'image/webp', 0.85);
  if (webp && webp.type === 'image/webp') return webp;
  return toBlob(canvas, 'image/jpeg', 0.85);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
}
