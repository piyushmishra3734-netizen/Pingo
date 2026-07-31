import type { NotificationPreferences } from '@pingo/core';

/**
 * Whether quiet hours currently suppress in-app message banners.
 *
 * Quiet hours hide banners but never drop the message: the inbox and badges
 * still update. Overnight ranges (e.g. 22:00 - 07:00) wrap past midnight.
 */
export function isQuietHoursActive(
  prefs: Pick<NotificationPreferences, 'quietHours' | 'quietHoursStart' | 'quietHoursEnd'>,
  now = new Date(),
): boolean {
  if (!prefs.quietHours) return false;

  const start = parseClock(prefs.quietHoursStart);
  const end = parseClock(prefs.quietHoursEnd);
  if (start === undefined || end === undefined) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();

  // Same-day window, e.g. 13:00 - 17:00.
  if (start === end) return true;
  if (start < end) return minutes >= start && minutes < end;
  // Overnight window, e.g. 22:00 - 07:00.
  return minutes >= start || minutes < end;
}

function parseClock(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}
