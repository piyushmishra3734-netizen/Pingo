/**
 * The home screen's filter chips: All · Unread · Groups · Favorites.
 *
 * A hook rather than inline logic because the same filtering has to behave
 * identically on web and native, and because "what counts as unread" is a
 * product rule (muted threads still count) worth stating in exactly one place.
 */

import { useMemo, useState } from 'react';

import type { Conversation, ConversationFilter } from '../types.js';

const FILTERS: readonly ConversationFilter[] = [
  'all',
  'unread',
  'groups',
  'favorites',
] as const;

export const conversationFilters = FILTERS;

export const conversationFilterLabels: Record<ConversationFilter, string> = {
  all: 'All',
  unread: 'Unread',
  groups: 'Groups',
  favorites: 'Favorites',
};

export function matchesFilter(
  conversation: Conversation,
  filter: ConversationFilter,
): boolean {
  switch (filter) {
    case 'unread':
      return conversation.unreadCount > 0;
    // Communities are group-shaped from the user's point of view, so the
    // "Groups" chip includes them rather than hiding them behind a fifth chip.
    case 'groups':
      return conversation.kind === 'group' || conversation.kind === 'community';
    case 'favorites':
      return conversation.favorite;
    case 'all':
    default:
      return true;
  }
}

interface UseConversationFilterResult {
  filter: ConversationFilter;
  setFilter: (filter: ConversationFilter) => void;
  filtered: Conversation[];
  /** Per-chip counts, so the UI can dim a chip that would yield nothing. */
  counts: Record<ConversationFilter, number>;
}

export function useConversationFilter(
  conversations: Conversation[],
  query = '',
): UseConversationFilterResult {
  const [filter, setFilter] = useState<ConversationFilter>('all');

  const counts = useMemo(() => {
    const result = {} as Record<ConversationFilter, number>;
    for (const f of FILTERS) {
      result[f] = conversations.filter((c) => matchesFilter(c, f)).length;
    }
    return result;
  }, [conversations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (!matchesFilter(conversation, filter)) return false;
      if (!q) return true;
      // Search spans the title and the visible preview text, which is what a
      // user scanning the list would expect to match.
      return (
        conversation.title.toLowerCase().includes(q) ||
        (conversation.lastMessage?.body.toLowerCase().includes(q) ?? false)
      );
    });
  }, [conversations, filter, query]);

  return { filter, setFilter, filtered, counts };
}
