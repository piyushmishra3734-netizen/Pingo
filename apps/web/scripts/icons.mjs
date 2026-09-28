/**
 * Every icon the product ships, generated from the one logo.
 *
 * Run: `node scripts/icons.mjs` (from apps/web)
 *
 * ## The source
 *
 * `brand/pingo-mark.svg` is the PINGO mark: the looped P, drawn in the sweep
 * (#8B5DFF → #E0559B → #FF9A5A → #FFCC4D). `pingo-mark-ink.svg` and
 * `pingo-mark-white.svg` are the one-colour versions, with the cut where the
 * ribbon crosses itself. Everything below is derived from those three files, so
 * a change to the logo is a change to them and a re-run of this, never a folder
 * of hand exports that drift apart.
 *
 * ## The rules the outputs follow
 *
 * - The mark alone wherever the mark is small and the surface is not ours: the
 *   browser tab.
 * - A white tile with the mark on it wherever the platform expects an app icon:
 *   home screens, launchers, link previews. That is the icon on the brand board.
 * - The splash is the mark and nothing else, on the app's own ground - light
 *   #FBFBFE or dark #111113 - at the size index.html paints it, so the system
 *   splash, the native one and the web one are the same picture.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';

const MARK = 'brand/pingo-mark.svg';
const WHITE = 'brand/pingo-mark-white.svg';
const LIGHT = { r: 0xfb, g: 0xfb, b: 0xfe, alpha: 1 };
const DARK = { r: 0x11, g: 0x11, b: 0x13, alpha: 1 };
const PAPER = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

async function write(path, buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
  console.log('  ', path);
}

/** The mark at `size` px square, on nothing. Rendered large, then scaled, so the edges stay clean. */
async function mark(size, file = MARK) {
  const density = Math.max(72, Math.ceil((size / 1231) * 72 * 4));
  return sharp(file, { density }).resize(size, size).png().toBuffer();
}

/** `size` square of `ground`, with the mark centred at `scale` of it. `radius` rounds the corners. */
async function tile(size, scale, ground, radius = 0) {
  const art = await mark(Math.round(size * scale));
  let out = sharp({ create: { width: size, height: size, channels: 4, background: ground } })
    .composite([{ input: art, gravity: 'center' }])
    .png();
  if (radius) {
    const r = Math.round(size * radius);
    const shape = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`);
    out = sharp(await out.toBuffer()).composite([{ input: shape, blend: 'dest-in' }]).png();
  }
  return out.toBuffer();
}

async function circle(size, scale) {
  const shape = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  return sharp(await tile(size, scale, PAPER)).composite([{ input: shape, blend: 'dest-in' }]).png().toBuffer();
}

/** The splash: the mark on the ground, at the size index.html draws it - min(30% of each side, 120dp). */
async function splash(w, h, ground, dp) {
  const side = Math.round(Math.min(w * 0.3, h * 0.3, 120 * dp));
  return sharp({ create: { width: w, height: h, channels: 4, background: ground } })
    .composite([{ input: await mark(side), gravity: 'center' }])
    .png()
    .toBuffer();
}

console.log('web:');
await write('public/pingo-mark.svg', await (await import('node:fs/promises')).readFile(MARK));
await write('public/pingo-favicon.png', await mark(512));
await write('public/pingo-favicon-32.png', await mark(32));
await write('public/pingo-icon.png', await tile(512, 0.72, PAPER, 0.225));
// Opaque to every edge: Android crops it to its own shape, iOS rounds it itself.
// The mark stays inside the 80% circle a maskable icon is guaranteed.
await write('public/pingo-maskable.png', await tile(512, 0.58, PAPER));
await write('public/apple-touch-icon.png', await tile(180, 0.68, PAPER));
// The PINGO assistant's face in a chat list, until the operator gives it another.
await write('public/pingo-avatar.png', await tile(256, 0.6, PAPER));

console.log('android:');
const RES = 'android/app/src/main/res';
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];
for (const [density, dp] of DENSITIES) {
  const dir = `${RES}/mipmap-${density}`;
  await write(`${dir}/ic_launcher.png`, await tile(48 * dp, 0.68, PAPER, 0.225));
  await write(`${dir}/ic_launcher_round.png`, await circle(48 * dp, 0.6));
  // Adaptive: 108dp, of which the launcher may show as little as the middle 66dp circle.
  await write(`${dir}/ic_launcher_foreground.png`, await tile(108 * dp, 0.5, CLEAR));
  // The status bar draws this at 24dp, white, and ignores its colour.
  await write(`${RES}/drawable-${density}/ic_notification.png`, await sharp({ create: { width: 24 * dp, height: 24 * dp, channels: 4, background: CLEAR } })
    .composite([{ input: await mark(Math.round(22 * dp), WHITE), gravity: 'center' }]).png().toBuffer());
  // Android 12+: the system splash's icon, a 288dp canvas cut to a 192dp circle.
  await write(`${RES}/drawable-${density}/splash_mark.png`, await tile(288 * dp, 0.4, CLEAR));
  // Before Android 12, and the Capacitor splash on every version: a whole screen, centre-cropped.
  for (const [night, ground] of [['', LIGHT], ['-night', DARK]]) {
    await write(`${RES}/drawable${night}-port-${density}/splash.png`, await splash(Math.round(320 * dp), Math.round(699 * dp), ground, dp));
    await write(`${RES}/drawable${night}-land-${density}/splash.png`, await splash(Math.round(480 * dp), Math.round(270 * dp), ground, dp));
  }
}
await write(`${RES}/drawable/splash.png`, await splash(1080, 2359, LIGHT, 2.625));
await write(`${RES}/drawable-night/splash.png`, await splash(1080, 2359, DARK, 2.625));
console.log('done');
