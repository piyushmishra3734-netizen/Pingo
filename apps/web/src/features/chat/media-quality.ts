/**
 * What leaves the phone when somebody sends a picture.
 *
 * ## Why anything is thrown away at all
 *
 * A phone camera writes 12 megapixels. A chat bubble is about four hundred
 * pixels wide, and the full-screen view is the screen. Sending the original
 * means every recipient downloads roughly forty times the bytes their screen
 * can show - and on a metered plan and a free storage tier, that is the whole
 * bill for a difference nobody can see. This is why every messenger does it.
 *
 * ## 480p, because that is what was asked for
 *
 * Not "some compression" - a stated ceiling: the short edge at 480 and the long
 * edge at 854, whichever way round the picture is. A 4032x3024 photo becomes
 * 640x480 and about 3% of the bytes. It is visibly not the original if you go
 * looking, and it is completely fine in a conversation, which is the trade
 * being made deliberately rather than by accident.
 *
 * Anything already smaller is left alone. Upscaling to "meet" a ceiling would
 * add bytes to make a picture worse.
 */

/** The short edge, and the long edge. 480p, in both orientations. */
export const STANDARD_SHORT_EDGE = 480;
export const STANDARD_LONG_EDGE = 854;

/**
 * Chosen by eye against the ceiling above, not by rule of thumb.
 *
 * At 480p the resize has already removed almost everything; pushing the encoder
 * harder buys very little and starts to show on flat areas - skin, sky, a
 * screenshot's background. 0.72 is where the artefacts stop being visible at
 * this size.
 */
const QUALITY = 0.72;

/** What the send path knows about a file before it decides anything. */
export type SendQuality = 'standard' | 'hd';

/**
 * True when this is a still image a canvas can honestly re-encode.
 *
 * An animated WebP or GIF drawn to a canvas becomes its first frame - the
 * compression would "work" and the sticker would stop moving, which is a bug
 * that looks like a feature until somebody notices their GIF is a picture.
 */
export function isStillImage(file: Blob): boolean {
  return file.type.startsWith('image/') && !isAnimatedType(file.type);
}

function isAnimatedType(type: string): boolean {
  // GIF is always treated as animated. A still GIF is rare and costs nothing
  // to leave alone; a moving one flattened to a frame is a broken message.
  return type === 'image/gif' || type === 'image/apng';
}

/**
 * The size to draw at, or `undefined` when the picture is already small enough.
 *
 * Exported for the test: the arithmetic is the part that can be wrong in a way
 * nobody sees - a ceiling applied to the wrong edge silently rotates the
 * constraint, so portraits and landscapes get different amounts of picture.
 */
export function standardSize(
  width: number,
  height: number,
): { width: number; height: number } | undefined {
  if (width <= 0 || height <= 0) return undefined;

  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short <= STANDARD_SHORT_EDGE && long <= STANDARD_LONG_EDGE) return undefined;

  // Both ceilings, and the tighter one wins - a very wide panorama is limited
  // by its length, an ordinary photo by its height.
  const scale = Math.min(STANDARD_SHORT_EDGE / short, STANDARD_LONG_EDGE / long);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * A still image at 480p, or the original when HD was asked for and allowed.
 *
 * Never throws. A picture that cannot be decoded, a canvas that will not
 * allocate, an encoder that returns nothing - every one of those ends with the
 * original being sent. Refusing to send somebody's photo because it could not
 * be made smaller is a worse outcome than sending it large.
 *
 * ponytail: stills only. Video and animated images pass straight through, and
 * that is where the bytes actually are - a 30-second clip dwarfs any number of
 * photos. Doing them properly needs a transcoder: WebCodecs plus a muxer for
 * video, a frame decoder for GIF. Canvas cannot do either, and the honest
 * version of "compress everything" is a dependency and a plan, not a line here.
 */
export async function toStandardQuality(file: File): Promise<File> {
  if (!isStillImage(file)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const size = standardSize(bitmap.width, bitmap.height);
    if (!size) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();

    /*
     * WebP, with JPEG behind it. WebP is roughly a third smaller at the same
     * quality and every browser that runs PINGO encodes it - but a canvas that
     * cannot returns a PNG instead of failing, and a PNG of a photograph is
     * larger than the original was. So the type is checked rather than assumed.
     */
    const encoded = await encode(canvas, 'image/webp');
    const blob = encoded ?? (await encode(canvas, 'image/jpeg'));
    if (!blob) return file;

    // Bigger than what we started with means the original was already better
    // compressed than anything achievable here. Keep it.
    if (blob.size >= file.size) return file;

    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], `${stripExtension(file.name)}.${ext}`, {
      type: blob.type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob && blob.type === type ? blob : undefined),
      type,
      QUALITY,
    );
  });
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name || 'photo';
}
