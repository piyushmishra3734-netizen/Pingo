/**
 * Size variants of the MYTHIC PIONEER badge, from the artwork as supplied.
 *
 * ## Scaling only
 *
 * The badge is a finished piece of design and is not to be reinterpreted, so
 * this script does exactly one thing: it averages the original down to smaller
 * squares. No recolouring, no cropping, no simplification, no substitute glyph
 * at small sizes. The 24-pixel indicator in a chat list is the same emblem as
 * the one on the profile, just further away.
 *
 * ## Premultiplied, which is the whole reason this is a script
 *
 * The artwork is transparent, and averaging transparent pixels naively pulls
 * the colour of fully clear pixels - black, usually - into every edge, leaving
 * a grey halo that looks like a compression artefact and gets blamed on the
 * design. Colours are weighted by their own alpha and divided back out, so a
 * clear pixel contributes nothing but its transparency.
 *
 * ## A box filter, deliberately
 *
 * Every output pixel averages the whole region of the source it covers, rather
 * than sampling one point out of it. For a 24-pixel version of a 1312-pixel
 * emblem that is the difference between the badge and a handful of gold dots:
 * point sampling would throw away 99.97% of the picture and keep whatever
 * happened to be under the sample.
 *
 * Usage: node apps/web/scripts/make-badge-art.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';

const SOURCE = 'apps/web/assets/mythic-pioneer.png';
const OUT_DIR = 'apps/web/public/badges';

/**
 * The sizes the product actually asks for.
 *
 * 512 is the profile, where the badge is the subject. 128 is the detail sheet
 * and any card that gives it room. 48 is the indicator beside a name, drawn at
 * 24 CSS pixels so it stays sharp on the phones everybody actually holds.
 */
const SIZES = [512, 128, 48];

const src = PNG.sync.read(readFileSync(SOURCE));

/** One output pixel: the average of every source pixel it covers. */
function box(image, x0, y0, x1, y1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (image.width * y + x) << 2;
      const alpha = image.data[i + 3] / 255;
      // Weighted by alpha: a clear pixel has no colour to contribute, only
      // transparency. See the header.
      r += image.data[i] * alpha;
      g += image.data[i + 1] * alpha;
      b += image.data[i + 2] * alpha;
      a += alpha;
      n += 1;
    }
  }

  if (n === 0 || a === 0) return [0, 0, 0, 0];
  // Divide the colour back out of the alpha it was weighted by.
  return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / n) * 255)];
}

mkdirSync(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const out = new PNG({ width: size, height: size });
  /*
   * Square output for a picture that is not square: the badge is 1312x1199, and
   * every place it is drawn reserves a square. Fitting it inside preserves the
   * proportions - stretching to fill would be a redesign, and the one thing
   * nobody would forgive is a squashed crown.
   */
  const scale = Math.min(size / src.width, size / src.height);
  const drawnW = Math.round(src.width * scale);
  const drawnH = Math.round(src.height * scale);
  const offsetX = Math.floor((size - drawnW) / 2);
  const offsetY = Math.floor((size - drawnH) / 2);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (size * y + x) << 2;
      const insideX = x - offsetX;
      const insideY = y - offsetY;

      if (insideX < 0 || insideY < 0 || insideX >= drawnW || insideY >= drawnH) {
        out.data[i + 3] = 0;
        continue;
      }

      const [r, g, b, a] = box(
        src,
        Math.floor((insideX / drawnW) * src.width),
        Math.floor((insideY / drawnH) * src.height),
        Math.max(Math.floor((insideX / drawnW) * src.width) + 1, Math.ceil(((insideX + 1) / drawnW) * src.width)),
        Math.max(Math.floor((insideY / drawnH) * src.height) + 1, Math.ceil(((insideY + 1) / drawnH) * src.height)),
      );

      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = a;
    }
  }

  const path = `${OUT_DIR}/mythic-pioneer-${size}.png`;
  writeFileSync(path, PNG.sync.write(out));
  console.log(`${path}  ${size}x${size}`);
}
