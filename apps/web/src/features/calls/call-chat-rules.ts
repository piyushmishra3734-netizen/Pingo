import type { CallChatMessage } from '@pingo/core';

/**
 * The two decisions the in-call chat makes, out where they can be asserted.
 *
 * Both are small enough to have been written inline, and both are the kind of
 * small that is wrong for months: an unread count that includes your own lines
 * reads as a badge that never clears, and an untrimmed line is a blank message
 * or a paste large enough to hold up the signalling channel everybody's ICE
 * candidates are on.
 */

/**
 * The longest line the call chat will carry.
 *
 * Matches `CALL_CHAT_MAX_LENGTH` in the service, which is the boundary that
 * actually enforces it - this is the composer knowing the same number so the
 * field stops accepting rather than silently losing the tail.
 */
export const CALL_CHAT_MAX_LENGTH = 500;

/** What is safe to send, or an empty string when there is nothing to send. */
export function trimCallChat(body: string): string {
  return body.trim().slice(0, CALL_CHAT_MAX_LENGTH);
}

/**
 * How many lines have arrived since the panel was last looked at.
 *
 * `seen` is a count, not an index into anything clever: the list only ever
 * grows, so the number of lines present when the panel was last open is enough
 * to say what is new. Your own lines never count - you were there when you
 * typed them, and a badge that includes them never reaches zero.
 */
export function countUnread(
  messages: CallChatMessage[],
  seen: number,
  selfId: string | undefined,
): number {
  return messages.slice(seen).filter((message) => message.userId !== selfId).length;
}
