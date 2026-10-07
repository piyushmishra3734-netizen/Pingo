/**
 * Whether a broken build is recognised as one, and retried before it is reloaded.
 *
 * The boundary has two outcomes and picking the wrong one is invisible from
 * the outside. Recognise a failed chunk and it heals the caches and reloads,
 * which is the repair. Fail to recognise it and it shows an error card on a
 * screen that would have worked after a reload. Recognise too much - every
 * offline `fetch()` - and a screen that threw on its data is reloaded three
 * times for nothing and then hidden behind "did not open".
 *
 * There is no error *type* to check for. Chrome, Safari and Firefox each throw
 * a plain Error with their own sentence, so the sentence is the whole signal,
 * and the sentences are what this pins down. The retry is checked with a fake
 * importer, so no network is involved.
 *
 * Run with `pnpm verify:route-boundary`.
 */
import assert from 'node:assert/strict';

import { chunkUrlFrom, importWithRetry, looksLikeMissingChunk } from '../src/lib/chunk-recovery.js';

/* The real wording, per engine. These are the strings that must keep matching. */
const CHUNK_FAILURES = [
  // Chrome / Edge (also what Chrome says offline mid-navigation)
  'Failed to fetch dynamically imported module: https://pingo.chat/assets/ProfileScreen-a1b2c3.js',
  // Firefox
  'error loading dynamically imported module',
  // Safari
  'Importing a module script failed.',
  // Webpack-era name, and the name importWithRetry gives a failure it retried
  'ChunkLoadError: Loading chunk 42 failed.',
  // Vite's own preload helper, when a screen's stylesheet comes back as HTML
  'Unable to preload CSS for /assets/SettingsScreen-x1y2.css',
];

for (const message of CHUNK_FAILURES) {
  assert.ok(looksLikeMissingChunk(new Error(message)), `recognised as a stale build: ${message}`);
}

/*
 * And the other half, which matters just as much. A component that throws on
 * this data will throw again after a reload. A plain fetch failure is a
 * network call, not a module: it used to match, and that is how real errors
 * got three pointless reloads and then the wrong page.
 */
const REAL_BUGS = [
  "TypeError: Cannot read properties of undefined (reading 'displayName')",
  'RangeError: Maximum call stack size exceeded',
  'Invariant Violation: Rendered fewer hooks than expected',
  'TypeError: Failed to fetch',
  'NetworkError when attempting to fetch resource.',
];

for (const message of REAL_BUGS) {
  assert.ok(!looksLikeMissingChunk(new Error(message)), `not mistaken for a stale build: ${message}`);
}

/* Non-Error throws happen. They must not crash the thing that handles crashes. */
assert.equal(looksLikeMissingChunk('some string'), false, 'a thrown string is handled');
assert.equal(looksLikeMissingChunk(undefined), false, 'and so is nothing at all');

/* The URL a retry renames, from each engine's sentence. */
const base = 'https://pingochat.xyz/chats';
assert.equal(
  chunkUrlFrom(new Error(CHUNK_FAILURES[0]), base),
  'https://pingo.chat/assets/ProfileScreen-a1b2c3.js',
  'Chrome names the chunk',
);
assert.equal(
  chunkUrlFrom(new Error('error loading dynamically imported module: https://pingochat.xyz/assets/A-1.js'), base),
  'https://pingochat.xyz/assets/A-1.js',
  'Firefox names the chunk',
);
assert.equal(
  chunkUrlFrom(new Error(CHUNK_FAILURES[4]), base),
  'https://pingochat.xyz/assets/SettingsScreen-x1y2.css',
  'a relative stylesheet is resolved',
);
assert.equal(chunkUrlFrom(new Error('Importing a module script failed.'), base), undefined, 'Safari names none');

const chromeFailure = () => Promise.reject(new Error(CHUNK_FAILURES[0]));

/* A chunk that fails once comes back from a renamed URL, with no reload. */
{
  const asked: string[] = [];
  const module = await importWithRetry(chromeFailure, async (url) => {
    asked.push(url);
    return { Screen: 'ok' };
  });
  assert.deepEqual(module, { Screen: 'ok' }, 'the retried module is returned');
  assert.equal(asked.length, 1, 'one retry was enough');
  assert.match(asked[0]!, /^https:\/\/pingo\.chat\/assets\/ProfileScreen-a1b2c3\.js\?retry=\d+$/, 'with a cache-busting query');
}

/* Still missing: two retries, then a ChunkLoadError for the boundary to reload on. */
{
  let tries = 0;
  const error = await importWithRetry(chromeFailure, async () => {
    tries += 1;
    throw new Error(CHUNK_FAILURES[0]);
  }).catch((e: unknown) => e);
  assert.equal(tries, 2, 'retried twice');
  assert.ok(error instanceof Error && error.name === 'ChunkLoadError', 'marked as a chunk failure');
  assert.ok(looksLikeMissingChunk(error), 'which the boundary recognises');
}

/* A screen that threw is not retried and keeps its own error. */
{
  let tries = 0;
  const bug = new TypeError("Cannot read properties of undefined (reading 'x')");
  const error = await importWithRetry(
    () => Promise.reject(bug),
    async () => {
      tries += 1;
    },
  ).catch((e: unknown) => e);
  assert.equal(tries, 0, 'no retry for a real bug');
  assert.equal(error, bug, 'the original error goes up untouched');
}

console.log(
  `✓ ${CHUNK_FAILURES.length} stale-build messages recognised, ${REAL_BUGS.length} other errors left alone, retry renames the chunk`,
);
