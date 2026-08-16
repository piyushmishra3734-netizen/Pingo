/**
 * What a message costs before it reaches the screen.
 *
 * Sending a line of text used to wait on a chain of sequential requests - is
 * this an AI thread, then the whole conversation with its members and previews
 * and streaks, then the roster again for keys, then everybody's keys, then the
 * insert - and nothing appeared until the last one came back. Each link is a
 * round trip, and on a slow connection each round trip is a second. That is the
 * whole of why chatting felt slow.
 *
 * None of it fails loudly when it comes back. A re-added `await` is invisible
 * on a fast connection and is the difference between usable and not on 2G, so
 * the shape of this path is asserted rather than left to be noticed.
 *
 * Run with `pnpm verify:send-speed`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const service = await readFile(
  // Run from the repo root - see the `verify:send-speed` script.
  resolve(process.cwd(), 'apps/web/src/lib/supabase/chat-service.ts'),
  'utf8',
);

const sendNow = service.slice(
  service.indexOf('async #sendNow('),
  service.indexOf('async #isAiConversation('),
);
assert.ok(sendNow.length > 0, '#sendNow still exists');

// -- The bubble is on screen before the network is involved ----------------

const beforeInsert = sendNow.slice(0, sendNow.indexOf(".from('messages')"));
assert.match(
  beforeInsert,
  /type: 'message:new'/,
  'the message is emitted before the insert, or the sender waits on the network ' +
    'to see their own words',
);
assert.match(
  sendNow,
  /const id = existingId \?\? crypto\.randomUUID\(\)/,
  'the id is generated here - or reused from the queue - so the row the server ' +
    'writes is the bubble already shown',
);
// `\s` rather than `\n` between the lines: this file is checked out with CRLF
// on Windows, and a pattern that insists on a bare newline matches nothing.
assert.match(
  sendNow,
  /\bid,\s+conversation_id: draft\.conversationId/,
  'and that id is what the insert uses - otherwise there are two messages to reconcile',
);

// -- The heavy read is conditional, not unconditional ----------------------

/*
 * `getConversation` hydrates members, previews, streaks and profiles. It ran on
 * every send. It is only needed when the body mentions the assistant, because
 * that is the only thing it can change - whether a *group* message goes in the
 * clear.
 */
