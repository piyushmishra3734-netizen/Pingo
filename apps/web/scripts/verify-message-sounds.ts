/**
 * The message sounds, checked as numbers rather than as opinions.
 *
 * Two things are testable here without a speaker. The throttle is pure logic and
 * takes the clock as an argument, so a burst can be simulated in a millisecond.
 * And the sound designs are data, so the claims made about them in the comments
 * — soft rather than harsh, sent shorter than received, nothing loud enough to
 * clip — are assertions rather than intentions.
 *
 * What this cannot tell you is whether it sounds good. That needs ears.
 *
 * Run with `pnpm verify:message-sounds`.
 */
import {
  FRESH_THROTTLE,
  RECEIVED,
  SENT,
  decide,
  type SoundDesign,
  type ThrottleState,
} from '../src/lib/audio/message-sounds.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

/** Peak of every layer summed — the worst case for clipping. */
const peakSum = (design: SoundDesign) =>
  design.partials.reduce((sum, p) => sum + p.gain, 0) + (design.air?.gain ?? 0);

/** How long the design actually lasts, from its own envelopes. */
const envelopeEnd = (design: SoundDesign) =>
  Math.max(...design.partials.map((p) => p.delayMs + p.attackMs + p.decayMs));

console.log('— sent is short, dry and closed —');

{
  check(SENT.durationMs >= 50 && SENT.durationMs <= 90, `within the 50-90 ms brief (${SENT.durationMs} ms)`);
  check(SENT.partials[0]!.to < SENT.partials[0]!.from, 'the body falls, which reads as finished');
  check(
    !SENT.partials.some((p) => p.delayMs > 0),
    'nothing blooms — the sender does not need it to feel like it is opening',
  );
  check(envelopeEnd(SENT) <= SENT.durationMs + 10, 'the declared duration matches its envelopes');
}

console.log('\n— received is warmer, and opens —');

{
  check(
    RECEIVED.durationMs >= 80 && RECEIVED.durationMs <= 140,
    `within the 80-140 ms brief (${RECEIVED.durationMs} ms)`,
  );
  check(RECEIVED.durationMs > SENT.durationMs, 'and is longer than sent');
  check(RECEIVED.partials[0]!.to > RECEIVED.partials[0]!.from, 'the body rises, which reads as arriving');

  const bloom = RECEIVED.partials.find((p) => p.delayMs > 0);
  check(bloom !== undefined, 'there is a delayed bloom');
  check(
    bloom !== undefined && bloom.delayMs >= 15 && bloom.delayMs <= 35,
    `late enough to be felt, early enough not to be a second event (${bloom?.delayMs} ms)`,
  );
  check(
    bloom !== undefined && Math.abs(bloom.from / RECEIVED.partials[0]!.from - 1.5) < 0.02,
    'and it is a perfect fifth above the body — consonant without being a tune',
  );

  const sub = RECEIVED.partials.find((p) => p.from < RECEIVED.partials[0]!.from);
  check(sub !== undefined, 'a sub-octave carries the warmth');
  check(RECEIVED.partials.length > SENT.partials.length, 'received is the richer of the two');
}

console.log('\n— soft, not harsh —');

{
  /*
   * 2-5 kHz is where the ear is most sensitive and where alarms are placed on
   * purpose. Anything with real energy there stops sounding premium and starts
   * sounding like a warning.
   */
  for (const [name, design] of [['sent', SENT], ['received', RECEIVED]] as const) {
    const loud = design.partials.filter((p) => p.gain > 0.05);
    const highest = Math.max(...loud.map((p) => Math.max(p.from, p.to)));
    check(highest < 2500, `${name}: every audible partial sits below 2.5 kHz (${highest} Hz)`);

    const air = design.air;
    check(
      air === undefined || air.gain <= 0.03,
      `${name}: the air layer is texture, not a beep (${air?.gain})`,
    );

    check(
      design.partials.every((p) => p.attackMs >= 4),
      `${name}: no attack fast enough to read as a click`,
    );
    check(
      design.partials.every((p) => p.attackMs <= 20),
      `${name}: and none slow enough to feel sluggish`,
    );
  }
}

