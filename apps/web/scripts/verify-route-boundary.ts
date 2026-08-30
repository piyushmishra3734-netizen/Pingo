/**
 * Whether a broken build is recognised as one.
 *
 * The boundary has two outcomes and picking the wrong one is invisible from
 * the outside. Recognise a failed chunk and it clears the caches and reloads,
 * which is the repair. Fail to recognise it and it shows an error card on a
 * screen that would have worked perfectly after a reload - the white page
 * again, with prettier wallpaper.
 *
 * There is no error *type* to check for. Chrome, Safari and Firefox each throw
 * a plain Error with their own sentence, so the sentence is the whole signal,
 * and the sentences are what this pins down.
 *
 * Run with `pnpm verify:route-boundary`.
 */
import assert from 'node:assert/strict';

import { looksLikeMissingChunk } from '../src/components/RouteBoundary.js';

/* The real wording, per engine. These are the strings that must keep matching. */
const CHUNK_FAILURES = [
  // Chrome / Edge
  'Failed to fetch dynamically imported module: https://pingo.chat/assets/ProfileScreen-a1b2c3.js',
  // Firefox
  'error loading dynamically imported module',
  // Safari
  'Importing a module script failed.',
  // Webpack-era name, still thrown by some tooling
  'ChunkLoadError: Loading chunk 42 failed.',
  // A phone that lost signal mid-navigation
  'TypeError: Failed to fetch',
];

for (const message of CHUNK_FAILURES) {
  assert.ok(
    looksLikeMissingChunk(new Error(message)),
    `recognised as a stale build: ${message}`,
  );
}

/*
 * And the other half, which matters just as much. A component that throws on
 * this data will throw again after a reload, so treating it as a stale build
 * would spin the page instead of saying what happened - and the once-only guard
 * is the only thing standing between that and a loop.
 */
const REAL_BUGS = [
  "TypeError: Cannot read properties of undefined (reading 'displayName')",
  'RangeError: Maximum call stack size exceeded',
  'Invariant Violation: Rendered fewer hooks than expected',
];

for (const message of REAL_BUGS) {
  assert.ok(
    !looksLikeMissingChunk(new Error(message)),
    `not mistaken for a stale build: ${message}`,
  );
}

/* Non-Error throws happen. They must not crash the thing that handles crashes. */
assert.equal(looksLikeMissingChunk('some string'), false, 'a thrown string is handled');
assert.equal(looksLikeMissingChunk(undefined), false, 'and so is nothing at all');

console.log(`✓ ${CHUNK_FAILURES.length} stale-build messages recognised, ${REAL_BUGS.length} real bugs left alone`);