assert.match(
  beforeInsert,
  /mentioned && !isAi \? await this\.getConversation\(/,
  'the conversation is only fetched when a mention could change the answer',
);

// -- Housekeeping does not hold the send open ------------------------------

const afterInsert = sendNow.slice(sendNow.indexOf('#releaseUploadClaims'));
/*
 * Asserted as the shape that detaches them, not as the absence of `await` -
 * both still await *inside* a detached task, and a test that only looked for
 * the word would pass for code that had gone back to blocking.
 */
assert.match(
  afterInsert,
  /void \(async \(\) => \{[\s\S]{0,400}?mark_conversation_read/,
  'publishing the read cursor is detached from the send',
);
assert.match(
  afterInsert,
  /void this\.getConversation\(draft\.conversationId\)\s*\.then/,
  'refreshing the chat-list row is detached from the send',
);

// -- "Not an AI thread" is remembered, not re-asked ------------------------

const isAiConversation = service.slice(
  service.indexOf('async #isAiConversation('),
  service.indexOf('async #resolveMentionedUserIds('),
);
assert.match(
  isAiConversation,
  /#nonAiConversationIds\.has\(conversationId\)\) return false/,
  'the negative answer is cached too - otherwise every message in every ordinary ' +
    'conversation pays a round trip to be told no again',
);
assert.match(
  isAiConversation,
  /if \(error \|\| !data\) return false;/,
  'a failed read is not cached as an answer',
);

// -- Sealing does not re-read the same keys for every line -----------------

const session = await readFile(
  resolve(process.cwd(), 'apps/web/src/lib/crypto/session.ts'),
  'utf8',
);
assert.match(
  session,
  /Date\.now\(\) - pending\.at < KEYING_COALESCE_MS\) return pending\.work/,
  'a burst of messages shares one keying read',
);
/*
 * And the window stays short. Cached keys are a correctness question: seal
 * against a stale roster and a device that joined a moment ago can never read
 * that message. A second only merges sends that were already in flight.
 */
const window = /const KEYING_COALESCE_MS = (\d+)/.exec(session);
assert.ok(window, 'the coalescing window is stated');
assert.ok(
  Number(window[1]) <= 2000,
  'keys must not be cached long enough for a new device to miss a message',
);

// -- Everything gets a bubble, not just text -------------------------------

/*
 * A photo, a voice note and a file all have to be uploaded before the server
 * knows anything about them - seconds on a slow line - and the bubble used to
 * wait for the upload *and* the insert. The bytes are on the device already:
 * an object URL is the exact picture being sent, and a voice note's waveform
 * and duration were measured before `sendMessage` was called.
 */
for (const [what, needle] of [
  ['voice note', /kind: 'audio' as const,\s+url: preview\(draft\.voice\.audio\)/],
  ['file', /kind: 'file' as const,\s+url: preview\(draft\.document\.file\)/],
  ['photo', /photo: \{\s+url: preview\(draft\.photo\.image\)/],
  ['sticker', /draft\.sticker \? \{ sticker: draft\.sticker \}/],
] as const) {
  assert.match(beforeInsert, needle, `${what} shows itself while it uploads`);
}

/*
 * A Ping is the exception and has to stay one: `PingRef` carries no URL at all,
 * because the image only ever comes back through `open_ping` and that is what
 * makes the view limit real. Handing the sender a local URL here would be the
 * one bubble in the app whose picture the limit does not govern.
 */
assert.ok(
  !/ping: \{[\s\S]{0,200}?url:/.test(beforeInsert),
  'a Ping gets its cover, never a preview URL - the limit is the point',
);

// The object URLs are handed back, or a thread full of sent photos pins every
// one of their blobs in memory for the life of the tab.
assert.match(sendNow, /URL\.revokeObjectURL\(url\)/, 'previews are revoked after the swap');

// -- A dropped connection is not a failed message --------------------------

/*
 * On a weak signal requests time out, and that used to mark the message
 * `failed` - so on 2G most sends died and had to be noticed and repeated. A
 * refusal from Postgres carries a `code` and will happen again; everything else
 * is the network, and the network comes back.
 */
assert.match(
  sendNow,
  /const serverRefused = Boolean\(\(error as \{ code\?: string \}\)\.code\)/,
  'a server refusal is told apart from a connection giving out',
);
assert.match(
  sendNow,
  /if \(!serverRefused && !hasMediaDraft\(draft\) && !existingId\) \{\s+await enqueue\(draft, id\)/,
  'a network failure queues the message under the id already on screen',
);

/*
 * And the id survives the queue. Without this the flushed send invents a new
 * one, the row that arrives is a different message as far as the thread is
 * concerned, and the sender watches their message appear twice.
 */
const outbox = await readFile(
  resolve(process.cwd(), 'apps/web/src/lib/local/outbox.ts'),
  'utf8',
);
assert.match(
  outbox,
  /send: \(draft: OutgoingMessage, id: string\) => Promise<unknown>/,
  'flush hands the entry id to the send',
);
assert.match(outbox, /await send\(entry\.draft, entry\.id\)/, 'and actually passes it');

// -- What has to arrive before the chat list can be drawn ------------------

/*
 * Every screen was imported statically, so all fifty-five of them - settings,
 * camera, stories, backup, the legal pages - were in one chunk that had to
 * download before anything appeared. And the LiveKit client came with them, so
 * somebody opening PINGO to read a message first downloaded an entire WebRTC
 * stack whether or not they ever placed a call.
 *
 * Both are one static import away from coming back, and neither would show up
 * as anything but "the app feels slow again".
 */
const callService = await readFile(
  resolve(process.cwd(), 'apps/web/src/lib/supabase/call-service.ts'),
  'utf8',
);
assert.match(
  callService,
  /import type \{ CallRoom \} from '\.\.\/livekit\/room\.js'/,
  'the call transport is a type here - a value import puts livekit-client on the ' +
    'startup path for people who never call',
);
assert.match(
  callService,
  /await import\('\.\.\/livekit\/room\.js'\)/,
  'and it is fetched when a call actually needs it',
);

const app = await readFile(resolve(process.cwd(), 'apps/web/src/App.tsx'), 'utf8');

/*
 * Four screens stay eager, and they are the whole of what a returning user
 * sees. Everything else is fetched on the way to it.
 */
const eager = [...app.matchAll(/^import \{ (\w+Screen) \} from '\.\/screens\//gm)].map(
  (m) => m[1],
);
assert.deepEqual(
  eager.sort(),
  ['ChatsScreen', 'IntroSlidesScreen', 'OnboardingScreen', 'SplashScreen'],
  'only the first-paint screens are imported eagerly',
);

const lazyCount = (app.match(/lazyScreen\(\(\) => import\(/g) ?? []).length;
assert.ok(lazyCount > 40, `every other screen is lazy - found ${lazyCount}`);
assert.match(app, /<Suspense fallback=\{null\}>/, 'and there is a boundary to render them into');

console.log('send speed: ok');
