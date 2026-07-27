import {
  formatConversationTimestamp,
  useChat,
  useProfile,
  type AppNotification,
} from '@pingo/core';
import {
  Avatar,
  BellIcon,
  ChevronLeftIcon,
  EmptyState,
  IconButton,
  LoadingState,
  cn,
} from '@pingo/ui';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useNotifications } from '../features/notifications/NotificationContext.js';

/**
 * Everything that happened to you, newest first.
 *
 * ## Opening the screen marks it read
 *
 * There is no "mark all read" button, because the only thing such a button ever
 * does is confirm what looking already achieved. The badge clears on arrival,
 * and unread rows stay tinted for this visit so the list does not visibly reset
 * under the reader.
 *
 * ## Where each row goes
 *
 * A follow notification opens requests; a message or Ping opens the thread it
 * belongs to. A notification you cannot act on is just a log entry.
 */
export function NotificationsScreen() {
  const navigate = useNavigate();
  const { service } = useChat();
  const { clear } = useNotifications();
  const { service: profiles } = useProfile();
  const [acting, setActing] = useState<string>();

  /*
   * Answering happens here rather than on a separate screen.
   *
   * A notification that only tells you to go somewhere else to act on it is a
   * signpost, not a notification — and the request screen still exists for
   * anyone who wants the full list.
   */
  const respond = async (item: AppNotification, accept: boolean) => {
    if (!item.actorId || acting) return;
    setActing(item.id);
    try {
      await (accept
        ? profiles.acceptFollow(item.actorId)
        : profiles.removeFollow(item.actorId));
      // The row stays, but its decision is spent, so it stops offering one.
      setItems((all) =>
        all?.map((n) => (n.id === item.id ? { ...n, kind: 'follow_accepted' as const } : n)),
      );
    } finally {
      setActing(undefined);
    }
  };

  const [items, setItems] = useState<AppNotification[]>();
  const { users } = useChat();

  useEffect(() => {
    let active = true;
    void service
      .listNotifications()
      .then((list) => {
        if (!active) return;
        setItems(list);
        // After the list is in hand, so the tint below reflects what arrived
        // rather than what the server now says.
        void service.markAllNotificationsRead();
        // The badge is shared, so clearing it here is what makes it disappear
        // from the dock as well.
        clear();
      })
      .catch(() => {
        if (active) setItems([]);
      });
    return () => {
      active = false;
    };
  }, [service]);

  const open = (item: AppNotification) => {
    if (item.kind === 'follow_request' || item.kind === 'follow_accepted') {
      navigate('/requests');
    } else if (item.conversationId) {
      navigate(`/chats/${item.conversationId}`);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <header
        className={cn(
          'sticky top-0 z-100 shrink-0 flex items-center gap-1',
          'glass-surface border-x-0 border-t-0 border-b-line',
          'px-3 pt-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]',
        )}
      >
        <IconButton label="Back" variant="ghost" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={22} />
        </IconButton>
        <h1 className="text-h2 text-ink">Notifications</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {!items ? (
          <LoadingState label="Loading notifications" />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing yet"
            description="Follows, messages and Pings will show up here."
            icon={<BellIcon size={26} />}
          />
        ) : (
          <ul className="space-y-0.5">
            {items.map((item, index) => {
              const actor = users.find((u) => u.id === item.actorId);
              return (
                <li
                  key={item.id}
                  className="animate-row-in"
                  style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => open(item)}
                    className={cn(
                      'focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
                      'transition-colors duration-instant hover:bg-hover',
                      // Unread stays tinted for this visit; it is already
                      // marked read on the server.
                      !item.read && 'bg-selected',
                    )}
                  >
                    <Avatar
                      name={item.title}
                      id={item.actorId ?? item.id}
                      src={actor?.avatarUrl}
                      size="md"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">
                        <span className="font-medium">{item.title}</span> {item.body}
                      </span>
                      <span className="mt-0.5 block text-caption text-text-tertiary">
                        {formatConversationTimestamp(item.createdAt)}
                      </span>
                    </span>

                    {item.kind === 'follow_request' && item.actorId && (
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            void respond(item, true);
                          }}
                          className={cn(
                            'focus-ring rounded-full bg-brand-gradient px-3.5 py-1.5',
                            'text-caption font-medium text-white',
                            acting === item.id && 'opacity-60',
                          )}
                        >
                          Accept
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            void respond(item, false);
                          }}
                          className="focus-ring rounded-full px-2.5 py-1.5 text-caption text-text-secondary"
                        >
                          Ignore
                        </span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
