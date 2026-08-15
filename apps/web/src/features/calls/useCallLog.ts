import { useChat, type CallOutcome } from '@pingo/core';
import type { Call } from '@pingo/core';
import { useEffect, useRef } from 'react';

/**
 * Writes a call into the conversation once it is over.
 *
 * ## Why this watches the call disappear rather than hooking the actions
 *
 * A call ends in at least six ways - hung up, declined, unanswered, busy,
 * failed, cancelled - and only two of them are actions the user takes here. A
 * log written from `hangUp` would miss the rest, and adding a write beside each
 * new ending is how a log ends up with holes nobody notices for months.
 *
 * So this watches the call vanish and describes it from the last live snapshot,
 * which covers every ending including ones not yet invented.
 *
 * ## Only the caller writes
 *
 * The entry is an ordinary message, so the callee receives it over realtime
 * like anything else. Both ends writing would put two rows in the thread for
 * one call - and for a declined call, two rows that disagree.
 */

/** What the service's end reason means for the log. */
const OUTCOME: Record<string, CallOutcome> = {
  declined: 'declined',
  unanswered: 'missed',
  // Never reached the far end at all, which is a different fact from "nobody
  // picked up" and gets a different word.
  busy: 'unreachable',
  failed: 'unreachable',
  // You hung up before they picked up. Nothing failed - filing this under
  // "unreachable" told people the network broke on a call that did what they
  // asked it to.
  cancelled: 'cancelled',
};

export function useCallLog(call: Call | undefined): void {
  const { service, conversations, currentUser } = useChat();

  /** The last live snapshot, so the ending can be described after it. */
  const last = useRef<Call | undefined>(undefined);

  /**
   * The group entry written when the room opened, waiting to be finalised.
   *
   * A group call is logged at both ends of its life rather than only at the
   * end, and the reason is the thread: a room nobody has been told about is a
   * room nobody joins. The entry goes in when the call starts, carrying the
   * call id so anyone in the group can tap it and arrive; when the room empties
   * the same row is edited into ordinary history.
   *
   * A direct call keeps the old behaviour. There is nothing to join - the one
   * person who could is already ringing - so an entry before the end would only
   * be a duplicate.
   */
  const liveEntry = useRef<string | undefined>(undefined);

  useEffect(() => {
    const isGroup = Boolean(call?.participants && call.conversationId);

    if (call && isGroup && call.direction === 'outgoing' && !liveEntry.current) {
      liveEntry.current = 'pending';
      void service
        .logCall({
          conversationId: call.conversationId!,
          callKind: call.kind,
          outcome: 'ongoing',
          durationSeconds: 0,
          callId: call.id,
        })
        .then((message) => {
          liveEntry.current = message.id;
        })
        .catch(() => {
          // No entry is better than a wrong one; the end still writes history.
          liveEntry.current = undefined;
        });
    }

    if (call) {
      last.current = call;
      return;
    }

    const ended = last.current;
    last.current = undefined;
    if (!ended || !currentUser) return;
    if (ended.direction !== 'outgoing') return;

    const connectedSeconds = (from: Call) =>
      from.connectedAt !== undefined
        ? Math.max(1, Math.round((Date.now() - from.connectedAt) / 1000))
        : 0;

    /*
     * A group call finishes the entry it opened.
     *
     * Edited rather than appended: the row is already in the thread and already
     * on everyone's screen, and a second one would show the same call twice -
     * the first still inviting people into a room that has emptied.
     */
    if (ended.participants && ended.conversationId) {
      const messageId = liveEntry.current;
      liveEntry.current = undefined;
      if (!messageId || messageId === 'pending') return;

      const answered = ended.connectedAt !== undefined;
      void service
        .endCallLog(messageId, {
          outcome: answered ? 'answered' : (OUTCOME[ended.endReason ?? ''] ?? 'unreachable'),
          durationSeconds: connectedSeconds(ended),
        })
        .catch(() => undefined);
      return;
    }

    /*
     * The thread this call belongs to.
     *
     * Resolved from the peer rather than carried on the call, because a call is
     * a peer-to-peer thing and does not otherwise need to know about
     * conversations. Nothing is logged if there is no thread yet - a call to
     * someone you have never messaged has nowhere to be written.
     */
    const conversation = conversations.find(
      (c) => c.kind === 'direct' && c.participantIds.includes(ended.peer.userId),
    );
    if (!conversation) return;

    const connected = ended.connectedAt !== undefined;
    const outcome: CallOutcome = connected
      ? 'answered'
      : (OUTCOME[ended.endReason ?? ''] ?? 'unreachable');

    void service
      .logCall({
        conversationId: conversation.id,
        calleeId: ended.peer.userId,
        callKind: ended.kind,
        outcome,
        durationSeconds: connected
          ? Math.max(1, Math.round((Date.now() - ended.connectedAt!) / 1000))
          : 0,
      })
      .catch(() => {
        /*
         * A failed log is not worth interrupting anyone over: the call already
         * happened, and there is nothing the user could do about it.
         */
      });
  }, [call, service, conversations, currentUser]);
}
