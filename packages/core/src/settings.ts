/**
 * Appearance settings, and the registry that makes them searchable.
 *
 * ## Why appearance is device state, not account state
 *
 * Theme, accent, motion and glass are stored on the device rather than the
 * profile, and that is deliberate. Two reasons:
 *
 * 1. **It is a device preference.** Dark on a phone at night and light on a
 *    desktop at noon is one person with two correct answers, and syncing would
 *    force one of them to be wrong.
 * 2. **It has to apply before the first paint.** A profile arrives after a
 *    network round trip; a dark-mode user would watch the app flash white on
 *    every launch while it loaded their preference.
 *
 * Account-level settings — who can call you, notification routing — belong in
 * the database, because they govern what the *server* does. These four govern
 * only what this screen looks like.
 */

export type ThemeMode = 'light' | 'dark' | 'auto';
export type AccentName = 'blue' | 'purple' | 'green' | 'pink' | 'custom';
export type MotionLevel = 'smooth' | 'balanced' | 'minimal';
/** Percentages, matching the labels the user sees. */
export type GlassLevel = 0 | 25 | 50 | 75 | 100;

export interface AppearanceSettings {
  theme: ThemeMode;
  accent: AccentName;
  /** Hex, only meaningful when `accent` is `custom`. */
  customAccent?: string;
  motion: MotionLevel;
  glass: GlassLevel;
}

/**
 * The board's defaults, exactly.
 *
 * `auto` follows the OS rather than assuming light: the product should arrive
 * already matching the device it was opened on.
 */
export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'auto',
  accent: 'blue',
  motion: 'balanced',
  glass: 50,
};

export const ACCENT_SWATCHES: Record<Exclude<AccentName, 'custom'>, string> = {
  blue: '#5c6cff',
  purple: '#8b5dff',
  green: '#17a67a',
  pink: '#e0559b',
};

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * Every setting the product has, as data.
 *
 * This exists so **search is not a separate implementation of the settings
 * tree.** A search that maintains its own list of what exists drifts the first
 * time someone adds a toggle and forgets to register it; here, the pages and
 * the search results are generated from the same array, so a setting that is
 * findable is a setting that exists.
 *
 * `keywords` carry the words a user would actually type — "night" for dark
 * mode, "colour" for accent — which is the whole difference between a search
 * box and a useful one.
 */
export interface SettingsEntry {
  id: string;
  /** The control's own name, e.g. "Dark Mode". */
  label: string;
  /** The page it lives on, e.g. "Appearance". */
  section: string;
  /** Route to the page. */
  path: string;
  keywords: string[];
  /** False while the page exists but the control does nothing yet. */
  live: boolean;
}

