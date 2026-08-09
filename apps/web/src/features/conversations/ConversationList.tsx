import {
  conversationFilterLabels,
  conversationFilters,
  sortConversationsForList,
  useChat,
  useConversationFilter,
  useProfile,
  type ChatList,
  type Conversation,
  type StoryGroup,
} from '@pingo/core';
import {
  BellIcon,
  Chip,
  ChipGroup,
  IconButton,
  SearchField,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppWordmark } from '../../components/AppWordmark.js';
import { useConfirm } from '../../components/ConfirmProvider.js';
import { canAccessCommunities } from '../../lib/community-access.js';
import { useT } from '../i18n/useT.js';
import { usePreferences } from '../settings/SettingsContext.js';
import { useNotifications } from '../notifications/NotificationContext.js';
import { StoriesRow } from '../stories/StoriesRow.js';
import { JourneyStrip } from '../journey/JourneyStrip.js';
import { useJourneyProgress } from '../journey/useJourneyProgress.js';
import { MyStoryManageSheet } from '../stories/MyStoryManageSheet.js';
import { StoryComposer } from '../stories/StoryComposer.js';
import { StoryViewer } from '../stories/StoryViewer.js';
import { useStories } from '../stories/StoryContext.js';
import { ChatListBody, ChatListEmpty } from './ChatListBody.js';
import { ChatListsSheet } from './ChatListsSheet.js';
import { DeleteChatSheet } from './DeleteChatSheet.js';
import { MuteSheet } from './MuteSheet.js';
import { NewChatMenu } from './NewChatMenu.js';
import { SelectionBar, SelectionMenuItem } from './SelectionBar.js';
import { useConversationActions } from './useConversationActions.js';
import { useUnmuteConfirm } from './useUnmuteConfirm.js';

/**
 * The conversation list - header, search, filters, rows, selection.
 *
 * The header is sticky and glass-backed so the wordmark stays put while rows
 * scroll beneath it, which is what keeps a long list feeling anchored. In
 * selection mode that same header becomes the selection bar in place, so the
 * screen never appears to gain a layer.
 *
 * ## Archived chats are not in `conversations`
 *
 * They are partitioned out here, once, rather than filtered at each of the four
 * places that read the list. Everything downstream - filters, counts, search  - 
 * therefore describes the main list without having to remember to exclude them.
 */

export interface ConversationListProps {
  /** Highlighted row in the desktop two-pane layout. */
  activeConversationId?: string;
  /**
   * Cards that belong to the list rather than to the app.
   *
   * The backup reminder used to be a *sibling* of this component, which put it
   * above the header — on a phone that reads as a strip floating outside PINGO,
   * up against the status bar, rather than as something the app is saying.
   * Passed in here it lands under the header, scrolls with the rows, and
   * behaves like everything else on the screen.
   */
  banner?: ReactNode;
  className?: string;
}

