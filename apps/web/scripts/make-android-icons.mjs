import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

import { PNG } from 'pngjs';

/**
 * The Android launcher icon, from the official artwork.
 *
 * `npx cap add android` scaffolds Capacitor's own logo into every mipmap
 * bucket, and nothing replaces it — so the installed app wore a blue X. This
 * generates the real thing at every density Android asks for.
 *
 * ## Two icons, not one
 *
 * Android draws a *legacy* icon on old launchers and an *adaptive* one on
 * everything since Oreo. The adaptive one is two layers the system animates and
 * masks independently, so it cannot be the same flat image: the foreground has
 * to sit inside a safe zone covering the middle 72 of 108 units, because the
 * launcher crops the rest to whatever shape it uses.
 *
 * So the foreground is the mark alone on transparency, sized to that safe zone,
 * and the background is the tile's own colour. That is why the mark is not
 * clipped on a circular launcher and not floating on a square one.
 */

const root = new URL('../android/app/src/main/res/', import.meta.url);

/** Legacy icon sizes, in px, by density bucket. */
const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
/** Adaptive foregrounds are a 108dp canvas at the same densities. */
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

/** Alpha-weighted box filter. Averaging colour and alpha separately halos. */
function resize(src, to) {
  const out = new PNG({ width: to, height: to });
  const ratio = src.width / to;

  for (let y = 0; y < to; y += 1) {
    for (let x = 0; x < to; x += 1) {
      const x0 = Math.floor(x * ratio);
      const x1 = Math.min(src.width, Math.ceil((x + 1) * ratio));
      const y0 = Math.floor(y * ratio);
      const y1 = Math.min(src.height, Math.ceil((y + 1) * ratio));

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (src.width * sy + sx) << 2;
          const alpha = src.data[i + 3] / 255;
          r += src.data[i] * alpha;
          g += src.data[i + 1] * alpha;
          b += src.data[i + 2] * alpha;
          a += alpha;
          n += 1;
        }
      }

      const o = (to * y + x) << 2;
      if (a === 0 || n === 0) { out.data[o + 3] = 0; continue; }
      out.data[o] = Math.round(r / a);
      out.data[o + 1] = Math.round(g / a);
      out.data[o + 2] = Math.round(b / a);
      out.data[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/** Places `inner` centred on a transparent square of `size`, at `scale` of it. */
function pad(inner, size, scale) {
  const target = Math.round(size * scale);
  const small = resize(inner, target);
  const out = new PNG({ width: size, height: size });
  const offset = Math.round((size - target) / 2);

  for (let y = 0; y < target; y += 1) {
    for (let x = 0; x < target; x += 1) {
      const from = (target * y + x) << 2;
      const to = (size * (y + offset) + (x + offset)) << 2;
      out.data[to] = small.data[from];
      out.data[to + 1] = small.data[from + 1];
      out.data[to + 2] = small.data[from + 2];
      out.data[to + 3] = small.data[from + 3];
    }
  }
  return out;
}

const tile = PNG.sync.read(readFileSync(new URL('../public/pingo-icon.png', import.meta.url)));
const mark = PNG.sync.read(readFileSync(new URL('../src/assets/pingo-mark.png', import.meta.url)));

for (const [density, size] of Object.entries(LEGACY)) {
  const dir = new URL(`mipmap-${density}/`, root);
  await mkdir(dir, { recursive: true });
  const icon = PNG.sync.write(resize(tile, size));
  // The round variant is the same artwork; the launcher applies the mask.
  await writeFile(new URL('ic_launcher.png', dir), icon);
  await writeFile(new URL('ic_launcher_round.png', dir), icon);
}

for (const [density, size] of Object.entries(FOREGROUND)) {
  const dir = new URL(`mipmap-${density}/`, root);
  /*
   * 0.62 rather than 0.667.
   *
   * The safe zone is 72 of 108, and filling it exactly leaves the mark touching
   * the crop on a circular launcher. A little under puts visible air around it,
   * which is what every well-made icon does.
   */
  await writeFile(
    new URL('ic_launcher_foreground.png', dir),
    PNG.sync.write(pad(mark, size, 0.62)),
  );
}

console.log('wrote launcher icons for', Object.keys(LEGACY).join(', '));
