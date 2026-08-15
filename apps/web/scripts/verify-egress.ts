/**
 * The three rules that keep Pingo from re-sending what a device already has.
 *
 * Each of these was a measured bug, not a hypothetical:
 *
 * 1. The thread asked for a second page of history the instant it opened,
 *    because the synthetic first scroll check saw `scrollTop === 0` on an empty
 *    container and read it as "the reader has reached the top". 251 kB per
 *    conversation open.
 *
 * 2. Every read shipped the whole `envelope` - one wrapped content key per
 *    device that could ever open the message, 15.46 of them on average, where
 *    the reader needs exactly one. 95% of all message row bytes.
 *
 * 3. A page containing a permanently-unreadable message was refused by the
 *    cache for ever, so the conversation had no local copy and no sync cursor,
 *    and every open fetched two full pages from the network.
 *
 * All three are pure decisions, so all three are asserted here rather than
 * left to be re-measured in a browser after the fact.
 *
 * Run with `pnpm verify:egress`.
 */
import assert from 'node:assert/strict';

import { bumpedRow, shouldLoadOlder, trimEnvelopeKeys, shouldTrustCache } from '../src/lib/egress-rules.js';

// -- 1. Older history is only fetched from a real scroll, at a real top ------

// The open: a container that has not been scrolled and has nothing in it yet.
assert.equal(
  shouldLoadOlder({ fromScroll: false, scrollTop: 0, scrollHeight: 0, clientHeight: 800 }),
  false,
  'opening a thread must not fetch a second page',
);

// Still no, even once content is there - opening is not scrolling.
assert.equal(
  shouldLoadOlder({ fromScroll: false, scrollTop: 0, scrollHeight: 5000, clientHeight: 800 }),
  false,
);

// A real scroll to the top of real history is the one case that asks.
assert.equal(
  shouldLoadOlder({ fromScroll: true, scrollTop: 10, scrollHeight: 5000, clientHeight: 800 }),
  true,
);

// Scrolled, but nowhere near the top.
assert.equal(
  shouldLoadOlder({ fromScroll: true, scrollTop: 3000, scrollHeight: 5000, clientHeight: 800 }),
  false,
);

// A thread shorter than its own viewport sits at 0 for ever and must never ask.
assert.equal(
  shouldLoadOlder({ fromScroll: true, scrollTop: 0, scrollHeight: 400, clientHeight: 800 }),
  false,
  'a thread with no scrollback must not ask for more',
);

// -- 2. An envelope carries one key, not everybody's ------------------------

const envelope = {
  epk: 'EPK',
  iv: 'IV',
  keys: { 'device-a': 'wrap-a', 'device-b': 'wrap-b', 'device-c': 'wrap-c' },
};

const mine = trimEnvelopeKeys(envelope, 'device-b');
assert.deepEqual(mine, { epk: 'EPK', iv: 'IV', keys: { 'device-b': 'wrap-b' } });
assert.equal(Object.keys(mine!.keys).length, 1, 'exactly one wrapped key may be sent');

// The parts that are not addressed to anybody survive untouched - without the
// ephemeral public key and the iv the one remaining wrap cannot be opened.
assert.equal(mine!.epk, envelope.epk);
assert.equal(mine!.iv, envelope.iv);

// A device the message was never wrapped for gets a well-formed envelope with
// nothing in it, so the client reports "sent before you added this device"
// rather than failing to parse.
assert.deepEqual(trimEnvelopeKeys(envelope, 'device-z')!.keys, {});

// Plaintext messages - system notices, AI threads - have no envelope at all.
assert.equal(trimEnvelopeKeys(undefined, 'device-a'), undefined);

// -- 3. A permanent placeholder poisons the cache once, not for ever --------

// First sight of an unreadable message: refuse the cache and spend the refetch.
assert.equal(shouldTrustCache({ hasPlaceholder: true, alreadyRetried: false }), false);

// Having spent it, the page is accepted - no amount of refetching can invent a
// wrapped key that was never created for this device.
assert.equal(
  shouldTrustCache({ hasPlaceholder: true, alreadyRetried: true }),
  true,
  'a permanently unreadable message must not disable the local copy for ever',
);

// A clean page is trusted immediately, retried or not.
assert.equal(shouldTrustCache({ hasPlaceholder: false, alreadyRetried: false }), true);
assert.equal(shouldTrustCache({ hasPlaceholder: false, alreadyRetried: true }), true);

console.log('egress rules: ok');

// -- 4. A realtime message patches its row, it does not rebuild it ----------

const row = { id: 'c1', unreadCount: 2, updatedAt: 100, title: 'Chichora gang' };

const theirs = bumpedRow(row, { createdAt: 500 }, false);
assert.equal(theirs!.unreadCount, 3, 'somebody else writing raises the unread count');
assert.equal(theirs!.updatedAt, 500, 'and moves the conversation up the list');
assert.equal(theirs!.title, 'Chichora gang', 'everything a message does not change survives');

const own = bumpedRow(row, { createdAt: 500 }, true);
assert.equal(own!.unreadCount, 2, 'your own message is not unread to you');

// The one case that still has to ask the server: a conversation never loaded.
assert.equal(bumpedRow(undefined, { createdAt: 500 }, false), undefined);

// The original is untouched, so a patch cannot corrupt the row it came from.
assert.equal(row.unreadCount, 2);

console.log('realtime patch rule: ok');
