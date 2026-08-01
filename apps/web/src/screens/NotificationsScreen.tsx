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
  UserIcon,
  UsersIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../components/ScreenHeader.js';
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
  const navigate = useNavigate();
  const { service, users } = useChat();
  const { clear } = useNotifications();
  const { profile, service: profiles } = useProfile();
  const [acting, setActing] = useState<string>();
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
    } finally {
      setActing(undefined);
    }
  };

  const [items, setItems] = useState<AppNotification[]>();
  const [version, setVersion] = useState(0);

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

  const sections = useMemo(() => {
    if (!items?.length) return [] as { key: DayKey; items: AppNotification[] }[];
    const buckets: Record<DayKey, AppNotification[]> = {
      today: [],
      yesterday: [],
      earlier: [],
    };
    for (const item of items) {
      buckets[dayKey(item.createdAt)].push(item);
    }
    return (['today', 'yesterday', 'earlier'] as const)
      .filter((key) => buckets[key].length > 0)
      .map((key) => ({ key, items: buckets[key] }));
  }, [items]);

  const open = (item: AppNotification) => {
    if (item.kind === 'follow_request' || item.kind === 'follow_accepted') {
      navigate('/requests');
    } else if (item.conversationId) {
      navigate(`/chats/${item.conversationId}`);
    }
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

      <ScreenHeader title="Notifications" showBack={showBack} className="relative z-10" />

      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-1">
        <div className="mx-auto w-full max-w-2xl">
          {!items ? (
            <LoadingState label="Loading notifications" />
          ) : items.length === 0 ? (
            <PremiumEmpty />
          ) : (
            <div className="space-y-6">
              {sections.map((section) => (
                <section key={section.key}>
                  <h2 className="mb-2.5 px-1 text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-text-tertiary">
                    {DAY_LABEL[section.key]}
                  </h2>
                  <ul className="glass-surface overflow-hidden rounded-2xl shadow-sm">
                    {section.items.map((item, index) => {
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
                            actorName={actor?.name ?? item.title}
                            actorAvatar={actor?.avatarUrl}
                            acting={acting === item.id}
                            onOpen={() => open(item)}
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
  actorName,
  actorAvatar,
  acting,
  onOpen,
  onAccept,
  onIgnore,
}: {
  item: AppNotification;
  actorName: string;
  actorAvatar?: string;
  acting: boolean;
  onOpen: () => void;
  onAccept: () => void;
  onIgnore: () => void;
}) {
  const { label, Icon } = kindMeta(item.kind);
  const unread = !item.read;
  const isFollowRequest = item.kind === 'follow_request' && Boolean(item.actorId);

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
            unread && 'ring-2 ring-brand/25 ring-offset-2 ring-offset-glass',
          )}
        />
        <span
          aria-hidden
          className={cn(
            'absolute -right-0.5 -bottom-0.5 grid size-5 place-items-center rounded-full',
            'bg-surface text-brand shadow-sm ring-2 ring-glass',
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
            {item.body ? (
              <span className="font-normal text-text-secondary">
                {' '}
                {item.body}
              </span>
            ) : null}
          </span>
          {unread && (
            <span
              aria-label="Unread"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-dot shadow-[0_0_0_3px_rgba(139,93,255,0.12)]"
            />
          )}
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

      <h2 className="text-h2 tracking-tight text-ink">All quiet</h2>
      <p className="mt-2 max-w-[16rem] text-body leading-relaxed text-text-secondary">
        Follows, messages and Pings land here the moment something needs you.
      </p>
    </div>
  );
}
