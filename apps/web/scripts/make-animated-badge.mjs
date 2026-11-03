/**
 * An animated badge, from a GIF drawn on a black background, to transparent
 * animated WebP in the sizes the product asks for.
 *
 * ## Why WebP and not the GIF
 *
 * A GIF has one bit of transparency: a pixel is there or it is not, so a glowing
 * edge cut out of black is either a hard jagged line or a black fringe. WebP
 * carries a full alpha channel and plays in an <img> exactly as a GIF does.
 *
 * ## Taking the black away
 *
 * Not "every dark pixel": a ruby's deep shadow is darker than the black around
 * it in places, and keying on brightness would punch holes in the badge. The
 * background is what is dark AND reachable from the picture's edge; anything dark
 * that is enclosed by the artwork stays. The rim then gets a soft alpha, with the
 * colour divided back out of it, so a glow fades instead of leaving a halo.
 * Specks that float free of the badge (the sparks) are dropped, so the badge is
 * the one silhouette every frame.
 *
 * Usage:
 *   node apps/web/scripts/make-animated-badge.mjs <source.gif> <name> <crestName>
 */
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const [, , SOURCE, NAME, CREST_NAME] = process.argv;
if (!SOURCE || !NAME || !CREST_NAME) throw new Error('usage: <source.gif> <name> <crestName>');
const OUT_DIR = 'apps/web/public/badges';
const SIZES = [512, 128, 48];
const CREST_SIZES = [96, 48];
/** Brightness (max channel) under which a pixel can be background. */
const DARK = 38;
/** A closed gap is background only if it is this black, and at least this many pixels. */
const PURE = 12;
const GAP = 120;
/** Under this it is fully transparent at the rim, over RIM_TOP fully opaque. */
const RIM_TOP = 150;

const { data, info } = await sharp(SOURCE, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.pageHeight ?? Math.round(info.height / (info.pages ?? 1));
const N = info.pages ?? Math.round(info.height / H);
const delay = (await sharp(SOURCE, { animated: true }).metadata()).delay ?? Array(N).fill(100);
console.log(`source ${W}x${H}, ${N} frames`);

/** Frame `f` as RGBA with the background transparent. */
function cutOut(f) {
  const px = new Uint8Array(data.buffer, data.byteOffset + f * W * H * 4, W * H * 4);
  const bright = (i) => Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  // Background: dark pixels reachable from the edge.
  const bg = new Uint8Array(W * H);
  const stack = [];
  const seed = (i) => { if (!bg[i] && bright(i) < DARK) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x += 1) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y += 1) { seed(y * W); seed(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % W;
    if (x > 0) seed(i - 1);
    if (x < W - 1) seed(i + 1);
    if (i >= W) seed(i - W);
    if (i < W * (H - 1)) seed(i + W);
  }
  // Black gaps the artwork closes round (between the crown's spikes): background as well, but only when
  // they are pure black and big enough to be a gap - a ruby's shadow is dark but never that black.
  const seen = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s += 1) {
    if (bg[s] || seen[s] || bright(s) >= PURE) continue;
    const q = [s];
    const members = [];
    seen[s] = 1;
    while (q.length) {
      const i = q.pop();
      members.push(i);
      const x = i % W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1];
      for (const j of nb) if (j >= 0 && !bg[j] && !seen[j] && bright(j) < PURE) { seen[j] = 1; q.push(j); }
    }
    if (members.length >= GAP) for (const i of members) bg[i] = 1;
  }
  // Drop pieces that float free: keep components of the rest at least 2% of the biggest.
  const label = new Int32Array(W * H);
  const sizes = [0];
  for (let s = 0; s < W * H; s += 1) {
    if (bg[s] || label[s]) continue;
    const id = sizes.length;
    let n = 0;
    label[s] = id;
    const q = [s];
    while (q.length) {
      const i = q.pop();
      n += 1;
      const x = i % W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1];
      for (const j of nb) if (j >= 0 && !bg[j] && !label[j]) { label[j] = id; q.push(j); }
    }
    sizes.push(n);
  }
  const biggest = Math.max(...sizes);
  const keep = sizes.map((n) => n >= biggest * 0.02);
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i += 1) {
    if (bg[i] || !keep[label[i]]) continue;
    // Rim: a kept pixel touching the background gets a soft alpha.
    const x = i % W;
    const edge = (x > 0 && bg[i - 1]) || (x < W - 1 && bg[i + 1]) || (i >= W && bg[i - W]) || (i < W * (H - 1) && bg[i + W]);
    const m = bright(i);
    const a = edge ? Math.min(1, Math.max(0, (m - DARK * 0.5) / (RIM_TOP - DARK * 0.5))) : 1;
    if (a <= 0) continue;
    for (let c = 0; c < 3; c += 1) out[i * 4 + c] = Math.min(255, Math.round(px[i * 4 + c] / (edge ? Math.max(a, 0.35) : 1)));
    out[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

const frames = Array.from({ length: N }, (_, f) => cutOut(f));

// One crop for every frame, so the badge does not jitter: the union of their ink, as a square.
let x0 = W, y0 = H, x1 = -1, y1 = -1;
for (const fr of frames) {
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    if (fr[(y * W + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
}
const side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
const margin = Math.round(side * 0.02);
const box = side + margin * 2;
const left = Math.round((x0 + x1) / 2 - box / 2);
const top = Math.round((y0 + y1) / 2 - box / 2);
console.log(`ink ${x0},${y0}-${x1},${y1}; square ${box} at ${left},${top}`);

mkdirSync(OUT_DIR, { recursive: true });
async function emit(n, name) {
  const pieces = [];
  for (const fr of frames) {
    pieces.push(
      await sharp(fr, { raw: { width: W, height: H, channels: 4 } })
        .extend({ top: Math.max(0, -top), left: Math.max(0, -left), bottom: Math.max(0, top + box - H), right: Math.max(0, left + box - W), background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .extract({ left: Math.max(0, left), top: Math.max(0, top), width: box, height: box })
        .resize(n, n, { kernel: 'lanczos3' })
        .raw()
        .toBuffer(),
    );
  }
  const path = `${OUT_DIR}/${name}-${n}.webp`;
  await sharp(Buffer.concat(pieces), { raw: { width: n, height: n * N, channels: 4, pageHeight: n } })
    .webp({ loop: 0, delay, quality: 82, alphaQuality: 90, effort: 5 })
    .toFile(path);
  const meta = await sharp(path, { animated: true }).metadata();
  console.log(`${path}  ${n}x${n}  pages ${meta.pages}`);
}
for (const n of SIZES) await emit(n, NAME);
for (const n of CREST_SIZES) await emit(n, CREST_NAME);
