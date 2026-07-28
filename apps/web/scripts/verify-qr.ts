import jsQR from 'jsqr';

import { encodeQr } from '../src/features/profile/qr.ts';

/**
 * Decodes what the encoder produces, with a real decoder.
 *
 * jsQR takes raw RGBA, so the matrix is rasterised by hand — no canvas, no
 * browser. This is the only test that answers the question that matters: does a
 * scanner read it, and does it read the right thing.
 */
function decode(modules: boolean[][], scale = 6, quiet = 4): string | null {
  const count = modules.length;
  const span = (count + quiet * 2) * scale;
  const data = new Uint8ClampedArray(span * span * 4).fill(255);

  for (let y = 0; y < count; y += 1) {
    for (let x = 0; x < count; x += 1) {
      if (!modules[y]![x]) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const px = (x + quiet) * scale + dx;
          const py = (y + quiet) * scale + dy;
          const i = (py * span + px) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
  }

  return jsQR(data, span, span)?.data ?? null;
}

const cases = [
  'https://pingochat.pages.dev/profile/piyush',
  'https://pingochat.pages.dev/profile/' + 'a'.repeat(20),
  'https://pingochat.pages.dev/profile/x',
];

/**
 * Blanks the centre, the way the logo plate does.
 *
 * This is the test the branded design actually rests on. The plate is 22% of
 * the width; anything it covers is unreadable, and only the error correction
 * puts it back. Running it at the shipped size *and* well beyond shows how much
 * headroom is left rather than merely that it works today.
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
    const shipped = fraction === 0.22;
    const label = `${level} with ${Math.round(fraction * 100)}% of the width blanked${
      shipped ? '  <- the shipped plate' : ''
    }`;

    // Level M is expected to fail here, and that failure is the whole reason
    // the branded code uses H. Only H is held to passing.
    if (level === 'H') say(got === link, label);
    else console.log(`${got === link ? 'ok  ' : 'dead'}  ${label}`);
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
