import { useAuth } from '@pingo/core';
import { useEffect, useRef } from 'react';

import { loadPrefs, savePrefs } from './notification-sync.js';
import { usePreferences } from './SettingsContext.js';

/**
 * Keeps notification preferences in step with the server.
 *
 * ## Why this is a component and not part of `SettingsProvider`
 *
 * `SettingsProvider` wraps `AuthProvider` in `App` - it has to, because the
 * theme is applied to the document before anything else renders. So it cannot
 * call `useAuth`: the hook throws when there is no provider above it, and a
 * throw during render at that depth blanks the entire app. That is exactly what
 * happened, and this file exists so it cannot happen again - anything needing a
 * session lives here, inside the auth tree, reading the settings context rather
 * than the other way round.
 *
 * ## Loading does not trigger a save
 *
 * Writing the server's own values back to it would be a wasted round trip on
 * every launch, and on a slow connection it could race a real change. The last
 * synced snapshot is remembered, and a save only happens when the preferences
 * differ from it.
 */
export function NotificationPrefsSync() {
  const { session } = useAuth();
  const { preferences, update } = usePreferences();
  const userId = session?.user.id;

  /** What the server is known to hold, so an echo is not written back. */
  const synced = useRef<string | undefined>(undefined);
  /** The values at mount, used only to seed a first row. See `loadPrefs`. */
  const seed = useRef(preferences.notifications);

  useEffect(() => {
    if (!userId) {
      synced.current = undefined;
      return;
    }

    let active = true;
    void loadPrefs(userId, seed.current).then((server) => {
      if (!active || !server) return;
      synced.current = JSON.stringify(server);
      update('notifications', server);
    });

    return () => {
      active = false;
    };
    // `update` is stable and `seed` is a ref: this runs once per signed-in user,
    // which is what "load their settings when they arrive" means.
  }, [userId, update]);

  useEffect(() => {
    if (!userId || synced.current === undefined) return;

    const current = JSON.stringify(preferences.notifications);
    if (current === synced.current) return;

    /*
     * Optimistic. The switch has already moved; this follows. A failed write
     * leaves the server on its previous value and the next load corrects the
     * screen - which is the right way round, because a toggle that waits on a
     * round trip feels broken on a slow connection.
     */
    synced.current = current;
    void savePrefs(userId, preferences.notifications);
  }, [userId, preferences.notifications]);

  return null;
}
