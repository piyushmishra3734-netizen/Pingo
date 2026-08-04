/**
 * Noticing, and how the journey feels.
 *
 * Two things that share one rule: **neither of them may ever increase
 * progress.**
 *
 * > Journey should occasionally notice meaningful moments that users never
 * > expected to be noticed. Those moments should never increase progress. They
 * > exist only to make people feel seen.
 *
 * That is the whole design. The instant a notice is worth moments, it becomes
 * something to trigger deliberately — reply late on purpose so the app says you
 * were kind — and a thing you can farm is not a thing that makes you feel seen.
 * So nothing here returns a metric, a weight or a count, and the suite asserts
 * that a day full of notices leaves the level exactly where it was.
 *
 * ## The indicator is a feeling, not a score
 *
 * No percentage, no rank, no comparison to last week, no comparison to anybody
 * else. One phrase from a small fixed vocabulary, and the quiet one is warm
 * rather than a scolding: somebody who has not talked to anyone this week is
 * *"Quietly here"*, never "inactive" and never a bar that has emptied.
 *
 * ## Everything is local and nothing is stored about other people
 *
 * Both work from the same cached messages the counters use. A notice names a
 * friend only in the moment it is shown, and is never written down with a name.
 */
import type { CountableMessage } from '../badges/metrics.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * How the journey feels right now.
 *
 * Ordered by what is most worth saying, not by how "good" it is — this is not a
 * ladder, and none of these is a better result than another.
 */
export type JourneyFeeling =
  | 'Building new connections'
  | 'Keeping in touch'
  | 'Growing steadily'
  | 'Recently active'
  | 'Quietly here';

export interface FeelingInput {
  /** Direct conversations, warmest first — the same rows Pulse shows. */
  pulse: readonly { quietDays: number; exchanges: number }[];
  /** Conversations whose first message is inside the last month. */
  newConnections: number;
}

/**
 * One phrase, chosen from what actually happened.
 *
 * Deliberately not a function of a single number. "Recently active" and
 * "Keeping in touch" describe different weeks and neither is the higher score,
 * which is the point of using words: a phrase can say what is true without
 * implying there is a better phrase to reach.
 */
export function feelingFrom({ pulse, newConnections }: FeelingInput): JourneyFeeling {
  const spokenThisWeek = pulse.filter((p) => p.quietDays <= 7).length;
  const spokenRecently = pulse.some((p) => p.quietDays <= 1);

  if (newConnections >= 2) return 'Building new connections';
  if (spokenThisWeek >= 3) return 'Keeping in touch';
  if (spokenThisWeek >= 1 && pulse.some((p) => p.exchanges >= 20)) return 'Growing steadily';
  if (spokenRecently) return 'Recently active';

  /*
   * The quiet case, and it must not sting. Nobody is told they have been away,
   * that a streak ended, or that a bar has emptied — "Quietly here" is a fact
   * about the week and a welcome rather than a verdict.
   */
  return 'Quietly here';
}

export type NoticeKind =
  | 'replied-to-waiting'
  | 'checked-in-on-quiet'
  | 'oldest-friend'
  | 'long-exchange';

export interface Notice {
  kind: NoticeKind;
  /** The sentence, already written. Never contains a target or a count of progress. */
  text: string;
}

const SPELLED = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] as const;
const days = (n: number) => `${SPELLED[n] ?? n} day${n === 1 ? '' : 's'}`;

/**
 * What the system noticed today.
 *
 * Returns everything it found; the caller shows at most one. Detectors are
 * deliberately conservative — a notice that fires most days is a widget, and a
 * widget is the opposite of being noticed.
 */
