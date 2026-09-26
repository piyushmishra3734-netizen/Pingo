import { Gamepad2 } from 'lucide-react';
import {
  conversationFilterLabels,
  conversationFilters,
  sortConversationsForList,
  useChat,
  useConversationFilter,
  useProfile,
  type ChatList,
  type Conversation,
  type Profile,
  type StoryGroup,
} from '@pingo/core';
import {
  Avatar,
  BellIcon,
  ChevronRightIcon,
  IconButton,
  SearchField,
  cn,
} from '@pingo/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { canAccessCommunities } from '../../lib/community-access.js';
import { connectionTitle, useConnectionStatus } from '../connection/useConnectionStatus.js';
import { useT } from '../i18n/useT.js';
import { usePreferences } from '../settings/SettingsContext.js';
import { useNotifications } from '../notifications/NotificationContext.js';
import { StoriesRow } from '../stories/StoriesRow.js';
import { JourneyStrip } from '../journey/JourneyStrip.js';
import { useJourneyProgress } from '../journey/useJourneyProgress.js';
import { MyStoryManageSheet } from '../stories/MyStoryManageSheet.js';
import { useBackStep } from '../navigation/useBackStep.js';
import { StoryComposer } from '../stories/StoryComposer.js';
import { StoryViewer } from '../stories/StoryViewer.js';
import { LiveCreateSheet } from '../live/LiveCreateSheet.js';
import { LiveBanner } from '../live/LiveBanner.js';
import { useLive } from '../live/LiveContext.js';
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

