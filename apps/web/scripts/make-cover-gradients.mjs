import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

/**
 * The starter cover collection: soft gradients, so the picker has something in
 * it before the illustrated collections are drawn. 1536x512 WebP, the shape of
 * the cover band, small enough that a whole grid of them loads at once.
 *
 *   node scripts/make-cover-gradients.mjs
 */

const OUT = 'public/covers/gradients';
const SETS = {
  dusk: ['#ff9a8b', '#ff6a88', '#a855f7'],
  ocean: ['#22d3ee', '#3b82f6', '#6366f1'],
  mint: ['#a7f3d0', '#34d399', '#0ea5e9'],
  peach: ['#fde68a', '#fb923c', '#f472b6'],
  lavender: ['#e9d5ff', '#c4b5fd', '#818cf8'],
  night: ['#0f172a', '#4c1d95', '#db2777'],
  forest: ['#14532d', '#16a34a', '#bef264'],
  sunset: ['#f97316', '#e11d48', '#7c3aed'],
};

mkdirSync(OUT, { recursive: true });
for (const [name, [a, b, c]] of Object.entries(SETS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/>
    </linearGradient>
    <radialGradient id="r" cx=".78" cy=".2" r=".7">
      <stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1536" height="512" fill="url(#g)"/>
  <rect width="1536" height="512" fill="url(#r)"/>
</svg>`;
  await sharp(Buffer.from(svg)).webp({ quality: 82 }).toFile(`${OUT}/${name}.webp`);
  console.log(`${OUT}/${name}.webp`);
}