{
  // Layers sum, so each must be quiet enough that the total does not clip.
  check(peakSum(SENT) < 1, `sent cannot clip (${peakSum(SENT).toFixed(2)})`);
  check(peakSum(RECEIVED) < 1, `received cannot clip (${peakSum(RECEIVED).toFixed(2)})`);
  check(
    peakSum(RECEIVED) > peakSum(SENT),
    'and received is the fractionally more rewarding of the two',
  );
}

console.log('\n— one message at a time —');

{
  let state: ThrottleState = FRESH_THROTTLE;
  const first = decide(state, 1_000);
  check(first.play, 'the first sound plays');
  check(first.gain === 1, 'at full volume');

  // Straight away: too soon.
  const second = decide(first.state, 1_100);
  check(!second.play, 'a second 100 ms later is suppressed');

  // Well after: a fresh isolated sound.
  state = decide(first.state, 5_000).state;
  check(decide(state, 9_000).play, 'a sound seconds later plays again');
  check(decide(state, 9_000).gain === 1, 'and is back to full volume');
}

console.log('\n— ten messages arriving at once —');

{
  /*
   * The case the whole throttle exists for. Ten arrivals over three seconds
   * must not produce ten sounds, must not cut out abruptly, and must not still
   * be making noise at the end.
   */
  let state: ThrottleState = FRESH_THROTTLE;
  const played: number[] = [];

  for (let i = 0; i < 10; i += 1) {
    const at = 1_000 + i * 300;
    const decision = decide(state, at);
    state = decision.state;
    if (decision.play) played.push(decision.gain);
  }

  check(played.length > 0, 'the burst is acknowledged');
  check(played.length <= 4, `but not announced ten times (${played.length} sounds)`);
  check(
    played.every((gain, i) => i === 0 || gain < played[i - 1]!),
    'each one is quieter than the last',
  );
  check(played[played.length - 1]! < played[0]!, 'so the burst fades rather than stopping dead');
}

{
  // A steady stream must not settle into a steady beat of sound.
  let state: ThrottleState = FRESH_THROTTLE;
  let sounds = 0;
  for (let at = 0; at < 10_000; at += 400) {
    const decision = decide(state, at);
    state = decision.state;
    if (decision.play) sounds += 1;
  }
  check(sounds <= 4, `ten seconds of constant messages makes few sounds (${sounds})`);
}

{
  /*
   * A burst keeps extending while messages keep coming, so the sound does not
   * return the moment somebody pauses for half a second mid-flurry.
   */
  let state: ThrottleState = FRESH_THROTTLE;
  let last = 0;
  for (let i = 0; i < 6; i += 1) {
    last = 1_000 + i * 400;
    state = decide(state, last).state;
  }

  // Shorter than the burst window, measured from the last arrival — not from
  // where the loop was assumed to end, which is what this test got wrong first.
  const duringPause = decide(state, last + 600);
  check(!duringPause.play, 'a short pause inside a burst does not reset it');

  const afterQuiet = decide(state, last + 4_000);
  check(afterQuiet.play && afterQuiet.gain === 1, 'but real quiet does, at full volume');
}

console.log('\n— the throttle does not decide alone —');

{
  /*
   * `decide` is pure and knows nothing about mute, quiet hours or focus. That
   * is deliberate: those gates live where the notification decision already
   * lives, and duplicating them here would give two places to disagree about
   * whether a muted chat is silent.
   */
  const before: ThrottleState = { ...FRESH_THROTTLE };
  decide(before, 1_000);
  check(
    before.lastPlayedAt === FRESH_THROTTLE.lastPlayedAt,
    'deciding does not mutate the state handed in',
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