export function noticeToday(
  messages: readonly CountableMessage[],
  selfId: string,
  now = Date.now(),
): Notice[] {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.getTime();

  const byConversation = new Map<string, CountableMessage[]>();
  for (const message of messages) {
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }
  for (const list of byConversation.values()) list.sort((a, b) => a.createdAt - b.createdAt);

  const notices: Notice[] = [];

  /** The conversation whose first message is the oldest, for "oldest friend". */
  let oldest: { conversationId: string; at: number } | undefined;

  for (const [conversationId, list] of byConversation) {
    const first = list[0];
    if (first && (!oldest || first.createdAt < oldest.at)) {
      oldest = { conversationId, at: first.createdAt };
    }

    const mineToday = list.filter((m) => m.authorId === selfId && m.createdAt >= today);
    if (mineToday.length === 0) continue;

    const firstMineToday = mineToday[0]!;
    const before = list.filter((m) => m.createdAt < firstMineToday.createdAt);
    const previous = before[before.length - 1];
    if (!previous) continue;

    const gap = Math.floor((firstMineToday.createdAt - previous.createdAt) / DAY);

    if (previous.authorId !== selfId && gap >= 2) {
      // They wrote, and it sat there. Answering it is the thing worth noticing,
      // and the number of days is what makes it specific rather than generic.
      notices.push({
        kind: 'replied-to-waiting',
        text: `Today you replied to someone who had been waiting ${days(gap)}.`,
      });
    } else if (previous.authorId === selfId && gap >= 14) {
      // Nobody wrote for a fortnight and you went first.
      notices.push({
        kind: 'checked-in-on-quiet',
        text: 'You checked in with a friend it had been quiet with.',
      });
    }

    const bothSidesToday = new Set(
      list.filter((m) => m.createdAt >= today).map((m) => m.authorId),
    ).size;
    const todayCount = list.filter((m) => m.createdAt >= today).length;
    if (bothSidesToday > 1 && todayCount >= 40) {
      notices.push({ kind: 'long-exchange', text: 'You and a friend talked for a long time today.' });
    }
  }

  if (oldest) {
    const spokeToday = (byConversation.get(oldest.conversationId) ?? []).some(
      (m) => m.createdAt >= today && m.authorId === selfId,
    );
    // Only worth saying if the friendship is genuinely old.
    if (spokeToday && now - oldest.at >= 180 * DAY) {
      notices.push({ kind: 'oldest-friend', text: 'You spoke to your oldest friend here again today.' });
    }
  }

  return notices;
}

const SEEN_KEY = 'pingo.journey.noticed';

interface SeenRecord {
  /** Local day the last notice was shown, so at most one lands a day. */
  day: string;
  /** The last few kinds, so the same observation is not repeated all week. */
  recent: NoticeKind[];
}

const dayKey = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/**
 * The one to show, if any — at most one a day, and not the same one twice over.
 *
 * Rarity is the feature. Something that appears every time you open a screen is
 * furniture; something that appears occasionally, and is right, is the thing
 * people mention to their friends.
 */
export function pickNotice(
  candidates: readonly Notice[],
  userId: string,
  now = Date.now(),
): Notice | undefined {
  if (candidates.length === 0) return undefined;

  const key = `${SEEN_KEY}.${userId}`;
  const today = dayKey(now);

  let seen: SeenRecord = { day: '', recent: [] };
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SeenRecord>;
      seen = {
        day: typeof parsed.day === 'string' ? parsed.day : '',
        recent: Array.isArray(parsed.recent) ? parsed.recent.slice(-3) : [],
      };
    }
  } catch {
    // Unreadable is the same as nothing seen. This is a nicety, not a record.
  }

  if (seen.day === today) return undefined;

  const fresh = candidates.find((n) => !seen.recent.includes(n.kind)) ?? candidates[0]!;

  try {
    localStorage.setItem(
      key,
      JSON.stringify({ day: today, recent: [...seen.recent, fresh.kind].slice(-3) } satisfies SeenRecord),
    );
  } catch {
    // Storage full or blocked. Showing it twice is a far smaller problem than
    // interrupting somebody over a nicety.
  }

  return fresh;
}
