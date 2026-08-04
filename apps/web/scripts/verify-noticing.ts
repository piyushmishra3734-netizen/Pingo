/**
 * Noticing, and the rule that makes it worth anything.
 *
 * > Journey should occasionally notice meaningful moments that users never
 * > expected to be noticed. Those moments should never increase progress. They
 * > exist only to make people feel seen.
 *
 * The second sentence is the one under test. If a notice were worth moments it
 * would become something to trigger on purpose — reply late so the app calls
 * you kind — and a thing that can be farmed cannot make anybody feel seen. So
 * the central assertion here is an absence: a day that produces every notice
 * the system has leaves the level exactly where it was.
 *
 * Run with `pnpm verify:noticing`.
 */
import { feelingFrom, noticeToday } from '../src/features/journey/noticing.js';
import { countMessageMetrics, evaluateMessages, type CountableMessage } from '../src/features/badges/metrics.js';
import { FORBIDDEN_WORDS } from '../src/features/journey/language.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const ME = 'me';
const THEM = 'them';
const DAY = 24 * 60 * 60 * 1000;

let seq = 0;
const msg = (over: Partial<CountableMessage> & { createdAt: number }): CountableMessage => ({
  id: `n${(seq += 1)}`,
  conversationId: 'c1',
  authorId: ME,
  body: 'hello there',
  ...over,
});

/** Today at noon, so nothing lands in a different local day by accident. */
const now = new Date(2026, 7, 4, 12, 0, 0).getTime();
const daysAgo = (n: number, hour = 12) => {
  const d = new Date(2026, 7, 4 - n, hour, 0, 0);
  return d.getTime();
};

console.log('— what the system notices —');

{
  const waited = [
    msg({ createdAt: daysAgo(5), authorId: THEM, body: 'you around?' }),
    msg({ createdAt: now, body: 'sorry! yes' }),
  ];
  const found = noticeToday(waited, ME, now);
  check(
    found.some((n) => n.kind === 'replied-to-waiting'),
    'replying to somebody who had been waiting is noticed',
  );
  check(
    found.find((n) => n.kind === 'replied-to-waiting')?.text.includes('five days') === true,
    'and it says how long, spelled out, because the specifics are what make it feel seen',
  );

  const sameDay = [
    msg({ createdAt: daysAgo(0, 9), authorId: THEM, body: 'you around?' }),
    msg({ createdAt: now, body: 'yes' }),
  ];
  check(
    noticeToday(sameDay, ME, now).length === 0,
    'answering within the hour is just a conversation, and is not remarked upon',
  );

  const quiet = [
    msg({ createdAt: daysAgo(40), body: 'talk soon' }),
    msg({ createdAt: now, body: 'hey, how have you been?' }),
  ];
  check(
    noticeToday(quiet, ME, now).some((n) => n.kind === 'checked-in-on-quiet'),
    'going first after a long quiet is noticed',
  );

  const old = [
    msg({ conversationId: 'c-old', createdAt: daysAgo(400), body: 'hi' }),
    msg({ conversationId: 'c-old', createdAt: daysAgo(399), authorId: THEM, body: 'hey' }),
    msg({ conversationId: 'c-old', createdAt: now, body: 'still here' }),
  ];
  check(
    noticeToday(old, ME, now).some((n) => n.kind === 'oldest-friend'),
    'speaking to the oldest friendship again is noticed',
  );

  const yesterdayOnly = [
    msg({ createdAt: daysAgo(5), authorId: THEM, body: 'you around?' }),
    msg({ createdAt: daysAgo(1), body: 'sorry! yes' }),
  ];
  check(noticeToday(yesterdayOnly, ME, now).length === 0, 'and nothing is noticed about a day that is over');
}

console.log('\n— noticing may never increase progress —');

{
  /*
   * The assertion the whole feature rests on. Every detector fires on this
   * history; the level must be identical to the same history counted without
   * anybody looking at the notices.
   */
  const busy: CountableMessage[] = [
    msg({ conversationId: 'c-old', createdAt: daysAgo(400), body: 'hi' }),
    msg({ conversationId: 'c-old', createdAt: daysAgo(399), authorId: THEM, body: 'hey' }),
    msg({ conversationId: 'c-old', createdAt: daysAgo(6), authorId: THEM, body: 'you around?' }),
    msg({ conversationId: 'c-old', createdAt: now, body: 'sorry! yes' }),
    msg({ conversationId: 'c-quiet', createdAt: daysAgo(40), body: 'talk soon' }),
    msg({ conversationId: 'c-quiet', createdAt: daysAgo(39), authorId: THEM, body: 'bye!' }),
    msg({ conversationId: 'c-quiet', createdAt: now, body: 'hey, how have you been?' }),
  ];

  const before = evaluateMessages(busy, ME);
  const notices = noticeToday(busy, ME, now);
  const after = evaluateMessages(busy, ME);

  check(notices.length >= 2, `this history produces several notices (${notices.length})`);
  check(before.momentsEarned === after.momentsEarned, 'and the level is exactly where it was');
  check(
    JSON.stringify(before.metrics) === JSON.stringify(after.metrics),
    'no counter moved either',
  );

  const counted = countMessageMetrics(busy, ME);
  check(
    !Object.keys(counted).some((k) => k.toLowerCase().includes('notice')),
    'there is no metric for being noticed, and there must never be one',
  );

  const text = notices.map((n) => n.text).join(' ').toLowerCase();
  const banned = FORBIDDEN_WORDS.filter((w) =>
    new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text),
  );
  check(banned.length === 0, `a notice never uses the vocabulary Journey rules out${banned.length ? `: ${banned}` : ''}`);
  check(!/\+|moments|level/i.test(text), 'and never mentions moments, a level, or anything gained');
}

console.log('\n— the indicator is a feeling —');

{
  const feelings = [
    feelingFrom({ pulse: [], newConnections: 0 }),
    feelingFrom({ pulse: [{ quietDays: 0, exchanges: 3 }], newConnections: 0 }),
    feelingFrom({ pulse: [{ quietDays: 0, exchanges: 40 }], newConnections: 0 }),
    feelingFrom({
      pulse: [
        { quietDays: 0, exchanges: 5 },
        { quietDays: 2, exchanges: 5 },
        { quietDays: 6, exchanges: 5 },
      ],
      newConnections: 0,
    }),
    feelingFrom({ pulse: [{ quietDays: 1, exchanges: 4 }], newConnections: 3 }),
  ];

  check(feelings.every((f) => !/\d/.test(f)), 'no phrase contains a number');
  check(feelings.every((f) => !/%|rank|score|top|better|worse/i.test(f)), 'and none of them ranks anybody');
  check(new Set(feelings).size >= 4, `different weeks read differently (${new Set(feelings).size} distinct)`);

  /*
   * The quiet week, which is the one that could sting. It must be a welcome
   * rather than a verdict — no "inactive", no "you've been away", nothing that
   * reads as a bar that emptied.
   */
  const quiet = feelingFrom({ pulse: [], newConnections: 0 });
  check(quiet === 'Quietly here', `a quiet week is greeted, not judged ("${quiet}")`);
  check(!/inactive|away|missing|lost|empty|no /i.test(quiet), 'and says nothing about absence');

  check(
    feelingFrom({ pulse: [{ quietDays: 1, exchanges: 4 }], newConnections: 3 }) === 'Building new connections',
    'meeting new people is what gets said when it happens',
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
