/**
 * The penguin, cut out of the tile it was drawn on, for the middle of a QR code.
 *
 * The artwork arrives as an app-icon render: the penguin inside a rounded glass
 * tile, on a white page. In the centre of a QR code the tile is wrong twice
 * over - it is a second square inside the plate that is already a square, and
 * its rim is a thin light ring that a scanner has to read past. So this takes
 * the penguin out of it.
 *
 * ## Cut, not redrawn
 *
 * Every pixel that survives is the supplied file's. Nothing is recoloured,
 * simplified, or approximated in paths - `QrArt` already says why: an
 * approximation of a logo is "nearly the logo, which is worse than not having
 * one".
 *
 * ## How the background comes off
 *
 * A flood from the edges, and the direction matters. The tile's interior and
 * the penguin's belly are within a few levels of each other - both are
 * off-white under the same soft lighting - so no threshold separates them.
 * Connectivity does: the belly is enclosed by the hood above it and a flipper
 * on each side, and its only opening is the bottom, where the artwork itself is
 * cropped. Seeding the flood from the top and the two sides and never from the
 * bottom therefore takes the tile and leaves the bird.
 *
 * ## Premultiplied, like the badge art
 *
 * Scaling transparent artwork by averaging raw RGB drags the colour of fully
 * clear pixels into every edge and leaves a halo that looks like a compression
 * artefact. Colours are weighted by their own alpha and divided back out, so a
 * clear pixel contributes nothing but its transparency.
 *
 * Usage: node apps/web/scripts/make-qr-mark.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const SOURCE = 'apps/web/assets/pingo-penguin.png';
const OUT = 'apps/web/src/assets/pingo-qr-mark.png';

/**
 * The penguin's ink, measured in the source rather than guessed: the bounding
 * box of every pixel darker than mid-grey is the hood, the eyes and the two
 * flippers. Padded sideways so the flippers keep their soft edge, and left
 * exactly at the flipper line along the bottom, which is where the artwork's
 * own crop is.
 */
const INK = { x0: 232, y0: 290, x1: 1032, y1: 1051 };
const PAD = 18;

/** Anything lighter than this is tile, once the flood can reach it. */
const LIGHT = 170;

/**
 * 192 square.
 *
 * The mark is drawn at 18% of a code that renders between 168 and 260 CSS
 * pixels, so about 47 pixels at its largest - and the QR sheet exports a PNG at
 * 3x, which is 141. 192 covers that with room and keeps the file small, which
 * matters here more than usual: this asset is inlined as a data URI inside the
 * SVG, so every kilobyte is a kilobyte of JavaScript bundle.
 */
const SIZE = 192;

const src = PNG.sync.read(readFileSync(SOURCE));

const box = { x0: INK.x0 - PAD, y0: INK.y0 - PAD, x1: INK.x1 + PAD, y1: INK.y1 };
const w = box.x1 - box.x0 + 1;
const h = box.y1 - box.y0 + 1;

const cut = new PNG({ width: w, height: h });
for (let y = 0; y < h; y += 1) {
  for (let x = 0; x < w; x += 1) {
    const s = ((y + box.y0) * src.width + (x + box.x0)) << 2;
    const d = (y * w + x) << 2;
    cut.data[d] = src.data[s];
    cut.data[d + 1] = src.data[s + 1];
    cut.data[d + 2] = src.data[s + 2];
    cut.data[d + 3] = 255;
  }
}

const luminance = (i) =>
  0.299 * cut.data[i] + 0.587 * cut.data[i + 1] + 0.114 * cut.data[i + 2];

const outside = new Uint8Array(w * h);
const stack = [];
for (let x = 0; x < w; x += 1) stack.push([x, 0]);
for (let y = 0; y < h; y += 1) stack.push([0, y], [w - 1, y]);

while (stack.length) {
  const [x, y] = stack.pop();
  if (x < 0 || y < 0 || x >= w || y >= h) continue;
  const p = y * w + x;
  if (outside[p] || luminance(p << 2) < LIGHT) continue;
  outside[p] = 1;
  stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
}

let cleared = 0;
for (let p = 0; p < w * h; p += 1) {
  if (outside[p]) {
    cut.data[(p << 2) + 3] = 0;
    cleared += 1;
  }
}

/** One output pixel: the average of every source pixel it covers. */
function average(image, x0, y0, x1, y1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (image.width * y + x) << 2;
      const alpha = image.data[i + 3] / 255;
      r += image.data[i] * alpha;
      g += image.data[i + 1] * alpha;
      b += image.data[i + 2] * alpha;
      a += alpha;
      n += 1;
    }
  }

  if (n === 0 || a === 0) return [0, 0, 0, 0];
  return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / n) * 255)];
}

/*
 * Square output for a picture that is not square. `QrArt` reserves a square and
 * uses `xMidYMid meet`, so a letterboxed image would land in the same place -
 * but a square file is the one that says so, and it is what every other mark in
 * this repository is.
 */
const out = new PNG({ width: SIZE, height: SIZE });
const scale = Math.min(SIZE / w, SIZE / h);
const drawnW = Math.round(w * scale);
const drawnH = Math.round(h * scale);
const offsetX = Math.floor((SIZE - drawnW) / 2);
const offsetY = Math.floor((SIZE - drawnH) / 2);

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const i = (SIZE * y + x) << 2;
    const insideX = x - offsetX;
    const insideY = y - offsetY;

    if (insideX < 0 || insideY < 0 || insideX >= drawnW || insideY >= drawnH) {
      out.data[i + 3] = 0;
      continue;
    }

    const [r, g, b, a] = average(
      cut,
      Math.floor((insideX * w) / drawnW),
      Math.floor((insideY * h) / drawnH),
      Math.max(Math.floor((insideX * w) / drawnW) + 1, Math.floor(((insideX + 1) * w) / drawnW)),
      Math.max(Math.floor((insideY * h) / drawnH) + 1, Math.floor(((insideY + 1) * h) / drawnH)),
    );
    out.data[i] = r;
    out.data[i + 1] = g;
    out.data[i + 2] = b;
    out.data[i + 3] = a;
  }
}

const bytes = PNG.sync.write(out);
writeFileSync(OUT, bytes);

console.log(
  `${OUT}  ${SIZE}x${SIZE}  ${(bytes.length / 1024).toFixed(1)} kB  ` +
    `(cut ${w}x${h}, ${((100 * cleared) / (w * h)).toFixed(1)}% of it cleared)`,
);
