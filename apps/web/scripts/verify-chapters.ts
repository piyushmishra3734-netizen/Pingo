/**
 * Life Chapters, checked.
 *
 * The builder is small, and every one of its rules is a philosophy rule wearing
 * a function: nothing predates joining, a quiet year is not shown, a removed
 * badge does not leave a hole, and no chapter carries a count. Those are the
 * things that would be quietly undone by a well-meaning change, so they are the
 * things asserted here.
 *
 * Run with `pnpm verify:chapters`.
 */
import {
  buildChapters,
  buildFriendshipChapters,
  chapterNote,
  momentMonth,
  onThisDay,
  yearsAgoLabel,
  type ChapterMoment,
} from '../src/features/journey/chapters.js';
import { FORBIDDEN_WORDS } from '../src/features/journey/language.js';
import {
  DUMMY_JOINED_AT,
  DUMMY_PERSONAL_MOMENTS,
} from '../src/features/journey/dummy-journey.js';
import { DUMMY_UNLOCKED_AT } from '../src/features/badges/dummy-progress.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const at = (iso: string) => new Date(iso).getTime();

console.log('— the story is in order —');

{
  const chapters = buildChapters({
    joinedAt: at('2024-06-02T10:00:00Z'),
    unlockedAt: { first_message: at('2024-06-02T11:00:00Z'), hundred_messages: at('2026-02-11T09:00:00Z') },
    personal: [
      { id: 'person:a', at: at('2025-03-04T12:00:00Z'), title: 'Met someone', kind: 'person' },
    ],
  });

  check(chapters.length === 3, `one chapter per year with something in it (${chapters.length})`);
  check(
    chapters.map((c) => c.year).join(',') === '2024,2025,2026',
    'oldest first, because a story is read forwards',
  );

  const flat = chapters.flatMap((c) => c.moments);
  check(
    flat.every((m, i) => i === 0 || flat[i - 1]!.at <= m.at),
    'and every moment inside a chapter follows the one before it',
  );
  check(flat[0]!.kind === 'joined', 'the first line is the day it started');
}

console.log('\n— a quiet year is not a chapter —');

{
  const chapters = buildChapters({
    joinedAt: at('2023-01-05T10:00:00Z'),
    unlockedAt: { first_call: at('2026-01-05T10:00:00Z') },
  });

  /*
   * 2024 and 2025 had nothing in them. An empty chapter headed "2024" with
   * "no moments" under it would be a record of absence, and nothing in Journey
   * is allowed to punish — so the gap simply is not drawn.
   */
  check(chapters.length === 2, `years with nothing in them are absent, not empty (${chapters.length})`);
  check(chapters.map((c) => c.year).join(',') === '2023,2026', 'the gap leaves no trace');
}

console.log('\n— bad data cannot rewrite the past —');

{
  const joinedAt = at('2025-05-01T10:00:00Z');
  const chapters = buildChapters({
    joinedAt,
    unlockedAt: {
      // A device with a wrong clock, or a restored backup with a bad stamp.
      first_message: at('2019-01-01T00:00:00Z'),
      first_friend: Number.NaN,
      // A badge that no longer exists in the library.
      removed_badge: at('2025-07-01T10:00:00Z'),
      first_call: at('2025-08-01T10:00:00Z'),
    },
  });

  const flat = chapters.flatMap((c) => c.moments);
  check(flat.every((m) => m.at >= joinedAt), 'nothing appears before the day the account started');
  check(!flat.some((m) => Number.isNaN(m.at)), 'and an unusable date is dropped rather than drawn');
  check(!flat.some((m) => m.id === 'badge:removed_badge'), 'a badge no longer in the library leaves no line');
  check(flat.some((m) => m.id === 'badge:first_call'), 'while the ones that still exist survive it');
}

console.log('\n— the same moment is one line —');

{
  const twice: ChapterMoment[] = [
    { id: 'person:baani', at: at('2026-03-01T10:00:00Z'), title: 'Met Baani', kind: 'person' },
    { id: 'person:baani', at: at('2026-05-01T10:00:00Z'), title: 'Met Baani', kind: 'person' },
  ];
  const flat = buildChapters({ joinedAt: at('2026-01-01T00:00:00Z'), unlockedAt: {}, personal: twice })
    .flatMap((c) => c.moments)
    .filter((m) => m.id === 'person:baani');

  check(flat.length === 1, 'a moment recorded twice is still one moment');
  check(flat[0]!.at === at('2026-03-01T10:00:00Z'), 'and it keeps the first time it happened');
}

console.log('\n— the words —');

