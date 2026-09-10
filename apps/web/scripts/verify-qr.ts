import jsQR from 'jsqr';

import { GARDEN, contrast, encodeQr, mixRgb, type Rgb } from '../src/features/profile/qr.ts';

/**
 * Decodes what the encoder produces, with a real decoder.
 *
 * jsQR takes raw RGBA, so the matrix is rasterised by hand — no canvas, no
 * browser. This is the only test that answers the question that matters: does a
 * scanner read it, and does it read the right thing.
 */
function decode(
  modules: boolean[][],
  scale = 6,
  quiet = 4,
  /** Black on white unless a palette is handed in. See `garden` below. */
  ink?: (x: number, y: number) => Rgb,
  paper: Rgb = [255, 255, 255],
): string | null {
  const count = modules.length;
  const span = (count + quiet * 2) * scale;
  const data = new Uint8ClampedArray(span * span * 4).fill(255);

  for (let i = 0; i < span * span; i += 1) {
    data[i * 4] = paper[0];
    data[i * 4 + 1] = paper[1];
    data[i * 4 + 2] = paper[2];
  }

  for (let y = 0; y < count; y += 1) {
    for (let x = 0; x < count; x += 1) {
      if (!modules[y]![x]) continue;
      const [r, g, b] = ink ? ink(x, y) : ([0, 0, 0] as Rgb);
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const px = (x + quiet) * scale + dx;
          const py = (y + quiet) * scale + dy;
          const i = (py * span + px) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
        }
      }
    }
  }

  return jsQR(data, span, span)?.data ?? null;
}

/**
 * The palest a `VoxelQr` module of one kind is ever allowed to be.
 *
 * Full jitter toward its airborne colour, on the lawn rather than on white -
 * the least contrast the component can produce. Each palette is decoded on its
 * own rather than mixed the way the real geometry mixes them, because a code
 * painted entirely in the weaker of the two is strictly the harder read, and
 * because a synthetic per-module mix measures the binariser's block averaging
 * rather than anything this component will ever draw.
 */
const palest = (kind: 'grass' | 'blossom'): Rgb =>
  mixRgb(
    kind === 'grass' ? GARDEN.grassInk : GARDEN.blossomInk,
    kind === 'grass' ? GARDEN.grassAir : GARDEN.blossomAir,
    GARDEN.jitter,
  );

const cases = [
  'https://pingochat.pages.dev/profile/piyush',
  'https://pingochat.pages.dev/profile/' + 'a'.repeat(20),
  'https://pingochat.pages.dev/profile/x',
];

/**
 * Blanks the centre, the way a logo plate would.
 *
 * Nothing covers the shipped code any more - the centre mark was taken out
 * because the level H it needed made the code too dense to read comfortably.
 * This stays because it is the measurement that says what a logo would cost if
 * one is ever wanted back: at what fraction, and at which level, the code stops
 * coming apart.
 */
function punch(modules: boolean[][], fraction: number): boolean[][] {
  const count = modules.length;
  const span = count * fraction;
  const from = Math.floor((count - span) / 2);
  const to = Math.ceil(from + span);

  return modules.map((row, y) =>
    row.map((on, x) => (y >= from && y < to && x >= from && x < to ? false : on)),
  );
}

let failures = 0;
const say = (ok: boolean, line: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${line}`);
};

for (const level of ['M', 'H'] as const) {
  for (const link of cases) {
    const modules = encodeQr(link, level);
    const got = decode(modules);
    say(
      got === link,
      `${level} v${(modules.length - 17) / 4}  …${link.slice(-24)}` +
        (got === link ? '' : `  -> ${got === null ? 'NOT DECODABLE' : got}`),
    );
  }
}

console.log('');

const link = 'https://pingochat.pages.dev/profile/' + 'a'.repeat(20);
for (const fraction of [0.18, 0.22, 0.26, 0.3]) {
  for (const level of ['M', 'H'] as const) {
    const got = decode(punch(encodeQr(link, level), fraction));
    const label = `${level} with ${Math.round(fraction * 100)}% of the width blanked`;

    // Level M is expected to fail here, and that failure is exactly why a
    // centre mark and a comfortable module size cannot both be had. Only H is
    // held to passing.
    if (level === 'H') say(got === link, label);
    else console.log(`${got === link ? 'ok  ' : 'dead'}  ${label}`);
  }
}

console.log('');

for (const kind of ['grass', 'blossom'] as const) {
  const ink = palest(kind);

  /*
   * The decode is necessary and not sufficient. A synthetic raster is a
   * perfectly lit, perfectly square scan, and jsQR reads these colours far
   * lighter than any phone would; the contrast floor is what actually keeps
   * the palette honest, so both are asserted.
   */
  const ratio = contrast(ink, GARDEN.ground);
  say(
    ratio >= GARDEN.floor,
    `palest ${kind} is ${ratio.toFixed(2)}:1 on the lawn (floor ${GARDEN.floor}:1)`,
  );

  for (const level of ['M', 'H'] as const) {
    for (const link of cases) {
      const got = decode(encodeQr(link, level), 6, 4, () => ink, GARDEN.ground);
      say(got === link, `${level} in the palest ${kind}  …${link.slice(-24)}`);
    }
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
