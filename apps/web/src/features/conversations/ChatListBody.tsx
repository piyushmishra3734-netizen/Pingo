import type { Conversation } from '@pingo/core';
import {
  ArchiveIcon,
  ChatIcon,
  ChevronRightIcon,
  ConversationSkeleton,
  EmptyState,
  ListIcon,
  PinIcon,
  StarIcon,
  TrashIcon,
  UnarchiveIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { useFlipList } from '../../hooks/useFlipList.js';
import { ConversationRow } from './ConversationRow.js';
import { SwipeableRow } from './SwipeableRow.js';
import type { ConversationActions } from './useConversationActions.js';

/**
 * The scrolling part of the chat list: archived shelf, pinned section, rows.
 *
 * Split out of `ConversationList` because that file now owns a header with two
 * modes, three sheets and a filter - and the part that renders rows had become
 * the hardest thing to find in it.
 *
 * ## Pinned chats are a section, not a sort order
 *
 * Sorting pinned chats to the top and leaving it there means the boundary
 * between "pinned" and "recent" is invisible, so a chat that falls out of the
 * pinned group appears to have moved for no reason. A labelled divider makes
 * the group a place.
 */

export interface ChatListBodyProps {
  ready: boolean;
  /** Already filtered by chip, list and search. */
  conversations: Conversation[];
  archived: Conversation[];
  activeConversationId?: string;
  /** Non-empty means selection mode. */
  selectedIds: Set<string>;
  selectionMode: boolean;
  /** The chat preference. Off means rows do not move at all. */
  swipeEnabled: boolean;
  onEnterSelection: (conversation: Conversation) => void;
  onToggleSelect: (conversation: Conversation) => void;
  /** Escape leaves selection mode from anywhere in the list. */
  onCancelSelection: () => void;
  actions: ConversationActions;
  onDeleteRequest: (conversations: Conversation[]) => void;
  /** Rendered above the rows - the story rail, when it applies. */
  header?: React.ReactNode;
  empty: React.ReactNode;
}

export function ChatListBody({
  ready,
  conversations,
  archived,
  activeConversationId,
  selectedIds,
  selectionMode,
  swipeEnabled,
  onEnterSelection,
  onToggleSelect,
  onCancelSelection,
  actions,
  onDeleteRequest,
  header,
  empty,
}: ChatListBodyProps) {
  /*
   * Collapsed by default, and the state is local rather than persisted. The
   * shelf is a door, not a preference - leaving it open across sessions would
   * put archived chats back in the main list by another name.
   */
  const [showArchived, setShowArchived] = useState(false);

  /**
   * The conversation focus should land on once selection mode ends.
   *
   * Leaving selection swaps every row from an `option` back to a link, so the
   * element that had focus stops existing and the browser drops focus on
   * `<body>` - a keyboard user is returned to the top of the page by the act of
   * pressing Escape. Deselecting the last row has the same effect, since that
   * also ends selection mode.
   *
   * So the id is remembered across the swap and focus is handed to the row that
   * replaces it, which is the same chat in the same place.
   */
  const handedBack = useRef<string | undefined>(undefined);

  /*
   * Reordering, animated.
   *
   * A message arriving sends its conversation to the top and shuffles every
   * row below it down in a single frame, which rearranges a list somebody is
   * reading with nothing to say which row moved. The hook measures the rows
   * before and after and animates the difference away.
   *
   * Keyed on the order rather than the conversations themselves: the rows
   * re-render constantly - a timestamp ticking over, a typing indicator - and
   * only a change in *sequence* is a reorder worth animating.
   */
  const listRef = useRef<HTMLDivElement>(null);
  useFlipList(
    listRef,
    conversations.map((c) => c.id).join(','),
  );

  /** Which conversation the focused row belongs to, if any. */
  const focusedConversationId = (): string | undefined => {
    const row = (document.activeElement as HTMLElement | null)?.closest('[data-conversation]');
    return (row as HTMLElement | null)?.dataset.conversation;
  };

  useEffect(() => {
    if (selectionMode) return;
    const id = handedBack.current;
    handedBack.current = undefined;
    if (!id) return;

    document.querySelector<HTMLElement>(`a[data-conversation="${id}"]`)?.focus();
  }, [selectionMode]);

  /*
   * Arrow keys walk the selection, Space toggles, Escape leaves.
   *
   * The rows are a `listbox` of `option`s while selecting, and a listbox that
   * only answers to Tab makes a keyboard user step through every chat to reach
   * the one after the one they are on. Handled at the container so it works
   * regardless of which row has focus, and so rows stay presentational.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!selectionMode) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      // Remembered before the rows change shape, so focus can follow the same
      // conversation back out. See `handedBack` below.
      handedBack.current = focusedConversationId();
      onCancelSelection();
      return;
    }

    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();

    const rows = [
      ...(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
    ];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    // From nowhere, Down starts at the top and Up at the bottom.
    const next = index === -1 ? (step > 0 ? 0 : rows.length - 1) : index + step;
    rows[Math.max(0, Math.min(next, rows.length - 1))]?.focus();
  };

  if (!ready) return <ConversationSkeleton />;

  const pinned = conversations.filter((c) => c.pinned);
  const rest = conversations.filter((c) => !c.pinned);

  const row = (conversation: Conversation, index: number, inArchive = false) => {
    const selected = selectedIds.has(conversation.id);

    const rowNode = (
      <ConversationRow
        conversation={conversation}
        active={conversation.id === activeConversationId}
        selectable={selectionMode}
        selected={selected}
        onToggleSelect={() => {
          handedBack.current = conversation.id;
          onToggleSelect(conversation);
        }}
        onEnterSelection={() => onEnterSelection(conversation)}
      />
    );

    return (
      <div
        key={conversation.id}
        // What FLIP tracks. See useFlipList: it measures these by id before and
        // after a reorder and animates the difference away.
        data-flip-id={conversation.id}
        className="animate-row-in"
        // Staggered and capped at eight; past that the last rows would arrive
        // after the user has already started scrolling.
        style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
      >
        <SwipeableRow
          // Swiping is off during selection, where the row is a tap target and
          // a half-swipe would read as a failed tap.
          enabled={swipeEnabled && !selectionMode}
          right={
            inArchive
              ? {
                  label: 'Unarchive',
                  icon: <UnarchiveIcon size={18} />,
                  tone: 'bg-brand',
                  onAct: () => void actions.archive([conversation.id], false),
                }
              : {
                  label: conversation.pinned ? 'Unpin' : 'Pin',
                  icon: <PinIcon size={18} />,
                  tone: 'bg-brand',
                  onAct: () => void actions.pin([conversation], !conversation.pinned),
                }
          }
          left={{
            label: inArchive ? 'Delete' : 'Archive',
            icon: inArchive ? <TrashIcon size={18} /> : <ArchiveIcon size={18} />,
            tone: inArchive ? 'bg-danger' : 'bg-ink',
            onAct: () =>
              inArchive
                ? onDeleteRequest([conversation])
                : void actions.archive([conversation.id], true),
          }}
        >
          {rowNode}
        </SwipeableRow>
      </div>
    );
  };

  return (
    <div ref={listRef} onKeyDown={onKeyDown}>
      {header}

      {/*
        The archived shelf sits above everything, including pinned chats. It is
        a door out of this list rather than a row in it, so it does not compete
        with the chats for position - and it is absent entirely when there is
        nothing behind it, because an empty door is furniture.
      */}
      {archived.length > 0 && !selectionMode && (
        <div className="mb-1">
          <button
            type="button"
            onClick={() => setShowArchived((was) => !was)}
            aria-expanded={showArchived}
            className={cn(
              'focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2.5',
              'text-left transition-colors duration-instant hover:bg-hover',
            )}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-hover text-text-secondary">
              <ArchiveIcon size={17} />
            </span>
            <span className="min-w-0 flex-1 text-body text-ink">Archived</span>

            {/*
              The count is the unread total, not the number of chats. An
              archived chat you have read is exactly what archiving is for, and
              counting it would make the shelf permanently demand attention.
            */}
            {archived.some((c) => c.unreadCount > 0) && (
              <span className="shrink-0 text-caption font-medium text-text-secondary tabular-nums">
                {archived.reduce((sum, c) => sum + c.unreadCount, 0)}
              </span>
            )}

            <ChevronRightIcon
              size={16}
              className={cn(
                'shrink-0 text-text-tertiary transition-transform duration-quick ease-standard',
                showArchived && 'rotate-90',
              )}
            />
          </button>

          {showArchived && (
            <div className="mt-0.5 space-y-0.5">
              {archived.map((conversation, index) => row(conversation, index, true))}
            </div>
          )}
        </div>
      )}

      {conversations.length === 0 ? (
        empty
      ) : (
        <div className="space-y-0.5">
          {pinned.length > 0 && (
            <>
              <SectionLabel icon={<PinIcon size={12} />} label={`Pinned`} />
              {pinned.map((conversation, index) => row(conversation, index))}
              {rest.length > 0 && <SectionLabel label="All chats" />}
            </>
          )}

          {rest.map((conversation, index) => row(conversation, pinned.length + index))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ icon, label }: { icon?: React.ReactNode; label: string }) {
  return (
    <p className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-caption font-medium text-text-tertiary">
      {icon}
      {label}
    </p>
  );
}

/**
 * The empty states, all five, chosen by what is actually empty.
 *
 * Kept together because the distinction between them is the point: an empty
 * filter is not an empty inbox, and telling someone "no conversations yet" when
 * they simply have nothing unread is a small lie that makes the app look broken.
 */
export function ChatListEmpty({
  reason,
  query,
  listName,
  greeting,
}: {
  reason: 'search' | 'favorites' | 'archive' | 'list' | 'filter' | 'none';
  query?: string;
  listName?: string;
  greeting?: string;
}) {
  if (reason === 'search') {
    return (
      <EmptyState
        title="No matches"
        description={`Nothing found for "${query?.trim()}".`}
        icon={<ChatIcon size={26} />}
      />
    );
  }

  if (reason === 'favorites') {
    return (
      <EmptyState
        title="No favourites yet"
        description="Hold a chat and star it to keep it close."
        icon={<StarIcon size={26} />}
      />
    );
  }

  if (reason === 'archive') {
    return (
      <EmptyState
        title="Nothing archived"
        description="Swipe a chat left to put it away without leaving it."
        icon={<ArchiveIcon size={26} />}
      />
    );
  }

  if (reason === 'list') {
    return (
      <EmptyState
        title={`${listName} is empty`}
        description="Hold a chat and add it to this list."
        icon={<ListIcon size={26} />}
      />
    );
  }

  if (reason === 'filter') {
    return (
      <EmptyState
        title="Nothing here"
        description="Try another filter to see the rest of your conversations."
        icon={<ChatIcon size={26} />}
      />
    );
  }

  /*
   * Home's first impression, and the screen most likely to greet someone who
   * has just signed up. It uses their name on purpose: an empty product that
   * knows who you are reads as ready, the same screen without a name reads as
   * broken.
   */
  return (
    <EmptyState
      title={greeting ? `👋 Welcome ${greeting}` : '👋 Welcome'}
      description="Start your first conversation."
      icon={<ChatIcon size={26} />}
      action={
        <div className="mt-2 w-full max-w-[16rem]">
          <div className="h-px w-full bg-divider" />
          <p className="mt-4 text-caption text-text-tertiary">No chats yet.</p>
        </div>
      }
    />
  );
}

