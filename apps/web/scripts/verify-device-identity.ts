/**
 * The one thing this device must never do twice: make an identity.
 *
 * Every message anyone sends to this device is wrapped for the identity it had
 * at the time. Mint a second one and every message wrapped for the first is
 * unreadable for ever - and it does not read as a key problem, it reads as
 * "Sent before you added this device." appearing over a conversation somebody
 * has been reading for weeks, with nothing having changed. Which is exactly how
 * it was reported.
 *
 * `deviceIdentity` used to mint whenever `localGet` returned `undefined`, and
 * `withStore` returns `undefined` for a missing record, a failed transaction,
 * and a database that never opened. Those are not the same fact. This checks
 * the four shapes of "no identity here" and that only one of them is a new
 * device.
 *
 * Run with `pnpm verify:device-identity`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = await readFile(
  resolve(process.cwd(), 'apps/web/src/lib/crypto/keys.ts'),
  'utf8',
);

const fn = source.slice(source.indexOf('export async function deviceIdentity('));

/*
 * Both slots present is the only path that returns without minting, and the
 * only path that should.
 */
assert.match(fn, /if \(existing && existingId\)/, 'a complete identity is reused');

/*
 * A device that cannot read its keys mints new ones, and says so.
 *
 * This used to throw, and the throw is what took the product down. `openRow`
 * catches everything and writes the "Sent before you added this device"
 * placeholder, so a device that refused to mint could not read a single
 * message - not the history the refusal was protecting, and not the one that
 * arrived a second ago either. Every account except one went dark within hours
 * and no device published a key for six of them.
 *
 * A wrong identity loses old messages. No identity loses all of them plus every
 * future one. The mirror stays as evidence in a warning rather than as a gate.
 */
