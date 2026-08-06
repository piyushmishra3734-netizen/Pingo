/**
 * The grouping rules, checked against the cases that motivated them.
 *
 * Run with: npx tsx src/features/notifications/group-history.verify.ts
 *
 * Every check here is a case somebody actually hit or asked for - four
 * messages in two minutes, an unread run that outlives its window, a read item
 * that must not join one. They are written as sentences because the sentence
 * is the rule; if one fails, the question is whether the rule changed on
 * purpose.
 */
import {
  groupNotifications,
  sectionByDay,
  describe,
  type HistoryEntry,
} from './group-history.js';

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures += 1;
}

const minute = 60_000;
const now = Date.now();

const n = (
  id: string,
  kind: string,
  actorId: string,
  minutesAgo: number,
  read = false,
) =>
  ({
    id,
    kind,
    title: actorId,
    body: '',
    createdAt: now - minutesAgo * minute,
    read,
    actorId,
  }) as never;

// Newest first, as the service returns them.
const burst = [
  n('4', 'message', 'baani', 1),
  n('3', 'message', 'baani', 2),
  n('2', 'message', 'baani', 3),
  n('1', 'message', 'baani', 4),
];

const grouped = groupNotifications(burst);
check(grouped.length === 1, 'four messages from one person collapse to one entry');
check(grouped[0]!.count === 4, 'the entry counts all four');
check(describe(grouped[0]!) === 'Sent you 4 messages', 'copy says "4 messages"');
check(grouped[0]!.ids.length === 4, 'every id is kept, so one swipe clears the run');

// A different person breaks the run.
const two = groupNotifications([
  n('b', 'message', 'sneha', 1),
  n('a', 'message', 'baani', 2),
]);
check(two.length === 2, 'a different person starts a new entry');

// A different kind breaks the run.
const kinds = groupNotifications([
  n('b', 'story', 'baani', 1),
  n('a', 'message', 'baani', 2),
]);
check(kinds.length === 2, 'a different kind starts a new entry');

// A long gap breaks the run: messages collapse within an hour, not beyond.
const spread = groupNotifications([
  n('b', 'message', 'baani', 1, true),
  n('a', 'message', 'baani', 200, true),
]);
check(spread.length === 2, 'read messages three hours apart are two moments, not one');

const near = groupNotifications([
  n('b', 'message', 'baani', 1),
  n('a', 'message', 'baani', 50),
]);
check(near.length === 1, 'messages fifty minutes apart still collapse');

// Stories use a tighter window than messages.
const stories = groupNotifications([
  n('b', 'story', 'baani', 1, true),
  n('a', 'story', 'baani', 40, true),
]);
check(stories.length === 2, 'read stories forty minutes apart do not collapse');

// Singular copy has no number in it.
check(describe(groupNotifications([n('a', 'message', 'x', 1)])[0]!) === 'Sent you a message',
  'one message reads as a sentence, not "1 new message"');

// Unread if anything in the run is unread.
const mixed = groupNotifications([
  n('b', 'message', 'baani', 1, true),
  n('a', 'message', 'baani', 2, false),
]);
check(mixed[0]!.unread === true, 'a run is unread when any of it is unread');

// Day sections.
const sections = sectionByDay(
  groupNotifications([n('b', 'call', 'x', 5), n('a', 'call', 'y', 60 * 30)]),
);
check(sections[0]!.label === 'Today', 'the newest section is Today');
check(sections.length >= 2, 'yesterday gets its own heading');


// --- the unread rule -------------------------------------------------------

// Unread and far apart: still one row, because nothing has landed yet.
const waiting = groupNotifications([
  n('c', 'message', 'baani', 1, false),
  n('b', 'message', 'baani', 400, false),
]);
check(waiting.length === 1, 'an unread run keeps collecting past the window');
check(waiting[0]!.count === 2, 'and counts everything in it');

// Read and far apart: two moments, as before.
const settled = groupNotifications([
  n('c', 'message', 'baani', 1, true),
  n('b', 'message', 'baani', 400, true),
]);
check(settled.length === 2, 'a read run still splits at the window');

// A read notification must not extend an unread run backwards.
const mixedFar = groupNotifications([
  n('c', 'message', 'baani', 1, false),
  n('b', 'message', 'baani', 400, true),
]);
check(mixedFar.length === 2, 'a read item does not join an unread run across the window');

// Still splits on a different person even while unread.
const other = groupNotifications([
  n('c', 'message', 'sneha', 1, false),
  n('b', 'message', 'baani', 400, false),
]);
check(other.length === 2, 'unread does not merge two different people');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
