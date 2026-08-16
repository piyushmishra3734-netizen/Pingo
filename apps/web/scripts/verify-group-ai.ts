/**
 * When a group message leaves this device unencrypted, and when it must not.
 *
 * This is the one rule in PINGO where encryption is deliberately skipped, so it
 * is the one that has to be pinned down. A group message is sealed unless it
 * @mentions an assistant that is *in the room* - both halves matter, and the
 * dangerous failure is the second one silently becoming "always".
 *
 * Run with `pnpm verify:group-ai`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { mentionsPingoAi } from '../src/features/ai/ai-mentions.js';

// -- What counts as calling the assistant -----------------------------------

assert.equal(mentionsPingoAi('@pingoai what is this'), true);
assert.equal(mentionsPingoAi('@pingo_ai what is this'), true);
assert.equal(mentionsPingoAi('hey @PingoAI'), true, 'case does not matter');

// The ones that must stay sealed. Somebody talking *about* the assistant is not
// talking *to* it, and their message is nobody else's to read.
assert.equal(mentionsPingoAi('pingoai is useless'), false, 'no @, no mention');
assert.equal(mentionsPingoAi('ask @pingoaibot instead'), false, 'a longer handle is not it');
assert.equal(mentionsPingoAi('my bank pin is 4021'), false);
assert.equal(mentionsPingoAi(''), false);

// -- Both halves of the plaintext rule, in the code that applies it ---------

const service = await readFile(
  // Run from the repo root - see the `verify:group-ai` script.
  resolve(process.cwd(), 'apps/web/src/lib/supabase/chat-service.ts'),
  'utf8',
);

/*
 * `callAiInGroup` has to be the conjunction. If it ever became just
 * `mentionsPingoAi(...)`, a group that had turned the assistant off would still
 * send every @pingoai message in the clear to a server with nothing there to
 * read it - the worst possible version of this bug, because the feature would
 * look switched off.
 */
assert.match(
  service,
  /const callAiInGroup = groupHasAi && mentionsPingoAi\(draft\.body\)/,
  'plaintext needs the assistant to be in the group AND to be mentioned',
);

// And `groupHasAi` is read from membership, which is what the toggle changes.
assert.match(
  service,
  /participantIds\.includes\(PINGO_AI_USER_ID\)/,
  'membership is the switch - see set_group_ai',
);

// Sealing is still the default: the plaintext branch is the exception.
assert.match(
  service,
  /const sealed = plaintextForAi\s*\n?\s*\?\s*\{ body: draft\.body/,
  'the unencrypted path is the branch, not the fallthrough',
);

// -- The one-way door is gone ----------------------------------------------

/*
 * `add_pingo_ai_to_group` could only add. Every group got the assistant in a
 * bulk insert and there was no way to take it out of one of them, which is how
 * a default nobody chose becomes permanent.
 */
assert.ok(
  !service.includes('add_pingo_ai_to_group'),
  'the add-only RPC is replaced by set_group_ai, which goes both ways',
);
assert.match(service, /rpc\('set_group_ai'/, 'and the two-way one is what is called');

console.log('group ai: ok');
