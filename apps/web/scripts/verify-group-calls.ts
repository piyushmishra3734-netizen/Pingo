/**
 * What a group call is, as far as the history and the thread are concerned.
 *
 * A room has no single other party. That one fact decides four things that were
 * each wrong in a different way:
 *
 *   - the call history labelled every group call `Design Team`, a fixture name
 *     left in from the mock, because it had nothing else to fall back to;
 *   - an *incoming* group entry read `sender_id` as "the other person", so the
 *     history showed whoever started the call where the room belongs;
 *   - a live room is logged with an outcome that is not an outcome, and the
 *     preview line called it `Missed voice call` - the exact opposite of true;
 *   - and the entry stops being an invitation the moment `callId` is cleared,
 *     which is what keeps a finished call from offering a way into a room that
 *     emptied an hour ago.
 *
 * Run with `pnpm verify:group-calls`.
 */
import assert from 'node:assert/strict';
import { messagePreview, type Conversation, type Message } from '@pingo/core';

import { callRecordFrom, isLiveCall } from '../src/features/calls/call-log-rules.js';

// -- Which entries are a room, and which are a person ----------------------

const direct = callRecordFrom(
  { id: 'm1', sender_id: 'them', created_at: '2026-08-15T10:00:00Z' },
  { callKind: 'voice', outcome: 'answered', durationSeconds: 42, calleeId: 'me' },
  'me',
);
assert.equal(direct.withUserId, 'them', 'an incoming direct call is with whoever rang');
assert.equal(direct.direction, 'incoming');

const outgoingDirect = callRecordFrom(
  { id: 'm2', sender_id: 'me', created_at: '2026-08-15T10:00:00Z' },
  { callKind: 'voice', outcome: 'answered', durationSeconds: 42, calleeId: 'them' },
  'me',
);
assert.equal(outgoingDirect.withUserId, 'them', 'an outgoing direct call is with the callee');

// The one that was broken: an incoming group entry has a sender, and that
// sender is not "the other person" - there is no other person.
const group = callRecordFrom(
  { id: 'm3', sender_id: 'host', created_at: '2026-08-15T10:00:00Z' },
  { callKind: 'video', outcome: 'answered', durationSeconds: 600 },
  'me',
);
assert.equal(
  group.withUserId,
  undefined,
  'a group call has no other party, whoever started it',
);
assert.equal(group.direction, 'incoming');

// -- A live room is an invitation; a finished one is a record ---------------

assert.equal(isLiveCall({ callKind: 'voice', outcome: 'ongoing', durationSeconds: 0, callId: 'c1' }), true);

// Ongoing without a call id cannot be joined - there is nothing to join.
assert.equal(isLiveCall({ callKind: 'voice', outcome: 'ongoing', durationSeconds: 0 }), false);

// Clearing the id is what ends the offer, and `endCallLog` is what clears it.
assert.equal(isLiveCall({ callKind: 'voice', outcome: 'answered', durationSeconds: 90 }), false);

// A stale id on a finished call must never be tappable.
assert.equal(
  isLiveCall({ callKind: 'voice', outcome: 'answered', durationSeconds: 90, callId: 'c1' }),
  false,
  'a finished call must not offer a way into a room that has emptied',
);

// -- The conversation list says the right thing --------------------------------

const conversation = { id: 'c1', kind: 'group', title: 'Chichora gang' } as Conversation;
const base = {
  id: 'x',
  conversationId: 'c1',
  authorId: 'host',
  body: '',
  createdAt: 1,
  status: 'sent' as const,
  attachments: [],
  reactions: [],
};
const options = { conversation, currentUserId: 'me', users: [] };

assert.match(
  messagePreview(
    { ...base, call: { callKind: 'voice', outcome: 'ongoing', durationSeconds: 0 } } as Message,
    options,
  ),
  /now/,
  'a room still open must not be described as missed',
);
assert.match(
  messagePreview(
    { ...base, call: { callKind: 'voice', outcome: 'missed', durationSeconds: 0 } } as Message,
    options,
  ),
  /Missed/,
);

console.log('group calls: ok');
