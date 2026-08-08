import {
  formatConversationTimestamp,
  useChat,
  useProfile,
  type AppNotification,
} from '@pingo/core';
import {
  AtIcon,
  Avatar,
  BellIcon,
  ChatIcon,
  HeartIcon,
  LoadingState,
  PhoneIcon,
  SearchField,
  UserIcon,
  UsersIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { useT } from '../features/i18n/useT.js';
import {
  FILTERS,
  describe,
  groupNotifications,
  sectionByDay,
  type FilterKey,
  type HistoryEntry,
} from '../features/notifications/group-history.js';
import { markDismissed, markOpened } from '../features/notifications/history-actions.js';
import { useNotifications } from '../features/notifications/NotificationContext.js';
import { canAccessCommunities } from '../lib/community-access.js';
import { getRealtimeHub } from '../lib/supabase/realtime-hub.js';

/**
 * Everything that happened to you, newest first.
 *
 * Premium feed, not a settings-list clone: soft glass cards, whisper unread
 * cues, day grouping, and kind-aware chrome so a Ping does not look like a
 * follow request.
 *
 * Opening the screen marks the feed read. Unread rows stay tinted for this
 * visit so the list does not visibly reset under the reader.
 */

type DayKey = 'today' | 'yesterday' | 'earlier';

const DAY_LABEL: Record<DayKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
};

function dayKey(ts: number, now = Date.now()): DayKey {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today0 = startOfToday.getTime();
  const yesterday0 = today0 - 86_400_000;
  if (ts >= today0) return 'today';
  if (ts >= yesterday0) return 'yesterday';
  return 'earlier';
}

function kindMeta(kind: AppNotification['kind']): {
  label: string;
  Icon: typeof BellIcon;
} {
  switch (kind) {
    case 'message':
    case 'mention':
      return { label: kind === 'mention' ? 'Mention' : 'Message', Icon: kind === 'mention' ? AtIcon : ChatIcon };
    case 'ping':
    case 'ping_opened':
    case 'ping_replayed':
      return { label: 'Ping', Icon: HeartIcon };
    case 'call':
      return { label: 'Call', Icon: PhoneIcon };
    case 'follow_request':
    case 'follow_accepted':
      return { label: 'Follow', Icon: UserIcon };
    case 'story':
      return { label: 'Story', Icon: UsersIcon };
    default:
      return { label: 'PINGO', Icon: BellIcon };
  }
}

