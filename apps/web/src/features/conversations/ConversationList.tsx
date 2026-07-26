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
  BellIcon,
  ConversationSkeleton,
  EmptyState,
  IconButton,
  SearchField,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useProfile, type StoryGroup } from '@pingo/core';

import { AppWordmark } from '../../components/AppWordmark.js';
import { StoriesRow } from '../stories/StoriesRow.js';
import { StoryViewer } from '../stories/StoryViewer.js';
import { useStories } from '../stories/StoryContext.js';
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
  // For the empty state's greeting, and the "You" circle on the story rail.
  const { profile } = useProfile();
  const { groups: storyGroups, markSeen: markStorySeen } = useStories();
  const navigate = useNavigate();

  const searchRef = useRef<HTMLInputElement>(null);

  /*
   * Fetched once per mount rather than kept live. A badge that counts down as
   * you read is a distraction; one that is right when you arrive is enough.
   */
  const { service: chatService } = useChat();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    void chatService
      .unreadNotifications()
      .then((n) => {
        if (active) setUnread(n);
      })
      .catch(() => undefined);

    /*
     * Then keep it live. Fetching once per mount meant the badge only ever
     * showed what was true when the app opened — a notification arriving while
     * you sat on the chat list was invisible until a reload.
     */
    const unsubscribe = chatService.subscribe((event) => {
      if (event.type === 'notification:new') setUnread((n) => n + 1);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [chatService]);
  /*
   * The origin travels with the group so the viewer can grow out of the exact
   * circle that was tapped. Measured at tap time, because the row scrolls.
   */
  const [openStory, setOpenStory] = useState<
    { group: StoryGroup; origin: DOMRect } | undefined
  >();
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
          <AppWordmark height={22} as="h1" />

          <div className="flex items-center gap-0.5">
            {/*
              Search focuses the field below rather than opening a screen — the
              field is already here, and a second search surface would be two
              places to look for one thing.
            */}
            <IconButton
              label="Search"
              variant="ghost"
              onClick={() => searchRef.current?.focus()}
            >
              <SearchIcon size={21} />
            </IconButton>

            {/*
              The only way into a conversation with someone new. Without it the
              app can only continue threads that already exist — which is what
              it did, because `startDirectConversation` had no caller.
            */}
            <IconButton
              label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              variant="ghost"
              onClick={() => navigate('/notifications')}
            >
              <span className="relative">
                <BellIcon size={21} />
                {/* A dot, not a number: the count is on the screen it opens. */}
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand ring-2 ring-page" />
                )}
              </span>
            </IconButton>

            <IconButton
              label="New chat"
              variant="ghost"
              onClick={() => navigate('/chats/new')}
            >
              <PlusIcon size={21} />
            </IconButton>

            <IconButton label="Settings" variant="ghost" onClick={() => navigate('/settings')}>
              <SettingsIcon size={21} />
            </IconButton>
          </div>
        </div>

        <div className="mt-3.5">
          <SearchField
            inputRef={searchRef}
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
        {/*
          The story rail sits above the chats and scrolls away with them, rather
          than pinning to the sticky header. Stories are the day's news; the
          conversations are why the screen exists, and pinning the rail would
          spend permanent vertical space on the lesser of the two.

          Hidden while searching or filtering — both are "find me a
          conversation", and the rail answers neither.
        */}
        {!searching && filter === 'all' && (
          <div className="pb-3">
            <StoriesRow
              groups={storyGroups}
              currentUserId={profile?.id}
              currentUserName={profile?.displayName ?? 'You'}
              {...(profile?.avatarUrl ? { currentUserAvatarUrl: profile.avatarUrl } : {})}
              onOpen={(group, origin) => setOpenStory({ group, origin })}
            />
          </div>
        )}

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
            /*
             * Home's first impression, and the one screen most likely to greet
             * someone who has just finished signing up. It uses their name on
             * purpose: an empty product that knows who you are reads as ready,
             * while the same screen without a name reads as broken.
             *
             * "No chats yet" still appears, under a divider — the state is
             * stated plainly rather than hidden behind the welcome.
             */
            <EmptyState
              title={profile ? `👋 Welcome ${profile.displayName}` : '👋 Welcome'}
              description="Start your first conversation."
              icon={<ChatIcon size={26} />}
              action={
                <div className="mt-2 w-full max-w-[16rem]">
                  <div className="h-px w-full bg-divider" />
                  <p className="mt-4 text-caption text-text-tertiary">No chats yet.</p>
                </div>
              }
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

      {openStory && (
        <StoryViewer
          group={openStory.group}
          origin={openStory.origin}
          onClose={() => setOpenStory(undefined)}
          onSeen={(storyId) => void markStorySeen(storyId)}
        />
      )}
    </div>
  );
}
