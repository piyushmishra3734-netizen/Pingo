import {
  DEFAULT_PREFERENCES,
  FONT_SCALE,
  type AppearanceSettings,
  type Preferences,
  useAuth,
} from '@pingo/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { loadPrefs, savePrefs } from './notification-sync.js';

/**
 * Every preference, held here and applied to the document root.
 *
 * ## The attributes are the API
 *
 * Appearance and font size write `data-*` attributes and a root font size onto
 * `<html>`, and `packages/tokens` does the rest by overriding the same tokens
 * every component already reads. No component subscribes to this context to
 * restyle itself - the CSS cascade does the work, which is why changing accent
 * retints buttons, rings, chips, bubbles and focus outlines in one frame
 * without a single re-render.
 *
 * The rest of the preferences are plain stored values, read by whichever screen
 * cares. Several have no reader yet; `preferences.ts` says which and why.
 */

const STORAGE_KEY = 'pingo:preferences';
/** The v1 key, when only appearance existed. Migrated on first read. */
const LEGACY_APPEARANCE_KEY = 'pingo:appearance';

interface SettingsContextValue {
  preferences: Preferences;
  /** Shorthand - appearance is read far more often than anything else. */
  appearance: AppearanceSettings;
  updateAppearance: (changes: Partial<AppearanceSettings>) => void;
  /** Patches one group, e.g. `update('privacy', { readReceipts: false })`. */
  update: <K extends keyof Preferences>(
    group: K,
    changes: Partial<Preferences[K]>,
  ) => void;
  reset: () => void;
  /** What `auto` currently resolves to, for showing the active state. */
  resolvedTheme: 'light' | 'dark';
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

function read(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<Preferences>;
      /*
       * Merged per group over the defaults, so a preferences blob written by an
       * older build gains new keys rather than leaving them undefined and
       * crashing a control that expects a value.
       */
      return {
        ...DEFAULT_PREFERENCES,
        ...stored,
        appearance: { ...DEFAULT_PREFERENCES.appearance, ...stored.appearance },
        notifications: { ...DEFAULT_PREFERENCES.notifications, ...stored.notifications },
        privacy: { ...DEFAULT_PREFERENCES.privacy, ...stored.privacy },
        chats: { ...DEFAULT_PREFERENCES.chats, ...stored.chats },
        camera: { ...DEFAULT_PREFERENCES.camera, ...stored.camera },
        calls: { ...DEFAULT_PREFERENCES.calls, ...stored.calls },
        advanced: { ...DEFAULT_PREFERENCES.advanced, ...stored.advanced },
      };
    }

    // One-time migration: don't make anyone re-pick a theme they already chose.
    const legacy = localStorage.getItem(LEGACY_APPEARANCE_KEY);
    if (legacy) {
      return {
        ...DEFAULT_PREFERENCES,
        appearance: {
          ...DEFAULT_PREFERENCES.appearance,
          ...(JSON.parse(legacy) as Partial<AppearanceSettings>),
        },
      };
    }
  } catch {
    // Unreadable or malformed. Defaults are always a valid place to start.
  }
  return DEFAULT_PREFERENCES;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(read);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );

  const { session } = useAuth();
  const userId = session?.user.id;

  /**
   * Pulls the server's notification preferences once there is a session.
   *
   * Keyed on the user, so switching accounts on one device loads that person's
   * settings rather than leaving the previous one's switches on screen.
   *
   * The local values are handed over as the seed. Somebody who turned messages
   * off before these lived on the server would otherwise have them switched
   * back on by the defaults the first time this ran - which is the one
   * migration outcome that is genuinely unacceptable.
   */
  useEffect(() => {
    if (!userId) return;

    let active = true;
    void loadPrefs(userId, preferences.notifications).then((server) => {
      if (!active || !server) return;
      setPreferences((previous) => ({ ...previous, notifications: server }));
    });

    return () => {
      active = false;
    };
    // Deliberately not depending on `preferences.notifications`: it is the seed
    // for a first write, not an input that should re-run the fetch on every
    // toggle. Re-running on each change would fight the optimistic update.

  }, [userId]);

  const { appearance } = preferences;

  // `auto` has to keep following the OS after load, not just sample it once.
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;

    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    appearance.theme === 'auto' ? (systemDark ? 'dark' : 'light') : appearance.theme;

  useEffect(() => {
    const root = document.documentElement;

    root.setAttribute('data-theme', resolvedTheme);
    root.setAttribute('data-accent', appearance.accent);
    root.setAttribute('data-motion', appearance.motion);
    root.setAttribute('data-glass', String(appearance.glass));

    if (appearance.accent === 'custom' && appearance.customAccent) {
      root.style.setProperty('--custom-accent', appearance.customAccent);
    } else {
      root.style.removeProperty('--custom-accent');
    }

    /*
     * Font size is set on the root in px, and every size in the product is in
     * rem, so one property resizes the whole app proportionally rather than
     * just the message text.
     */
    root.style.fontSize = FONT_SCALE[preferences.chats.fontSize];

    /*
     * Keeps browser chrome, the address bar on Android, the status bar on iOS
     * - matching the page. Without it a dark app sits under a white bar, which
     * is the single most obvious sign of a theme bolted on afterwards.
     */
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme === 'dark' ? '#0c0d11' : '#FBFBFE');

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Private mode. The choice still applies for this session.
    }
  }, [preferences, appearance, resolvedTheme]);

  const updateAppearance = useCallback((changes: Partial<AppearanceSettings>) => {
    setPreferences((previous) => ({
      ...previous,
      appearance: { ...previous.appearance, ...changes },
    }));
  }, []);

  const update = useCallback(
    <K extends keyof Preferences>(group: K, changes: Partial<Preferences[K]>) => {
      setPreferences((previous) => {
        const next = {
          ...previous,
          [group]:
            // Scalars (`language`) are replaced; groups are merged.
            typeof previous[group] === 'object' && previous[group] !== null
              ? { ...previous[group], ...changes }
              : changes,
        };

        /*
         * Notifications are the one group that also lives on the server.
         *
         * Every other preference here describes *this device* - the theme, the
         * font size, whether Enter sends - and syncing those would be wrong,
         * because a phone and a desktop may reasonably differ. Notifications
         * are decided by a Postgres trigger, which cannot read a browser's
         * storage, so a switch left purely local changed nothing at all.
         *
         * Written optimistically: the toggle moves now and the request follows.
         * A failed write leaves the server on its previous value and the next
         * load corrects the screen, which is the right way round - a switch
         * that waits on a round trip feels broken on a slow connection.
         */
        if (group === 'notifications' && userId) {
          void savePrefs(userId, next.notifications);
        }

        return next;
      });
    },
    [userId],
  );

  const reset = useCallback(() => setPreferences(DEFAULT_PREFERENCES), []);

  const value = useMemo<SettingsContextValue>(
    () => ({ preferences, appearance, updateAppearance, update, reset, resolvedTheme }),
    [preferences, appearance, updateAppearance, update, reset, resolvedTheme],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useAppearance(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useAppearance must be used inside a <SettingsProvider>');
  return context;
}

/** Same context, named for the screens that read more than appearance. */
export const usePreferences = useAppearance;
