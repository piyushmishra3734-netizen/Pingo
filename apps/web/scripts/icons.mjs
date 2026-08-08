/**
 * Every icon the product ships, generated from the one supplied artwork.
 *
 * Run: `node scripts/icons.mjs <path-to-source.png>`
 *
 * ## Why a script and not a folder of files somebody exported once
 *
 * There are nineteen raster targets across the web manifest and five Android
 * densities. Exported by hand they drift: a logo change updates the ones
 * somebody remembers, and the launcher keeps the old mark on half the devices
 * in the fleet because `mipmap-hdpi` was missed. Generated, the source of truth
 * is the artwork and everything else is derived.
 *
 * ## Nothing here redraws the logo
 *
 * The artwork is used as supplied. The only operations are cropping to the
 * tile, removing the paper it was rendered on, scaling, and - for the maskable
 * and adaptive variants - placing it on a full-bleed ground, which is what
 * those formats require. No recolouring, no re-proportioning, no tracing.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';

const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error('usage: node scripts/icons.mjs <source.png>');
  process.exit(1);
}

/**
 * How close to the corner pixel a colour must be to count as the paper the
 * artwork was rendered on.
 *
 * Measured on the supplied file: the paper is (254,254,253) and the tile's
 * own interior is (243,237,233) - a distance of about eleven. Six therefore
 * separates them with room on both sides, and the tile's glass rim is further
 * still, so the fill stops at the rim rather than leaking into the design.
 */
const PAPER_TOLERANCE = 6;

/** Read the source once, as raw RGBA. */
const src = sharp(SOURCE).ensureAlpha();
const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;

const rgb = (x, y) => {
  const i = (y * W + x) * C;
  return [data[i], data[i + 1], data[i + 2]];
};
const paper = rgb(0, 0);
const isPaper = (x, y) => {
  const p = rgb(x, y);
  return (
    Math.abs(p[0] - paper[0]) <= PAPER_TOLERANCE &&
    Math.abs(p[1] - paper[1]) <= PAPER_TOLERANCE &&
    Math.abs(p[2] - paper[2]) <= PAPER_TOLERANCE
  );
};

/**
 * The paper, removed by flooding inward from the four corners.
 *
 * A plain colour key would not work: the tile's interior and the penguin's
 * body are both within a few points of the paper, so keying every near-white
 * pixel would punch holes through the middle of the logo. Connectivity is what
 * distinguishes them - the paper is the region touching the edge of the canvas,
 * and the rim of the tile is an unbroken boundary the flood cannot cross.
 */