export function NotificationsScreen() {
  const t = useT();
  const navigate = useNavigate();
  const { service, users } = useChat();
  const { clear } = useNotifications();
  const { profile, service: profiles } = useProfile();
  const [acting, setActing] = useState<string>();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  /** Hidden for this visit; the write to dismissed_at follows behind. */
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  /*
   * Primary dock tab for most accounts (no back). Allowlisted community
   * accounts still open this from the chats header, so they keep a back button.
   */
  const showBack = canAccessCommunities(profile?.username);

  const respond = async (item: AppNotification, accept: boolean) => {
    if (!item.actorId || acting) return;
    setActing(item.id);
    try {
      await (accept
        ? profiles.acceptFollow(item.actorId)
        : profiles.removeFollow(item.actorId));
      setItems((all) =>
        all?.map((n) => (n.id === item.id ? { ...n, kind: 'follow_accepted' as const } : n)),
      );
      // Answered, so every other row about the same person stops offering.
      setPending((open) => {
        if (!open?.has(item.actorId!)) return open;
        const next = new Set(open);
        next.delete(item.actorId!);
        return next;
      });
    } finally {
      setActing(undefined);
    }
  };

  const [items, setItems] = useState<AppNotification[]>();
  const [version, setVersion] = useState(0);

  /**
   * Who is *still* waiting on an answer.
   *
   * The feed used to offer Accept and Ignore on any row of kind
   * `follow_request`, for ever — so a request accepted a week ago kept its
   * buttons, and the same screen showed "accepted your follow request" two rows
   * above the offer to accept it again. Requests screen said "No requests".
   *
   * The notification is a record of something that happened; whether it is
   * still open is a fact about now, and has to be asked for.
   */
  const [pending, setPending] = useState<Set<string>>();

  useEffect(() => {
    let active = true;
    void profiles
      .listFollowRequests()
      .then((list) => {
        if (active) setPending(new Set(list.map((person) => person.id)));
      })
      // Unknown is treated as "not pending": an Accept that silently does
      // nothing is worse than no button at all.
      .catch(() => {
        if (active) setPending(new Set());
      });
    return () => {
      active = false;
    };
  }, [profiles, version]);

  useEffect(
    () => getRealtimeHub().on('notifications', () => setVersion((n) => n + 1)),
    [],
  );

  useEffect(() => {
    let active = true;
    void service
      .listNotifications()
      .then((list) => {
        if (!active) return;
        setItems(list);
        void service.markAllNotificationsRead();
        // Badge only - not a load dependency (clear identity changes with unread).
        clear();
      })
      .catch(() => {
        if (active) setItems([]);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear is a badge setter
  }, [service, version]);

  /**
   * A timeline, not a log.
   *
   * Filter, then search, then group, then split by day - in that order, because
   * grouping a filtered list is right and filtering a grouped one is not: a
   * chip that hides half a run would leave an entry claiming four messages
   * while showing one.
   *
   * Grouping is what stops this being the thing it used to be. Four messages
   * from one person in two minutes were four rows; the one real event - that
   * somebody wanted you - was harder to see with four copies of it than with
   * one. `groupNotifications` collapses a consecutive run into a single entry
   * that counts it, and only a consecutive run: two messages this morning and
   * two tonight are two moments in a day, and merging them across the gap would
   * say something untrue about when they happened.
   */
  const sections = useMemo(() => {
    if (!items?.length) return [];

    const term = query.trim().toLowerCase();
    const visible = items
      .filter((item) => !dismissed.has(item.id))
      .filter(FILTERS[filter])
      .filter((item) => {
        if (!term) return true;
        const actor = users.find((u) => u.id === item.actorId);
        return (
          (actor?.name ?? item.title).toLowerCase().includes(term) ||
          item.body.toLowerCase().includes(term)
        );
      });

    return sectionByDay(groupNotifications(visible));
  }, [items, filter, query, dismissed, users]);

  const open = (entry: HistoryEntry) => {
    const item = entry.latest;
    // Every id in the run, so opening a group of four counts as four opened -
    // an open rate built on the newest one alone would understate every burst.
    void markOpened(entry.ids);

    if (item.kind === 'follow_request' || item.kind === 'follow_accepted') {
      navigate('/requests');
    } else if (item.conversationId) {
      navigate(`/chats/${item.conversationId}`);
    }
  };

  /*
   * Hidden immediately, recorded in the background.
   *
   * The row leaves on the tap; the write follows. A dismissal that waited on a
   * round trip would leave a row sitting under a finger that has already moved
   * on, which reads as the gesture not having worked.
   */
  const dismiss = (entry: HistoryEntry) => {
    setDismissed((all) => new Set([...all, ...entry.ids]));
    void markDismissed(entry.ids);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-page">
      {/* Soft brand air behind the feed - keeps the screen from reading as a white form. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-56 overflow-hidden"
      >
        <div className="absolute -top-16 left-1/2 size-72 -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />
        <div className="absolute top-8 right-[-10%] size-48 rounded-full bg-brand-alt/10 blur-3xl" />
      </div>

      <ScreenHeader title={t('notifications.title')} showBack={showBack} className="relative z-10" />

      {/*
        Search and filters, above the timeline.

        Rendered only once there is something to search. A filter row over an
        empty screen is furniture that explains nothing, and the empty state
        already says what to do.
      */}
      {items && items.length > 0 && (
        <div className="relative z-10 shrink-0 px-4 pb-2">
          <div className="mx-auto w-full max-w-2xl">
            <SearchField
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search activity"
              aria-label="Search activity"
            />
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
              {(
                [
                  ['all', 'All'],
                  ['messages', 'Messages'],
                  ['stories', 'Stories'],
                  ['calls', 'Calls'],
                  ['people', 'People'],
                  ['pings', 'Pings'],
                ] as [FilterKey, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={cn(
                    'focus-ring shrink-0 rounded-full px-3 py-1.5 text-caption font-medium',
                    'transition-colors duration-instant',
                    filter === key
                      ? 'bg-brand text-white'
                      : 'bg-surface text-text-secondary hover:text-ink',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-1">
        <div className="mx-auto w-full max-w-2xl">
          {!items ? (
            <LoadingState label="Loading activity" />
          ) : items.length === 0 ? (
            <PremiumEmpty />
          ) : (
            <div className="space-y-6">
              {sections.map((section) => (
                <section key={section.label}>
                  <h2 className="mb-2.5 px-1 text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-text-tertiary">
                    {section.label}
                  </h2>
                  <ul className="glass-surface overflow-hidden rounded-2xl shadow-sm">
                    {section.entries.map((entry, index) => {
                      const item = entry.latest;
                      const actor = users.find((u) => u.id === item.actorId);
                      return (
                        <li
                          key={item.id}
                          className={cn(
                            'animate-row-in',
                            index > 0 && 'border-t border-line/70',
                          )}
                          style={{ animationDelay: `${Math.min(index, 8) * 32}ms` }}
                        >
                          <NotificationRow
                            item={item}
                            /*
                              The grouped sentence, not the row's own body.
                              "Sent you 4 messages" is what happened; "Sent you
                              a message" repeated four times is a transcript of
                              the delivery mechanism.
                            */
                            summary={describe(entry)}
                            actorName={actor?.name ?? item.title}
                            actorAvatar={actor?.avatarUrl}
                            acting={acting === item.id}
                            pendingReply={Boolean(item.actorId && pending?.has(item.actorId))}
                            onOpen={() => open(entry)}
                            onDismiss={() => dismiss(entry)}
                            onAccept={() => void respond(item, true)}
                            onIgnore={() => void respond(item, false)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationRow({
  item,
  summary,
  actorName,
  actorAvatar,
  acting,
  pendingReply,
  onOpen,
  onDismiss,
  onAccept,
  onIgnore,
}: {
  item: AppNotification;
  /** The grouped sentence: "Sent you 4 messages". */
  summary: string;
  actorName: string;
  actorAvatar?: string;
  acting: boolean;
  /** The request is still open, so it can still be answered. */
  pendingReply: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  onAccept: () => void;
  onIgnore: () => void;
}) {
  const { label, Icon } = kindMeta(item.kind);
  const unread = !item.read;
  const isFollowRequest = pendingReply && item.kind === 'follow_request' && Boolean(item.actorId);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'focus-ring group relative flex w-full items-start gap-3 px-3.5 py-3.5 text-left',
        'transition-[background-color,transform] duration-quick ease-standard',
        'hover:bg-hover/70 active:scale-[0.995]',
        unread && 'bg-brand/[0.045]',
      )}
    >
      {/* Whisper brand edge - unread without a loud slab of fill. */}
      {unread && (
        <span
          aria-hidden
          className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-brand-gradient opacity-90"
        />
      )}

      <span className="relative shrink-0">
        <Avatar
          name={actorName}
          id={item.actorId ?? item.id}
          src={actorAvatar}
          size="md"
          className={cn(
            'transition-[box-shadow,ring] duration-quick',
            unread && 'ring-2 ring-brand/25 ring-offset-2 ring-offset-page',
          )}
        />
        <span
          aria-hidden
          className={cn(
            'absolute -right-0.5 -bottom-0.5 grid size-5 place-items-center rounded-full',
            'bg-surface text-brand shadow-sm ring-2 ring-surface',
          )}
        >
          <Icon size={11} strokeWidth={2.2} />
        </span>
      </span>

      <span className="min-w-0 flex-1 pt-0.5">
        <span className="flex items-start justify-between gap-3">
          <span
            className={cn(
              'min-w-0 flex-1 text-body leading-snug text-ink',
              unread ? 'font-medium' : 'font-normal',
            )}
          >
            <span className="font-semibold tracking-tight">{item.title}</span>
            {summary ? (
              <span className="font-normal text-text-secondary"> {summary}</span>
            ) : null}
          </span>
          {unread && (
            <span
              aria-label="Unread"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-dot shadow-[0_0_0_3px_rgba(139,93,255,0.12)]"
            />
          )}
          {/*
            A button, not a swipe.

            Swipe-to-dismiss is the gesture people expect here and it is not
            built yet - a half-built swipe that sometimes scrolls the list
            instead is worse than an obvious control. This does the same thing
            and works with a keyboard, which the gesture never will.
          */}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={(event) => {
              // The row itself opens; this must not.
              event.stopPropagation();
              onDismiss();
            }}
            className={cn(
              'focus-ring -mr-1 ml-1 shrink-0 rounded-full p-1 text-text-tertiary',
              'transition-colors duration-instant hover:bg-hover hover:text-ink',
            )}
          >
            <span aria-hidden className="block text-caption leading-none">
              ×
            </span>
          </button>
        </span>

        <span className="mt-1.5 flex items-center gap-1.5 text-caption text-text-tertiary">
          <span className="rounded-full bg-sunken/90 px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-wider text-text-secondary/90">
            {label}
          </span>
          <span aria-hidden className="opacity-40">
            ·
          </span>
          <span className="tabular-nums">{formatConversationTimestamp(item.createdAt)}</span>
        </span>

        {isFollowRequest && (
          <span className="mt-3 flex items-center gap-2">
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onAccept();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  onAccept();
                }
              }}
              className={cn(
                'focus-ring glass-press inline-flex items-center rounded-full',
                'bg-brand-gradient px-4 py-1.5 text-caption font-medium text-on-brand',
                'shadow-brand transition-opacity duration-instant',
                acting && 'opacity-55',
              )}
            >
              Accept
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onIgnore();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  onIgnore();
                }
              }}
              className={cn(
                'focus-ring inline-flex items-center rounded-full px-3.5 py-1.5',
                'text-caption font-medium text-text-secondary',
                'bg-sunken/80 ring-1 ring-line transition-colors duration-instant',
                'hover:bg-hover hover:text-ink',
                acting && 'opacity-55',
              )}
            >
              Ignore
            </span>
          </span>
        )}
      </span>
    </button>
  );
}

function PremiumEmpty() {
  return (
    <div className="flex flex-col items-center px-6 pt-16 pb-10 text-center">
      <div className="relative mb-7">
        <div
          aria-hidden
          className="absolute inset-0 scale-125 rounded-full bg-brand/15 blur-2xl"
        />
        <div
          className={cn(
            'relative grid size-[4.5rem] place-items-center rounded-[1.35rem]',
            'glass-surface shadow-md',
          )}
        >
          <span
            aria-hidden
            className="absolute inset-0 rounded-[1.35rem] bg-brand-gradient opacity-[0.12]"
          />
          <BellIcon size={30} className="relative text-brand" />
        </div>
      </div>

      <h2 className="text-h2 tracking-tight text-ink">{t('notifications.quiet')}</h2>
      <p className="mt-2 max-w-[16rem] text-body leading-relaxed text-text-secondary">
        Follows, messages and Pings land here the moment something needs you.
      </p>
    </div>
  );
}
