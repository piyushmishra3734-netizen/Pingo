/**
 * The two privacy switches, readable from outside React.
 *
 * Both of them are enforced where the data is *published* rather than where it
 * is displayed - the heartbeat that writes "last seen", the call that moves the
 * read cursor - and neither of those is a component. Hiding either on the
 * receiving side would be asking every other person's copy of the app to keep a
 * promise on this user's behalf, which is not a promise software can make.
 *
 * Read straight from the same storage the settings screen writes, so there is
 * one copy of the answer and no context to thread through the service layer.
 * Absent means on, which is what every account meant before the switches did
 * anything.
 */

const PREFERENCES_KEY = 'pingo:preferences';

/** Written by the profile service whenever the account's rules are seen. */
const RULES_CACHE_KEY = 'pingo:privacy_rules_cache';

function readFlag(key: string, path: (parsed: Record<string, unknown>) => unknown): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return true;
    const value = path(JSON.parse(raw) as Record<string, unknown>);
    return value === undefined ? true : value !== false;
  } catch {
    // A corrupt or unreadable store must not silently switch privacy *off*;
    // it also must not switch it on. On is the documented default.
    return true;
  }
}

/**
 * Whether this account still tells people when it is here.
 *
 * The account's rule rather than this device's preference: being seen online is
 * a fact about the person, and turning it off on a phone while a laptop keeps
 * broadcasting would not be turning it off at all. Cached locally because the
 * heartbeat runs every minute and must not ask the network what it already
 * knows - see `cachePrivacyRules`.
 */
export function activityStatusOn(): boolean {
  return readFlag(RULES_CACHE_KEY, (parsed) => parsed.onlineStatus);
}

/**
 * Keeps the local answer in step with the account's, on read and on save.
 *
 * Announces the change as well, because the thing that matters most - the
 * presence channel saying "here" every time it connects - is already running
 * by the time anybody opens Settings. Without the event it would keep
 * broadcasting until the next launch, which is the shape of switch nobody
 * believes: it does something, tomorrow.
 */
export function cachePrivacyRules(rules: { onlineStatus: boolean }): void {
  try {
    localStorage.setItem(RULES_CACHE_KEY, JSON.stringify({ onlineStatus: rules.onlineStatus }));
  } catch {
    // Private mode, a full quota. The default stands and nothing else breaks.
  }
  try {
    window.dispatchEvent(new CustomEvent('pingo:privacy-changed'));
  } catch {
    // No window (a worker, a test). Nothing is listening there either.
  }
}

/**
 * Whether this device reports messages as read.
 *
 * Off does not mean the reader loses their own place - it means nobody else is
 * told about it until they answer. See `read-cursor.ts`.
 */
export function readReceiptsOn(): boolean {
  return readFlag(PREFERENCES_KEY, (parsed) => {
    const privacy = parsed.privacy as Record<string, unknown> | undefined;
    return privacy?.readReceipts;
  });
}
