import {
  DEFAULT_APPEARANCE,
  DEFAULT_PREFERENCES,
  FONT_SCALE,
  type AppearanceSettings,
  type Preferences,
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

import { syncDocumentVoice } from '../i18n/catalog.js';
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

/**
 * Set once the move to purple has been applied to this install.
 *
 * ## Why a migration is needed at all
 *
 * Changing `DEFAULT_APPEARANCE.accent` moves the arriving colour for a fresh
 * install and nobody else, because the whole preferences object is written to
 * storage on mount - so every existing install already has an accent saved, and
 * the merge below rightly prefers what is stored. Without this, the new default
 * would reach approximately nobody.
 *
 * ## Why v2
 *
 * v1 moved ink to green and has already run on any install that opened the app
 * in the hour green was the default. Reusing its key would mean those installs
 * skip this one and sit on green for good, which is the opposite of the point.
 * A new key runs once more, everywhere.
 *
 * ## What it cannot tell apart
 *
 * `blue` is both "never chose a colour" and "deliberately chose Ink" - the same
 * value is written either way, so there is no signal separating them. This
 * moves both, which means somebody who picked Ink on purpose has it changed
 * once and has to pick it again.
 *
 * That is the cost, and it is paid once: the marker means a person who re-picks
 * their colour afterwards keeps it for good.
 */
const ACCENT_MIGRATION_KEY = 'pingo:accent-purple-v2';

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

/**
 * Move an untouched accent to purple, once per install.
 *
 * `blue` is the ink default nobody picked. `green` is here because it was the
 * default for about an hour between two commits, so an install that loaded the
 * app in that window has green stored without anybody having chosen it - and
 * leaving it would strand exactly the people who happened to open the app at
 * the wrong moment.
 *
 * That is the one place this could be wrong: somebody who genuinely picked green
 * in that hour is moved too. Pink, purple and a custom hex are untouched, which
 * is the rule everywhere else - a default changing underneath a choice is the
 * thing this is careful not to do.
 */
function migrateAccent(appearance: AppearanceSettings): AppearanceSettings {
  try {
    if (localStorage.getItem(ACCENT_MIGRATION_KEY)) return appearance;
    localStorage.setItem(ACCENT_MIGRATION_KEY, '1');
    if (appearance.accent !== 'blue' && appearance.accent !== 'green') return appearance;
    return { ...appearance, accent: 'purple' };
  } catch {
    // Private mode: no marker, no migration. The stored colour stands, which is
    // the safe direction to be wrong in.
    return appearance;
  }
}

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
        appearance: migrateAccent({ ...DEFAULT_PREFERENCES.appearance, ...stored.appearance }),
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
        // Migrated here too: an install still on the v1 key is the oldest one
        // there is, and skipping it would leave exactly the people who have
        // been here longest on the old colour.
        appearance: migrateAccent({
          ...DEFAULT_PREFERENCES.appearance,
          ...(JSON.parse(legacy) as Partial<AppearanceSettings>),
        }),
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

  /*
   * There is deliberately no `useAuth()` here.
   *
   * This provider sits *above* `AuthProvider` in `App`, so calling that hook
   * threw "useAuth must be used inside an <AuthProvider>" during render - which
   * crashes at the root and paints a blank page with no error anybody sees.
   * Everything that needs a session lives in `NotificationPrefsSync`, mounted
   * inside the auth tree, which reads this context rather than the reverse.
   */

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
    /*
     * Accent drives --color-brand, --gradient-*, --color-dot, hover/focus across
     * the whole product (buttons, bubbles, chips, loaders, rings). User picks
     * override every surface that reads brand tokens — not hard-coded blacks.
     *
     * The fallback is `DEFAULT_APPEARANCE.accent` rather than a literal, because
     * a second copy of the default is a second thing to forget: this one said
     * `blue` and would have quietly kept painting the product ink for anybody
     * whose stored settings had no accent in them at all.
     */
    root.setAttribute('data-accent', appearance.accent || DEFAULT_APPEARANCE.accent);
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

    // Voice / language mode for copy (`en` vs `en-genz`).
    syncDocumentVoice(preferences.language);

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

        return next;
      });
    },
    [],
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
