import type { Conversation } from './types.js';

/**
 * Chat list order.
 *
 * When `pinAiToTop` is on, PINGO AI floats near the top without a manual pin:
 * unread human chats still outrank it, then AI, then ordinary pin + recency.
 * When off, behaviour matches the classic pin-first list.
 */
export function sortConversationsForList(
  conversations: Conversation[],
  options?: { pinAiToTop?: boolean },
): Conversation[] {
  const pinAiToTop = options?.pinAiToTop ?? true;

  const tier = (c: Conversation): number => {
    if (pinAiToTop) {
      if (c.kind !== 'ai' && c.unreadCount > 0) return 0;
      if (c.kind === 'ai') return 1;
    }
    if (c.pinned) return 2;
    return 3;
  };

  return [...conversations].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    return b.updatedAt - a.updatedAt;
  });
}
