/**
 * Whether a picture moves.
 *
 * ## Why anything has to ask
 *
 * Every photo on its way into a thread goes through the editor, and the editor
 * finishes by painting the picture onto a canvas and exporting a JPEG. That is
 * right for a photograph and destroys a GIF: a canvas holds one frame, so what
 * arrives at the other end is a poster of the first moment of the animation.
 * The editor showed the real file animating the whole time, which made it look
 * like the one thing it was not going to do.
 *
 * So a moving picture has to be recognised before the editor sees it, and sent
 * as the bytes it came as.
 *
 * ## The bytes decide, not the type
 *
 * The obvious version of this reads `file.type` and only bothers looking at a
 * WebP or a PNG. It has a hole: when a keyboard hands over a picture with no
 * type at all, the Android side falls back to `image/png` - so a GIF arrives
 * labelled PNG and a type-led check waves it through to be flattened. The one
 * case this exists for is the one it would miss.
 *
 * Every format here announces itself in its first bytes, so that is what is
 * read. It costs one 4 KB slice per picture and cannot be lied to.
 *
 * A still GIF exists, and is reported as animated anyway: flattening one to
 * JPEG still throws away its transparency, so there is nothing to gain by
 * looking closer.
 */

/** How much of the file to look at. Every flag here sits in the header region. */
const HEADER_BYTES = 4096;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = at; i < at + length && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

/** Where `marker` appears in `bytes`, or -1. Used for APNG's `acTL` chunk. */
function indexOfAscii(bytes: Uint8Array, marker: string): number {
  const target = [...marker].map((character) => character.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - target.length; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export async function isAnimatedImage(file: Blob): Promise<boolean> {
  try {
    const bytes = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());

    // `GIF87a` or `GIF89a`. Only the shared prefix is worth matching.
    if (ascii(bytes, 0, 4) === 'GIF8') return true;

    /*
     * An animated WebP is an extended one: `RIFF....WEBPVP8X`, then a flags
     * byte at offset 20 whose 0x02 bit means animation. A plain WebP carries
     * `VP8 ` or `VP8L` there instead and cannot move at all.
     */
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
      if (ascii(bytes, 12, 4) !== 'VP8X') return false;
      return ((bytes[20] ?? 0) & 0x02) !== 0;
    }

    /*
     * APNG is a PNG carrying an `acTL` chunk, which the format requires to come
     * before the first `IDAT` - so it is always near the front, and a reader
     * that stops at the header cannot miss it on a file that has one.
     */
    if (PNG_SIGNATURE.every((byte, at) => bytes[at] === byte)) {
      const idat = indexOfAscii(bytes, 'IDAT');
      const actl = indexOfAscii(bytes, 'acTL');
      return actl !== -1 && (idat === -1 || actl < idat);
    }

    // A JPEG, or something this does not recognise. Neither moves.
    return false;
  } catch {
    // Unreadable bytes are not a reason to mangle the picture. Treating it as
    // still is the existing behaviour, which is the safe side to fail towards.
    return false;
  }
}
