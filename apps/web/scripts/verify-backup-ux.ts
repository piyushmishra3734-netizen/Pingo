/**
 * The reminder escalation and the telemetry allowlist.
 *
 * Both are pure enough to test without a browser, and both are the kind of
 * thing that quietly stops working: a reminder that keeps appearing after
 * someone said no, or an event that starts carrying a conversation id.
 *
 * Run with `pnpm verify:backup-ux`.
 */
import {
  INITIAL_REMINDERS,
  REMINDER_MS,
  afterDismissed,
  afterEnabled,
  afterShown,
  describeInterval,
  intervalAfter,
  shouldShowReminder,
  withInterval,
} from '../src/lib/backup/reminders.js';
import { UX_EVENTS, summarise, type RecordedEvent } from '../src/lib/backup/ux-telemetry.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const NOW = 1_800_000_000_000;

console.log('— the first ask —');

check(shouldShowReminder(INITIAL_REMINDERS, false, NOW), 'shown when backup is off and never shown before');
check(!shouldShowReminder(INITIAL_REMINDERS, true, NOW), 'never shown when backup is already on');

const shown = afterShown(INITIAL_REMINDERS, NOW);
check(shown.promptSeen, 'showing it is recorded');
check(!shouldShowReminder(shown, false, NOW + 60_000), 'not shown again a minute later');
check(shouldShowReminder(shown, false, NOW + REMINDER_MS['24h']), 'shown again after a day');

console.log('\n— a repeated no widens the gap —');

const once = afterDismissed(shown, NOW);
check(once.interval === '7d', 'first dismissal moves to weekly');
check(!shouldShowReminder(once, false, NOW + REMINDER_MS['24h']), 'and a day is no longer enough');
check(shouldShowReminder(once, false, NOW + REMINDER_MS['7d']), 'a week is');

const twice = afterDismissed(once, NOW);
check(twice.interval === '1m', 'second dismissal moves to monthly');
check(!shouldShowReminder(twice, false, NOW + REMINDER_MS['7d']), 'and a week is no longer enough');

const thrice = afterDismissed(twice, NOW);
check(thrice.interval === 'never', 'third dismissal stops asking entirely');
check(!shouldShowReminder(thrice, false, NOW + 10 * REMINDER_MS['1m']), 'and it stays stopped');

check(intervalAfter(0) === '24h' && intervalAfter(1) === '7d' && intervalAfter(2) === '1m' && intervalAfter(9) === 'never',
  'the escalation ladder is 24h, 7d, 1m, never');

console.log('\n— explicit choices win —');

const monthly = withInterval(shown, '1m');
check(monthly.interval === '1m', 'Settings can widen the gap');
const daily = withInterval(thrice, '24h');
check(daily.interval === '24h', 'and can narrow it again after Never');
check(shouldShowReminder(daily, false, NOW + REMINDER_MS['24h']), 'a reinstated schedule resumes');

const off = withInterval(shown, 'never');
check(!shouldShowReminder(off, false, NOW + 365 * 24 * 3600_000), 'Never is honoured for a year');

console.log('\n— enabling backup ends the conversation —');

const enabled = afterEnabled(twice);
check(enabled.interval === 'never', 'enabling sets the schedule to never');
check(!shouldShowReminder(enabled, true, NOW + REMINDER_MS['1m']), 'and nothing is shown afterwards');

/*
 * The guard that matters most: whatever the stored schedule says, a user with
 * backup on is never told to turn backup on.
 */
check(!shouldShowReminder(INITIAL_REMINDERS, true, NOW + 10 * REMINDER_MS['1m']),
  'backup being on overrides any stale schedule');

console.log('\n— wording —');

check(describeInterval('24h') === 'Every day', 'daily reads as Every day');
check(describeInterval('never') === 'Never', 'never reads as Never');
check(
  ['24h', '7d', '1m', 'never'].every((i) => !/interval|ms|schedule/i.test(describeInterval(i as never))),
  'no scheduling jargon reaches the user',
);

console.log('\n— telemetry carries nothing but a name and a time —');

check(UX_EVENTS.length === 8, `${UX_EVENTS.length} events, all fixed at compile time`);
check(
  UX_EVENTS.every((e) => /^backup\.[a-z.]+$/.test(e)),
  'every event name is a screen or a tap, not a value',
);

/*
 * A RecordedEvent has exactly two fields. If a third ever appears this fails,
 * which is the point: the absence of a properties bag is the privacy mechanism,
 * not a convention someone can helpfully improve.
 */
const sample: RecordedEvent = { event: 'backup.prompt.shown', at: NOW };
check(Object.keys(sample).length === 2, 'an event has exactly two fields');
check(
  !Object.keys(sample).some((k) => /id|user|conversation|name|content|text/i.test(k)),
  'and neither of them can identify anyone',
);

const counts = summarise([
  { event: 'backup.prompt.shown', at: NOW },
  { event: 'backup.prompt.shown', at: NOW + 1 },
  { event: 'backup.prompt.notnow', at: NOW + 2 },
]);
check(counts['backup.prompt.shown'] === 2 && counts['backup.prompt.notnow'] === 1, 'summarise counts by name');
check(
  Object.keys(counts).every((k) => (UX_EVENTS as readonly string[]).includes(k)),
  'and produces nothing outside the allowlist',
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
