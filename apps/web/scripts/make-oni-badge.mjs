/**
 * The ONI badge, made visible on a dark screen.
 *
 * The crest is a black-and-oxblood mask. Drawn at the size beside a name, on a
 * dark chat list, the mask and the page are the same colour and what is left is
 * a hole in the row. The art is not redrawn: it is lifted a little (brightness,
 * saturation), and given what a dark mask needs to be seen against dark - a thin
 * gold rim just outside its own silhouette and a soft warm glow outside that.
 * Both come from the artwork's own alpha, so they follow the shape exactly.
 *
 * Usage: node apps/web/scripts/make-oni-badge.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const SOURCE = 'apps/web/assets/oni.png';
const OUT = process.argv[2] ?? 'apps/web/public/badges';
const SIZES = [['oni', 512], ['oni', 128], ['oni', 48], ['oni-crest', 96], ['oni-crest', 48]];
const GOLD = { r: 236, g: 178, b: 74 };
const GLOW = { r: 255, g: 96, b: 54 };

mkdirSync(OUT, { recursive: true });

for (const [name, n] of SIZES) {
  // The art sits inside the box with room round it for the rim and the glow.
  const pad = Math.round(n * 0.07);
  const inner = n - pad * 2;
  const art = await sharp(SOURCE)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .modulate({ brightness: 1.35, saturation: 1.2 })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const alpha = await sharp(art).extractChannel(3).toBuffer();

  const tint = async (mask, colour, opacity) => {
    const m = await sharp(mask).linear(opacity, 0).toBuffer();
    // A flat colour whose alpha channel is the mask.
    return sharp({ create: { width: n, height: n, channels: 3, background: colour } })
      .joinChannel(m)
      .png()
      .toBuffer();
  };
  // Rim: the silhouette pushed out a little. Glow: the same, blurred wide.
  const rimMask = await sharp(alpha).blur(Math.max(0.6, n * 0.012)).threshold(10).blur(Math.max(0.4, n * 0.004)).toBuffer();
  const glowMask = await sharp(alpha).blur(Math.max(1, n * 0.035)).toBuffer();
  const rim = await tint(rimMask, GOLD, 1);
  const glow = await tint(glowMask, GLOW, 0.85);

  await sharp({ create: { width: n, height: n, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: glow }, { input: rim }, { input: art }])
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/${name}-${n}.png`);
  console.log(`${OUT}/${name}-${n}.png`);
}
