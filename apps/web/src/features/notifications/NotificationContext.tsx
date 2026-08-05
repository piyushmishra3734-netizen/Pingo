import { useChat } from '@pingo/core';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

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
  /** Called by the feed once it has marked everything read. */
  clear: () => void;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { service, ready } = useChat();
  const [unread, setUnread] = useState(0);

  /*
   * Mounted here rather than in `App`, because this is already the place that
   * owns "how does someone find out something happened". The in-app badge and
   * the notification on the lock screen are two answers to one question, and
   * keeping them together is what stops a future change to one from forgetting
   * the other.
   */
  usePushRegistration();

  useEffect(() => {
    // Waits for the session: an unauthenticated count is always zero and the
    // request would only fail.
    if (!ready) return;

    let active = true;
    void service
      .unreadNotifications()
      .then((n) => {
        if (active) setUnread(n);
      })
      .catch(() => undefined);

    const unsubscribe = service.subscribe((event) => {
      if (event.type === 'notification:new') setUnread((n) => n + 1);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [service, ready]);

  const value = useMemo<NotificationContextValue>(
    () => ({ unread, clear: () => setUnread(0) }),
    [unread],
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
