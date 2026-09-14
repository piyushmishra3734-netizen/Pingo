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
 * Normal chats are stored as sent (the normal/private split, phase 1): no
 * send or edit seals, and an edit clears the envelope an older sealed message
 * carried. The own-text store above still serves messages sealed before that.
 */
const service = await readFile(
  resolve(process.cwd(), 'apps/web/src/lib/supabase/chat-service.ts'),
  'utf8',
);
assert.match(
  service,
  /const sealed = \{ body: draft\.body, encryption: null/,
  'a normal send is stored as sent',
);
assert.match(
  service,
  /new_encryption: null,\s*new_envelope: null/,
  'an edit clears any envelope, so it never describes a body it no longer holds',
);
assert.doesNotMatch(service, /sealBody\(/, 'nothing in the chat service seals a normal message');

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
 * The backfill does not run itself.
 *
 * It did, and `account_wrap_candidates` timed out on every call (9 s, 500)
 * while a failed pass never stamped its day - so it retried on every
 * `#userId()` and held the database up. Settings > Restore history runs it by
 * hand; new messages are not sealed since the normal/private split.
 */
assert.doesNotMatch(
  service,
  /backfillAccountWraps\(/,
  'the chat service never runs the account-wrap backfill on its own',
);

/*
 * Session start runs once per account per page, not on every `#userId()`.
 */
assert.match(
  service,
  /if \(this\.#startedFor !== id\) \{\s*this\.#startedFor = id;\s*this\.#startSession\(id\);/,
  'publish, adopt and the rest start once per session',
);

console.log('✓ own sends skip decryption, publishes retry, keying revalidates');

/*
 * The local database opens at whatever version is on disk.
 *
 * It opened at a constant (5) while its own upgrade path took devices to 6,
 * and from then on every open was a VersionError: no cache, no stored keys,
 * and a new device identity minted on every call. Asking for no version
 * cannot be lower than what exists.
 */
const dbSource = await readFile(resolve(process.cwd(), 'apps/web/src/lib/local/db.ts'), 'utf8');
assert.match(dbSource, /const db = await openAt\(\);/, 'the local database opens at the version on disk');
// Code, not prose: the comment in openDatabase names the old constant on purpose.
assert.doesNotMatch(
  dbSource,
  /const DB_VERSION|openAt\(DB_VERSION\)/,
  'no constant can ask for a version below the one on disk',
);
assert.match(dbSource, /db\.onversionchange = /, 'an open tab lets another tab upgrade');
console.log('✓ the local database opens at any version on disk, and steps aside for upgrades');

/*
 * Second-pass latency fixes. Each was measured, not guessed.
 */
const readSource = (path: string) => readFile(resolve(process.cwd(), path), 'utf8');

// Mute and friends: 3.8 s before the row moved, because the write was followed
// by a full rebuild from the server. The flag now shows first, and rolls back.
const flagsStart = service.indexOf('async setConversationFlags(');
const flags = service.slice(flagsStart, service.indexOf('#withFlags(conversation', flagsStart));
assert.ok(
  flags.indexOf("type: 'conversation:updated'") < flags.indexOf('await this.#writeMembership('),
  'a flag change reaches the screen before its write is awaited',
);
assert.match(flags, /catch \(cause\) \{[\s\S]*this\.#known\.set\(known\.id, known\)[\s\S]*throw cause;/, 'a failed flag write puts the row back');
assert.doesNotMatch(flags, /await this\.#refresh\(conversationIds\)/, 'a known conversation is not rebuilt after a flag change');

// A never-opened thread paints before its reactions query answers.
assert.ok(
  service.indexOf('options.onEarly(') < service.indexOf('const reactions = await reactionsRead;'),
  'the early page is handed over before reactions are awaited',
);

// Coming back to a chat starts from what it showed, not from the skeleton.
const useMessagesSource = await readSource('packages/core/src/react/use-messages.ts');
assert.match(useMessagesSource, /const lastShown = new Map/, 'threads remember what they showed');
assert.match(useMessagesSource, /useState\(\(\) => !\(shownKey && lastShown\.has\(shownKey\)\)\)/, 'a remembered thread mounts without loading');

// Returning to Chats does not repeat once-per-session work.
const journeySource = await readSource('apps/web/src/features/journey/useJourneyProgress.ts');
assert.match(journeySource, /^const seededFor = new Set/m, 'the published journey is read once per tab');
assert.match(journeySource, /^const lastPublishedFor = new Map/m, 'the same journey summary is published once per tab');
const listSource = await readSource('apps/web/src/features/conversations/ConversationList.tsx');
assert.match(listSource, /^const ensuredAi = new WeakSet/m, 'PINGO AI is ensured once per service, not per mount');
console.log('✓ flags are optimistic, first paint skips reactions, returns skip the skeleton and repeat work');

/*
 * Switching accounts: the switcher names people by their profile, and a token
 * refresh (which only knows the sign-in email) does not undo that.
 */
const stored = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
};
const saved = await import('../src/lib/supabase/accounts.js');
const tokens = { accessToken: 'a1', refreshToken: 'r1' };
saved.remember({ userId: 'u1', name: 'me@example.com', handle: 'me@example.com', ...tokens });
saved.setSavedProfile('u1', { name: 'Piyush', handle: '@piyush' });
saved.remember({ userId: 'u1', name: 'me@example.com', handle: 'me@example.com', accessToken: 'a2', refreshToken: 'r2' });
const [one] = saved.savedAccounts();
assert.equal(one?.name, 'Piyush', 'a refresh keeps the profile name');
assert.equal(one?.handle, '@piyush', 'a refresh keeps the @username');
assert.equal(one?.refreshToken, 'r2', 'a refresh still stores the new token');
saved.setSavedProfile('nobody', { name: 'X', handle: '@x' });
assert.equal(saved.savedAccounts().length, 1, 'naming an unsaved account adds nothing');

// A session that changed hands under the shell reloads rather than showing the last account's chats.
const shellSource = await readSource('apps/web/src/app/AppShell.tsx');
assert.match(shellSource, /currentUser\.id !== signedInAs/, 'the shell notices another account signed in');
assert.match(shellSource, /if \(staleAccount\) window\.location\.assign\('\/chats'\)/, 'and reloads into it');
console.log('✓ switched accounts reload into their own chats, and show their PINGO name');

// A message's `last_message_at` bump on its conversation row is not a reason to
// re-read the whole conversation: the message event already moved the list row.
assert.match(
  service,
  /payload\.eventType === 'UPDATE' &&\s*this\.#onlyActivityMoved\(payload\.new as ConversationRow\)\s*\)\s*\{\s*return;\s*\}\s*void this\.#announce\(row\.id\);/,
  'a conversation row that only moved last_message_at does not trigger a rebuild',
);
assert.match(service, /key === 'last_message_at' \|\|/, 'only last_message_at is treated as activity');
console.log('✓ message bumps on the conversation row no longer rebuild the conversation');
