/**
 * A GIF for the cover: premium only, and never taller than 480p.
 *
 * ## Why a GIF is re-encoded rather than resized like a photo
 *
 * A photo shrinks on a canvas and comes out a JPEG. A GIF drawn onto a canvas
 * comes out as its first frame - the animation, which is the entire reason for
 * picking one, is gone. So a GIF over 480p is taken apart frame by frame with
 * `ImageDecoder`, each frame drawn at 480p, and put back together with `gifenc`,
 * because the platform has a GIF decoder and no encoder at all.
 *
 * At or under 480p it is uploaded exactly as picked. Re-encoding one that is
 * already small would only cost colours.
 *
 * ## The cap is about the people looking at it
 *
 * A cover is fetched by everybody who opens the profile, over and over, and
 * this project's plan is paid for in bytes served. So 480p, a frame limit, and
 * a size limit on what comes out - premium unlocks the animation, not an
 * unbounded download for every visitor.
 *
 * ## Where it cannot be done
 *
 * `ImageDecoder` is Chromium's - the Android app and Chrome have it, Safari
 * does not. There, a GIF already at 480p or under still goes up untouched, and
 * a bigger one is refused with a reason rather than uploaded at full size.
 *
 * The premium check here is for the message. The database refuses a GIF cover
 * from anybody else whatever this code does - see `profiles_cover_rules`.
 */

export const GIF_COVER_MAX_HEIGHT = 480;

/** A long GIF at 480p is still a large file; past this it is refused. */
const MAX_FRAMES = 300;

/** What may come out, after shrinking. */
const MAX_BYTES = 6 * 1024 * 1024;

export type CoverResult = { ok: true; file: File } | { ok: false; reason: string };

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

class CoverRefused extends Error {}

const TOO_BIG = 'That GIF is too big for a cover. Try a shorter one.';

/** The first frame's size, without decoding the rest. */
async function firstFrameSize(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

async function shrink(file: File, Decoder: ImageDecoderCtor): Promise<File> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');

  const decoder = new Decoder({ data: await file.arrayBuffer(), type: 'image/gif' });
  try {
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
    if (count > MAX_FRAMES) throw new CoverRefused('That GIF is too long for a cover. Try a shorter one.');

    const first = (await decoder.decode({ frameIndex: 0 })).image;
    const height = GIF_COVER_MAX_HEIGHT;
    const width = Math.max(2, Math.round((first.displayWidth * height) / first.displayHeight));
    first.close();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no 2d context');

    const gif = GIFEncoder();
    for (let index = 0; index < count; index += 1) {
      // Each frame comes back already composited, so disposal needs no handling here.
      const { image } = await decoder.decode({ frameIndex: index });
      context.clearRect(0, 0, width, height);
      context.drawImage(image as unknown as CanvasImageSource, 0, 0, width, height);
      const delay = image.duration ? Math.round(image.duration / 1000) : 100;
      image.close();

      const { data } = context.getImageData(0, 0, width, height);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), width, height, {
        palette,
        delay,
        // Loop for ever, as the original almost certainly did.
        ...(index === 0 ? { repeat: 0 } : {}),
      });
    }
    gif.finish();

    return new File([gif.bytes() as BlobPart], 'cover.gif', { type: 'image/gif' });
  } finally {
    decoder.close();
  }
}

/**
 * What to upload for a picked cover, or why not.
 *
 * Anything but a GIF passes straight through - photos keep their own path.
 */
export async function prepareCover(file: File, premium: boolean): Promise<CoverResult> {
  if (file.type !== 'image/gif') return { ok: true, file };
  if (!premium) return { ok: false, reason: 'GIF covers are part of PINGO premium.' };

  try {
    const { height } = await firstFrameSize(file);

    if (height <= GIF_COVER_MAX_HEIGHT) {
      return file.size <= MAX_BYTES ? { ok: true, file } : { ok: false, reason: TOO_BIG };
    }

    const Decoder = (globalThis as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
    if (!Decoder) {
      return {
        ok: false,
        reason: 'This browser cannot shrink a GIF. Pick one 480p or smaller, or use the PINGO app.',
      };
    }

    const shrunk = await shrink(file, Decoder);
    return shrunk.size <= MAX_BYTES ? { ok: true, file: shrunk } : { ok: false, reason: TOO_BIG };
  } catch (cause) {
    if (cause instanceof CoverRefused) return { ok: false, reason: cause.message };
    return { ok: false, reason: 'That GIF could not be prepared. Try another one.' };
  }
}
