/**
 * A GIF as a profile photo, for everybody: square, small, and still moving.
 *
 * The crop editor draws on a canvas, and a canvas keeps only a GIF's first
 * frame, so the framing the person chose is applied to every frame instead:
 * each frame is decoded (`ImageDecoder`), drawn into the frame, and the GIF is put
 * back together (`gifenc`), the way covers are (`cover-gif.ts`).
 *
 * ## It fits, it does not refuse
 *
 * A face is drawn at 40 to 96 pixels and fetched by everybody whose chat list
 * has this person in it, so the result is capped at AVATAR_GIF_MAX_BYTES. A GIF
 * somebody picked is rarely that small, and refusing it was what made a profile
 * photo GIF so hard to set: most of the funny ones are long and large. So the
 * cap is met by making the GIF smaller instead, from sharp to small: 320px, then
 * 256, 192, and below that fewer frames as well (the delays are added up, so the
 * speed stays the same). Only a GIF that cannot fit even then is refused.
 *
 * ## Where there is no decoder
 *
 * Safari has no `ImageDecoder`. There a GIF that is small enough goes up as
 * picked (the picture is cut to the circle by CSS), and a bigger one is refused
 * with a reason.
 */

export const AVATAR_GIF_SIZE = 320;
/** What may be uploaded, after shrinking. */
export const AVATAR_GIF_MAX_BYTES = 2 * 1024 * 1024;
/** A GIF picked as-is (no decoder) may be at most this tall or wide, and this many bytes. */
const UNTOUCHED_MAX_SIDE = 800;
const UNTOUCHED_MAX_BYTES = 3 * 1024 * 1024;
/** Frames kept; a longer GIF has frames dropped evenly and its delays added up. */
const MAX_FRAMES = 200;
/** A GIF with more frames than this is not a profile photo. */
const MAX_SOURCE_FRAMES = 1500;

/** From sharpest to smallest: tried in turn until one fits. `skip` multiplies how many frames are dropped. */
const FITS: readonly { size: number; skip: number }[] = [
  { size: AVATAR_GIF_SIZE, skip: 1 },
  { size: 256, skip: 1 },
  { size: 192, skip: 1 },
  { size: 160, skip: 2 },
  { size: 128, skip: 2 },
  { size: 128, skip: 4 },
];

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

/** Whether this browser can cut a GIF to a framing the person chose (it needs `ImageDecoder`). */
export const canEditGif = (): boolean => typeof (globalThis as { ImageDecoder?: unknown }).ImageDecoder === 'function';

