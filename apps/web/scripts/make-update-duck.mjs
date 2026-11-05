/**
 * The update screen's duck: a GIF on a white page, to a transparent animated
 * WebP, so it stands on the app's own background in the light theme and the dark.
 *
 * ## Why not just use the GIF
 *
 * It is 4.9 MB, it is 720 x 1280 with the duck in the middle of it, it loops
 * 149 frames when the walk repeats after 111, and its background is white: on
 * the dark theme it would be a white rectangle with a duck in it.
 *
 * ## What this does
 *
 *   - crops every frame to the duck (the walk is a full turn, so the crop is
 *     the widest the duck ever gets);
 *   - keeps the one loop (frames 0-110; frame 111 is frame 0 again);
 *   - takes the white away from the OUTSIDE only: what is near-white and
 *     reachable from the picture's edge without crossing the black outline.
 *     The duck itself is white too, and stays, because the outline encloses it;
 *   - gives the outline a soft alpha with its colour put back to black, so
 *     it fades instead of leaving a white fringe on a dark page;
 *   - turns the grey ground shadow into a translucent black one, which reads as
 *     a shadow on any background instead of a grey ellipse.
 *
 * Usage (from the repository root):
 *   node apps/web/scripts/make-update-duck.mjs
 * Reads apps/web/assets/update-duck.gif; writes apps/web/public/update/duck.webp
 * and duck-still.webp (the same duck, front on, for reduced motion).
 */
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const SOURCE = 'apps/web/assets/update-duck.gif';
const OUT = 'apps/web/public/update';
const LOOP = 111;
const BOX = { left: 200, top: 430, width: 350, height: 410 };
const OUT_W = 240;
const OUT_H = Math.round((OUT_W * BOX.height) / BOX.width);
/** The frame where the duck faces the viewer, for the still. */
const STILL = 100;

const meta = await sharp(SOURCE, { animated: true, pages: -1 }).metadata();
const SW = meta.width;
const SH = meta.pageHeight;
const delays = (meta.delay ?? Array(LOOP).fill(100)).slice(0, LOOP);
const { data } = await sharp(SOURCE, { animated: true, pages: -1 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const frameBytes = SW * SH * 4;

const w = BOX.width;
const h = BOX.height;
const idx = (x, y) => y * w + x;

/** One cropped frame, with the outside cleared and the edge softened. */
function lift(i) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const from = i * frameBytes + ((BOX.top + y) * SW + BOX.left) * 4;
    px.set(data.subarray(from, from + w * 4), y * w * 4);
  }
  const lum = (p) => (px[p * 4] + px[p * 4 + 1] + px[p * 4 + 2]) / 3;
  const low = (p) => Math.min(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]);
  const sat = (p) => Math.max(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]) - low(p);

  /*
   * The ground shadow: grey, low colour, low on the picture. It is not part of
   * the duck's outline - and it must not be treated as a wall either: it sits
   * right under the feet, and as a wall it shut the white between the legs in,
   * so that gap stayed white on a dark page.
   */
  const shadowBand = h - 70;
  const shadow = new Uint8Array(w * h);
  for (let y = shadowBand; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = idx(x, y);
      const l = lum(p);
      if (sat(p) < 28 && l > 95 && l < 215) shadow[p] = 1;
    }
  }

  // The outline, thickened by a pixel so a gap in a thin line does not let the outside in.
  const dark = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p += 1) dark[p] = !shadow[p] && lum(p) < 150 ? 1 : 0;
  const wall = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && dark[idx(nx, ny)]) {
            on = 1;
            break;
          }
        }
      }
      wall[idx(x, y)] = on;
    }
  }

  // The outside: near-white, and reachable from the edge without crossing the wall.
  const outside = new Uint8Array(w * h);
  const queue = [];
  const push = (x, y) => {
    const p = idx(x, y);
    if (!outside[p] && !wall[p] && (low(p) >= 205 || shadow[p])) {
      outside[p] = 1;
      queue.push(p);
    }
  };
  for (let x = 0; x < w; x += 1) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    push(0, y);
    push(w - 1, y);
  }
  for (let q = 0; q < queue.length; q += 1) {
    const p = queue[q];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }

  // Within two pixels of the outside: the anti-aliased edge of the outline.
  const rim = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (outside[idx(x, y)]) continue;
      let near = 0;
      for (let dy = -2; dy <= 2 && !near; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && outside[idx(nx, ny)]) {
            near = 1;
            break;
          }
        }
      }
      rim[idx(x, y)] = near;
    }
  }

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = idx(x, y);
      const o = p * 4;
      const l = lum(p);
      // The shadow: black, at a fraction of the grey's opacity.
      if (shadow[p]) {
        px[o] = 0;
        px[o + 1] = 0;
        px[o + 2] = 0;
        px[o + 3] = Math.round(255 * Math.min(0.5, ((215 - l) / 215) * 0.9));
        continue;
      }
      if (outside[p]) {
        px[o + 3] = 0;
        continue;
      }
      if (rim[p]) {
        // The outline's soft edge: black, as opaque as it was dark.
        const a = Math.max(0, Math.min(1, (248 - l) / (248 - 70)));
        px[o] = 0;
        px[o + 1] = 0;
        px[o + 2] = 0;
        px[o + 3] = Math.round(255 * a);
        continue;
      }
      px[o + 3] = 255;
    }
  }
  return Buffer.from(px.buffer);
}

mkdirSync(OUT, { recursive: true });

const sized = async (i) =>
  sharp(lift(i), { raw: { width: w, height: h, channels: 4 } })
    .resize(OUT_W, OUT_H, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();

const pieces = [];
for (let i = 0; i < LOOP; i += 1) pieces.push(await sized(i));

await sharp(Buffer.concat(pieces), { raw: { width: OUT_W, height: OUT_H * LOOP, channels: 4, pageHeight: OUT_H } })
  .webp({ loop: 0, delay: delays, quality: 66, alphaQuality: 85, effort: 5 })
  .toFile(`${OUT}/duck.webp`);

await sharp(await sized(STILL), { raw: { width: OUT_W, height: OUT_H, channels: 4 } })
  .webp({ quality: 85, alphaQuality: 95 })
  .toFile(`${OUT}/duck-still.webp`);

console.log(`${OUT}/duck.webp  ${OUT_W}x${OUT_H}, ${LOOP} frames`);
