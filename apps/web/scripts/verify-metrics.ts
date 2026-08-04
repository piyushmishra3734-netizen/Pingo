/**
 * The real counters, checked against the policy they claim to implement.
 *
 * Every assertion here is one line of `metric-policy.ts` made to bite. The
 * point of the policy was that "never reward spam" should be a behaviour rather
 * than a sentence, and the only way that is true is if sending fifty messages
 * to one person in an evening demonstrably does not count as fifty.
 *
 * Run with `pnpm verify:metrics`.
 */
import { countMessageMetrics, type CountableMessage } from '../src/features/badges/metrics.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const ME = 'me';
const THEM = 'them';

/** Local noon on a given day, so nothing lands in the night or dawn windows. */
const noon = (day: number, minute = 0) => new Date(2026, 2, day, 12, minute).getTime();

let seq = 0;
const msg = (over: Partial<CountableMessage> & { createdAt: number }): CountableMessage => ({
  id: `m${(seq += 1)}`,
  conversationId: 'c1',
  authorId: ME,
  body: 'hello there',
  ...over,
});

console.log('— a message counts when somebody answered —');

{
  const talkingAtSomebody = [msg({ createdAt: noon(1) }), msg({ createdAt: noon(1, 1) })];
  check(
    (countMessageMetrics(talkingAtSomebody, ME).messagesSent ?? 0) === 0,
    'messages into a thread nobody answered count for nothing',
  );

  const exchange = [
    msg({ createdAt: noon(1) }),
    msg({ createdAt: noon(1, 5), authorId: THEM, body: 'hey' }),
    msg({ createdAt: noon(1, 6) }),
  ];
  check(countMessageMetrics(exchange, ME).messagesSent === 2, 'an answered thread counts both of yours');

  const answeredTomorrow = [
    msg({ createdAt: noon(1) }),
    msg({ createdAt: noon(2), authorId: THEM, body: 'sorry, saw this late' }),
    msg({ createdAt: noon(2, 5) }),
  ];
  check(
    countMessageMetrics(answeredTomorrow, ME).messagesSent === 1,
    'and the reply condition is per day, so yesterday’s monologue stays uncounted',
  );

  check(
    countMessageMetrics(exchange, THEM).messagesSent === 1,
    'the counter counts the person asked for, not whoever wrote most',
  );
}

console.log('\n— never reward spam —');

{
  /*
   * Fifty messages to one person in an evening. The policy caps a conversation
   * at thirty a day precisely so stamina cannot stand in for meaning.
   */
  const flood: CountableMessage[] = [msg({ createdAt: noon(1), authorId: THEM, body: 'hi' })];
  for (let i = 0; i < 50; i += 1) flood.push(msg({ createdAt: noon(1, i + 1), body: `line ${i}` }));

  check(countMessageMetrics(flood, ME).messagesSent === 30, `a flood stops at the ceiling (${countMessageMetrics(flood, ME).messagesSent})`);

  // The same fifty spread over two days is two days of talking, not a flood.
  const spread: CountableMessage[] = [];
  for (const day of [1, 2]) {
    spread.push(msg({ createdAt: noon(day), authorId: THEM, body: 'hi' }));
    for (let i = 0; i < 25; i += 1) spread.push(msg({ createdAt: noon(day, i + 1), body: `line ${day}-${i}` }));
  }
  check(countMessageMetrics(spread, ME).messagesSent === 50, 'while the same volume across two days counts in full');

  /*
   * And the ceiling is per conversation, not global: someone with ten active
   * friendships is not spamming, and must not be capped as though they were.
   */
  const many: CountableMessage[] = [];
  for (let c = 0; c < 3; c += 1) {
    many.push(msg({ conversationId: `c${c}`, createdAt: noon(1), authorId: THEM, body: 'hi' }));
    for (let i = 0; i < 30; i += 1) {
      many.push(msg({ conversationId: `c${c}`, createdAt: noon(1, i + 1), body: `to ${c} line ${i}` }));
    }
  }
  check(countMessageMetrics(many, ME).messagesSent === 90, 'three conversations get three ceilings, not one');
}

console.log('\n— never reward repetition —');

{
  const echo: CountableMessage[] = [msg({ createdAt: noon(1), authorId: THEM, body: 'hi' })];
  for (let i = 0; i < 5; i += 1) echo.push(msg({ createdAt: noon(1, i + 1), body: 'ok' }));

  check(countMessageMetrics(echo, ME).messagesSent === 1, '"ok" five times is one thing said');

  const alternating = [
    msg({ createdAt: noon(1), authorId: THEM, body: 'hi' }),
    msg({ createdAt: noon(1, 1), body: 'ok' }),
    msg({ createdAt: noon(1, 2), body: 'actually wait' }),
    msg({ createdAt: noon(1, 3), body: 'ok' }),
  ];
  check(
    countMessageMetrics(alternating, ME).messagesSent === 3,
    'but the same word said again later is not a repeat',
  );

  const echoedThem = [
    msg({ createdAt: noon(1), authorId: THEM, body: 'ready?' }),
    msg({ createdAt: noon(1, 1), body: 'ready?' }),
  ];
  check(
    countMessageMetrics(echoedThem, ME).messagesSent === 1,
    'and answering with their own word still counts — the rule is about repeating yourself',
  );
}