function paperMask() {
  const outside = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = y * W + x;
    if (outside[k]) return;
    if (!isPaper(x, y)) return;
    outside[k] = 1;
    stack.push(k);
  };
  for (let x = 0; x < W; x++) {
    push(x, 0);
    push(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    push(0, y);
    push(W - 1, y);
  }
  while (stack.length) {
    const k = stack.pop();
    const x = k % W;
    const y = (k - x) / W;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return outside;
}

const outside = paperMask();

/**
 * The tile itself, which is not the same as everything the flood left behind.
 *
 * The artwork is a mockup: the tile is rendered sitting on the paper, and it
 * casts a soft shadow below itself. That shadow is nowhere near the paper's
 * colour, so the flood correctly leaves it - and taking the bounding box of
 * what remains then hands back a rectangle 116px taller than the tile, with the
 * tile pushed off centre inside it. At launcher sizes that reads as a grey
 * smudge along the bottom edge, which is indistinguishable from dirt.
 *
 * So the tile is measured rather than inferred from what is left. The shadow
 * falls below, so the horizontal centre line crosses the tile's sides and
 * nothing else; the vertical centre line above the tile's middle finds its top
 * the same way. The tile is square by design, so its width is its side, and
 * that is enough to place all four edges without ever consulting the part of
 * the image the shadow is in.
 */
function tileBounds() {
  const midY = Math.round(H / 2);
  const midX = Math.round(W / 2);
  let left = 0;
  while (left < W && outside[midY * W + left]) left++;
  let right = W - 1;
  while (right > 0 && outside[midY * W + right]) right--;
  let top = 0;
  while (top < H && outside[top * W + midX]) top++;
  return { left, top, side: right - left + 1 };
}

const { left, top, side } = tileBounds();

/**
 * The tile, cut out of its paper.
 *
 * The alpha is mirrored top-to-bottom and intersected with itself, which is
 * what removes the shadow from the two lower corners. The flood cannot do it
 * alone: below the tile the shadow is not paper, so those corners came back
 * opaque - measured at alpha 173 in the bottom right, a grey wedge that reads
 * as a chipped icon at launcher size.
 *
 * The mirror is safe because it only ever *removes*, and because everything
 * inside the tile is fully opaque in both halves - so the intersection changes
 * nothing except the corners, where the tile's own geometry is symmetric. The
 * top corners are shadow-free, so they are the clean copy the bottom borrows.
 */
const cutout = Buffer.alloc(side * side * 4);
for (let y = 0; y < side; y++) {
  for (let x = 0; x < side; x++) {
    const sx = left + x;
    const sy = top + y;
    const mirroredY = top + (side - 1 - y);
    const opaque = !outside[sy * W + sx] && !outside[mirroredY * W + sx];
    const s = (sy * W + sx) * C;
    const i = (y * side + x) * 4;
    cutout[i] = data[s];
    cutout[i + 1] = data[s + 1];
    cutout[i + 2] = data[s + 2];
    cutout[i + 3] = opaque ? 255 : 0;
  }
}

const transparentTile = await sharp(cutout, { raw: { width: side, height: side, channels: 4 } })
  .png()
  .toBuffer();

/** The tile's own interior colour, for the grounds that must be opaque. */
const interior = rgb(left + Math.round(side * 0.06), top + Math.round(side * 0.5));
const GROUND = { r: interior[0], g: interior[1], b: interior[2], alpha: 1 };

async function write(path, buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
  console.log('  ', path);
}

/** Transparent-cornered, for a browser tab and a manifest's `any` purpose. */
async function plain(size) {
  return sharp(transparentTile).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

/**
 * Full bleed, for the formats that crop.
 *
 * Android takes an icon and cuts it to whatever shape the launcher uses, so a
 * tile with transparent corners is cropped twice and arrives as a small badge
 * in a large empty circle. `inset` is how much of the canvas the artwork keeps;
 * the rest is the tile's own colour carried to every edge.
 */
async function bleed(size, inset) {
  const art = await sharp(transparentTile)
    .resize(Math.round(size * inset), Math.round(size * inset))
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: GROUND } })
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toBuffer();
}

/**
 * The round launcher icon, actually round.
 *
 * On API 26 and above `mipmap-anydpi-v26/ic_launcher_round.xml` takes over and
 * the launcher masks the adaptive icon itself, so this file is never seen. On
 * 24 and 25 - which this app still supports - it is used exactly as it is,
 * unmasked. Shipping the square copy under this name puts a square icon on
 * those devices in a row of circles.
 */
async function round(size) {
  const square = await bleed(size, 0.86);
  const circle = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  return sharp(square).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer();
}

/**
 * The penguin with the tile taken away too, for the browser tab.
 *
 * Cutting the paper leaves the tile, and the tile is a pale glass square - so
 * in a tab it still reads as a white box with a bird in it. What is wanted
 * there is the mark alone.
 *
 * It cannot be lifted by colour: the tile's wash and the penguin's belly are
 * within a point of each other. Connectivity separates them again, and this
 * time the barrier is the bird itself. Flooding from the tile's own upper
 * corners fills the wash around the head and stops dead at the dark plumage;
 * the belly is sealed behind it - head above, flippers to either side, the
 * tile's own bottom edge below - so the flood can never reach it. What
 * survives is the penguin, entire, including the parts that are the same
 * colour as what was removed.
 */
