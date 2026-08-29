/**
 * Size variants of the MYTHIC PIONEER badge, from the artwork as supplied.
 *
 * ## Scaling only
 *
 * The badge is a finished piece of design and is not to be reinterpreted, so
 * this script only ever moves pixels the artwork already contains: it averages
 * the original down to smaller squares, and it takes one crop out of it. No
 * recolouring, no simplification, no substitute glyph, nothing drawn.
 *
 * Two artworks come out of the one file. The full emblem, for anywhere it has
 * room to be the subject; and the crest - the crowned ghost, cropped - for the
 * sixteen pixels beside a name, where the emblem's wreath and banner are four
 * grey smudges and the thing that makes it recognisable is gone. See `CREST`.
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
 * ## One script, every badge
 *
 * The sizes, the filter and the crest argument are the same problem for any
 * emblem the registry gains, so the artwork is an argument rather than a
 * constant. A second copy of this file per badge is how the premultiplied
 * averaging above ends up fixed in one of them and not the other.
 *
 * Usage:
 *   node apps/web/scripts/make-badge-art.mjs                  # every badge
 *   node apps/web/scripts/make-badge-art.mjs mythic-pioneer   # just one
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';

const OUT_DIR = 'apps/web/public/badges';

/**
 * The sizes the product actually asks for.
 *
 * 512 is the profile, where the badge is the subject. 128 is the detail sheet
 * and any card that gives it room. 48 is the indicator beside a name, drawn at
 * 24 CSS pixels so it stays sharp on the phones everybody actually holds.
 */
const SIZES = [512, 128, 48];

/**
 * The crest: the crowned ghost, cropped out of the same artwork.
 *
 * Beside a name the emblem is drawn at sixteen pixels, and at sixteen pixels a
 * wreath, a banner and the word MYTHIC are four grey smudges - the whole shape
 * that makes it recognisable is thrown away by the scale. The crown and the
 * ghost survive it, because they are two large forms with one silhouette.
 *
 * This is a crop, not a redrawing: every pixel is the supplied file's. The
 * brief allows exactly this - "size variants only by technically safe scaling
 * or cropping" - and it is the difference between a mark somebody recognises
 * across a chat list and a gold dot.
 */
const CREST_SIZES = [96, 48];

/**
 * Every badge in the registry, and where its artwork comes from.
 *
 * `crest` is the square of the source that survives being drawn at
 * twenty-four pixels. For MYTHIC PIONEER that is the crowned ghost, without the
 * wreath and banner that turn to smudges. For FOUNDER it is the crown and the
 * P - the orbital ring is what widens the mark and thins the ink, and at this
 * size the ring is the first thing that stops reading.
 */
const BADGES = [
  {
    name: 'mythic-pioneer',
    crestName: 'mythic-crest',
    source: 'apps/web/assets/mythic-pioneer.png',
    crest: { x: 280, y: 0, size: 770 },
  },
  {
    name: 'founder',
    crestName: 'founder-crest',
    source: 'apps/web/assets/founder.png',
    /*
     * Trimmed to its own ink, measured rather than guessed: the supplied file
     * carries about a tenth of its width as empty margin, and `object-contain`
     * honours that margin, so the badge drew noticeably smaller than MYTHIC
     * PIONEER in the same box for no reason anybody could see.
     */
    trim: { x: 67, y: 38, size: 1144 },
    /*
     * No separate crest crop. MYTHIC PIONEER needs one because its wreath and
     * banner become smudges at twenty-four pixels; this mark is a crown, a P
     * and a ring, and all three survive - where a tighter crop did not, it cut
     * the ring in half and read as damaged. Same framing, smaller file.
     */
  },
];

/** The crest region of the source, as its own image to scale down from. */
function crestSource(src, CREST) {
  const out = new PNG({ width: CREST.size, height: CREST.size });
  for (let y = 0; y < CREST.size; y += 1) {
    for (let x = 0; x < CREST.size; x += 1) {
      const sx = x + CREST.x;
      const sy = y + CREST.y;
      const d = (CREST.size * y + x) << 2;
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) {
        out.data[d + 3] = 0;
        continue;
      }
      const s = (src.width * sy + sx) << 2;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = src.data[s + 3];
    }
  }
  return out;
}

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

/** Scale one source image down to a square of `size`, and write it. */
function emit(image, size, name) {
  const out = new PNG({ width: size, height: size });
  /*
   * Square output for a picture that is not square: the badge is 1312x1199, and
   * every place it is drawn reserves a square. Fitting it inside preserves the
   * proportions - stretching to fill would be a redesign, and the one thing
   * nobody would forgive is a squashed crown.
   */
  const scale = Math.min(size / image.width, size / image.height);
  const drawnW = Math.round(image.width * scale);
  const drawnH = Math.round(image.height * scale);
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
        image,
        Math.floor((insideX / drawnW) * image.width),
        Math.floor((insideY / drawnH) * image.height),
        Math.max(Math.floor((insideX / drawnW) * image.width) + 1, Math.ceil(((insideX + 1) / drawnW) * image.width)),
        Math.max(Math.floor((insideY / drawnH) * image.height) + 1, Math.ceil(((insideY + 1) / drawnH) * image.height)),
      );

      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = a;
    }
  }

  const path = `${OUT_DIR}/${name}-${size}.png`;
  writeFileSync(path, PNG.sync.write(out));
  console.log(`${path}  ${size}x${size}`);
}

const only = process.argv[2];

for (const badge of BADGES) {
  if (only && badge.name !== only) continue;

  const file = PNG.sync.read(readFileSync(badge.source));
  const src = badge.trim ? crestSource(file, badge.trim) : file;
  for (const size of SIZES) emit(src, size, badge.name);

  const crest = badge.crest ? crestSource(file, badge.crest) : src;
  for (const size of CREST_SIZES) emit(crest, size, badge.crestName);
}