/** Services that have already been asked to make sure PINGO AI is in Chats. */
const ensuredAi = new WeakSet<object>();

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
  const { profile, service: profiles } = useProfile();
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
  /** The `+` asks Story or Live first - Instagram's mode switch. */
  const [choosingCreate, setChoosingCreate] = useState(false);
  const { lives, mine: myLive } = useLive();
  /** What the plus opens: a chat, or a group. */
  const [starting, setStarting] = useState(false);
  const [managingStory, setManagingStory] = useState(false);
  const [query, setQuery] = useState('');

  /** Selection mode is "the set is non-empty", so there is no second flag. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Edit was tapped: selecting with nothing picked yet, as Telegram's Edit does. */
  const [editing, setEditing] = useState(false);
  const selectionMode = selectedIds.size > 0 || editing;

  /*
   * Selecting chats is a mode this screen is in, and Back leaves the mode
   * rather than the screen - which on the chat list is the difference between
   * "never mind" and closing the app.
   */
  useBackStep(selectionMode, () => setSelectedIds(new Set()));

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

  // Fresh installs: PINGO exists in Chats without hunting the + menu. Once per
  // service, not per mount: each call also rebuilds the conversation from the
  // server, and this list remounts on every return to Chats.
  useEffect(() => {
    if (!ready || ensuredAi.has(service)) return;
    ensuredAi.add(service);
    void service.ensureAiConversation().catch(() => {
      ensuredAi.delete(service);
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

  const clearSelection = () => {
    setSelectedIds(new Set());
    setEditing(false);
  };

  const toggleSelect = (conversation: Conversation) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(conversation.id)) next.delete(conversation.id);
      else next.add(conversation.id);
      return next;
    });
  };

  const searching = query.trim().length > 0;

  /*
   * Telegram's fold: scroll the list and the story rail folds into a few faces
   * beside the title; back at the top it opens again. Two thresholds so the
   * header changing height can never flip it straight back.
   */
  const [folded, setFolded] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const observer = new ResizeObserver(() => setHeaderHeight(header.offsetHeight));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const netTitle = connectionTitle(useConnectionStatus(), t);
  const showRail = !searching && filter === 'all' && !activeList && !selectionMode;
  const railFaces = storyGroups
    .filter((group) => group.authorId !== profile?.id)
    .sort((a, b) => Number(a.allSeen) - Number(b.allSeen))
    .slice(0, 3);

  /**
   * People who are not in this list yet.
   *
   * The field says "Search name, @user, or id" and only ever filtered the
   * conversations already on screen - so looking somebody up by their handle or
   * their id worked exactly when you had already spoken to them, and answered
   * "Nothing found" for everyone else. That is the opposite of what a search by
   * id is for: it is how you reach somebody you have *not* met.
   *
   * The conversations stay first, because a thread you already have is almost
   * always what a search of your own chat list means. These are offered
   * underneath, as people rather than as chats.
   */
  const [people, setPeople] = useState<Profile[]>([]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setPeople([]);
      return;
    }

    // One request per pause in typing, not one per keystroke.
    let live = true;
    const timer = window.setTimeout(() => {
      void profiles
        .search(term)
        .then((found) => {
          if (!live) return;
          /*
           * Anyone already answering this search as a conversation is dropped:
           * the same person twice, once as a chat and once as a stranger, reads
           * as two different people.
           */
          const shown = new Set(
            ordered.flatMap((c) => c.participantIds ?? []).concat(profile?.id ? [profile.id] : []),
          );
          setPeople(found.filter((person) => !shown.has(person.id)));
        })
        .catch(() => {
          if (live) setPeople([]);
        });
    }, 220);

    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // `ordered` changes identity constantly; the term is what drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, profiles, profile?.id]);

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
      {/*
        One scroller, with the header stuck to its top - the approved sample's
        arrangement. The list runs under the frosted header instead of stopping
        at its edge, and as it scrolls the stories fold away smoothly.

        `overflow-anchor: none`, or the browser shifts the list to compensate
        while the header changes height and the fold fights the finger. One
        pixel short of the screen (`mb-px`), or Chrome treats this as the page
        and hides its address bar on every scroll, and the dock jumps with it.
      */}
      <div
        className="mb-px min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
        onScroll={(event) => {
          const rail = railRef.current?.offsetHeight ?? 0;
          setFolded(rail > 0 && event.currentTarget.scrollTop > rail * 0.55);
        }}
      >
      <header
        ref={headerRef}
        className={cn(
          'sticky top-0 z-100 shrink-0',
          // Divider under the chrome at ~70% of default line strength.
          // Telegram's bar: the page, frosted, and one hairline - not a framed slab of glass.
          'bg-page/85 backdrop-blur-xl backdrop-saturate-150',
          'px-4 pt-4 pb-2',
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
            {/*
              Telegram's header: start something on the left, the title in the
              middle, and on the right the bell (only where the dock does not
              already carry it) and the Arcade.

              The title is also the connection indicator. There is no banner:
              while the socket is down the word "Chats" is replaced by what is
              happening, with a small spinner, and comes back when it is over.
            */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center">
              <div className="flex items-center justify-start">
                {/* Telegram's Edit. Selecting chats leads the menu; starting something follows. */}
                <button
                  type="button"
                  onClick={() => setStarting(true)}
                  className="focus-ring rounded-lg px-1.5 py-1.5 text-[16px] font-medium text-brand active:opacity-60"
                >
                  Edit
                </button>
              </div>

              <h1 className="flex min-w-0 items-center justify-center gap-2 text-[17px] font-semibold text-ink">
                {netTitle ? (
                  <span className="inline-flex items-center gap-2" role="status">
                    <span
                      aria-hidden
                      className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
                    />
                    {netTitle}
                  </span>
                ) : (
                  <>
                    {showRail && railFaces.length > 0 && (
                      <span
                        className={cn(
                          'flex transition-[max-width,opacity,transform] duration-300 ease-standard',
                          folded
                            ? 'max-w-[90px] scale-100 opacity-100'
                            : '-mr-1.5 max-w-0 scale-50 opacity-0',
                        )}
                        aria-hidden>
                        {railFaces.map((group, index) => (
                          <span
                            key={group.authorId}
                            className={cn(
                              'inline-flex rounded-full ring-2 ring-page',
                              // The ring is the story's; unseen gets the brand, seen stays quiet.
                              group.allSeen
                                ? 'shadow-[0_0_0_3.5px_var(--color-line-strong)]'
                                : 'shadow-[0_0_0_3.5px_var(--color-brand)]',
                              index > 0 && '-ml-3',
                            )}
                          >
                            <Avatar
                              name={group.authorName}
                              id={group.authorId}
                              src={group.authorAvatarUrl}
                              size="xs"
                            />
                          </span>
                        ))}
                      </span>
                    )}
                    {t('chats.title')}
                  </>
                )}
              </h1>

              <div className="flex items-center justify-end gap-0.5">
                {showHeaderNotifications && (
                  <IconButton
                    label={
                      unread > 0
                        ? t('chats.notifsUnread', { n: unread })
                        : t('chats.notifsAria')
                    }
                    variant="ghost"
                    onClick={() => navigate('/notifications')}
                    className="text-brand"
                  >
                    <span className="relative">
                      <BellIcon size={22} />
                      <span
                        className={cn(
                          'absolute -top-0.5 -right-0.5 size-2 rounded-full bg-dot ring-2 ring-page',
                          'transition-opacity duration-quick',
                          unread > 0 ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                    </span>
                  </IconButton>
                )}
                <IconButton
                  label="PINGO Arcade"
                  variant="ghost"
                  onClick={() => navigate('/arcade')}
                  className="text-brand"
                >
                  <Gamepad2 size={23} strokeWidth={1.9} aria-hidden />
                </IconButton>
              </div>
            </div>

            <div className="mt-1.5">
              <SearchField
                inputRef={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('common.search')}
                aria-label={t('chats.searchAria')}
                className="lq-search h-10 rounded-xl border-transparent bg-sunken focus-within:border-line"
              />
            </div>

          </>
        )}
      </header>

      {!selectionMode && (
        <>
            {/*
              Stories under the search, as Telegram does it, and the Arcade in
              the seat beside your own circle. Folds away as the list scrolls.
            */}
            {showRail && (
              <div ref={railRef} className="pt-1">
                <div>
                  <div className="px-1">
                    <StoriesRow
                      groups={storyGroups}
                      currentUserId={profile?.id}
                      currentUserName={profile?.displayName ?? 'You'}
                      {...(profile?.avatarUrl
                        ? { currentUserAvatarUrl: profile.avatarUrl }
                        : {})}
                      lives={lives}
                      onWatchLive={(live) => navigate(`/live/${live.id}`)}
                      onOpenMyLive={() => {
                        if (myLive) navigate(`/live/host/${myLive.id}`);
                      }}
                      onOpen={(group, origin) =>
                        setOpenStory({
                          // The index, not the group: the viewer runs the whole
                          // queue and needs to know where in it to start.
                          index: storyGroups.indexOf(group),
                          origin,
                        })
                      }
                      onCreate={() => setChoosingCreate(true)}
                      onManageMine={() => setManagingStory(true)}
                      extra={<ArcadeCircle onOpen={() => navigate('/arcade')} />}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Folders as Telegram's tabs: the chosen one in the brand, underlined. */}
            <nav
              role="tablist"
              aria-label={t('chats.filter')}
              style={{ top: headerHeight }}
              className="scrollbar-none sticky z-[99] flex gap-5 overflow-x-auto border-b border-line bg-page/85 px-5 backdrop-blur-xl backdrop-saturate-150"
            >
              {conversationFilters.map((f) => (
                <FolderTab
                  key={f}
                  selected={filter === f && !activeList}
                  onClick={() => {
                    setFilter(f);
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
                </FolderTab>
              ))}
              {lists.map((list) => (
                <FolderTab
                  key={list.id}
                  selected={activeList?.id === list.id}
                  onClick={() => {
                    setActiveList((was) => (was?.id === list.id ? undefined : list));
                    setFilter('all');
                  }}
                  count={list.count}
                >
                  {list.name}
                </FolderTab>
              ))}
            </nav>
        </>
      )}

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
          className="px-2 pt-1 pb-2"
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
                {/*
                  A mutual on air gets a banner that says who, and the front
                  seats of the story tray itself - one row, like Instagram,
                  never a strip above it.
                */}
                <LiveBanner
                  lives={lives}
                  currentUserId={profile?.id}
                  onWatch={(live) => navigate(`/live/${live.id}`)}
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
            // "Nothing found" printed above a list of people who *were* found
            // is a contradiction; when there are strangers to offer, they are
            // the answer and the empty state has nothing to say.
            people.length > 0 ? null : (
              <ChatListEmpty
                reason={emptyReason}
                query={query}
                {...(activeList ? { listName: activeList.name } : {})}
                {...(profile?.displayName ? { greeting: profile.displayName } : {})}
              />
            )
          }
        />

        {/*
          Everyone else who matches, under the chats that do.

          Rendered here rather than inside `ChatListBody`, which is about
          conversations and would have to learn a second kind of row to hold
          these. Tapping one opens their profile, not a chat: finding somebody
          by id is looking them up, and the profile is where you decide - its
          Message button starts the thread.
        */}
        {searching && people.length > 0 && (
          <section className="px-1 pt-2 pb-1">
            <h2 className="px-3 pb-1 text-[0.6875rem] font-semibold text-text-tertiary">
              {people.length === 1 ? 'Person' : 'People'}
            </h2>
            <ul>
              {people.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/profile/${person.username}`)}
                    className={cn(
                      'focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left',
                      'transition-colors duration-instant hover:bg-hover active:bg-pressed',
                      'disabled:opacity-60',
                    )}
                  >
                    <Avatar
                      name={person.displayName}
                      id={person.id}
                      {...(person.avatarUrl ? { src: person.avatarUrl } : {})}
                      size="md"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">{person.displayName}</span>
                      <span className="block truncate text-caption text-text-secondary">
                        @{person.username}
                      </span>
                    </span>
                    <ChevronRightIcon size={16} className="shrink-0 text-text-tertiary" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        </div>
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

      {choosingCreate && (
        <LiveCreateSheet
          onPickStory={() => {
            setChoosingCreate(false);
            setCreating(true);
          }}
          onPickLive={() => {
            setChoosingCreate(false);
            navigate('/live/setup');
          }}
          onClose={() => setChoosingCreate(false)}
        />
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

      {starting && (
        <NewChatMenu
          onClose={() => setStarting(false)}
          onSelectChats={() => {
            setStarting(false);
            setEditing(true);
          }}
        />
      )}
    </div>
  );
}

/** One folder, Telegram's way: text in the brand when chosen, with a bar under it. */
function FolderTab({
  selected,
  count,
  onClick,
  children,
}: {
  selected: boolean;
  count: number | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'focus-ring relative flex shrink-0 items-center gap-1.5 pt-1.5 pb-2.5 text-[14.5px] font-semibold',
        'transition-colors duration-instant',
        selected ? 'text-brand' : 'text-text-secondary hover:text-ink',
      )}
    >
      {children}
      {count ? (
        <span
          className={cn(
            'grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums',
            selected ? 'bg-brand text-on-brand' : 'bg-sunken text-text-secondary',
          )}
        >
          {count}
        </span>
      ) : null}
      {selected && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[3px] rounded-t-[3px] bg-brand" />}
    </button>
  );
}

/**
 * The Arcade, in the seat beside your own story.
 *
 * Shaped like a story circle so the rail reads as one row, with a small note
 * on top where a note would sit. It says "Play" rather than a count: nothing
 * yet tells the app how many friends are in the Arcade, and a number it made
 * up would be the first thing somebody noticed was wrong.
 */
function ArcadeCircle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="PINGO Arcade"
      className={cn(
        'relative flex w-[68px] shrink-0 flex-col items-center gap-1.5 rounded-xl py-1',
        'focus-ring transition-transform duration-[160ms] ease-standard active:scale-[0.96]',
      )}
    >
      <span className="absolute top-0 left-1/2 z-[1] -translate-x-1/2 -translate-y-1.5 rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-ink shadow-md">
        Play
      </span>
      <span className="grid size-[68px] place-items-center rounded-full bg-gradient-to-br from-[#ff8a3d] to-[#ff3d77] p-[2.5px]">
        <span className="grid size-full place-items-center rounded-full border-[2.5px] border-page bg-gradient-to-br from-[#ff8a3d] to-[#ff3d77] text-white">
          <Gamepad2 size={26} strokeWidth={1.9} aria-hidden />
        </span>
      </span>
      <span className="w-full truncate text-center text-[0.6875rem] font-medium leading-tight text-text-secondary">
        Arcade
      </span>
    </button>
  );
}