console.log('\n— the long ones —');

{
  const long = 'x'.repeat(320);
  const day: CountableMessage[] = [msg({ createdAt: noon(1), authorId: THEM, body: 'hi' })];
  for (let i = 0; i < 8; i += 1) day.push(msg({ createdAt: noon(1, i + 1), body: `${long}${i}` }));

  const counted = countMessageMetrics(day, ME);
  check(counted.longMessages === 5, `five a day, and no more (${counted.longMessages})`);
  check(
    (countMessageMetrics([...day, msg({ createdAt: noon(1, 20), body: 'short' })], ME).longMessages ?? 0) === 5,
    'a short message does not become a long one by being nearby',
  );

  const under = [
    msg({ createdAt: noon(2), authorId: THEM, body: 'hi' }),
    msg({ createdAt: noon(2, 1), body: 'x'.repeat(299) }),
  ];
  check((countMessageMetrics(under, ME).longMessages ?? 0) === 0, 'and 299 characters is not long');
}

console.log('\n— night and dawn —');

{
  const at = (hour: number, minute: number) => new Date(2026, 2, 4, hour, minute).getTime();
  const night: CountableMessage[] = [
    msg({ createdAt: at(1, 0), authorId: THEM, body: 'still up?' }),
    msg({ createdAt: at(1, 5) }),
    msg({ createdAt: at(2, 0), body: 'and another thing' }),
    msg({ createdAt: at(5, 0), body: 'morning' }),
    msg({ createdAt: at(9, 0), body: 'later' }),
  ];

  const counted = countMessageMetrics(night, ME);
  check(counted.messagesAtNight === 2, `after midnight and before four is night (${counted.messagesAtNight})`);
  check(counted.messagesAtDawn === 1, `four to seven is dawn (${counted.messagesAtDawn})`);
  check(counted.messagesSent === 4, 'and each of them is also just a message');

  const bothWindows = counted.messagesAtNight! + counted.messagesAtDawn!;
  check(bothWindows === 3, 'no message lands in both windows');
}

console.log('\n— a conversation started is a conversation that happened —');

{
  const ignored = [msg({ conversationId: 'c9', createdAt: noon(1), body: 'hey!' })];
  check(
    countMessageMetrics(ignored, ME).conversationsStarted === 0,
    'an opener nobody answered is not a conversation started',
  );

  const answered = [
    msg({ conversationId: 'c9', createdAt: noon(1), body: 'hey!' }),
    msg({ conversationId: 'c9', createdAt: noon(2), authorId: THEM, body: 'hey' }),
  ];
  check(countMessageMetrics(answered, ME).conversationsStarted === 1, 'an answer makes it one');

  const answeredMuchLater = [
    msg({ conversationId: 'c9', createdAt: noon(1), body: 'hey!' }),
    msg({ conversationId: 'c9', createdAt: noon(20), authorId: THEM, body: 'hey, sorry' }),
  ];
  check(
    countMessageMetrics(answeredMuchLater, ME).conversationsStarted === 0,
    'and an answer three weeks later does not',
  );

  const theirs = [
    msg({ conversationId: 'c9', createdAt: noon(1), authorId: THEM, body: 'hey!' }),
    msg({ conversationId: 'c9', createdAt: noon(1, 5) }),
  ];
  check(
    countMessageMetrics(theirs, ME).conversationsStarted === 0,
    'a conversation somebody else started is theirs',
  );
}

console.log('\n— nothing is invented —');

{
  const counted = countMessageMetrics(
    [
      msg({ createdAt: noon(1), authorId: THEM, body: 'hi' }),
      msg({ createdAt: noon(1, 1), attachmentKinds: ['audio'] }),
    ],
    ME,
  );

  /*
   * The policy counts voice notes the recipient *played*, and nothing records a
   * play. Approximating it with "sent" is how a metric quietly stops meaning
   * what its policy says — so it stays absent, which reads as zero.
   */
  check(counted.voiceNotesSent === undefined, 'a metric with no honest source is absent rather than approximated');
  check(counted.friends === undefined, 'and so are the ones this data cannot see at all');
  check(
    Object.values(counted).every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0),
    'every number returned is a real, non-negative number',
  );
  check(countMessageMetrics([], ME).messagesSent === 0, 'an empty history counts zero rather than throwing');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
