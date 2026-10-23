import { loadLocks } from '../lock/lock-store.js';
import { useChat } from '@pingo/core';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getSupabaseClient } from '../../lib/supabase/client.js';
import { useBrowserBadge } from './useBrowserBadge.js';
import { usePushRegistration } from './usePushRegistration.js';

/**
 * The unread count, once for the whole app.
 *
 * ## Why it is not local to a screen
 *
 * It used to live inside the chat list, which meant the badge only existed on
 * the one screen that rendered it. A notification arriving while the user was
 * on Camera or Profile was invisible until they navigated back - the count was
 * correct and nobody could see it.
 *
 * Held here, one subscription serves every screen, and the number survives
 * navigation instead of being refetched on each mount.
 *
 * ## Optimistic on arrival, authoritative on read
 *
 * A `notification:new` event bumps the count without asking the server, because
 * the event *is* the notification. Marking read goes the other way and resets
 * to zero locally - the screen that does it has just read everything, so there
 * is nothing to reconcile.
 */

interface NotificationContextValue {
  unread: number;
  /** Unread activity by kind (likes, follows, calls...), for the popup over the Activity tab. */
  byKind: Record<string, number>;
  /** Called by the feed once it has marked everything read. */
  clear: () => void;
}

/** A chat line is counted, and cleared, on the chat itself (see `is_chat_notification`). */
export const CHAT_NOTIFICATION_KINDS = new Set(['message', 'voice', 'snap', 'ping', 'mention', 'ai']);

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { service, ready } = useChat();
  const [unread, setUnread] = useState(0);
  const [byKind, setByKind] = useState<Record<string, number>>({});

  /*
   * Mounted here rather than in `App`, because this is already the place that
   * owns "how does someone find out something happened". The in-app badge and
   * the notification on the lock screen are two answers to one question, and
   * keeping them together is what stops a future change to one from forgetting
   * the other.
   */
  usePushRegistration();

  /*
   * Mounted here for the same reason: this provider owns "how does somebody
   * find out something happened". A lock screen, an in-app badge and a browser
   * tab are three answers to one question, and keeping them together is what
   * stops a change to one forgetting the others.
   */
  useBrowserBadge();

  useEffect(() => {
    // Waits for the session: an unauthenticated count is always zero and the
    // request would only fail.
    if (!ready) return;
    void loadLocks();

    let active = true;
    void service
      .unreadNotifications()
      .then((n) => {
        if (active) setUnread(n);
      })
      .catch(() => undefined);

    const loadKinds = () => {
      void getSupabaseClient()
        .rpc('unread_activity_counts')
        .then(({ data, error }) => {
          if (!active || error || !Array.isArray(data)) return;
          setByKind(Object.fromEntries(data.map((row) => [row.kind, row.count])));
        });
    };
    loadKinds();

    const unsubscribe = service.subscribe((event) => {
      if (event.type !== 'notification:new') return;
      const kind = event.notification.kind;
      // Chat lines, mentions included, are read (and cleared) in the chat itself.
      if (CHAT_NOTIFICATION_KINDS.has(kind)) return;
      setUnread((n) => n + 1);
      setByKind((all) => ({ ...all, [kind]: (all[kind] ?? 0) + 1 }));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [service, ready]);

  const value = useMemo<NotificationContextValue>(
    () => ({
      unread,
      byKind,
      clear: () => {
        setUnread(0);
        setByKind({});
      },
    }),
    [unread, byKind],
  );

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used inside a <NotificationProvider>');
  }
  return context;
}