export const SETTINGS_REGISTRY: SettingsEntry[] = [
  // -- Appearance (fully wired) ---------------------------------------------
  {
    id: 'appearance.theme',
    label: 'Dark Mode',
    section: 'Appearance',
    path: '/settings/appearance',
    keywords: ['theme', 'dark', 'light', 'night', 'auto', 'system', 'colour scheme'],
    live: true,
  },
  {
    id: 'appearance.accent',
    label: 'Accent',
    section: 'Appearance',
    path: '/settings/appearance',
    keywords: ['color', 'colour', 'accent', 'blue', 'purple', 'green', 'pink', 'custom', 'brand'],
    live: true,
  },
  {
    id: 'appearance.motion',
    label: 'Animations',
    section: 'Appearance',
    path: '/settings/appearance',
    keywords: ['animation', 'motion', 'smooth', 'balanced', 'minimal', 'speed', 'transitions'],
    live: true,
  },
  {
    id: 'appearance.glass',
    label: 'Glass Intensity',
    section: 'Appearance',
    path: '/settings/appearance',
    keywords: ['glass', 'blur', 'transparency', 'frosted', 'translucent', 'intensity'],
    live: true,
  },

  // -- Account ---------------------------------------------------------------
  {
    id: 'account.photo',
    label: 'Profile Photo',
    section: 'Account',
    path: '/settings/account',
    keywords: ['photo', 'avatar', 'picture', 'profile'],
    live: true,
  },
  {
    id: 'account.username',
    label: 'Username',
    section: 'Account',
    path: '/settings/account',
    keywords: ['username', 'handle', 'name', '@'],
    live: true,
  },
  {
    id: 'account.name',
    label: 'Display Name',
    section: 'Account',
    path: '/settings/account',
    keywords: ['name', 'display', 'called'],
    live: true,
  },
  {
    id: 'account.logout',
    label: 'Logout',
    section: 'Account',
    path: '/settings/account',
    keywords: ['logout', 'log out', 'sign out', 'exit'],
    live: true,
  },

  // -- Notifications ---------------------------------------------------------
  entry('notifications.messages', 'Messages', 'Notifications', ['message', 'dm', 'chat', 'alert']),
  entry('notifications.groups', 'Groups', 'Notifications', ['group', 'alert']),
  entry('notifications.calls', 'Calls', 'Notifications', ['call', 'ring', 'alert']),
  entry('notifications.communities', 'Communities', 'Notifications', ['community', 'channel']),
  entry('notifications.streak', 'Streak Reminder', 'Notifications', ['streak', 'fire', 'remind']),
  entry('notifications.birthday', 'Friend Birthday', 'Notifications', ['birthday', 'friend']),
  entry('notifications.muteAll', 'Mute All', 'Notifications', ['mute', 'silence', 'off', 'dnd']),
  entry('notifications.quietHours', 'Quiet Hours', 'Notifications', [
    'quiet',
    'hours',
    'night',
    'do not disturb',
    'dnd',
    'sleep',
  ]),

  // -- Privacy ---------------------------------------------------------------
  entry('privacy.call', 'Who can call me', 'Privacy', ['call', 'who', 'permission']),
  entry('privacy.add', 'Who can add me', 'Privacy', ['add', 'friend', 'request', 'who']),
  entry('privacy.profile', 'Profile Visibility', 'Privacy', ['profile', 'visible', 'visibility']),
  entry('privacy.online', 'Online Status', 'Privacy', ['online', 'presence', 'active', 'status']),
  entry('privacy.receipts', 'Read Receipts', 'Privacy', ['read', 'receipt', 'seen', 'ticks']),
  entry('privacy.screenshot', 'Screenshot Alerts', 'Privacy', ['screenshot', 'capture', 'alert']),
  entry('privacy.blocked', 'Blocked Users', 'Privacy', ['block', 'blocked', 'ban']),

  // -- Chats -----------------------------------------------------------------
  entry('chats.fontSize', 'Font Size', 'Chats', ['font', 'size', 'text', 'bigger', 'smaller']),
  entry('chats.wallpaper', 'Chat Wallpaper', 'Chats', ['wallpaper', 'background', 'theme']),
  entry('chats.bubble', 'Bubble Style', 'Chats', ['bubble', 'style', 'message', 'shape']),
  entry('chats.autoDownload', 'Auto Download', 'Chats', ['download', 'media', 'auto', 'data']),
  entry('chats.enterToSend', 'Enter to Send', 'Chats', ['enter', 'return', 'send', 'keyboard']),
  entry('chats.swipe', 'Swipe Actions', 'Chats', ['swipe', 'gesture', 'action']),

  // -- Camera ----------------------------------------------------------------
  entry('camera.default', 'Default Camera', 'Camera & Snaps', ['camera', 'front', 'back', 'selfie']),
  entry('camera.filters', 'Filters', 'Camera & Snaps', ['filter', 'effect', 'lens']),
  entry('camera.beauty', 'Beauty', 'Camera & Snaps', ['beauty', 'smooth', 'skin']),
  entry('camera.hdr', 'HDR', 'Camera & Snaps', ['hdr', 'dynamic range', 'quality']),
  entry('camera.save', 'Save Snaps', 'Camera & Snaps', ['save', 'gallery', 'roll']),
  entry('camera.mirror', 'Mirror Camera', 'Camera & Snaps', ['mirror', 'flip', 'reverse']),
  entry('camera.quality', 'Upload Quality', 'Camera & Snaps', ['quality', 'upload', 'data']),

  // -- Calls -----------------------------------------------------------------
  entry('calls.noise', 'Noise Cancellation', 'Calls', ['noise', 'cancel', 'background', 'audio']),
  entry('calls.echo', 'Echo Cancellation', 'Calls', ['echo', 'cancel', 'audio']),
  entry('calls.hdAudio', 'HD Audio', 'Calls', ['hd', 'audio', 'quality', 'sound']),
  entry('calls.hdVideo', 'HD Video', 'Calls', ['hd', 'video', 'quality']),
  entry('calls.camera', 'Camera Default', 'Calls', ['camera', 'video', 'default', 'on']),
  entry('calls.mic', 'Microphone Test', 'Calls', ['microphone', 'mic', 'test', 'audio']),

  // -- Storage ---------------------------------------------------------------
  entry('storage.cache', 'Cache', 'Storage', ['cache', 'space', 'clear']),
  entry('storage.media', 'Downloaded Media', 'Storage', ['media', 'downloads', 'photos']),
  entry('storage.clear', 'Clear Cache', 'Storage', ['clear', 'cache', 'free', 'space', 'delete']),

  // -- Language --------------------------------------------------------------
  entry('language', 'Language', 'Language', ['language', 'locale', 'english', 'hindi']),

  // -- Advanced --------------------------------------------------------------
  entry('advanced.developer', 'Developer Mode', 'Advanced', ['developer', 'dev', 'debug']),
  entry('advanced.experimental', 'Experimental Features', 'Advanced', ['experimental', 'labs']),
  entry('advanced.beta', 'Beta Features', 'Advanced', ['beta', 'preview', 'early']),
  entry('advanced.logs', 'Debug Logs', 'Advanced', ['debug', 'log', 'logs', 'diagnostic']),

  // -- Help ------------------------------------------------------------------
  entry('help.about', 'About PINGO', 'Help', ['about', 'version', 'build']),
  entry('help.contact', 'Contact Support', 'Help', ['support', 'contact', 'help', 'problem']),
];

