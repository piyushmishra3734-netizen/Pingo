/**
 * The in-call chat, and the two things about it that are easy to get wrong.
 *
 * It is not a conversation message: it is never written to the thread, and it
 * does not survive the call. And the unread count is what makes the panel
 * worth closing - a badge that counted your own lines would sit on `1` from the
 * moment you typed anything.
 *
 * Run with `pnpm verify:call-chat`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { countUnread, trimCallChat } from '../src/features/calls/call-chat-rules.js';

// -- The badge counts what somebody else said, since you last looked --------

const lines = [
  { id: 'a', userId: 'me', body: 'hi', sentAt: 1 },
  { id: 'b', userId: 'them', body: 'go back a slide', sentAt: 2 },
  { id: 'c', userId: 'them', body: 'there', sentAt: 3 },
];

assert.equal(countUnread(lines, 0, 'me'), 2, 'only the other person’s lines are unread');
assert.equal(countUnread(lines, 2, 'me'), 1, 'seen up to the mark, one left');
assert.equal(countUnread(lines, 3, 'me'), 0, 'all seen');

// Your own line must never light the badge - you were there when you typed it.
assert.equal(
  countUnread([{ id: 'd', userId: 'me', body: 'ok', sentAt: 4 }], 0, 'me'),
  0,
  'your own line is not unread',
);

// A mark past the end is not a negative count.
assert.equal(countUnread(lines, 99, 'me'), 0);

// -- A line is trimmed and bounded before it is sent ------------------------

assert.equal(trimCallChat('  hello  '), 'hello');
assert.equal(trimCallChat('   '), '', 'whitespace alone is nothing to send');
assert.equal(trimCallChat(''), '');
assert.equal(
  trimCallChat('x'.repeat(900)).length,
  500,
  'a pasted wall of text is cut, not carried over the signalling channel',
);

// -- It is never written to the thread -------------------------------------

/*
 * A source check. The whole promise of this feature is that a meeting chat does
 * not turn into a permanent transcript in the middle of a real conversation,
 * and the way that promise breaks is somebody reaching for `sendMessage`
 * because it is right there. `sendCallChat` sends signals and nothing else.
 */
const service = await readFile(
  // Run from the repo root - see the `verify:call-chat` script.
  resolve(process.cwd(), 'apps/web/src/lib/supabase/call-service.ts'),
  'utf8',
);

const start = service.indexOf('async sendCallChat(');
assert.notEqual(start, -1, 'sendCallChat still exists');
const rest = service.slice(start);
const end = rest.search(/\n {2}(?:async |#|\/\*\*)/);
const body = end === -1 ? rest : rest.slice(0, end);

for (const forbidden of ['sendMessage', 'from(', 'insert(']) {
  assert.ok(
    !body.includes(forbidden),
    `call chat must not reach the database - found ${forbidden}`,
  );
}
assert.ok(body.includes('#send('), 'it goes over the signalling channel');

console.log('call chat: ok');
