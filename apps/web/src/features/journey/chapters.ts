/**
 * Life Chapters — the journey as years rather than as a grid.
 *
 * A badge collection answers "what have I got". A chapter answers "what
 * happened", and those are different feelings: one is an inventory, the other is
 * a memory. Grouping by year is what does most of the work — "2026" above six
 * lines turns a list of unlocks into a period of somebody's life, and it is the
 * only section on the screen where the same badge appears as a *date* instead of
 * as a thing owned.
 *
 * ## What is allowed to be a moment
 *
 * Something that happened once and is worth remembering: joining, a badge
 * earned, a person met. Not a total, not a level, not a rate. If it can go up
 * again next week it belongs in Statistics — a chapter entry that keeps
 * changing is not a memory.
 *
 * ## Gaps are not shown
 *
 * A year with nothing in it does not appear. The alternative — an empty 2027
 * with "no moments yet" under it — is a record of absence, and this document's
 * rule is that nothing in Journey may punish. A quiet year simply is not a
 * chapter.
 */
import { BADGE_BY_ID } from '../badges/registry.js';

export type ChapterMomentKind =
  /** The first line of the first chapter. There is exactly one. */
  | 'joined'
  /** A badge, drawn with its own artwork. */
  | 'badge'
  /** Somebody entering the story. */
  | 'person'
  /** Something that happened, with no badge behind it. */
  | 'milestone';

export interface ChapterMoment {
  id: string;
  /** When it happened, in ms. */
  at: number;
  /** One line, in the past tense, about a thing that happened. */
  title: string;
  /** An optional second line. Never a count. */
  detail?: string;
  kind: ChapterMomentKind;
  /** Set on badge moments, so the row can draw the real artwork. */
  badgeId?: string;
}

export interface Chapter {
  year: number;
  moments: ChapterMoment[];
}

/**
 * Build the chapters from what the profile already knows.
 *
 * Badge moments are derived rather than stored: the unlock dates exist anyway,
 * and a second hand-maintained list of "timeline entries" would be one more
 * thing to keep in step with the registry.
 */
export function buildChapters(input: {
  joinedAt: number;
  unlockedAt: Readonly<Record<string, number>>;
  /** Moments that are not badges — people met, things done. */
  personal?: readonly ChapterMoment[];
}): Chapter[] {
  const { joinedAt, unlockedAt, personal = [] } = input;

  const byId = new Map<string, ChapterMoment>();
  const add = (moment: ChapterMoment) => {
    if (!Number.isFinite(moment.at)) return;

    /*
     * Nothing may predate joining.
     *
     * A clock that was wrong when a badge was earned, or a restored backup with
     * a bad timestamp, would otherwise open the story with an event from before
     * the story started. Dropping it is better than showing a 1970 chapter.
     */
    if (moment.kind !== 'joined' && moment.at < joinedAt) return;

    const existing = byId.get(moment.id);
    if (!existing || moment.at < existing.at) byId.set(moment.id, moment);
  };

  add({ id: 'joined', at: joinedAt, title: 'Started using PINGO', kind: 'joined' });

  for (const [badgeId, at] of Object.entries(unlockedAt)) {
    const badge = BADGE_BY_ID.get(badgeId);
    // A badge that has been removed from the library leaves no hole in the
    // story; it simply stops being a line.
    if (!badge) continue;
    add({ id: `badge:${badgeId}`, at, title: badge.title, kind: 'badge', badgeId });
  }

  for (const moment of personal) add(moment);

  const ordered = [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  const chapters: Chapter[] = [];
  for (const moment of ordered) {
    const year = new Date(moment.at).getFullYear();
    const current = chapters[chapters.length - 1];
    if (current && current.year === year) current.moments.push(moment);
    else chapters.push({ year, moments: [moment] });
  }
  return chapters;
}

/**
 * One quiet line under a year.
 *
 * The first chapter and the current one are the two that mean something to
 * name; the ones in between are just years, and captioning every one of them
 * would be writing for the sake of the layout.
 */
export function chapterNote(chapter: Chapter, index: number, total: number, now = new Date()): string | undefined {
  if (index === 0) return 'Where it started';
  if (index === total - 1 && chapter.year === now.getFullYear()) return 'This year, so far';
  return undefined;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * The month, and only the month.
 *
 * A day and a time would make it a log. "March" is how people remember when
 * something happened, and it is also the resolution at which nobody can work
 * out what somebody was doing on a given evening.
 */
export function momentMonth(at: number): string {
  return MONTHS[new Date(at).getMonth()] ?? '';
}