function penguinOnly() {
  const at = (x, y) => rgb(left + x, top + y);

  /*
   * The bird is its plumage plus everything the plumage encloses.
   *
   * Three attempts went the other way - find the tile's wash and subtract it -
   * and all three failed for the same reason, which only measuring the artwork
   * revealed: the head carries a specular highlight that reaches pure white.
   * It is brighter than the wash it was supposed to be separated from, so every
   * flood walked straight through the head, into the face, and ate the belly.
   * The bird came back as a penguin-shaped hole.
   *
   * Turning it around removes the problem instead of fighting it. The dark
   * plumage is unambiguous at any sensible threshold. Fill what it encloses and
   * the highlight is filled too - it is a hole in the head, and holes are
   * exactly what this fills - so the gloss stops being a leak and becomes part
   * of the mark, which is what it always was.
   *
   * The bottom edge is sealed because the artwork crops the penguin there: the
   * belly is genuinely open at that edge, and a flood allowed in from below
   * would empty it again.
   */
  const PLUMAGE = 150;

  /*
   * Filled by row, not by flooding.
   *
   * Flooding the space around the plumage should have worked and did not: the
   * highlight touches the top of the dome, so there is a bright path from the
   * wash into the head and down into the belly, and no tolerance closes it
   * without also eating the bird.
   *
   * Every horizontal line across this penguin, though, enters through plumage
   * and leaves through plumage - the dome at the top, a flipper on each side
   * lower down. So the bird on any row is simply everything between its first
   * and last dark pixel. No connectivity, no tolerance, nothing for the gloss
   * to escape through, and the face and belly are included because they are
   * between the flippers rather than because anything decided they were
   * enclosed.
   */
  const dark = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const p = at(x, y);
      if ((p[0] + p[1] + p[2]) / 3 < PLUMAGE) dark[y * side + x] = 1;
    }
  }
  /*
   * Only the bird's own plumage defines a row.
   *
   * The tile's rim is dark enough in places to qualify, and a single rim pixel
   * on a row above the head opens a span the full width of the tile - which
   * showed up as a hairline bar floating over the mark. Keeping the largest
   * connected piece of dark leaves the penguin, whose head joins both flippers,
   * and drops everything that is merely dark.
   */
  {
    const seen = new Int32Array(side * side).fill(-1);
    let bestId = -1;
    let bestSize = 0;
    for (let s = 0; s < side * side; s++) {
      if (!dark[s] || seen[s] !== -1) continue;
      let size = 0;
      const q = [s];
      seen[s] = s;
      while (q.length) {
        const k = q.pop();
        size++;
        const x = k % side;
        const y = (k - x) / side;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
          const n = ny * side + nx;
          if (!dark[n] || seen[n] !== -1) continue;
          seen[n] = s;
          q.push(n);
        }
      }
      if (size > bestSize) {
        bestSize = size;
        bestId = s;
      }
    }
    for (let k = 0; k < side * side; k++) if (seen[k] !== bestId) dark[k] = 0;
  }

  const inside = new Uint8Array(side * side).fill(1);
  for (let y = 0; y < side; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < side; x++) {
      if (!dark[y * side + x]) continue;
      if (first < 0) first = x;
      last = x;
    }
    // `inside` means "not the bird", so a row with no plumage stays excluded.
    if (first < 0) continue;
    for (let x = first; x <= last; x++) inside[y * side + x] = 0;
  }


  /*
   * Only the bird, and nothing that merely survived alongside it.
   *
   * The flood stops where the wash stops, which leaves the tile's rim behind -
   * a hairline arc at each corner, invisible on a white tab and plainly there
   * on a dark one. It is not attached to the penguin, so taking the largest
   * connected piece of what remains discards it without needing to describe
   * what it is.
   */
  const survives = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const k = y * side + x;
      if (!inside[k] && !outside[(top + y) * W + (left + x)]) survives[k] = 1;
    }
  }
  const label = new Int32Array(side * side).fill(-1);
  let best = -1;
  let bestSize = 0;
  for (let seed = 0; seed < side * side; seed++) {
    if (!survives[seed] || label[seed] !== -1) continue;
    const id = seed;
    let size = 0;
    const q = [seed];
    label[seed] = id;
    while (q.length) {
      const k = q.pop();
      size++;
      const x = k % side;
      const y = (k - x) / side;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
        const n = ny * side + nx;
        if (!survives[n] || label[n] !== -1) continue;
        label[n] = id;
        q.push(n);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
  }

  const out = Buffer.alloc(side * side * 4);
  let l = side, r = 0, t = side, b = 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const k = y * side + x;
      const keep = survives[k] && label[k] === best;
      const p = at(x, y);
      const i = k * 4;
      out[i] = p[0];
      out[i + 1] = p[1];
      out[i + 2] = p[2];
      out[i + 3] = keep ? 255 : 0;
      if (keep) {
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
    }
  }
  return { buffer: out, box: { left: l, top: t, width: r - l + 1, height: b - t + 1 } };
}

