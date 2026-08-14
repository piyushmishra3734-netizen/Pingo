/**
 * In-thread search, checked as ordering rather than as opinion.
 *
 * The bar itself is an input and two arrows. What can actually be wrong is
 * which messages a term hits, the direction the matches are walked in, and
 * what the arrows do at either end — all pure, all here.
 *
 * Run with `pnpm verify:thread-search`.
 */
import assert from 'node:assert/strict';

import { searchMatches, stepMatch } from '../src/features/chat/search-matches.js';

const thread = [
  { id: 'a', body: 'Meet me at the station' },
  { id: 'b', body: 'Bringing the tickets' },
  { id: 'c', body: 'STATION is closed, use the bus' },
  { id: 'd', body: '' },
];

// Newest first: 'c' is later in the thread than 'a', so it is offered first.
assert.deepEqual(searchMatches(thread, 'station'), ['c', 'a']);

// Case and surrounding whitespace are not part of what somebody meant to type.
assert.deepEqual(searchMatches(thread, '  STATION '), ['c', 'a']);

// A blank term is not a search for everything.
assert.deepEqual(searchMatches(thread, ''), []);
assert.deepEqual(searchMatches(thread, '   '), []);

// Empty bodies (media, tombstones) never match.
assert.deepEqual(searchMatches(thread, 'tickets'), ['b']);

// Wrapping, in both directions, and no divide-by-zero with nothing found.
assert.equal(stepMatch(0, 1, 2), 1);
assert.equal(stepMatch(1, 1, 2), 0);
assert.equal(stepMatch(0, -1, 2), 1);
assert.equal(stepMatch(0, -1, 0), 0);
assert.equal(stepMatch(0, 1, 0), 0);

console.log('thread search: ok');