/** Terse constructor for the bulk of the registry, which is all the same shape. */
function entry(
  id: string,
  label: string,
  section: string,
  keywords: string[],
): SettingsEntry {
  return {
    id,
    label,
    section,
    path: `/settings/${section.toLowerCase().replace(/\s*&\s*/g, '-').replace(/\s+/g, '-')}`,
    keywords,
    live: true,
  };
}

/**
 * Ranked matches for a query.
 *
 * Label matches beat keyword matches, and a prefix beats a substring — so
 * typing "the" surfaces **Theme** above anything that merely mentions it. Empty
 * query returns nothing rather than everything: the index below the box is
 * already the full list.
 */
export function searchSettings(query: string): SettingsEntry[] {
  const term = query.trim().toLowerCase();
  if (term.length === 0) return [];

  const scored: { entry: SettingsEntry; score: number }[] = [];

  for (const entry of SETTINGS_REGISTRY) {
    const label = entry.label.toLowerCase();
    const section = entry.section.toLowerCase();

    let score = 0;
    if (label.startsWith(term)) score = 100;
    else if (label.includes(term)) score = 80;
    else if (section.startsWith(term)) score = 60;
    else if (section.includes(term)) score = 50;
    else if (entry.keywords.some((word) => word.startsWith(term))) score = 40;
    else if (entry.keywords.some((word) => word.includes(term))) score = 20;

    if (score > 0) scored.push({ entry, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
    .map((item) => item.entry);
}
