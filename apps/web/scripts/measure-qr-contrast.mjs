// How light can the blossom go and still be read by a camera that is not ideal?
//
// Rasterises the real code at several inks, degrades each the way a phone in a
// dim room at an angle degrades it, and decodes. The answer is measured, not
// reasoned: a clean synthetic raster decodes far lighter than anything a camera
// will, so a contrast number alone does not settle it.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Pingo chat/apps/web/package.json');
const jsQR = require('jsqr');

const { GARDEN, encodeQr, mixRgb, contrast } = await import(
  '../src/features/profile/qr.ts'
);

const LINK = 'https://pingochat.pages.dev/profile/anaya';
const SCALE = 8;
const QUIET = 4;

function raster(ink, grass) {
  const m = encodeQr(LINK, 'M');
  const n = m.length;
  const mid = (n - 1) / 2;
  const span = (n + QUIET * 2) * SCALE;
  const buf = Buffer.alloc(span * span * 3);
  const [pr, pg, pb] = GARDEN.ground;
  for (let i = 0; i < span * span; i += 1) {
    buf[i * 3] = pr;
    buf[i * 3 + 1] = pg;
    buf[i * 3 + 2] = pb;
  }
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (!m[y][x]) continue;
      // The same rule the component uses: corners and rim are grass.
      const finder = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
      const reach = Math.max(Math.abs(x - mid), Math.abs(y - mid)) / mid;
      const isGrass = finder || reach > 0.9;
      // Palest shade of whichever it is - the hardest case.
      const c = mixRgb(
        isGrass ? grass : ink,
        isGrass ? GARDEN.grassAir : GARDEN.blossomAir,
        GARDEN.jitter,
      );
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          const i = (((y + QUIET) * SCALE + dy) * span + (x + QUIET) * SCALE + dx) * 3;
          buf[i] = c[0];
          buf[i + 1] = c[1];
          buf[i + 2] = c[2];
        }
      }
    }
  }
  return { buf, span };
}

/** What a camera does to a code, in five increasingly unkind ways. */
const TRIALS = [
  ['clean', []],
  ['soft focus', ['gblur=sigma=2.2']],
  ['dim + grain', ['gblur=sigma=1.6,noise=alls=12:allf=t,eq=contrast=0.8:brightness=-0.04']],
  ['small on screen', ['scale=132:132,gblur=sigma=0.7']],
  ['angled + dim', ['gblur=sigma=1.6,noise=alls=12:allf=t,eq=contrast=0.78,rotate=4*PI/180:c=white']],
];

function decodeThrough(buf, span, filters) {
  const args = [
    '-v', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${span}x${span}`, '-i', 'pipe:0',
    ...(filters.length ? ['-vf', filters[0]] : []),
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ];
  const out = execFileSync('ffmpeg', args, { input: buf, maxBuffer: 1 << 28 });
  // The filter chain may have resized; derive the side from the byte count.
  const side = Math.round(Math.sqrt(out.length / 4));
  return jsQR(new Uint8ClampedArray(out), side, side)?.data ?? null;
}

// Controls first: is the trial set even passable, and which colour is the
// limiting one - the blossom or the grass?
const controls = [
  ['black on white', [0, 0, 0], [0, 0, 0]],
  ['shipped both', GARDEN.blossomInk, GARDEN.grassInk],
  ['shipped ink, dark grass', GARDEN.blossomInk, [34, 74, 18]],
  ['dark ink, shipped grass', [120, 20, 40], GARDEN.grassInk],
];
for (const [name, ink, grass] of controls) {
  const results = TRIALS.map(([n, f]) => {
    const { buf, span } = raster(ink, grass);
    return [n, decodeThrough(buf, span, f) === LINK];
  });
  console.log(
    `${name.padEnd(26)} ${results.filter(([, ok]) => ok).length}/${TRIALS.length}  ` +
      results.map(([n, ok]) => `${ok ? '+' : '-'}${n}`).join('  '),
  );
}
console.log('');

const air = GARDEN.blossomAir;
const steps = [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1];

console.log('blossom, lerped from the shipped ink toward the canopy pink\n');
for (const step of steps) {
  const ink = mixRgb(GARDEN.blossomInk, air, step).map(Math.round);
  const palest = mixRgb(ink, air, GARDEN.jitter);
  const ratio = contrast(palest, GARDEN.ground);
  const results = TRIALS.map(([name, f]) => {
    const { buf, span } = raster(ink, GARDEN.grassInk);
    return [name, decodeThrough(buf, span, f) === LINK];
  });
  const passed = results.filter(([, ok]) => ok).length;
  console.log(
    `${String(step.toFixed(2)).padEnd(5)} rgb(${String(ink).padEnd(13)}) ${ratio.toFixed(2)}:1  ` +
      `${passed}/${TRIALS.length}  ` +
      results.map(([n, ok]) => `${ok ? '+' : '-'}${n}`).join('  '),
  );
}

console.log('');
console.log('grass, lerped from the shipped ink toward the reference green');
console.log('');
const VIDEO_GREEN = [96, 180, 54];
for (const step of steps) {
  const grass = mixRgb(GARDEN.grassInk, VIDEO_GREEN, step).map(Math.round);
  const palest = mixRgb(grass, GARDEN.grassAir, GARDEN.jitter);
  const ratio = contrast(palest, GARDEN.ground);
  const results = TRIALS.map(([n, f]) => {
    const { buf, span } = raster(GARDEN.blossomInk, grass);
    return [n, decodeThrough(buf, span, f) === LINK];
  });
  const passed = results.filter(([, ok]) => ok).length;
  console.log(
    `${String(step.toFixed(2)).padEnd(5)} rgb(${String(grass).padEnd(13)}) ${ratio.toFixed(2)}:1  ` +
      `${passed}/${TRIALS.length}  ` +
      results.map(([n, ok]) => `${ok ? '+' : '-'}${n}`).join('  '),
  );
}

console.log('');
console.log('the two candidates together, which is the only pair that ships');
console.log('');
const pairs = [
  ['shipped', GARDEN.blossomInk, GARDEN.grassInk],
  ['lighter blossom only', [232, 92, 107], GARDEN.grassInk],
  ['brighter grass only', GARDEN.blossomInk, [75, 141, 42]],
  ['both', [232, 92, 107], [75, 141, 42]],
  ['both, one step back', [229, 79, 98], [75, 141, 42]],
];
for (const [name, ink, grass] of pairs) {
  const results = TRIALS.map(([n, f]) => {
    const { buf, span } = raster(ink, grass);
    return [n, decodeThrough(buf, span, f) === LINK];
  });
  const passed = results.filter(([, ok]) => ok).length;
  console.log(
    `${name.padEnd(22)} ${passed}/${TRIALS.length}  ` +
      results.map(([n, ok]) => `${ok ? '+' : '-'}${n}`).join('  '),
  );
}
