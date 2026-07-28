import { readFileSync, writeFileSync } from 'node:fs';

import { PNG } from 'pngjs';

/**
 * Lifts the official PINGO mark off its tile.
 *
 * The supplied logo is an app-icon tile: the mark sitting on a rounded square
 * with a pale lavender gradient. Everywhere the mark is used *inside* something
 * else — the middle of a QR code, most immediately — the tile is in the way.
 *
 * ## The mark itself is not touched
 *
 * No redrawing, no tracing, no "cleaning up". Every pixel that belongs to the
 * mark keeps its own colour, including the gradient in the dot. The only thing
 * this decides is how opaque each pixel is.
 *
 * ## Why alpha is computed rather than keyed
 *
 * The obvious version is "if it is light, delete it". That leaves a pale fringe
 * one pixel wide all the way around the mark, because the edge pixels are a
 * blend of ink and background — and against the white plate in a QR nobody
 * would notice, while against anything dark it reads as a halo.
 *
 * So each pixel is treated as what it is: `C = a*F + (1-a)*B`, a blend of some
 * foreground over the known background. Solving for `a` gives the coverage, and
 * dividing it back out recovers the foreground's true colour. That is what
 * makes the edges hold up on a dark surface as well as a light one.
 *
 * ## Two kinds of foreground
 *
 * The stem is near-black and the dot is saturated violet, and they need
 * different tests: darkness finds the first and misses the second entirely,
 * since the dot is brighter than parts of the background it sits on. Coverage
 * is the larger of the two measures, so each shape is found by the test that
 * suits it.
 *
 * Run with `pnpm build:logo`. The output is committed, so this exists to be
 * re-run if the official mark is ever reissued.
 */

const SOURCE = process.argv[2];
const OUT = process.argv[3] ?? 'apps/web/src/assets/pingo-mark.png';

if (!SOURCE) {
  console.error('usage: pnpm build:logo <source.png> [out.png]');
  process.exit(1);
}

const png = PNG.sync.read(readFileSync(SOURCE));
const { width, height, data } = png;

/** Luminance, 0–1. The usual perceptual weights. */
const lum = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/** Saturation, 0–1, on the HSV definition. */
const sat = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
};

/*
 * The background, sampled from the tile's corners.
 *
 * It is a gradient rather than one colour, so a single constant would leave a
 * faint cast on one side. Averaging the four corners lands in the middle of
 * that gradient, which is close enough everywhere that the residual is well
 * under one level of 255.
 */
const corner = (x: number, y: number) => {
  const i = (width * y + x) << 2;
  return [data[i]!, data[i + 1]!, data[i + 2]!] as const;
};
const samples = [
  corner(Math.floor(width * 0.12), Math.floor(height * 0.12)),
  corner(Math.floor(width * 0.88), Math.floor(height * 0.12)),
  corner(Math.floor(width * 0.12), Math.floor(height * 0.88)),
  corner(Math.floor(width * 0.88), Math.floor(height * 0.88)),
];
const bg = [0, 1, 2].map((c) => samples.reduce((n, s) => n + s[c]!, 0) / samples.length) as [
  number,
  number,
  number,
];
const bgLum = lum(bg[0], bg[1], bg[2]);

/** How dark the darkest ink gets. Read from the image rather than guessed. */
let inkLum = 1;
for (let i = 0; i < data.length; i += 4) {
  inkLum = Math.min(inkLum, lum(data[i]!, data[i + 1]!, data[i + 2]!));
}

/*
 * The stem's actual colour, averaged over its solid interior.
 *
 * Needed because un-premultiplying an edge pixel divides by its coverage, and
 * at low coverage that turns a rounding error of one level into a visible
 * fringe — the first run of this script produced a thin yellow outline all the
 * way around the stem for exactly that reason. The stem is one flat colour, so
 * its edge pixels can simply be told what colour they are instead.
 */
let inkR = 0;
let inkG = 0;
let inkB = 0;
let inkN = 0;
for (let i = 0; i < data.length; i += 4) {
  if (lum(data[i]!, data[i + 1]!, data[i + 2]!) > inkLum + 0.04) continue;
  inkR += data[i]!;
  inkG += data[i + 1]!;
  inkB += data[i + 2]!;
  inkN += 1;
}
const ink: [number, number, number] = [inkR / inkN, inkG / inkN, inkB / inkN];

/*
 * The colour test has to ignore the tile.
 *
 * The tile is not white — it is a wash that runs to pale lavender in one
 * corner, and pale lavender still has some saturation. Dividing raw saturation
 * by a ceiling let that corner through at about a fifth opacity, which came out
 * as a violet haze hanging off the mark. The floor is set above the tile's own
 * saturation and well below the dot's, so the test now separates them rather
 * than ranking them.
 */
const SAT_FLOOR = 0.26;
const SAT_FULL = 0.6;

const out = new PNG({ width, height });

