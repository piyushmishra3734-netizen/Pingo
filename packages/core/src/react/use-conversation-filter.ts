/**
 * The home screen's filter chips: All · Unread · Groups · Favorites.
 *
 * A hook rather than inline logic because the same filtering has to behave
 * identically on web and native, and because "what counts as unread" is a
 * product rule (muted threads still count) worth stating in exactly one place.
 */

import { useMemo, useState } from 'react';

import type { Conversation, ConversationFilter, User } from '../types.js';

const FILTERS: readonly ConversationFilter[] = [
  'all',
  'unread',
  'groups',
  'favorites',
] as const;

export const conversationFilters = FILTERS;

/**
 * How many conversations may be pinned at once.
 *
 * Three, matching WhatsApp. The cap is what keeps the pinned section meaning
 * "these three matter" - an uncapped one drifts into a second inbox, and then
 * the ordering it was supposed to fix is back.
 *
 * Here rather than in `types.ts` because the barrel re-exports that module with
 * `export type *`, so a runtime constant declared there is unreachable by
 * design - it typechecks at the definition and fails at every call site.
 */
export const PIN_LIMIT = 3;

/**
 * What muting offers.
 *
 * Three, and no more. "8 hours" covers a night's sleep and a working day,
 * "1 week" covers a holiday, and "Always" covers the group chat you have given
 * up on - a longer menu is a longer decision about something nobody wants to
 * spend a decision on.
 */
export const MUTE_DURATIONS: { label: string; ms: number }[] = [
  { label: '8 hours', ms: 8 * 60 * 60 * 1000 },
  { label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
  // Not a large number - the real thing, so nothing has to guess whether a
  // date far in the future was meant as forever.
  { label: 'Always', ms: Number.POSITIVE_INFINITY },
];

/**
 * "Muted until 8:00 pm", or "Muted" when it never lifts.
 *
 * Returns undefined when the chat is not muted, so a caller renders nothing
 * rather than an empty string that still takes up a gap.
 */
export function formatMuteUntil(mutedUntil: number | undefined): string | undefined {
  if (mutedUntil === undefined) return undefined;
  if (!Number.isFinite(mutedUntil)) return 'Muted';
  if (mutedUntil <= Date.now()) return undefined;

  const until = new Date(mutedUntil);
  const sameDay = until.toDateString() === new Date().toDateString();

  return `Muted until ${until.toLocaleString(undefined, {
    ...(sameDay ? {} : { weekday: 'short' }),
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

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

/**
 * Whether a conversation matches what was typed in the list search.
 *
 * Title and last-message text are the obvious hits. People also paste a
 * handle, a user id, or a conversation id - none of those live in the title
 * for every row (a DM is titled by display name only), so the roster of known
 * people is checked too. Without that, searching for `@someone` in the chat
 * list looked broken even when their thread was right there.
 */
export function conversationMatchesQuery(
  conversation: Conversation,
  query: string,
  peopleById?: Map<string, User>,
): boolean {
  const raw = query.trim().toLowerCase();
  if (!raw) return true;
  const q = raw.replace(/^@/u, '');

  if (conversation.title.toLowerCase().includes(q)) return true;
  if (conversation.id.toLowerCase().includes(q)) return true;
  if (conversation.lastMessage?.body?.toLowerCase().includes(q)) return true;

  for (const participantId of conversation.participantIds) {
    if (participantId.toLowerCase().includes(q)) return true;
    const person = peopleById?.get(participantId);
    if (!person) continue;
    if (person.name.toLowerCase().includes(q)) return true;
    if (person.handle.toLowerCase().includes(q)) return true;
    if (person.id.toLowerCase().includes(q)) return true;
  }

  return false;
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
  /**
   * Known people (roster / contacts). Used so search can hit @handle and user
   * id, not only the conversation title.
   */
  users: readonly User[] = [],
): UseConversationFilterResult {
  const [filter, setFilter] = useState<ConversationFilter>('all');

  const peopleById = useMemo(() => {
    const map = new Map<string, User>();
    for (const person of users) map.set(person.id, person);
    return map;
  }, [users]);

  const counts = useMemo(() => {
    const result = {} as Record<ConversationFilter, number>;
    for (const f of FILTERS) {
      result[f] = conversations.filter((c) => matchesFilter(c, f)).length;
    }
    return result;
  }, [conversations]);

  const filtered = useMemo(() => {
    return conversations.filter((conversation) => {
      if (!matchesFilter(conversation, filter)) return false;
      return conversationMatchesQuery(conversation, query, peopleById);
    });
  }, [conversations, filter, query, peopleById]);

  return { filter, setFilter, filtered, counts };
}
