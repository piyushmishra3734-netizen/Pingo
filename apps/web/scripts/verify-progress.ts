/**
 * The level curve, and the rule that Journey never goes backwards.
 *
 * The second one is the important one. Counts are computed from what a device
 * has, so a fresh install, a trimmed cache or a partial restore each produce a
 * smaller number than yesterday — and a level that drops because somebody
 * changed phones is both the "punished" feeling the philosophy rules out and
 * simply untrue. The conversations happened.
 *
 * Run with `pnpm verify:progress`.
 */
import {
  EMPTY_PROGRESS,
  levelFor,
  mergeProgress,
  type JourneyProgress,
} from '../src/features/journey/progress.js';
import { encouragementFor } from '../src/features/journey/language.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const DAY = 24 * 60 * 60 * 1000;

console.log('— the curve —');

{
  check(levelFor(0).level === 1, 'a brand-new account is level one, not level zero');
  check(levelFor(0).xpIntoLevel === 0 && levelFor(0).xpTotal === 0, 'with nothing behind it');

  check(levelFor(99).level === 1, 'ninety-nine moments is still level one');
  check(levelFor(100).level === 2, 'and a hundred is level two');

  /*
   * Later levels cost more, but linearly. An exponential curve is how a
   * progression system tells somebody to play more, and this one is not asking.
   */
  const costs = [1, 2, 3, 4, 5].map((n) => levelFor(cumulative(n)).xpForLevel);
  check(
    costs.every((c, i) => i === 0 || c > costs[i - 1]!),
    'each level costs more than the one before',
  );
  check(
    costs.every((c, i) => i === 0 || c - costs[i - 1]! === 50),
    'by a fixed step rather than a multiplier',
  );

  const mid = levelFor(cumulative(4) + 30);
  check(mid.xpIntoLevel === 30, 'progress inside a level is the remainder');
  check(mid.xpIntoLevel < mid.xpForLevel, 'and never reaches the total, which would be the next level');

  check(levelFor(-50).level === 1, 'a negative count cannot happen, and does not break anything if it does');
  check(levelFor(12.7).xpTotal === 12, 'fractions are floored rather than shown');
}

console.log('\n— Journey never goes backwards —');

{
  const yesterday: JourneyProgress = {
    momentsEarned: 4_200,
    unlockedIds: ['first_message', 'hundred_messages', 'night_owl'],
    unlockedAt: { first_message: 1_000, hundred_messages: 2_000, night_owl: 3_000 },
    joinedAt: 500,
  };

  /*
   * A new device that has only cached the last week. This is the case that
   * would silently erase somebody's history if progress were replaced rather
   * than merged.
   */
  const freshDevice: JourneyProgress = {
    momentsEarned: 60,
    unlockedIds: ['first_message'],
    unlockedAt: { first_message: 9_000 },
    joinedAt: 8_000,
  };

  const merged = mergeProgress(yesterday, freshDevice);

  check(merged.momentsEarned === 4_200, `a device that saw less takes nothing away (${merged.momentsEarned})`);
  check(merged.unlockedIds.length === 3, 'and no badge is lost');
  check(merged.unlockedAt.first_message === 1_000, 'an unlock keeps the earliest date it was ever seen');
  check(merged.joinedAt === 500, 'and the story keeps its earliest beginning');
  check(levelFor(merged.momentsEarned).level === levelFor(yesterday.momentsEarned).level, 'so the level cannot drop');
}

{
  const stored: JourneyProgress = {
    momentsEarned: 100,
    unlockedIds: ['first_message'],
    unlockedAt: { first_message: 5_000 },
  };
  const today: JourneyProgress = {
    momentsEarned: 340,
    unlockedIds: ['first_message', 'first_friend'],
    unlockedAt: { first_message: 5_000, first_friend: 9_000 },
    joinedAt: 4_000,
  };

  const merged = mergeProgress(stored, today);
  check(merged.momentsEarned === 340, 'a real day of progress does move it forward');
  check(merged.unlockedIds.includes('first_friend'), 'and a new badge arrives');
  check(merged.joinedAt === 4_000, 'a beginning learned later is still adopted');

  check(mergeProgress(EMPTY_PROGRESS, today).momentsEarned === 340, 'the first ever run keeps everything it found');
  const idempotent = mergeProgress(merged, today);
  check(
    idempotent.momentsEarned === merged.momentsEarned && idempotent.unlockedIds.length === merged.unlockedIds.length,
    'and merging the same result again changes nothing',
  );
}

console.log('\n— the line under the level is true —');

{
  const now = Date.now();
  check(encouragementFor(now - 2 * DAY, now) === 'Your journey starts here.', 'a new account is not told it has months of history');
  check(
    encouragementFor(now - 20 * DAY, now).startsWith('A few weeks'),
    'three weeks in, it says weeks',
  );
  check(
    encouragementFor(now - 95 * DAY, now) === 'Three months of conversations, and still going.',
    'three months in, it says three months',
  );
  check(
    encouragementFor(now - 400 * DAY, now).startsWith('Over a year'),
    'past a year it stops counting months',
  );
  check(
    !/\d/.test(encouragementFor(now - 95 * DAY, now)),
    'and the number is spelled out, because this line is meant to be read rather than measured',
  );
}

/** Total moments needed to have just reached level `n`. */
function cumulative(level: number): number {
  let total = 0;
  for (let n = 1; n < level; n += 1) total += 100 + 50 * (n - 1);
  return total;
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