export function ConversationList({
  activeConversationId,
  banner,
  className,
}: ConversationListProps) {
  const t = useT();
  const { conversations, ready, service, users, currentUser } = useChat();
  /*
   * The same count the Journey screen runs, from the same cache. It is keyed on
   * the conversation ids rather than the array, so this does not re-read every
   * thread each time a message arrives — see `useJourneyProgress`.
   */
  const journey = useJourneyProgress();
  const { profile } = useProfile();
  const { groups: storyGroups } = useStories();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const { unread } = useNotifications();
  /*
   * Most accounts open notifications from the dock. Allowlisted community
   * accounts still have Communities in that slot, so they keep the header bell.
   */
  const showHeaderNotifications = canAccessCommunities(profile?.username);

  const actions = useConversationActions();
  const confirm = useConfirm();
  const confirmUnmute = useUnmuteConfirm();

  const [openStory, setOpenStory] = useState<{ index: number; origin: DOMRect } | undefined>();
  const [creating, setCreating] = useState(false);
  /** What the plus opens: a chat, or a group. */
  const [starting, setStarting] = useState(false);
  const [managingStory, setManagingStory] = useState(false);
  const [query, setQuery] = useState('');

  /** Selection mode is "the set is non-empty", so there is no second flag. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionMode = selectedIds.size > 0;

  const [pendingDelete, setPendingDelete] = useState<Conversation[]>();
  /** Ids, not conversations: the sheet needs their live state. */
  const [listsFor, setListsFor] = useState<string[]>();
  const [muting, setMuting] = useState<Conversation[]>();

  /** The custom list being viewed, if any. `undefined` is "no list filter". */
  const [activeList, setActiveList] = useState<ChatList>();
  const [lists, setLists] = useState<ChatList[]>([]);

  const loadLists = () => {
    void service
      .listChatLists()
      .then(setLists)
      .catch(() => setLists([]));
  };
  useEffect(loadLists, [service]);

  const { preferences } = usePreferences();
  const { keepArchived, swipeActions, pinAiToTop } = preferences.chats;

  // Fresh installs: PINGO exists in Chats without hunting the + menu.
  const ensuredAi = useRef(false);
  useEffect(() => {
    if (!ready || ensuredAi.current) return;
    ensuredAi.current = true;
    void service.ensureAiConversation().catch(() => {
      ensuredAi.current = false;
    });
  }, [ready, service]);

  /*
   * Whether an archived chat with new messages is still archived.
   *
   * Resolved here rather than written by anything, so both answers are pure
   * functions of state: nothing has to be running at the moment a message
   * arrives, and flipping the preference re-sorts the list that already exists
   * instead of only applying from now on.
   */
  const isArchived = (conversation: Conversation) => {
    if (!conversation.archived) return false;
    if (keepArchived) return true;
    const newest = conversation.lastMessage?.createdAt;
    return newest === undefined || newest <= (conversation.archivedAt ?? 0);
  };

  const { active, archived } = useMemo(
    () => ({
      active: conversations.filter((c) => !isArchived(c)),
      archived: conversations.filter(isArchived),
    }),
    [conversations, keepArchived],
  );

  const inList = useMemo(
    () => (activeList ? active.filter((c) => c.listIds.includes(activeList.id)) : active),
    [active, activeList],
  );

  /*
   * Pass the roster into search so @handle / user id find the right DM.
   * Title alone only matches display name, which is why "search does nothing"
   * was reported when people typed a username or pasted an id.
   */
  const searchPeople = useMemo(() => {
    if (!currentUser) return users;
    return users.some((u) => u.id === currentUser.id) ? users : [...users, currentUser];
  }, [users, currentUser]);

  const { filter, setFilter, filtered, counts } = useConversationFilter(
    inList,
    query,
    searchPeople,
  );

  const ordered = useMemo(
    () => sortConversationsForList(filtered, { pinAiToTop }),
    [filtered, pinAiToTop],
  );

  const selected = useMemo(
    () => conversations.filter((c) => selectedIds.has(c.id)),
    [conversations, selectedIds],
  );

  /*
   * A selection cannot outlive what it points at. Archiving four chats empties
   * the selection, and without this the bar would keep counting rows that are
   * no longer on screen.
   */
  useEffect(() => {
    setSelectedIds((previous) => {
      if (previous.size === 0) return previous;
      const live = new Set(conversations.map((c) => c.id));
      const next = new Set([...previous].filter((id) => live.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [conversations]);

  const clearSelection = () => setSelectedIds(new Set());

  const toggleSelect = (conversation: Conversation) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(conversation.id)) next.delete(conversation.id);
      else next.add(conversation.id);
      return next;
    });
  };

  const searching = query.trim().length > 0;
  const allSelected = selected.length > 0 && selected.every((c) => c.favorite);
  const allMuted = selected.length > 0 && selected.every((c) => c.muted);
  const anyUnread = selected.some((c) => c.unreadCount > 0);
  /** Single selection unlocks the actions that only mean anything for one chat. */
  const only = selected.length === 1 ? selected[0] : undefined;

  /** Runs an action, then leaves selection mode - the job is done. */
  const andClose = (work: Promise<void> | void) => {
    void Promise.resolve(work).then(clearSelection);
  };

  const emptyReason = searching
    ? ('search' as const)
    : activeList
      ? ('list' as const)
      : filter === 'favorites'
        ? ('favorites' as const)
        : filter !== 'all'
          ? ('filter' as const)
          : ('none' as const);

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <header
        className={cn(
          'sticky top-0 z-100 shrink-0',
          // Divider under the chrome at ~70% of default line strength.
          'glass-surface border-x-0 border-t-0 border-b border-b-line/70',
          'px-4 pt-4 pb-3',
          'pt-[max(1rem,env(safe-area-inset-top))]',
        )}
      >
        {selectionMode ? (
          <SelectionBar
            selected={selected}
            onCancel={clearSelection}
            onPin={(pinned) => andClose(actions.pin(selected, pinned))}
            onArchive={(archive) =>
              andClose(actions.archive(selected.map((c) => c.id), archive))
            }
            onDelete={() => setPendingDelete(selected)}
            menu={
              <>
                <SelectionMenuItem
                  label={anyUnread ? 'Mark as read' : 'Mark as unread'}
                  onSelect={() =>
                    andClose(actions.markUnread(selected.map((c) => c.id), !anyUnread))
                  }
                />
                <SelectionMenuItem
                  label={t('select.selectAll', { n: ordered.length })}
                  onSelect={() => setSelectedIds(new Set(ordered.map((c) => c.id)))}
                />
                <SelectionMenuItem
                  label={allSelected ? t('select.removeFav') : t('select.addFav')}
                  onSelect={() =>
                    andClose(actions.favorite(selected.map((c) => c.id), !allSelected))
                  }
                />
                <SelectionMenuItem
                  label={t('select.addList')}
                  onSelect={() => setListsFor(selected.map((c) => c.id))}
                />
                <SelectionMenuItem
                  label={allMuted ? t('select.unmute') : t('select.mute')}
                  onSelect={() => {
                    if (!allMuted) {
                      // Muting asks *how long* rather than whether, which is a
                      // sheet of its own.
                      setMuting(selected);
                      return;
                    }
                    void (async () => {
                      const go = await confirmUnmute(selected.length, only?.title);
                      if (go) andClose(actions.mute(selected.map((c) => c.id), null));
                    })();
                  }}
                />
                <SelectionMenuItem
                  label={t('select.clear')}
                  onSelect={() => {
                    void (async () => {
                      const go = await confirm({
                        title:
                          selected.length === 1
                            ? 'Clear this chat?'
                            : `Clear ${selected.length} chats?`,
                        description:
                          'Every message goes from your side. The other people keep theirs, and the chats stay in your list.',
                        confirmLabel: t('select.clear'),
                      });
                      if (go) andClose(actions.clear(selected.map((c) => c.id)));
                    })();
                  }}
                />

                {/*
                  Single-selection only. "Chat info" for four chats has no
                  meaning, and docs/13 § 3 applies here too - hide what was
                  never available rather than offering it and refusing.
                */}
                {only && (
                  <>
                    <SelectionMenuItem
                      label={t('select.chatInfo')}
                      onSelect={() => {
                        clearSelection();
                        navigate(`/chats/${only.id}`);
                      }}
                    />
                    {/*
                      Shortcut and Export are honest omissions rather than dead
                      rows: neither has an implementation behind it, and a menu
                      item that silently does nothing is the failure this
                      codebase keeps finding. They return when they work.
                    */}
                  </>
                )}

                <SelectionMenuItem
                  label={t('select.delete')}
                  danger
                  onSelect={() => setPendingDelete(selected)}
                />
              </>
            }
          />
        ) : (
          <>
            <div className="flex items-center justify-between">
              {/*
                Whisper, not ghost. The mark was reading like a disabled control
                (~20% presence); a gentle contrast lift and full opacity bring it
                to about a third of the ink strength without competing with the
                rows below.
              */}
              <AppWordmark
                height={22}
                as="h1"
                className="[&_img]:opacity-[0.92] [&_img]:[filter:contrast(1.12)_saturate(1.08)]"
              />

              <div className="flex items-center gap-0.5">
                <IconButton
                  label={t('common.search')}
                  variant="ghost"
                  onClick={() => searchRef.current?.focus()}
                >
                  <SearchIcon size={21} />
                </IconButton>

                {showHeaderNotifications && (
                  <IconButton
                    label={
                      unread > 0
                        ? t('chats.notifsUnread', { n: unread })
                        : t('chats.notifsAria')
                    }
                    variant="ghost"
                    onClick={() => navigate('/notifications')}
                  >
                    <span className="relative">
                      <BellIcon size={22} />
                      <span
                        className={cn(
                          'absolute -top-0.5 -right-0.5 size-2 rounded-full bg-dot',
                          'shadow-[0_0_0_3px_rgba(139,93,255,0.16)] ring-2 ring-page',
                          'transition-opacity duration-quick',
                          unread > 0 ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                    </span>
                  </IconButton>
                )}

                <IconButton
                  label={t('chats.startSomething')}
                  variant="ghost"
                  onClick={() => setStarting(true)}
                >
                  <PlusIcon size={21} />
                </IconButton>

                <IconButton
                  label={t('settings.title')}
                  variant="ghost"
                  onClick={() => navigate('/settings')}
                >
                  <SettingsIcon size={21} />
                </IconButton>
              </div>
            </div>

            {/*
              Tighter rhythm between logo row → search → chips. Was ~14px gaps
              (mt-3.5 / mt-3); ~6–8px keeps the top stack as one unit without
              crowding the stories rail below.
            */}
            <div className="mt-2">
              <SearchField
                inputRef={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('chats.search')}
                aria-label={t('chats.searchAria')}
                /*
                  Border almost disappears: idle line ~8–10% softer than default
                  line-strong, so the field is a recess rather than a box.
                */
                className="h-11 border-[rgba(16,17,20,0.045)] bg-sunken/90 focus-within:border-[rgba(16,17,20,0.08)]"
              />
            </div>

            <ChipGroup label={t('chats.filter')} className="mt-2">
              {conversationFilters.map((f) => (
                <Chip
                  key={f}
                  selected={filter === f && !activeList}
                  onClick={() => {
                    setFilter(f);
                    // The chips and the lists are one row of choices, so
                    // picking a chip leaves whichever list was open.
                    setActiveList(undefined);
                  }}
                  count={f === 'all' ? undefined : counts[f]}
                >
                  {f === 'all'
                    ? t('chats.filterAll')
                    : f === 'unread'
                      ? t('chats.filterUnread')
                      : f === 'favorites'
                        ? t('chats.filterFavorites')
                        : f === 'groups'
                          ? t('chats.filterGroups')
                          : conversationFilterLabels[f]}
                </Chip>
              ))}

              {/*
                Custom lists continue the same row rather than getting their own.
                They are filters - a second row would imply a second kind of
                thing and spend permanent vertical space saying so.
              */}
              {lists.map((list) => (
                <Chip
                  key={list.id}
                  selected={activeList?.id === list.id}
                  onClick={() => {
                    setActiveList((was) => (was?.id === list.id ? undefined : list));
                    setFilter('all');
                  }}
                  count={list.count}
                >
                  {list.name}
                </Chip>
              ))}
            </ChipGroup>
          </>
        )}
      </header>

      {actions.error && (
        <p
          role="alert"
          onClick={actions.dismissError}
          className="mx-3 mt-2 shrink-0 rounded-lg bg-danger-soft px-3 py-2 text-caption text-danger"
        >
          {actions.error}
        </p>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2"
        role={selectionMode ? 'listbox' : undefined}
        aria-multiselectable={selectionMode ? true : undefined}
        aria-label={selectionMode ? 'Conversations, selecting' : undefined}
      >
        <ChatListBody
          ready={ready}
          conversations={ordered}
          pinAiToTop={pinAiToTop}
          archived={archived}
          {...(activeConversationId ? { activeConversationId } : {})}
          selectedIds={selectedIds}
          selectionMode={selectionMode}
          swipeEnabled={swipeActions}
          onEnterSelection={(conversation) => setSelectedIds(new Set([conversation.id]))}
          onToggleSelect={toggleSelect}
          onCancelSelection={clearSelection}
          actions={actions}
          onDeleteRequest={setPendingDelete}
          header={
            /*
             * The story rail scrolls away with the rows rather than pinning to
             * the header. Stories are the day's news; the conversations are why
             * the screen exists. Hidden while searching, filtering or selecting
             * - all three are "find me a conversation", and the rail answers
             * none of them.
             */
            !searching && filter === 'all' && !activeList && !selectionMode ? (
              <div className="pb-0.5">
                {banner}
                <StoriesRow
                  groups={storyGroups}
                  currentUserId={profile?.id}
                  currentUserName={profile?.displayName ?? 'You'}
                  {...(profile?.avatarUrl
                    ? { currentUserAvatarUrl: profile.avatarUrl }
                    : {})}
                  onOpen={(group, origin) =>
                    setOpenStory({
                      // The index, not the group: the viewer runs the whole
                      // queue and needs to know where in it to start.
                      index: storyGroups.indexOf(group),
                      origin,
                    })
                  }
                  onCreate={() => setCreating(true)}
                  onManageMine={() => setManagingStory(true)}
                />

                {/*
                  Under the stories, above the conversations, and scrolling away
                  with both.

                  It sits inside the same hidden-while-searching condition as the
                  rail for the same reason: searching, filtering and selecting
                  are all "find me a conversation", and a progress strip answers
                  none of them.
                */}
                <JourneyStrip
                  level={journey.level}
                  // The same phrase the Journey screen shows, rather than a
                  // second piece of copy about the same week.
                  note={journey.feeling}
                  {...(journey.nextBadge ? { next: journey.nextBadge } : {})}
                  className="mt-1"
                />
              </div>
            ) : undefined
          }
          empty={
            <ChatListEmpty
              reason={emptyReason}
              query={query}
              {...(activeList ? { listName: activeList.name } : {})}
              {...(profile?.displayName ? { greeting: profile.displayName } : {})}
            />
          }
        />
      </div>

      {openStory && (
        <StoryViewer
          groups={storyGroups}
          startGroupIndex={openStory.index}
          currentUserId={profile?.id}
          origin={openStory.origin}
          onClose={() => setOpenStory(undefined)}
        />
      )}

      {creating && (
        <StoryComposer onClose={() => setCreating(false)} onPosted={() => setCreating(false)} />
      )}

      {managingStory && (
        <MyStoryManageSheet
          onClose={() => setManagingStory(false)}
          onAdd={() => {
            setManagingStory(false);
            setCreating(true);
          }}
          onArchive={() => {
            setManagingStory(false);
            navigate('/stories/archive');
          }}
        />
      )}

      {pendingDelete && (
        <DeleteChatSheet
          count={pendingDelete.length}
          onCancel={() => setPendingDelete(undefined)}
          onConfirm={() => {
            const ids = pendingDelete.map((c) => c.id);
            setPendingDelete(undefined);
            andClose(actions.remove(ids));
          }}
        />
      )}

      {muting && (
        <MuteSheet
          count={muting.length}
          onCancel={() => setMuting(undefined)}
          onChoose={(durationMs) => {
            const ids = muting.map((c) => c.id);
            setMuting(undefined);
            andClose(actions.mute(ids, durationMs));
          }}
        />
      )}

      {listsFor && (
        <ChatListsSheet
          selectedIds={listsFor}
          onClose={() => {
            setListsFor(undefined);
            clearSelection();
          }}
          onChanged={loadLists}
        />
      )}

      {starting && <NewChatMenu onClose={() => setStarting(false)} />}
    </div>
  );
}