assert.ok(
  !/throw new IdentityUnavailableError/.test(fn),
  'an unreadable key store never refuses - it mints, because refusing reads as total data loss',
);
assert.match(fn, /const mirrored = readMirror\(\);/, 'the second store is still consulted');
assert.match(fn, /console\.warn\(/, 'and disagreement is reported rather than swallowed');

/* Minting must still be the last thing, after both slots have been checked. */
const mintAt = fn.indexOf('crypto.subtle.generateKey');
assert.ok(
  mintAt > fn.indexOf('const existing = await localGet') &&
    mintAt > fn.indexOf('if (existing && existingId)'),
  'a complete identity is still reused rather than replaced',
);

/* The mirror is written when one is minted, or it records nothing. */
assert.match(fn, /writeMirror\(deviceId\);/, 'a minted identity records itself');

/*
 * The two places that legitimately end an identity have to clear the mirror,
 * or the guard turns on the people it was meant to protect: a second account
 * signing in here, and a device that was revoked and is starting over. Both
 * are entitled to mint.
 */
const session = await readFile(
  resolve(process.cwd(), 'apps/web/src/lib/crypto/session.ts'),
  'utf8',
);
const switchFn = session.slice(
  session.indexOf('async function switchAccount('),
  session.indexOf('async function wipeRevokedDevice('),
);
assert.match(
  switchFn,
  /localStorage\.removeItem\(IDENTITY_MIRROR\)/,
  'an account with no parked keys gets no mirror either',
);
assert.match(
  switchFn,
  /localStorage\.setItem\(IDENTITY_MIRROR, restoredId\)/,
  'and a returning account gets its own back',
);
assert.match(
  session.slice(session.indexOf('async function wipeRevokedDevice(')),
  /localStorage\.removeItem\(IDENTITY_MIRROR\)/,
  'a revoked device may start over',
);

console.log('✓ one identity per device, and only a genuinely new device makes one');

/*
 * Layer 1: your own sends never decrypt.
 *
 * A message sealed before this device published carries no wrap for it, and
 * the author staring at the placeholder over their own words was the most
 * reported face of this bug. The plaintext is remembered at send time and
 * served back before any key is consulted, so this path cannot fail the way
 * decryption can.
 */
const openFn = session.slice(session.indexOf('export async function openRow('));
assert.match(
  openFn,
  /await ownText\(row\.id\)/,
  'openRow reads remembered plaintext before touching cryptography',
);
assert.match(
  openFn,
  /if \(mine !== undefined\) \{[\s\S]*?row\.body = mine;[\s\S]*?return true;[\s\S]*?\}/,
  'and a hit returns without decrypting',
);

/* The store it reads from exists, and dies with the account like the rest. */
const db = await readFile(resolve(process.cwd(), 'apps/web/src/lib/local/db.ts'), 'utf8');
assert.match(db, /sentText: 'sent-text'/, 'own sends have a store of their own');
assert.ok(
  (session.match(/STORE\.sentText/g) ?? []).length >= 2,
  'switch and wipe clear it with the other content stores',
);

/*
 * Layer 2: a failed publish is retried, never remembered.
 *
 * The old memo held the failed attempt: one hiccup at launch meant no publish
 * for the whole tab. And sealing awaited nothing, so messages sealed into the
 * gap missed their own author's wrap permanently.
 */
const publishFn = session.slice(
  session.indexOf('export function publishDeviceKey('),
  session.indexOf('async function attemptPublish('),
);
assert.match(publishFn, /published = undefined;/, 'failure resets the memo for a later retry');
assert.match(
  session,
  /PUBLISH_RETRY_MS = \[0, 800, 2000\]/,
  'launch hiccups get retries with backoff, not one swallowed attempt',
);
assert.match(
  publishFn,
  /deviceId !== publishedFor/,
  'an identity minted mid-session gets its own publish, not the old memo',
);
const sealFn = session.slice(session.indexOf('export async function sealBody('));
assert.ok(
  sealFn.indexOf('await publishDeviceKey(') < sealFn.indexOf('await conversationKeying('),
  'sealing waits for your own publish first - a later publish cannot add a wrap to an immutable envelope',
);

/*
 * The send path remembers, on sends and on edits alike.
 */
const service = await readFile(
  resolve(process.cwd(), 'apps/web/src/lib/supabase/chat-service.ts'),
  'utf8',
);
assert.match(
  service,
  /void rememberOwnText\(id, draft\.body\)/,
  'a sent message is remembered under the id its bubble already shows',
);
assert.match(
  service,
  /void rememberOwnText\(messageId, trimmed\)/,
  'an edit re-remembers, or the re-read decrypts stale wraps',
);

/*
 * The 250ms: warm on open, reuse only after proving nothing changed.
 *
 * A blind TTL would be faster and wrong - a device published inside it would
 * miss its wrap permanently, which is this bug in a speed costume. The cache
 * revalidates exact roster and device sets, so reuse is provably harmless.
 */
assert.match(
  session,
  /setsEqual\(memberIds, cached\.members\) && setsEqual\(deviceIds, cached\.deviceIds\)/,
  'keying reuse requires exact roster and device sets, never time alone',
);

/*
 * The thread warms the next send while the reader reads. Optional on the
 * interface so mocks never notice; called on every thread open.
 */
const core = await readFile(
  resolve(process.cwd(), 'packages/core/src/chat-service.ts'),
  'utf8',
);
assert.match(core, /warmThread\?\(conversationId: ConversationId\)/, 'warming is a declared, optional seam');
assert.match(
  service,
  /async warmThread\(conversationId: string\)/,
  'and the real service prefetches keying through it',
);
const thread = await readFile(
  resolve(process.cwd(), 'apps/web/src/features/chat/ChatThread.tsx'),
  'utf8',
);
assert.match(
  thread,
  /void service\.warmThread\?\.?\(conversation\.id\)/,
  'and opening a thread fires it',
);

/*
 * Failures are registered, and healing retries exactly those ids.
 *
 * A placeholder that can heal must be looked at again when the key state
 * moves - publish landing, account claimed, backfill adding wraps, thread
 * reopened. The registry is what remembers; without it a healed message
 * would sit behind its cached copy for ever.
 */
assert.match(
  session,
  /noteUnhealed\(row\.conversation_id, row\.id\)/,
  'every failed open registers its id',
);
assert.match(
  session,
  /export function takeUnhealedFor\(/,
  'and healing drains per conversation, never the world at once',
);
assert.match(
  service,
  /async #healConversation\(conversationId: string, messageIds: string\[\]\)/,
  'which refetches only noted ids, rewrites blob, rows and bubbles, and drops stale previews',
);
assert.match(
  service,
  /takeUnhealedFor\(conversationId\)/,
  'and opening a thread heals what it remembers',
);

/*
 * The backfill runs itself, bounded.
 *
 * The Sept-9 repair was a manual screen for two known accounts; the next key
 * replacement would strand the same way. So every device donates a capped
 * pass a day - idempotent, resumable - and heals itself afterwards.
 */
assert.match(
  service,
  /backfillAccountWraps\(this\.#client, \{ maxBatches: 2 \}\)/,
  'the daily pass is capped at two batches, not open-ended',
);
assert.match(
  service,
  /pingo:account-backfill-day/,
  'and gated to once a day per account, not once a launch',
);

console.log('✓ own sends skip decryption, publishes retry, keying revalidates');
