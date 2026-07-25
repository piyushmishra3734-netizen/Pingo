/**
 * Wireframe alignment checker.
 *
 * Every ASCII wireframe in docs/ must be a rectangle. A misaligned frame is the
 * difference between a specification and a sketch, and it is invisible in a diff
 * — so it is checked mechanically.
 *
 * Run: node docs/.check-wireframes.mjs
 *
 * Rules enforced:
 *   1. Every line of a frame has the same visual width as its top border.
 *   2. No emoji or ambiguous-width characters inside a frame. Terminals and
 *      browsers disagree on their width, so a frame containing one cannot be
 *      guaranteed to render as a rectangle anywhere.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = dirname(fileURLToPath(import.meta.url));

/** Characters whose rendered width varies between renderers. */
function isAmbiguousWidth(codePoint) {
  return (
    // Emoji blocks
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x1f000 && codePoint <= 0x1f2ff) ||
    // Dingbats and misc symbols that commonly render double-width
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x2b00 && codePoint <= 0x2bff) ||
    // Enclosed alphanumerics (circled digits)
    (codePoint >= 0x2460 && codePoint <= 0x24ff) ||
    // CJK and fullwidth
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xff60) ||
    // Variation selector — makes the preceding glyph emoji-presentation
    codePoint === 0xfe0f
  );
}

const BORDER_START = /^[┌│├└]/;
const CLOSERS = new Set(['│', '┐', '┤', '┘']);

/** The frame portion of a line, ignoring any trailing `← annotation`. */
function framePart(line) {
  const chars = [...line.trimEnd()];
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    if (CLOSERS.has(chars[i])) return chars.slice(0, i + 1);
  }
  return null;
}

let frames = 0;
let checked = 0;
const problems = [];

for (const file of readdirSync(DOCS).filter((f) => f.endsWith('.md')).sort()) {
  const lines = readFileSync(join(DOCS, file), 'utf8').split('\n');
  let width = null;
  let openedAt = 0;

  lines.forEach((raw, index) => {
    const line = raw.trimEnd();

    if (/^┌─+┐$/.test(line)) {
      width = [...line].length;
      openedAt = index + 1;
      frames += 1;
      return;
    }

    if (width === null) return;

    if (!BORDER_START.test(line)) {
      width = null;
      return;
    }

    const frame = framePart(line);
    if (!frame) {
      width = null;
      return;
    }

    checked += 1;

    const ambiguous = frame.filter((c) => isAmbiguousWidth(c.codePointAt(0)));
    if (ambiguous.length > 0) {
      problems.push({
        file,
        line: index + 1,
        openedAt,
        kind: 'ambiguous-width',
        detail: `contains ${[...new Set(ambiguous)].join(' ')}`,
        text: line,
      });
    }

    if (frame.length !== width) {
      problems.push({
        file,
        line: index + 1,
        openedAt,
        kind: 'width',
        detail: `${frame.length} vs expected ${width}`,
        text: line,
      });
    }

    if (/^└─+┘$/.test(line)) width = null;
  });
}

for (const p of problems) {
  console.log(`${p.file}:${p.line}  [${p.kind}] ${p.detail}  (frame opened line ${p.openedAt})`);
  console.log(`    ${p.text}`);
}

console.log(
  `\n${frames} frames · ${checked} lines checked · ${problems.length} problem${problems.length === 1 ? '' : 's'}`,
);

process.exit(problems.length === 0 ? 0 : 1);
