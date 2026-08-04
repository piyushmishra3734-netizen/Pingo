/**
 * The pipeline, checked end to end.
 *
 *     Events → Meaning Evaluator → Journey Metrics → Badge Evaluator → Journey UI
 *
 * The first three stages are here. What is asserted is not that the code runs —
 * it is that the philosophy survives contact with arithmetic: that one long
 * conversation genuinely outweighs a day of heavy messaging, that nothing which
 * would not matter in a year can earn anything, and that a real-life claim from
 * one side alone is worth nothing at all.
 *
 * Run with `pnpm verify:journey-pipeline`.
 */
import { EVENT_MEANING, type JourneyEvent, type JourneyEventKind } from '../src/features/journey/events.js';
import { evaluateJourney } from '../src/features/journey/evaluate.js';
import { libraryFor } from '../src/features/badges/registry.js';
import { METRIC_POLICY } from '../src/features/badges/metric-policy.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const at = (day: number, hour = 12, minute = 0) => new Date(2026, 6, day, hour, minute).getTime();

let seq = 0;
const id = () => `e${(seq += 1)}`;

const sent = (day: number, minute: number, over: Partial<Extract<JourneyEvent, { kind: 'message.sent' }>> = {}): JourneyEvent => ({
  kind: 'message.sent',
  id: id(),
  at: at(day, 12, minute),
  conversationId: 'c1',
  characters: 20,
  fingerprint: `line ${minute}`,
  ...over,
});

const received = (day: number, minute: number, conversationId = 'c1'): JourneyEvent => ({
  kind: 'message.received',
  id: id(),
  at: at(day, 12, minute),
  conversationId,
  with: 'baani',
});

console.log('— every event kind has answered the one-year test —');

{
  const kinds = Object.keys(EVENT_MEANING) as JourneyEventKind[];

  check(
    kinds.every((k) => EVENT_MEANING[k].rememberedInAYear.trim().length > 20),
    'every kind says, in writing, whether it would matter a year from now',
  );

  const counting = kinds.filter((k) => EVENT_MEANING[k].counts);
  check(
    counting.every((k) => EVENT_MEANING[k].weight > 0),
    'anything that counts is worth something',
  );
  check(
    kinds.filter((k) => !EVENT_MEANING[k].counts).every((k) => EVENT_MEANING[k].weight === 0),
    'and anything that does not is worth exactly nothing',
  );

  /*
   * The two kinds that exist to be refused. They are in the union on purpose:
   * a surface should be able to emit whatever it observes without knowing the
   * rules, and the refusal should be visible rather than a missing call.
   */
  check(EVENT_MEANING['app.opened'].counts === false, 'opening the app earns nothing');
  check(EVENT_MEANING['reaction.given'].counts === false, 'and neither does a tap');

  const metrics = counting.map((k) => EVENT_MEANING[k].metric).filter(Boolean) as string[];
  check(
    metrics.every((m) => (METRIC_POLICY as Record<string, unknown>)[m] !== undefined),
    'every metric an event feeds has been through the meaningful-interaction rule',
  );
}

console.log('— what would not matter in a year earns nothing —');

{
  const opens: JourneyEvent[] = [];
  for (let i = 0; i < 40; i += 1) opens.push({ kind: 'app.opened', id: id(), at: at(1, 9, i) });
  for (let i = 0; i < 40; i += 1) opens.push({ kind: 'reaction.given', id: id(), at: at(1, 10, i), with: 'baani' });

  const result = evaluateJourney(opens);
  check(result.momentsEarned === 0, `eighty of them are worth nothing (${result.momentsEarned})`);
  check(result.moments.length === 0, 'and produce no moment at all');
  check(
    result.rejected.length === 80 && result.rejected.every((r) => r.reason === 'not-memorable'),
    'each one is rejected with a reason rather than silently dropped',
  );
}

console.log('\n— quality beats quantity, in arithmetic —');

{
  /*
   * The rule the user set, made checkable: one long conversation must be worth
   * more than a day of messaging that hits the ceiling. If the bonus were
   * modest, volume would win on a busy enough day — so this is the assertion
   * that keeps the weights honest.
   */
  const heavyDay: JourneyEvent[] = [received(1, 0)];
  for (let i = 0; i < 300; i += 1) heavyDay.push(sent(1, i + 1));
  const messaging = evaluateJourney(heavyDay);

  const longCall = evaluateJourney([
    { kind: 'call.ended', id: id(), at: at(2, 20), with: 'baani', seconds: 45 * 60, answered: true, participants: 2 },
  ]);

  check(messaging.metrics.messagesSent === 30, `three hundred messages count as thirty (${messaging.metrics.messagesSent})`);
  check(
    longCall.momentsEarned > messaging.momentsEarned,
    `and a forty-five minute call is worth more than that whole day (${longCall.momentsEarned} vs ${messaging.momentsEarned})`,
  );

  const shortCall = evaluateJourney([
    { kind: 'call.ended', id: id(), at: at(2, 20), with: 'baani', seconds: 4 * 60, answered: true, participants: 2 },
  ]);
  check(
    shortCall.momentsEarned < longCall.momentsEarned / 4,
    'a four-minute call is not a long conversation, and is not paid like one',
  );

  const unanswered = evaluateJourney([
    { kind: 'call.ended', id: id(), at: at(2, 20), with: 'baani', seconds: 90, answered: false, participants: 2 },
  ]);
  check(unanswered.momentsEarned === 0 && unanswered.rejected[0]?.reason === 'unreceived', 'a call nobody picked up is not a call');
}

console.log('\n— real life needs the other person —');

