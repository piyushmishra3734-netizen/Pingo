/**
 * A GIF as a profile photo, for everybody: centred, square, and small.
 *
 * The crop editor draws on a canvas, and a GIF drawn on a canvas is its first
 * frame - the one thing somebody picked a GIF for is gone. So a GIF skips the
 * editor and comes here instead: each frame is decoded (`ImageDecoder`), cut to
 * the centre square, drawn at AVATAR_GIF_SIZE and put back together (`gifenc`),
 * the same way covers are (`cover-gif.ts`).
 *
 * ## Why so small
 *
 * A face is drawn at 40 to 96 pixels and fetched by everybody whose chat list
 * has this person in it, every time it scrolls past. 320px is sharp on a dense
 * screen at the largest size, and the byte cap keeps a long GIF from becoming a
 * download for the whole friend list. They are served from R2, which has no
 * egress bill, but phones still pay for the data.
 *
 * ## Where it cannot be done
 *
 * Safari has no `ImageDecoder`. There a GIF that is already small enough in
 * size and bytes goes up untouched, and a bigger one is refused with a reason.
 */

export const AVATAR_GIF_SIZE = 320;
/** What may be uploaded, after shrinking. */
export const AVATAR_GIF_MAX_BYTES = 2 * 1024 * 1024;
/** A GIF picked as-is (no decoder) may be at most this tall or wide. */
const UNTOUCHED_MAX_SIDE = 512;
const MAX_FRAMES = 200;

export type AvatarGifResult = { ok: true; file: File } | { ok: false; reason: string };

interface DecodedImage {
  displayWidth: number;
  displayHeight: number;
  /** Microseconds. */
  duration: number | null;
  close(): void;
}

interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(options: { frameIndex: number }): Promise<{ image: DecodedImage }>;
  close(): void;
}

type ImageDecoderCtor = new (init: { data: ArrayBuffer; type: string }) => ImageDecoderLike;

class Refused extends Error {}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function isGif(file: Blob): boolean {
  return file.type === 'image/gif';
}

/** What to upload for a GIF picked as a profile photo, or why not. */
export async function prepareAvatarGif(file: File): Promise<AvatarGifResult> {
  try {
    const Decoder = (globalThis as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
    if (!Decoder) {
      const bitmap = await createImageBitmap(file);
      const side = Math.max(bitmap.width, bitmap.height);
      bitmap.close();
      if (side <= UNTOUCHED_MAX_SIDE && file.size <= AVATAR_GIF_MAX_BYTES) return { ok: true, file };
      return {
        ok: false,
        reason: `This browser cannot shrink GIFs. Pick one that is ${UNTOUCHED_MAX_SIDE}px or smaller and under ${mb(AVATAR_GIF_MAX_BYTES)}, or use the PINGO app.`,
      };
    }
    const out = await squareAndShrink(file, Decoder);
    if (out.size > AVATAR_GIF_MAX_BYTES) {
      return { ok: false, reason: `That GIF is still ${mb(out.size)} as a profile photo. The most is ${mb(AVATAR_GIF_MAX_BYTES)}: try a shorter one.` };
    }
    return { ok: true, file: out };
  } catch (cause) {
    if (cause instanceof Refused) return { ok: false, reason: cause.message };
    return { ok: false, reason: 'That GIF could not be prepared. Try another one.' };
  }
}

async function squareAndShrink(file: File, Decoder: ImageDecoderCtor): Promise<File> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');

  const decoder = new Decoder({ data: await file.arrayBuffer(), type: 'image/gif' });
  try {
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
    if (count > MAX_FRAMES) throw new Refused(`That GIF has ${count} frames. A profile photo can have at most ${MAX_FRAMES}: try a shorter one.`);

    const first = (await decoder.decode({ frameIndex: 0 })).image;
    // The centre square of the frame, the way a round face shows it anyway.
    const crop = Math.min(first.displayWidth, first.displayHeight);
    const sx = (first.displayWidth - crop) / 2;
    const sy = (first.displayHeight - crop) / 2;
    const size = Math.min(AVATAR_GIF_SIZE, crop);
    first.close();

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no 2d context');

    const gif = GIFEncoder();
    for (let index = 0; index < count; index += 1) {
      // Each frame comes back already composited, so disposal needs no handling.
      const { image } = await decoder.decode({ frameIndex: index });
      context.clearRect(0, 0, size, size);
      context.drawImage(image as unknown as CanvasImageSource, sx, sy, crop, crop, 0, 0, size, size);
      const delay = image.duration ? Math.round(image.duration / 1000) : 100;
      image.close();

      const { data } = context.getImageData(0, 0, size, size);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), size, size, {
        palette,
        delay,
        ...(index === 0 ? { repeat: 0 } : {}),
      });
    }
    gif.finish();
    return new File([gif.bytes() as BlobPart], 'avatar.gif', { type: 'image/gif' });
  } finally {
    decoder.close();
  }
}
