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
  /const id = crypto\.randomUUID\(\)/,
  'the id is generated here, so the row the server writes is the bubble already shown',
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

console.log('send speed: ok');