{
  const claimed = evaluateJourney([
    { kind: 'meetup.confirmed', id: id(), at: at(3), with: 'baani', bothConfirmed: false },
  ]);
  check(
    claimed.momentsEarned === 0 && claimed.rejected[0]?.reason === 'not-mutual',
    'a meet-up one person confirmed alone is worth nothing',
  );

  const both = evaluateJourney([
    { kind: 'meetup.confirmed', id: id(), at: at(3), with: 'baani', bothConfirmed: true },
  ]);
  check(both.metrics.meetupsConfirmed === 1, 'and worth a great deal when both did');

  const twiceInADay: JourneyEvent[] = [
    { kind: 'meetup.confirmed', id: id(), at: at(3, 9), with: 'baani', bothConfirmed: true },
    { kind: 'meetup.confirmed', id: id(), at: at(3, 18), with: 'baani', bothConfirmed: true },
  ];
  check(evaluateJourney(twiceInADay).metrics.meetupsConfirmed === 1, 'seeing the same friend twice in a day is one day together');

  const twoFriends: JourneyEvent[] = [
    { kind: 'meetup.confirmed', id: id(), at: at(3, 9), with: 'baani', bothConfirmed: true },
    { kind: 'meetup.confirmed', id: id(), at: at(3, 18), with: 'kashish', bothConfirmed: true },
  ];
  check(evaluateJourney(twoFriends).metrics.meetupsConfirmed === 2, 'while two friends in a day is two');

  const unreadWish = evaluateJourney([
    { kind: 'birthday.wished', id: id(), at: at(4), with: 'baani', read: false },
  ]);
  check(unreadWish.rejected[0]?.reason === 'unreceived', 'a birthday message they never opened is not a wish');

  const sameYear: JourneyEvent[] = [
    { kind: 'birthday.wished', id: id(), at: at(4, 9), with: 'baani', read: true },
    { kind: 'birthday.wished', id: id(), at: at(4, 10), with: 'baani', read: true },
  ];
  check(evaluateJourney(sameYear).metrics.birthdayWishes === 1, 'and one friend has one birthday a year');
}

console.log('\n— a place is not a view —');

{
  const sameFriendAgain: JourneyEvent[] = [];
  for (let i = 0; i < 20; i += 1) {
    sameFriendAgain.push({ kind: 'story.watched', id: id(), at: at(5, 10, i), with: 'baani', place: 'Delhi' });
  }
  const watched = evaluateJourney(sameFriendAgain);
  check(watched.metrics.storyPlaces === 1, `the same friend in the same city is one fact, not twenty (${watched.metrics.storyPlaces})`);
  check(
    watched.rejected.filter((r) => r.reason === 'already-counted').length === 19,
    'and the rest are refused as already counted',
  );

  const spread = evaluateJourney([
    { kind: 'story.watched', id: id(), at: at(5, 10), with: 'baani', place: 'Delhi' },
    { kind: 'story.watched', id: id(), at: at(5, 11), with: 'kashish', place: 'Pune' },
    { kind: 'story.watched', id: id(), at: at(5, 12), with: 'sneha', place: 'delhi' },
  ]);
  check(spread.metrics.storyPlaces === 3, 'three friends in three places is three, and the city match ignores case');
}

console.log('\n— the same event twice is one moment —');

{
  const once: JourneyEvent[] = [received(6, 0), sent(6, 1)];
  const twice = [...once, ...once];

  const a = evaluateJourney(once);
  const b = evaluateJourney(twice);

  check(a.metrics.messagesSent === b.metrics.messagesSent, 'a re-read history does not double the counters');
  check(a.momentsEarned === b.momentsEarned, 'nor the moments');
  check(
    b.rejected.filter((r) => r.reason === 'duplicate').length === 2,
    'the repeats are named as duplicates',
  );
}

console.log('\n— nothing rewards inactivity —');

{
  /*
   * A month of opening the app and nothing else. If any part of the pipeline
   * counted presence, this is where it would show up as progress.
   */
  const present: JourneyEvent[] = [];
  for (let day = 1; day <= 30; day += 1) present.push({ kind: 'app.opened', id: id(), at: at(day, 9) });

  const result = evaluateJourney(present);
  check(result.momentsEarned === 0, 'thirty days of showing up, alone, is not progress');
  check(Object.keys(result.metrics).length === 0, 'and advances no counter');

  const library = libraryFor(result.metrics);
  check(library.every((entry) => !entry.unlocked), 'so no badge unlocks from presence');
}

console.log('\n— the pipeline hands the Badge Evaluator something it understands —');

{
  const events: JourneyEvent[] = [received(7, 0)];
  for (let i = 0; i < 40; i += 1) events.push(sent(7, i + 1));
  events.push({ kind: 'conversation.started', id: id(), at: at(7, 13), conversationId: 'c1', with: 'baani' });
  events.push({ kind: 'friend.established', id: id(), at: at(7, 14), with: 'baani' });

  const { metrics, moments, momentsEarned } = evaluateJourney(events);
  const library = libraryFor(metrics);

  check(library.length > 0 && library.some((e) => e.badge.id === 'first_friend' && e.unlocked), 'the metrics unlock what they should');
  check(
    library.find((e) => e.badge.id === 'hundred_messages')?.fraction === 0.3,
    'and a partly-done badge reports a real fraction',
  );
  check(moments.every((m) => Number.isFinite(m.weight) && m.weight >= 0), 'every moment carries a real weight');
  check(momentsEarned > 0, 'and the level has something to show for the day');
  check(
    moments.every((m) => !m.metric || (METRIC_POLICY as Record<string, unknown>)[m.metric] !== undefined),
    'no moment advances a metric that never went through the rule',
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
