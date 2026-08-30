/**
 * Who gets nagged about a new build, and who is left alone.
 *
 * The update card is the one screen in PINGO whose failure is invisible from
 * the inside. Get the comparison backwards and every device that is already
 * current shows an "update available" image on every single launch, forever,
 * with a cross that does not stick - the exact behaviour that makes people
 * uninstall. Get it wrong the other way and nobody is ever told anything, and
 * the operator publishes into a void that looks identical to a working one.
 *
 * There is no failing test in between those two. There is just the boundary.
 *
 * Run with `pnpm verify:update-notice`.
 */
import { isBehind, shouldShow } from '../src/features/updates/notice-rules.js';

/** The build shipped as 2.26.35.3 - YYWWBB, the scheme in build.gradle. */
const SHIPPED = 2603503;

let failures = 0;
function check(what: string, got: boolean, want: boolean): void {
  if (got === want) return;
  console.error(`✗ ${what}: expected ${want}, got ${got}`);
  failures += 1;
}

// The whole point: older sees it.
check('the previous build is behind', isBehind(String(SHIPPED - 1), SHIPPED), true);
check('a much older build is behind', isBehind('2603402', SHIPPED), true);

/*
 * The boundary, and the reason this file exists. The build named in the notice
 * is the one being shipped *to* - the people already on it are done, and an
 * off-by-one here nags everybody who did what they were asked.
 */
check('the named build is not behind', isBehind(String(SHIPPED), SHIPPED), false);
check('a newer build is not behind', isBehind(String(SHIPPED + 1), SHIPPED), false);

/*
 * A platform that cannot state a version says nothing useful, and nothing
 * useful must not become "you are out of date". `parseInt` is happy to answer
 * NaN and NaN loses every comparison, but only because the guard is there -
 * remove it and `NaN < n` is false, which is accidentally right today and
 * silently wrong the moment the comparison is reversed.
 */
check('a missing version is left alone', isBehind(undefined, SHIPPED), false);
check('an empty version is left alone', isBehind('', SHIPPED), false);
check('a non-numeric version is left alone', isBehind('unknown', SHIPPED), false);

/*
 * The half that decides how long it stays. Two people see the same card and
 * must get different answers: the one who can act on it keeps being asked, the
 * one who cannot is told once.
 */
const PUBLISHED = '2026-08-30T12:00:00.000Z';

check('someone behind sees it again after closing', shouldShow(true, PUBLISHED, PUBLISHED), true);
check('a closed card stays closed when current', shouldShow(false, PUBLISHED, PUBLISHED), false);
check('an unseen card shows when current', shouldShow(false, null, PUBLISHED), true);

/*
 * The reason the key is the timestamp and not a boolean: a new card has to
 * reach the people who dismissed the last one, and it has to do that without
 * anybody remembering to clear a flag when they publish.
 */
check(
  'a newly published card returns',
  shouldShow(false, '2026-08-01T00:00:00.000Z', PUBLISHED),
  true,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log(`✓ nagged below ${SHIPPED}, shown once at or above it`);
