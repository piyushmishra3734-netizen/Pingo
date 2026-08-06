import type { AppNotification } from '@pingo/core';

/**
 * Turning a list of notifications into something worth reading.
 *
 * ## The problem is repetition, not volume
 *
 * Somebody typing "hello", "hello?", "bro", "where are you?" produces four
 * rows. Shown as four, the history is a log of packets rather than a record of
 * what happened - and the one real event, *Baani wanted you*, is harder to see
 * with four copies of it than with one.
 *
 * So consecutive notifications of the same kind from the same person collapse
 * into one entry that counts them. Consecutive, not global: two messages this
 * morning and two tonight are two different moments in somebody's day, and
 * merging them across a gap would say something untrue about when they
 * happened.
 *
 * ## What breaks a group
 *
 * A different person, a different kind, or a gap longer than the window. The
 * window is generous for messages, because a conversation is a conversation
 * even with pauses in it, and short for everything else - two stories an hour
 * apart are two events, not one.
 */

/** How long a run of the same thing keeps collapsing, per kind. */
const WINDOW_MS: Record<string, number> = {
  message: 60 * 60 * 1000,
  ping: 60 * 60 * 1000,
  story: 15 * 60 * 1000,
};
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

export interface HistoryEntry {
  /** The newest notification in the run - what a tap follows. */
  latest: AppNotification;
  /** Every id in the run, so one swipe dismisses all of them. */
  ids: string[];
  count: number;
  /** True when nothing in the run has been read. */
  unread: boolean;
}

export interface HistorySection {
  /** "Today", "Yesterday", or a date. */
  label: string;
  entries: HistoryEntry[];
}

export function groupNotifications(items: AppNotification[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  for (const item of items) {
    const last = entries[entries.length - 1];
    const window = WINDOW_MS[item.kind] ?? DEFAULT_WINDOW_MS;

    const continues =
      last !== undefined &&
      last.latest.kind === item.kind &&
      last.latest.actorId === item.actorId &&
      // The list is newest first, so `last` is always the more recent one.
      last.latest.createdAt - item.createdAt <= window;

    if (continues && last) {
      last.ids.push(item.id);
      last.count += 1;
      last.unread = last.unread || !item.read;
      continue;
    }

    entries.push({ latest: item, ids: [item.id], count: 1, unread: !item.read });
  }

  return entries;
}

/**
 * Day headings.
 *
 * Compared by calendar day rather than by elapsed hours: something at 23:50 and
 * something at 00:10 are twenty minutes apart and belong under different
 * headings, because that is how people remember when things happened.
 */
export function sectionByDay(entries: HistoryEntry[]): HistorySection[] {
  const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0);
  const today = startOfDay(Date.now());
  const day = 86_400_000;

  const sections: HistorySection[] = [];

  for (const entry of entries) {
    const bucket = startOfDay(entry.latest.createdAt);
    const label =
      bucket === today
        ? 'Today'
        : bucket === today - day
          ? 'Yesterday'
          : new Date(bucket).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            });

    const open = sections[sections.length - 1];
    if (open && open.label === label) open.entries.push(entry);
    else sections.push({ label, entries: [entry] });
  }

  return sections;
}

/**
 * What a grouped entry says.
 *
 * The count only appears when there is one - "1 new message" is a sentence
 * nobody writes, and a bare "Sent you a message" reads better than a number
 * that is always there.
 */
export function describe(entry: HistoryEntry): string {
  const n = entry.count;

  switch (entry.latest.kind) {
    case 'message':
      return n > 1 ? `Sent you ${n} messages` : 'Sent you a message';
    case 'ping':
      return n > 1 ? `Sent you ${n} Pings` : 'Sent you a Ping';
    case 'ping_opened':
      return 'Opened your Ping';
    case 'ping_replayed':
      return 'Replayed your Ping';
    case 'story':
      return n > 1 ? `Added ${n} stories` : 'Replied to your story';
    case 'call':
      return 'Missed call';
    case 'follow_request':
      return 'Wants to follow you';
    case 'follow_accepted':
      return 'Accepted your request';
    case 'mention':
      return 'Mentioned you';
    default:
      return entry.latest.body;
  }
}

/** The filter chips, and what each one keeps. */
export const FILTERS = {
  all: () => true,
  messages: (n: AppNotification) => n.kind === 'message' || n.kind === 'mention',
  stories: (n: AppNotification) => n.kind === 'story',
  calls: (n: AppNotification) => n.kind === 'call',
  people: (n: AppNotification) =>
    n.kind === 'follow_request' || n.kind === 'follow_accepted',
  pings: (n: AppNotification) =>
    n.kind === 'ping' || n.kind === 'ping_opened' || n.kind === 'ping_replayed',
} as const;

export type FilterKey = keyof typeof FILTERS;