let minX = width;
let minY = height;
let maxX = -1;
let maxY = -1;

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = (width * y + x) << 2;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;

    // How far this pixel has travelled from the background, by darkness…
    const byDark = (bgLum - lum(r, g, b)) / (bgLum - inkLum);
    // …and by colour, which is the only thing that finds the violet dot.
    const byColour = (sat(r, g, b) - SAT_FLOOR) / (SAT_FULL - SAT_FLOOR);

    const dark = Math.max(0, Math.min(1, byDark));
    const colour = Math.max(0, Math.min(1, byColour));
    const raw = Math.max(dark, colour);

    /*
     * A noise floor, rescaled rather than clipped.
     *
     * The tile's gradient is not perfectly flat, so its darkest corner reads a
     * few per cent above the sampled background and survived as a 4% wash —
     * invisible on the white QR plate and a faint grey cast anywhere darker.
     * Subtracting the floor and stretching what remains removes it without
     * hardening the real edges, which a plain threshold would.
     */
    const FLOOR = 0.06;
    const alpha = raw <= FLOOR ? 0 : (raw - FLOOR) / (1 - FLOOR);

    if (alpha <= 0.004) {
      out.data[i + 3] = 0;
      continue;
    }

    out.data[i + 3] = Math.round(alpha * 255);

    if (colour > dark) {
      /*
       * The dot. Un-premultiplied, because it carries a real gradient that is
       * part of the mark and must survive — snapping it to one colour would be
       * redrawing it.
       */
      const unmix = (channel: number, back: number) =>
        Math.max(0, Math.min(255, Math.round((channel - (1 - alpha) * back) / alpha)));
      out.data[i] = unmix(r, bg[0]);
      out.data[i + 1] = unmix(g, bg[1]);
      out.data[i + 2] = unmix(b, bg[2]);
    } else {
      // The stem: one flat colour, so its edges are told what they are.
      out.data[i] = Math.round(ink[0]);
      out.data[i + 1] = Math.round(ink[1]);
      out.data[i + 2] = Math.round(ink[2]);
    }

    // Bounds of everything that survived, so the tile's padding can go too.
    if (alpha > 0.5) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

/*
 * Cropped square and centred on the mark.
 *
 * Removing the tile leaves the mark floating in a lot of nothing, and in the
 * middle of a QR that nothing is the difference between a logo you can see and
 * a speck. Square rather than tight so the proportions are untouched — this
 * crops the empty space, it does not reframe the mark.
 */
const markW = maxX - minX + 1;
const markH = maxY - minY + 1;
const side = Math.max(markW, markH);
const pad = Math.round(side * 0.06);
const size = side + pad * 2;
const offX = minX - Math.round((size - markW) / 2);
const offY = minY - Math.round((size - markH) / 2);

const cropped = new PNG({ width: size, height: size });
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const sx = offX + x;
    const sy = offY + y;
    const to = (size * y + x) << 2;
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
      cropped.data[to + 3] = 0;
      continue;
    }
    const from = (width * sy + sx) << 2;
    cropped.data[to] = out.data[from]!;
    cropped.data[to + 1] = out.data[from + 1]!;
    cropped.data[to + 2] = out.data[from + 2]!;
    cropped.data[to + 3] = out.data[from + 3]!;
  }
}

/**
 * Down to a sensible delivery size.
 *
 * The source is a 1254px app-icon render and the mark is drawn at about 40px in
 * the middle of a QR and 48px elsewhere. Shipping the full crop would be 170KB
 * to draw something the size of a fingernail. 256 is still five times the
 * largest place it appears, which is enough for any display density.
 *
 * Averaged over each source region rather than sampled, and **weighted by
 * alpha** — averaging colour and transparency independently pulls the
 * background's colour into every edge pixel, which is the classic way a
 * cut-out picks up a halo on the way down.
 */
function resize(source: PNG, to: number): PNG {
  const result = new PNG({ width: to, height: to });
  const ratio = source.width / to;

  for (let y = 0; y < to; y += 1) {
    for (let x = 0; x < to; x += 1) {
      const x0 = Math.floor(x * ratio);
      const x1 = Math.min(source.width, Math.ceil((x + 1) * ratio));
      const y0 = Math.floor(y * ratio);
      const y1 = Math.min(source.height, Math.ceil((y + 1) * ratio));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;

      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (source.width * sy + sx) << 2;
          const alpha = source.data[i + 3]! / 255;
          r += source.data[i]! * alpha;
          g += source.data[i + 1]! * alpha;
          b += source.data[i + 2]! * alpha;
          a += alpha;
          n += 1;
        }
      }

      const to4 = (to * y + x) << 2;
      if (a === 0 || n === 0) {
        result.data[to4 + 3] = 0;
        continue;
      }

      // Divided by the alpha total, not the pixel count: that is what keeps a
      // mostly-transparent region from being dragged toward black.
      result.data[to4] = Math.round(r / a);
      result.data[to4 + 1] = Math.round(g / a);
      result.data[to4 + 2] = Math.round(b / a);
      result.data[to4 + 3] = Math.round((a / n) * 255);
    }
  }

  return result;
}

const final = resize(cropped, 256);
writeFileSync(OUT, PNG.sync.write(final));

console.log(`background  rgb(${bg.map(Math.round).join(', ')})  luminance ${bgLum.toFixed(3)}`);
console.log(`darkest ink luminance ${inkLum.toFixed(3)}`);
console.log(`mark ${markW}x${markH} at (${minX}, ${minY}) in ${width}x${height}`);
console.log(`wrote ${OUT} at ${final.width}x${final.width} (cropped from ${size})`);