{
  const chapters = buildChapters({
    joinedAt: DUMMY_JOINED_AT,
    unlockedAt: DUMMY_UNLOCKED_AT,
    personal: DUMMY_PERSONAL_MOMENTS,
  });
  const flat = chapters.flatMap((c) => c.moments);

  check(chapters.length >= 2, `the dummy timeline spans more than one year (${chapters.length})`);
  check(flat.length > 5, `with enough in it to judge the layout (${flat.length})`);

  const text = flat.map((m) => `${m.title} ${m.detail ?? ''}`).join(' ').toLowerCase();
  /*
   * Whole words. Substring matching fails on "Camera Explorer", which contains
   * "xp" and is not a vocabulary problem — the rule is about the word XP, and a
   * check that cannot tell the difference would eventually be silenced rather
   * than fixed.
   */
  const banned = FORBIDDEN_WORDS.filter((word) =>
    new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text),
  );
  check(banned.length === 0, `no moment uses the vocabulary Journey rules out${banned.length ? `: ${banned.join(', ')}` : ''}`);

  /*
   * No counts of moments. A chapter with a number under it becomes a year to
   * beat, and next year starts at zero — which is the pressure this screen
   * exists to avoid.
   *
   * Badge titles are exempt: "100 Messages" is the name of a thing that
   * happened once, not a running total, and renaming the library to satisfy a
   * check on this screen would be the tail wagging the dog.
   */
  const written = flat
    .filter((m) => m.kind !== 'badge')
    .map((m) => `${m.title} ${m.detail ?? ''}`)
    .join(' ');
  check(!/\d/.test(written), 'and nothing written for the timeline carries a number');
  check(
    chapters.every((c) => Object.keys(c).sort().join(',') === 'moments,year'),
    'a chapter is a year and its moments, with nothing to total',
  );

  const notes = chapters.map((c, i) => chapterNote(c, i, chapters.length));
  check(notes[0] === 'Where it started', 'the first chapter is named');
  check(
    notes.slice(1, -1).every((n) => n === undefined),
    'the ones in between are just years',
  );
}

console.log('\n— dates read as memory —');

{
  check(momentMonth(at('2026-03-14T09:00:00Z')) === 'Mar', 'a moment is dated to its month');
  check(momentMonth(at('2026-12-31T09:00:00Z')) === 'Dec', 'including the last one of the year');
  /*
   * Month resolution is a privacy decision as much as a tone one: a public
   * Journey showing "14 March, 21:40" tells a reader what somebody was doing on
   * a particular evening.
   */
  check(!/\d/.test(momentMonth(Date.now())), 'and never to a day or a time');
}

console.log('\n— on this day —');

{
  /*
   * Local time, not UTC. "On this day" is a question about the calendar on the
   * wall, and an evening in Delhi is already tomorrow in UTC — a test written
   * in Z would pass in London and fail here, which is the wrong way round for a
   * feature about somebody's own day.
   */
  const local = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h).getTime();
  const moments: ChapterMoment[] = [
    { id: 'a', at: local(2024, 7, 4, 20), title: 'Talked with Baani for three hours', kind: 'milestone', with: 'baani' },
    { id: 'b', at: local(2025, 7, 4, 9), title: 'Coffee with Sneha', kind: 'milestone', with: 'sneha' },
    { id: 'c', at: local(2025, 7, 5, 9), title: 'Something the day after', kind: 'milestone' },
    { id: 'd', at: local(2026, 7, 4, 9), title: 'Something today', kind: 'milestone' },
  ];
  const today = new Date(2026, 7, 4, 12, 0, 0);

  const found = onThisDay(moments, today);
  check(found.length === 2, `only what happened on this date, in an earlier year (${found.length})`);
  check(found[0]?.yearsAgo === 1 && found[1]?.yearsAgo === 2, 'most recent first — "one year ago" lands hardest');
  check(!found.some((r) => r.moment.id === 'd'), 'nothing from this year, which would be a log rather than a memory');
  check(!found.some((r) => r.moment.id === 'c'), 'and nothing from the day after');

  /*
   * The important case. Most days have nothing, and on those days the section
   * must not appear at all — a card that shows up daily whether or not there is
   * anything to say is the memories feed this is deliberately not.
   */
  const quiet = onThisDay(moments, new Date(2026, 8, 19, 12, 0, 0));
  check(quiet.length === 0, 'a day with nothing to remember produces nothing to show');

  check(yearsAgoLabel(1) === 'One year ago', 'the years are spelled out, because a digit reads as data');
  check(yearsAgoLabel(2) === 'Two years ago', 'including the plural');
  check(/^\d/.test(yearsAgoLabel(9)), 'past five it falls back to a numeral rather than inventing prose');
}

console.log('\n— friendship chapters —');

{
  const moments: ChapterMoment[] = [
    { id: 'call', at: at('2026-09-02T20:00:00Z'), title: 'First call', kind: 'milestone', with: 'baani' },
    { id: 'coffee', at: at('2027-01-11T10:00:00Z'), title: 'Coffee together', kind: 'milestone', with: 'baani' },
    { id: 'other', at: at('2026-10-02T20:00:00Z'), title: 'Coffee with Sneha', kind: 'milestone', with: 'sneha' },
    { id: 'solo', at: at('2026-11-02T20:00:00Z'), title: 'Night Owl', kind: 'badge' },
  ];

  const chapters = buildFriendshipChapters({
    friendId: 'baani',
    friendName: 'Baani',
    metAt: at('2026-08-14T18:00:00Z'),
    moments,
  });

  const flat = chapters.flatMap((c) => c.moments);
  check(flat.length === 3, `only what the two of you did (${flat.length})`);
  check(flat[0]?.title === 'Met Baani', 'and it opens with meeting them, not with joining PINGO');
  check(!flat.some((m) => m.kind === 'joined'), 'the account’s own first line has no place in a friendship');
  check(!flat.some((m) => m.id === 'other' || m.id === 'solo'), 'somebody else’s moments stay out of it');
  check(
    chapters.map((c) => c.year).join(',') === '2026,2027',
    'a friendship that crosses a year gets two chapters',
  );

  const strangers = buildFriendshipChapters({
    friendId: 'nobody',
    friendName: 'Nobody',
    metAt: at('2026-08-14T18:00:00Z'),
    moments,
  });
  check(
    strangers.flatMap((c) => c.moments).length === 1,
    'a friendship with nothing in it yet is just the day you met',
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
