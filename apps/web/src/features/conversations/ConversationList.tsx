import {
  conversationFilterLabels,
  conversationFilters,
  useChat,
  useConversationFilter,
} from '@pingo/core';
import {
  ChatIcon,
  Chip,
  ChipGroup,
  ConversationSkeleton,
  EmptyState,
  IconButton,
  PlusIcon,
  SearchField,
  Wordmark,
  cn,
} from '@pingo/ui';
import { useState } from 'react';

import { ConversationRow } from './ConversationRow.js';

/**
 * The conversation list — header, search, filter chips, rows.
 *
 * The header is sticky and glass-backed so the wordmark stays put while rows
 * scroll beneath it, which is what keeps a long list feeling anchored.
 *
 * Empty states are distinguished on purpose: an empty *filter* is not an empty
 * *inbox*, and telling a user "no conversations yet" when they simply have nothing
 * unread would be a small lie.
 */

export interface ConversationListProps {
  /** Highlighted row in the desktop two-pane layout. */
  activeConversationId?: string;
  className?: string;
}

export function ConversationList({
  activeConversationId,
  className,
}: ConversationListProps) {
  const { conversations, ready } = useChat();
  const [query, setQuery] = useState('');
  const { filter, setFilter, filtered, counts } = useConversationFilter(
    conversations,
    query,
  );

  const searching = query.trim().length > 0;

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <header
        className={cn(
          'sticky top-0 z-100 shrink-0',
          // Glass, because rows pass underneath it.
          'glass-surface border-x-0 border-t-0 border-b-line',
          'px-4 pt-4 pb-3',
          'pt-[max(1rem,env(safe-area-inset-top))]',
        )}
      >
        <div className="flex items-center justify-between">
          <Wordmark size={17} as="h1" />
          <IconButton label="New conversation" variant="ghost">
            <PlusIcon size={22} className="text-brand" />
          </IconButton>
        </div>

        <div className="mt-3.5">
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search conversations"
          />
        </div>

        <ChipGroup label="Filter conversations" className="mt-3">
          {conversationFilters.map((f) => (
            <Chip
              key={f}
              selected={filter === f}
              onClick={() => setFilter(f)}
              // A count on "All" is redundant — it is the list you are looking at.
              count={f === 'all' ? undefined : counts[f]}
            >
              {conversationFilterLabels[f]}
            </Chip>
          ))}
        </ChipGroup>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {!ready ? (
          <ConversationSkeleton />
        ) : filtered.length === 0 ? (
          searching ? (
            <EmptyState
              title="No matches"
              description={`Nothing found for "${query.trim()}".`}
              icon={<ChatIcon size={26} />}
            />
          ) : filter !== 'all' ? (
            <EmptyState
              title={`Nothing in ${conversationFilterLabels[filter]}`}
              description="Try another filter to see the rest of your conversations."
              icon={<ChatIcon size={26} />}
            />
          ) : (
            <EmptyState
              title="No conversations yet"
              description="Start one, and it will appear here."
              icon={<ChatIcon size={26} />}
            />
          )
        ) : (
          <div className="space-y-0.5">
            {filtered.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === activeConversationId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
