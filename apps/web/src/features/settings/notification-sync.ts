import type { NotificationPreferences } from '@pingo/core';

import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * Notification preferences, on the server.
 *
 * ## Why these left `localStorage` when nothing else did
 *
 * Every other preference in PINGO is about *this device* - the theme, the font
 * size, whether Enter sends. Those are correctly local, and syncing them would
 * be wrong: a phone and a desktop can reasonably want different answers.
 *
 * Notification preferences are the exception, because the thing that acts on
 * them is not a device at all. Push is decided by a Postgres trigger, and a
 * trigger cannot read a browser's `localStorage`. Left local, "turn off
 * notifications" was a switch that moved and changed nothing - the server kept
 * sending, and the person who turned it off had no way to know why.
 *
 * ## One writable copy
 *
 * The server is the source of truth and the client keeps a cache. The cache is
 * written only *after* the server accepts a change, so the two cannot disagree
 * about what was saved - a local write that later failed would otherwise leave
 * a switch showing a state the server never agreed to.
 *
 * The cache exists so the settings screen paints instantly on open rather than
 * showing defaults for a beat and then correcting itself, which reads as the
 * screen forgetting what you chose.
 */

const CACHE_KEY = 'pingo:notification-prefs';

/** Column names are snake_case; the product is camelCase. One place converts. */
interface PrefsRow {
  muted: boolean;
  messages: boolean;
  groups: boolean;
  calls: boolean;
  friend_requests: boolean;
  stories: boolean;
  ai: boolean;
  journey: boolean;
  marketing: boolean;
  preview: 'sender_only' | 'sender_and_text' | 'hidden';
  quiet_enabled: boolean;
  quiet_start_minute: number;
  quiet_end_minute: number;
  utc_offset_minutes: number;
}

/** `"22:00"` to 1320. The server stores minutes so a trigger can compare them. */
function toMinutes(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function toTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fromRow(row: PrefsRow): NotificationPreferences {
  return {
    muteAll: row.muted,
    messages: row.messages,
    groups: row.groups,
    calls: row.calls,
    friendRequests: row.friend_requests,
    stories: row.stories,
    ai: row.ai,
    journey: row.journey,
    marketing: row.marketing,
    preview:
      row.preview === 'sender_and_text'
        ? 'sender-and-text'
        : row.preview === 'hidden'
          ? 'hidden'
          : 'sender-only',
    quietHours: row.quiet_enabled,
    quietHoursStart: toTime(row.quiet_start_minute),
    quietHoursEnd: toTime(row.quiet_end_minute),
  };
}

function toRow(prefs: NotificationPreferences, userId: string): PrefsRow & { user_id: string } {
  return {
    user_id: userId,
    muted: prefs.muteAll,
    messages: prefs.messages,
    groups: prefs.groups,
    calls: prefs.calls,
    friend_requests: prefs.friendRequests,
    stories: prefs.stories,
    ai: prefs.ai,
    journey: prefs.journey,
    marketing: prefs.marketing,
    preview:
      prefs.preview === 'sender-and-text'
        ? 'sender_and_text'
        : prefs.preview === 'hidden'
          ? 'hidden'
          : 'sender_only',
    quiet_enabled: prefs.quietHours,
    quiet_start_minute: toMinutes(prefs.quietHoursStart),
    quiet_end_minute: toMinutes(prefs.quietHoursEnd),
    /*
     * The offset, not a zone name. Quiet hours mean the user's ten at night
     * wherever they are, and a trigger comparing minutes has no tz database to
     * consult. Re-sent on every save, so somebody who moves country has their
     * quiet hours follow them the next time they touch the screen.
     */
    utc_offset_minutes: -new Date().getTimezoneOffset(),
  };
}

export function readCachedPrefs(): NotificationPreferences | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as NotificationPreferences) : undefined;
  } catch {
    return undefined;
  }
}

function cache(prefs: NotificationPreferences): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode. The server still has it, so nothing is lost - the screen
    // just paints defaults for a moment on next open.
  }
}

/**
 * Reads the server copy, creating it on first run.
 *
 * A user who has never opened this screen has no row, and the trigger reads a
 * missing row as "notify". Writing the defaults on first read makes the two
 * agree explicitly rather than by coincidence.
 *
 * @param migrating preferences to seed the row with - the old local ones, so
 * somebody who turned notifications off before this existed does not have them
 * silently turned back on.
 */
export async function loadPrefs(
  userId: string,
  migrating?: NotificationPreferences,
): Promise<NotificationPreferences | undefined> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('notification_prefs')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return undefined;

  if (data) {
    const prefs = fromRow(data as PrefsRow);
    cache(prefs);
    return prefs;
  }

  if (!migrating) return undefined;

  await savePrefs(userId, migrating);
  return migrating;
}

/** Writes the server copy, then the cache. Never the other way round. */
export async function savePrefs(
  userId: string,
  prefs: NotificationPreferences,
): Promise<boolean> {
  const { error } = await getSupabaseClient()
    .from('notification_prefs')
    .upsert(toRow(prefs, userId), { onConflict: 'user_id' });

  if (error) return false;
  cache(prefs);
  return true;
}
