import type { CallLogRef, CallRecord, MessageId, UserId } from '@pingo/core';

/**
 * The two decisions that separate a group call from a direct one.
 *
 * Both hang off a single fact - a room has no single other party - and both
 * were wrong in a way that only showed up in the UI. They live here, outside
 * the service and the screens, so the history and the thread cannot disagree
 * about what a group call is, and so the rules can be asserted without a
 * browser or a database.
 */

/** Just enough of a message row to describe the call on it. */
export interface CallRow {
  id: MessageId;
  sender_id: UserId;
  created_at: string;
}

/**
 * A history entry, from the message that recorded it.
 *
 * `withUserId` is the whole point. On a direct call it is the other person -
 * the callee if I rang, the sender if I was rung. On a group call it is
 * **absent**, because there is no other person: the conversation is the room.
 *
 * The absence is not a gap to be filled in. It is what the Calls screen reads
 * to know it should show a room's name and face instead of somebody's, and
 * filling it with `sender_id` - which is what the incoming path used to do -
 * labelled every group call with whoever happened to start it.
 */
export function callRecordFrom(row: CallRow, call: CallLogRef, me: UserId): CallRecord {
  const outgoing = row.sender_id === me;
  const group = !call.calleeId;
  const withUserId = group ? undefined : outgoing ? call.calleeId : row.sender_id;

  return {
    id: row.id,
    kind: call.callKind,
    direction: outgoing ? 'outgoing' : 'incoming',
    outcome: call.outcome,
    ...(withUserId ? { withUserId } : {}),
    startedAt: Date.parse(row.created_at),
    duration: call.durationSeconds,
  };
}

/**
 * Whether this entry is a room somebody can still walk into.
 *
 * Both halves are required, and each covers a different way of being wrong.
 * `ongoing` without a `callId` is a call that cannot be joined because nothing
 * names it. A `callId` left on a finished call would be worse: an invitation
 * into a room that emptied an hour ago, which is why `endCallLog` clears it
 * rather than only changing the outcome.
 */
export function isLiveCall(call: CallLogRef): boolean {
  return call.outcome === 'ongoing' && Boolean(call.callId);
}
