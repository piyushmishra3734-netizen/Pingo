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

  useEffect(() => {
    if (call) {
      last.current = call;
      return;
    }

    const ended = last.current;
    last.current = undefined;
    if (!ended || !currentUser) return;
    if (ended.direction !== 'outgoing') return;

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
