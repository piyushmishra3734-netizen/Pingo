/**
 * How big a face actually needs to be, and how long it may be cached.
 *
 * ## The measurement that produced this file
 *
 * A single session - the chat list plus one open conversation - downloaded
 * **9.56 MB of avatars**: fourteen objects averaging 778 kB, several over two
 * megabytes, every one of them a 1024x1024 PNG being drawn into a 48-pixel
 * circle. At 33 monthly users that was the largest single contributor to a
 * Supabase egress bill of 10.65 GB against a 5 GB quota.
 *
 * Nothing was wrong with the code that produced them. `AvatarPhotoEditor`
 * exported at 1024 because that is a sensible archival size, and PNG because
 * the crop is a circle with transparent corners - both defensible, and together
 * they made a two megabyte thumbnail.
 *
 * ## Why 384
 *
 * The largest place an avatar is drawn is the profile header, around 120 CSS
 * pixels. At a 3x device pixel ratio that is 360 real pixels, so 384 is the
 * first round number that is never upscaled on any phone anybody has. Above
 * that the extra pixels are not visible on any screen this app runs on; they
 * are only billable.
 *
 * ## Why WebP
 *
 * It keeps the alpha channel the circular crop depends on, at roughly a
 * fortieth of the bytes. Browsers that cannot *encode* it - Safari before 16.4 -
 * hand back a PNG from the same call, which at 384 is still a fifth of what a
 * 1024 PNG cost. The format is never assumed; it is read back off the blob.
 *
 * ## Why the cache may be immutable
 *
 * Every avatar path already ends in a timestamp or a uuid, so a replacement is
 * a different URL rather than new bytes at the old one. That makes the old
 * default of one hour pure waste: the same unchanged face was re-fetched every
 * hour for ever. A year is the honest answer for a file that cannot change.
 */

/** The longest edge stored for any avatar. See the note above. */
export const AVATAR_PIXELS = 384;

/**
 * `cacheControl` for anything whose path changes when its content does.
 *
 * Supabase takes seconds as a string. A year is the conventional maximum and
 * is correct here for the reason above - not a guess about how often people
 * change their picture.
 */
export const IMMUTABLE_CACHE_SECONDS = '31536000';

/**
 * Encodes a canvas as the smallest thing the browser can produce, alpha intact.
 *
 * Returns the blob and its real type rather than the type asked for, because a
 * browser that cannot encode WebP silently returns PNG from the same call and a
 * caller that trusted the request would upload a PNG labelled `image/webp`.
 */
export async function encodeAvatar(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, 'image/webp', 0.9);
  if (webp && webp.type === 'image/webp') return webp;

  const png = await toBlob(canvas, 'image/png');
  if (png) return png;

  throw new Error('Could not encode the photo.');
}

/** The file extension matching what was actually encoded. */
export function avatarExtension(blob: Blob): string {
  return blob.type === 'image/webp' ? 'webp' : 'png';
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * Any picked image, shrunk to avatar size before it is uploaded.
 *
 * For the paths that have no cropper - a group photo, the AI's picture - where
 * the file goes straight from the picker to the bucket. Covers the image with
 * a centre crop, so a landscape photo becomes the middle of itself rather than
 * a squashed one.
 *
 * Returns the original untouched if it cannot be decoded, which is the safe
 * end: an upload that works and is large beats one that fails.
 */
export async function shrinkToAvatar(file: File): Promise<File> {
  // An animated GIF has one frame after this and would stop moving. Nobody
  // uploads one as a still on purpose, so it is left alone rather than frozen.
  if (file.type === 'image/gif') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    if (side === 0) return file;

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_PIXELS;
    canvas.height = AVATAR_PIXELS;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_PIXELS,
      AVATAR_PIXELS,
    );
    bitmap.close();

    const blob = await encodeAvatar(canvas);
    // Already smaller is already right - a tiny picture must not be re-encoded
    // into a larger one.
    if (blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^.]+$/, '') || 'avatar';
    return new File([blob], `${base}.${avatarExtension(blob)}`, { type: blob.type });
  } catch {
    return file;
  }
}
