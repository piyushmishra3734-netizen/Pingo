/**
 * Cross-reference checker for docs/.
 *
 * Verifies that every relative link between documents resolves, and that every
 * `#anchor` matches a real heading using GitHub's slug rules — lowercase, strip
 * punctuation, then one hyphen per space (so "9. Security" becomes "9-security"
 * and "Step 4 — Emergency" becomes "step-4--emergency").
 *
 * Run: node docs/.check-links.mjs
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = dirname(fileURLToPath(import.meta.url));

function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    // One hyphen per space. GitHub does not collapse runs, which is why
    // em-dash headings produce a double hyphen.
    .replace(/ /g, '-');
}

const files = readdirSync(DOCS).filter((f) => f.endsWith('.md')).sort();
const anchors = new Map();

for (const file of files) {
  const set = new Set();
  // trimEnd() per line, so CRLF checkouts do not produce phantom slugs.
  for (const raw of readFileSync(join(DOCS, file), 'utf8').split('\n')) {
    const match = raw.trimEnd().match(/^#{1,6}\s+(.*)$/);
    if (match) set.add(slug(match[1]));
  }
  anchors.set(file, set);
}

let fileLinks = 0;
let anchorLinks = 0;
const problems = [];

for (const file of files) {
  const text = readFileSync(join(DOCS, file), 'utf8');

  for (const [, target] of text.matchAll(/\(\.\/([0-9A-Za-z._-]+\.md)\)/g)) {
    fileLinks += 1;
    if (!existsSync(join(DOCS, target))) {
      problems.push(`${file}: missing file ${target}`);
    }
  }

  for (const [, target, anchor] of text.matchAll(
    /\((?:\.\/([0-9A-Za-z._-]+\.md))?#([\w-]+)\)/g,
  )) {
    anchorLinks += 1;
    const inFile = target ?? file;
    if (!anchors.has(inFile)) problems.push(`${file}: unknown file ${inFile}`);
    else if (!anchors.get(inFile).has(anchor)) {
      problems.push(`${file}: #${anchor} not found in ${inFile}`);
    }
  }
}

for (const p of problems) console.log(p);
console.log(
  `\n${files.length} docs · ${fileLinks} file links · ${anchorLinks} anchor links · ${problems.length} broken`,
);

process.exit(problems.length === 0 ? 0 : 1);
