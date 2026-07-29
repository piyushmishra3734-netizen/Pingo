/**
 * Splash screens, from the official mobile artwork.
 *
 * The artwork is used exactly as drawn. Nothing here recolours, recomposes or
 * restyles it — the only operations are scaling and centre-cropping, which is
 * what makes one image fit every screen without distorting.
 *
 * ## What was wrong
 *
 * `drawable/splash.png` was 480x320 — landscape — and the launch theme uses it
 * as the window background, which Android stretches to fill. On a portrait
 * phone that means a landscape image pulled to twice its height. That is the
 * "PC one" showing up on mobile.
 *
 * ## Why centre-crop rather than fit
 *
 * Letterboxing would keep the whole image and put bars down the sides, which
 * looks broken on a phone. Stretching keeps the screen full and distorts the
 * logo. Centre-crop keeps the aspect ratio *and* fills the screen, showing a
 * little more or less of the gradient depending on the device. The logo sits in
 * the middle of a wide soft margin, so it survives any sensible crop — which is
 * presumably why the artwork was drawn that way.
 *
 *   node apps/web/scripts/make-splash.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

/** The official artwork, versioned here so a build does not depend on anyone's Downloads folder. */
const SOURCE = 'apps/web/assets/splash-mobile.png';
const RES = 'apps/web/android/app/src/main/res';

/** Widths per density, the standard Android ladder. */
const DENSITIES = { mdpi: 320, hdpi: 480, xhdpi: 720, xxhdpi: 960, xxxhdpi: 1280 };

/**
 * Landscape target ratio.
 *
 * 16:9 rather than the source's own shape, because a landscape asset exists to
 * be shown on a landscape screen and cropping to roughly that shape now means
 * less cropping at runtime.
 */
const LAND_RATIO = 16 / 9;

const src = PNG.sync.read(readFileSync(SOURCE));

/** Bilinear sample. Nearest-neighbour would visibly stair-step the gradients. */
function sample(image, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, image.width - 1);
  const y1 = Math.min(y0 + 1, image.height - 1);
  const fx = x - x0;
  const fy = y - y0;

  const at = (px, py) => (py * image.width + px) << 2;
  const a = at(x0, y0);
  const b = at(x1, y0);
  const c = at(x0, y1);
  const d = at(x1, y1);

  const out = [0, 0, 0, 0];
  for (let i = 0; i < 4; i += 1) {
    const top = image.data[a + i] * (1 - fx) + image.data[b + i] * fx;
    const bottom = image.data[c + i] * (1 - fx) + image.data[d + i] * fx;
    out[i] = top * (1 - fy) + bottom * fy;
  }
  return out;
}

/**
 * Scale-to-fill then crop the overflow evenly — the same geometry a runtime
 * CENTER_CROP applies, done once at build time so the shipped asset is already
 * the right shape.
 */
function centreCrop(image, width, height) {
  const out = new PNG({ width, height });
  const scale = Math.max(width / image.width, height / image.height);
  const cropW = width / scale;
  const cropH = height / scale;
  const left = (image.width - cropW) / 2;
  const top = (image.height - cropH) / 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = sample(image, left + (x / width) * cropW, top + (y / height) * cropH);
      const i = (y * width + x) << 2;
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = a;
    }
  }
  return out;
}

/**
 * Fit the whole artwork by height, then continue its edge columns outwards.
 *
 * For landscape, centre-cropping is the wrong tool: the target is more than
 * four times wider than the source is, relative to height, so filling the frame
 * means scaling 2.25x and keeping about a quarter of the image. The first
 * attempt at this did exactly that and sliced the purple dot off the top of the
 * logo.
 *
 * Fitting instead keeps the composition intact. The space either side is filled
 * by clamping the sample position to the image bounds, so the outermost column
 * of the gradient simply continues to the edge of the screen — a flat band of
 * one colour would read as letterboxing, and this does not, because the
 * artwork's sides are already a near-uniform wash.
 */
function fitAndExtend(image, width, height) {
  const out = new PNG({ width, height });
  const scale = height / image.height;
  const drawnWidth = image.width * scale;
  const left = (width - drawnWidth) / 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Clamped, which is what extends the edges rather than padding them.
      const sx = Math.min(image.width - 1, Math.max(0, (x - left) / scale));
      const sy = Math.min(image.height - 1, Math.max(0, y / scale));
      const [r, g, b, a] = sample(image, sx, sy);
      const i = (y * width + x) << 2;
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = a;
    }
  }
  return out;
}

const written = [];
async function emit(dir, png) {
  await mkdir(`${RES}/${dir}`, { recursive: true });
  await writeFile(`${RES}/${dir}/splash.png`, PNG.sync.write(png));
  written.push(`${dir}/splash.png  ${png.width}x${png.height}`);
}

const portraitRatio = src.height / src.width;

for (const [density, width] of Object.entries(DENSITIES)) {
  // Portrait keeps the artwork's own proportions, so nothing is cropped at
  // build time and the device only trims what its own shape requires.
  await emit(`drawable-port-${density}`, centreCrop(src, width, Math.round(width * portraitRatio)));
  // Landscape fits rather than crops. See fitAndExtend for why cropping here
  // decapitates the logo.
  const landW = Math.round(width * 1.5);
  await emit(`drawable-land-${density}`, fitAndExtend(src, landW, Math.round(landW / LAND_RATIO)));
}

/*
 * The bare `drawable/splash.png` is the fallback the launch theme reaches for
 * when no qualifier matches, and it was the landscape one. Portrait, because
 * a phone is the case that matters and a wrong guess here is the bug being
 * fixed.
 */
await emit('drawable', centreCrop(src, 1080, Math.round(1080 * portraitRatio)));

/*
 * The colour behind everything, sampled rather than chosen.
 *
 * Read from the artwork's own top-left corner so the solid frame Android may
 * show before the image is ready is the same colour the image starts with,
 * instead of a white flash against a lavender gradient.
 */
const corner = sample(src, 2, 2).slice(0, 3).map((v) => Math.round(v));
const hex = `#${corner.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

console.log(written.join('\n'));
console.log(`\nsampled splash background: ${hex}`);