/** The adaptive icon's foreground layer: artwork only, on nothing. */
async function foreground(size) {
  const art = await sharp(transparentTile)
    .resize(Math.round(size * 0.62), Math.round(size * 0.62))
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toBuffer();
}

/**
 * The status-bar icon, taken from the artwork rather than drawn again.
 *
 * Android renders this by throwing the colour away and painting the alpha
 * channel white. Hand it the launcher icon and every pixel with any opacity
 * becomes solid white, which is what "the notification icon is a grey blob"
 * always is.
 *
 * That same rule is what makes deriving it possible without tracing anything:
 * keep the penguin's dark plumage and its beak, drop everything else, and the
 * face becomes a hole while the eyes become two marks floating inside it. The
 * silhouette is the artwork's own geometry - the alpha is the only thing being
 * decided here, and it is decided by what colour the artwork already is.
 */
function silhouette() {
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const [r, g, b] = rgb(left + x, top + y);
      const dark = (r + g + b) / 3 < 120;
      const beak = r > 195 && g > 95 && g < 200 && b < 130;
      const i = (y * side + x) * 4;
      // White throughout: Android repaints it anyway, and a white source keeps
      // the edges from darkening when it is scaled down.
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = dark || beak ? 255 : 0;
    }
  }
  return sharp(out, { raw: { width: side, height: side, channels: 4 } }).png().toBuffer();
}

console.log(`source ${W}x${H}, tile at ${left},${top} size ${side}, ground rgb(${interior})`);
console.log('web:');
await write('public/pingo-icon.png', await plain(512));
await write('public/pingo-maskable.png', await bleed(512, 0.78));

/*
 * Squared around the mark before scaling, so the penguin is not stretched by
 * being taller than it is wide.
 */
const { buffer: penguin, box } = penguinOnly();
const markSide = Math.max(box.width, box.height);
await write(
  'public/pingo-favicon.png',
  await sharp(penguin, { raw: { width: side, height: side, channels: 4 } })
    .extract(box)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer(),
);
console.log(`   mark ${box.width}x${box.height} at ${box.left},${box.top} (square ${markSide})`);

console.log('android:');
const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];
for (const [density, launcher, adaptive] of DENSITIES) {
  const dir = `android/app/src/main/res/mipmap-${density}`;
  await write(`${dir}/ic_launcher.png`, await bleed(launcher, 0.86));
  await write(`${dir}/ic_launcher_round.png`, await round(launcher));
  await write(`${dir}/ic_launcher_foreground.png`, await foreground(adaptive));
}

/*
 * The status bar draws this at 24dp, so the densities are the plain multiples
 * of that rather than the launcher's.
 */
console.log('notification:');
const mark = await silhouette();
for (const [density, dp] of [['mdpi', 24], ['hdpi', 36], ['xhdpi', 48], ['xxhdpi', 72], ['xxxhdpi', 96]]) {
  const art = await sharp(mark).resize(Math.round(dp * 0.92), Math.round(dp * 0.92), { fit: 'inside' }).png().toBuffer();
  const padded = await sharp({ create: { width: dp, height: dp, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toBuffer();
  await write(`android/app/src/main/res/drawable-${density}/ic_notification.png`, padded);
}
console.log('done');