/** What to upload for a GIF picked as a profile photo, centred and without the editor, or why not. */
export async function prepareAvatarGif(file: File): Promise<AvatarGifResult> {
  try {
    const Decoder = (globalThis as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
    if (!Decoder) {
      const bitmap = await createImageBitmap(file);
      const side = Math.max(bitmap.width, bitmap.height);
      bitmap.close();
      if (side <= UNTOUCHED_MAX_SIDE && file.size <= UNTOUCHED_MAX_BYTES) return { ok: true, file };
      return {
        ok: false,
        reason: `This browser cannot shrink GIFs. Pick one that is ${UNTOUCHED_MAX_SIDE}px or smaller and under ${mb(UNTOUCHED_MAX_BYTES)}, or use the PINGO app.`,
      };
    }
    return { ok: true, file: await encodeFitted(file, Decoder, (first) => centred(first)) };
  } catch (cause) {
    if (cause instanceof Refused) return { ok: false, reason: cause.message };
    return { ok: false, reason: 'That GIF could not be prepared. Try another one.' };
  }
}

/** What the crop editor is showing: the picture's size, the frame, the pan, the turn and the scale. */
export interface GifFraming {
  natural: { x: number; y: number };
  /** The side of the on-screen frame, in CSS pixels. */
  cropPx: number;
  offset: { x: number; y: number };
  rotation: number;
  displayScale: number;
}

/**
 * The GIF cut to the framing the person chose in the editor: the same pan, zoom
 * and turn applied to every frame, so what they saw moving is what is saved.
 */
export async function cropAvatarGif(file: File, framing: GifFraming): Promise<AvatarGifResult> {
  try {
    const Decoder = (globalThis as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
    if (!Decoder) return { ok: false, reason: 'This browser cannot edit GIFs. Use the PINGO app.' };
    return { ok: true, file: await encodeFitted(file, Decoder, () => framed(framing)) };
  } catch (cause) {
    if (cause instanceof Refused) return { ok: false, reason: cause.message };
    return { ok: false, reason: 'That GIF could not be prepared. Try another one.' };
  }
}

type Draw = (context: CanvasRenderingContext2D, image: DecodedImage) => void;
/** How a GIF is put in the frame: the largest square it can fill, and how to draw a frame at a chosen size. */
type Plan = { side: number; draw: (size: number) => Draw };

/** The centre square of the frame, the way a round face shows it anyway. */
function centred(first: DecodedImage): Plan {
  const crop = Math.min(first.displayWidth, first.displayHeight);
  const sx = (first.displayWidth - crop) / 2;
  const sy = (first.displayHeight - crop) / 2;
  return {
    side: crop,
    draw: (size) => (context, image) => context.drawImage(image as unknown as CanvasImageSource, sx, sy, crop, crop, 0, 0, size, size),
  };
}

/** The editor's pan, zoom and turn, scaled from the on-screen frame to the output. */
function framed(framing: GifFraming): Plan {
  return {
    side: Number.POSITIVE_INFINITY,
    draw: (size) => (context, image) => {
      const k = size / framing.cropPx;
      context.save();
      context.translate(size / 2, size / 2);
      context.scale(k, k);
      context.translate(framing.offset.x, framing.offset.y);
      context.rotate((framing.rotation * Math.PI) / 180);
      context.scale(framing.displayScale, framing.displayScale);
      context.drawImage(image as unknown as CanvasImageSource, -framing.natural.x / 2, -framing.natural.y / 2, framing.natural.x, framing.natural.y);
      context.restore();
    },
  };
}

/** Tries the fits from sharpest to smallest and returns the first that is under the byte cap. */
async function encodeFitted(file: File, Decoder: ImageDecoderCtor, plan: (first: DecodedImage) => Plan): Promise<File> {
  let last: { bytes: number; size: number; skip: number } | undefined;
  for (const fit of FITS) {
    // A bigger one is guessed to be too big when the last was by a wide margin: bytes follow pixels and frames.
    if (last) {
      const guess = last.bytes * ((fit.size * fit.size) / (last.size * last.size)) * (last.skip / fit.skip);
      if (guess > AVATAR_GIF_MAX_BYTES * 1.6) continue;
    }
    const out = await encodeOnce(file, Decoder, plan, fit.size, fit.skip);
    if (out.size <= AVATAR_GIF_MAX_BYTES) return out;
    last = { bytes: out.size, size: out.sizeUsed, skip: fit.skip };
  }
  throw new Refused(`That GIF is still ${mb(last?.bytes ?? 0)} as a profile photo even when shrunk. The most is ${mb(AVATAR_GIF_MAX_BYTES)}: try a shorter or simpler one.`);
}

/** One try: every kept frame drawn at `size`, put back together. */
async function encodeOnce(
  file: File,
  Decoder: ImageDecoderCtor,
  plan: (first: DecodedImage) => Plan,
  wanted: number,
  skip: number,
): Promise<File & { sizeUsed: number }> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');

  const decoder = new Decoder({ data: await file.arrayBuffer(), type: 'image/gif' });
  try {
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
    if (count > MAX_SOURCE_FRAMES) throw new Refused(`That GIF has ${count} frames. A profile photo can come from at most ${MAX_SOURCE_FRAMES}: try a shorter one.`);
    const stride = Math.max(1, Math.ceil(count / MAX_FRAMES)) * skip;

    const first = (await decoder.decode({ frameIndex: 0 })).image;
    const planned = plan(first);
    first.close();
    // Never bigger than the picture itself.
    const size = Math.max(32, Math.min(wanted, Math.round(planned.side)));
    const draw = planned.draw(size);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no 2d context');

    const gif = GIFEncoder();
    let pending: { indexed: Uint8Array; palette: number[][]; delay: number; first: boolean } | undefined;
    const flush = () => {
      if (!pending) return;
      gif.writeFrame(pending.indexed, size, size, {
        palette: pending.palette,
        delay: Math.max(20, pending.delay),
        ...(pending.first ? { repeat: 0 } : {}),
      });
      pending = undefined;
    };

    let written = 0;
    for (let index = 0; index < count; index += 1) {
      // Each frame comes back already composited, so disposal needs no handling.
      const { image } = await decoder.decode({ frameIndex: index });
      const delay = image.duration ? Math.round(image.duration / 1000) : 100;
      if (index % stride === 0) {
        flush();
        context.clearRect(0, 0, size, size);
        draw(context, image);
        const { data } = context.getImageData(0, 0, size, size);
        const palette = quantize(data, 256);
        pending = { indexed: applyPalette(data, palette), palette, delay, first: written === 0 };
        written += 1;
      } else if (pending) {
        // A dropped frame's time goes to the one before it, so the GIF runs at the same speed.
        pending.delay += delay;
      }
      image.close();
    }
    flush();
    gif.finish();
    const out = new File([gif.bytes() as BlobPart], 'avatar.gif', { type: 'image/gif' });
    return Object.assign(out, { sizeUsed: size });
  } finally {
    decoder.close();
  }
}
