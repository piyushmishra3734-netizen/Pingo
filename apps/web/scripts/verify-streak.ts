/**
 * The streak flame's tiers.
 *
 * Three states with two boundaries, and every one of them is a product
 * decision rather than a number: nothing at all below a day, an ember through
 * the first week, fire once a week of talking has actually happened, and the
 * blue one at three months. The boundaries are the whole feature — a flame that
 * lights on day one means nothing, and one that never lights means less.
 *
 * Run with `pnpm verify:streak`.
 */
import {
  BLUE_DAYS,
  FLAME_DAYS,
  streakTier,
} from '../src/features/conversations/StreakFlame.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

console.log('— nothing is drawn for nothing —');

{
  check(streakTier(undefined) === 'none', 'a conversation with no streak shows no flame');
  check(streakTier(0) === 'none', 'and a streak of zero is not a streak');
  check(streakTier(-3) === 'none', 'a negative day count cannot happen, and draws nothing if it does');

  /*
   * The rule the number already followed: absent means nothing at all — not a
   * zero, not an empty flame. A streak is a reward; an empty one is a
   * scoreboard nobody asked to be on.
   */
  check(streakTier(0.5) === 'none', 'half a day is not a day');
}

console.log('\n— the first week is an ember, and it is still —');

{
  for (let day = 1; day < FLAME_DAYS; day += 1) {
    if (day > 1 && day < FLAME_DAYS - 1) continue;
    check(streakTier(day) === 'ember', `day ${day} is an ember`);
  }

  /*
   * Why still: a three-day-old conversation is not an achievement yet, and
   * animating it would set every new chat in the list flickering at once — noisy,
   * and a lie about what has happened.
   */
  check(streakTier(FLAME_DAYS - 1) === 'ember', 'the last day before the week is still an ember');
}

console.log('\n— a week of talking catches fire —');

{
  check(streakTier(FLAME_DAYS) === 'flame', `day ${FLAME_DAYS} is the flame`);
  check(streakTier(30) === 'flame', 'and a month in it is still the flame');
  check(streakTier(BLUE_DAYS - 1) === 'flame', 'right up to the day before three months');
}

console.log('\n— three months burns blue —');

{
  check(streakTier(BLUE_DAYS) === 'blue', `day ${BLUE_DAYS} is the blue flame`);
  check(streakTier(365) === 'blue', 'and a year is the same flame, not a fourth one');
  check(streakTier(10_000) === 'blue', 'there is no tier above it to chase');
}

console.log('\n— the boundaries are where they are meant to be —');

{
  check(FLAME_DAYS === 7, `fire starts at a week (${FLAME_DAYS})`);
  check(BLUE_DAYS === 90, `blue starts at three months (${BLUE_DAYS})`);

  const tiers = [0, 1, 6, 7, 89, 90].map(streakTier);
  check(
    tiers.join(',') === 'none,ember,ember,flame,flame,blue',
    `the whole ladder reads none → ember → flame → blue (${tiers.join(' ')})`,
  );

  /*
   * Monotonic: a longer streak can never show a smaller flame. Obvious with
   * three tiers, and the thing that would quietly break the day somebody adds
   * a fourth.
   */
  const order = { none: 0, ember: 1, flame: 2, blue: 3 } as const;
  let worst = 0;
  let regressed = -1;
  for (let day = 0; day <= 400; day += 1) {
    const rank = order[streakTier(day)];
    if (rank < worst) regressed = day;
    worst = Math.max(worst, rank);
  }
  check(regressed === -1, `a longer streak never shows a smaller flame${regressed === -1 ? '' : ` (day ${regressed})`}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
