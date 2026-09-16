import assert from 'node:assert/strict';
import test from 'node:test';

import { createBoxingCpu } from '../src/games/boxing/cpu.js';
import { COUNT_STEPS, DODGE, DOWN_SETTLE, GET_UP, HITSTOP, IN, MAX_HEALTH, PUNCHES, ROUND_FRAMES, createMatch, stepMatch } from '../src/games/boxing/match.js';

/** A match past its intro, boxers `gap` cm apart around the middle. */
function fighting(gap = 90) {
  const match = createMatch();
  while (match.phase !== 'fight') stepMatch(match, [0, 0]);
  match.boxers[0].x = -gap / 2;
  match.boxers[1].x = gap / 2;
  return match;
}

function run(match, steps, inputs = [0, 0]) {
  for (let i = 0; i < steps; i += 1) stepMatch(match, inputs);
  return match;
}

function tap(match, player, bits, after = [0, 0]) {
  const inputs = [0, 0];
  inputs[player] = bits;
  stepMatch(match, inputs);
  return run(match, 40, after);
}

test('a jab in reach lands and staggers', () => {
  const match = fighting(90);
  stepMatch(match, [IN.JAB, 0]);
  run(match, PUNCHES.jab.startup + 1);
  assert.equal(match.boxers[1].health, MAX_HEALTH - PUNCHES.jab.damage);
  assert.equal(match.boxers[1].state, 'hurt');
});

test('a jab out of reach whiffs, and costs recovery', () => {
  const match = fighting(200);
  tap(match, 0, IN.JAB);
  assert.equal(match.boxers[1].health, MAX_HEALTH);
});

test('the power punch reaches a little further and hurts much more', () => {
  const match = fighting(110);
  tap(match, 0, IN.POWER);
  assert.equal(match.boxers[1].health, MAX_HEALTH - PUNCHES.power.damage);
});

test('a guard turns a power punch into a scratch, paid for in stamina', () => {
  const match = fighting(90);
  const inputs = [IN.POWER, IN.BLOCK];
  stepMatch(match, inputs);
  run(match, 30, [0, IN.BLOCK]);
  const defender = match.boxers[1];
  assert.ok(defender.health > MAX_HEALTH - 30, `health ${defender.health}`);
  assert.ok(defender.stamina < 1000, 'blocking cost stamina');
});

test('a well-timed slip makes a punch miss', () => {
  const match = fighting(90);
  // Slip first, then the punch arrives while the slip is live.
  stepMatch(match, [0, IN.DODGE]);
  stepMatch(match, [IN.POWER, 0]);
  run(match, 30);
  assert.equal(match.boxers[1].health, MAX_HEALTH);
  assert.ok(PUNCHES.power.startup + 1 <= DODGE.to, 'the slip covers the power punch');
});

test('holding jab throws one jab, not a flurry', () => {
  const match = fighting(90);
  run(match, 120, [IN.JAB, 0]);
  assert.equal(match.boxers[1].health, MAX_HEALTH - PUNCHES.jab.damage);
});

test('nobody walks through the other boxer or out of the ring', () => {
  const match = fighting(150);
  for (let i = 0; i < 400; i += 1) {
    stepMatch(match, [IN.RIGHT, IN.LEFT]);
    const [a, b] = match.boxers;
    assert.ok(a.x < b.x, `step ${i}`);
  }
  run(match, 600, [IN.LEFT, IN.RIGHT]);
  assert.ok(match.boxers[0].x >= -230 && match.boxers[1].x <= 230);
});

test('a knockdown is counted; mashing gets you up, doing nothing is a knockout', () => {
  const match = fighting(90);
  match.boxers[1].health = 10;
  tap(match, 0, IN.JAB);
  assert.equal(match.phase, 'down');
  assert.equal(match.boxers[1].state, 'down');
  run(match, DOWN_SETTLE + 1);
  for (let i = 0; i < GET_UP[0].presses; i += 1) {
    stepMatch(match, [0, IN.JAB]);
    stepMatch(match, [0, 0]);
  }
  assert.equal(match.phase, 'fight');
  assert.equal(match.boxers[1].health, GET_UP[0].health);

  run(match, 40);
  match.boxers[0].x = -45;
  match.boxers[1].x = 45;
  match.boxers[1].health = 10;
  tap(match, 0, IN.JAB);
  assert.equal(match.phase, 'down');
  run(match, DOWN_SETTLE + COUNT_STEPS * 10 + 5);
  assert.equal(match.phase, 'ko');
  run(match, 200);
  assert.deepEqual(match.wins, [1, 0]);
});

test('hit stop holds the whole match still when a punch lands', () => {
  const match = fighting(90);
  stepMatch(match, [IN.JAB, 0]);
  run(match, PUNCHES.jab.startup);
  assert.equal(match.hitstop, HITSTOP.jab);
  const t = match.boxers[1].t;
  run(match, HITSTOP.jab);
  assert.equal(match.boxers[1].t, t, 'nobody moved during the stop');
});

test('a counter punch earns a star, and a star punch spends it', () => {
  const match = fighting(90);
  stepMatch(match, [0, IN.POWER]);
  run(match, 4);
  stepMatch(match, [IN.JAB, 0]);
  run(match, 30);
  assert.equal(match.boxers[0].stars, 1);
  run(match, 40);
  stepMatch(match, [IN.STAR, 0]);
  assert.equal(match.boxers[0].state, 'star');
  assert.equal(match.boxers[0].stars, 0);
});

test('a knockout ends the round; two rounds win the match', () => {
  const match = fighting(90);
  match.boxers[1].health = 10;
  match.boxers[1].knockdowns = GET_UP.length;
  tap(match, 0, IN.JAB);
  assert.equal(match.boxers[1].state, 'ko');
  run(match, 200);
  assert.deepEqual(match.wins, [1, 0]);
  assert.equal(match.round, 2);
  assert.equal(match.boxers[1].health, MAX_HEALTH);

  while (match.phase !== 'fight') stepMatch(match, [0, 0]);
  match.boxers[0].x = -45;
  match.boxers[1].x = 45;
  match.boxers[1].health = 10;
  match.boxers[1].knockdowns = GET_UP.length;
  tap(match, 0, IN.JAB);
  run(match, 200);
  assert.equal(match.phase, 'over');
  assert.equal(match.winner, 0);
});

test('when time runs out, the healthier boxer takes the round', () => {
  const match = fighting(200);
  match.boxers[0].health = 800;
  match.boxers[1].health = 500;
  match.timer = 1;
  stepMatch(match, [0, 0]);
  assert.equal(match.phase, 'timeup');
  run(match, 150);
  assert.deepEqual(match.wins, [1, 0]);
  assert.equal(match.timer, ROUND_FRAMES);
});

test('the computer is deterministic: same seed, same match', () => {
  const play = (seed) => {
    const match = createMatch();
    const left = createBoxingCpu({ seed, level: 'normal' });
    const right = createBoxingCpu({ seed: seed + 1, level: 'hard' });
    const trace = [];
    for (let i = 0; i < 3000; i += 1) {
      stepMatch(match, [left.think(match, 0), right.think(match, 1)]);
      trace.push(match.boxers[0].health * 10000 + match.boxers[1].health);
    }
    return trace;
  };
  assert.deepEqual(play(7), play(7));
});

test('two computers box a whole match to the end', () => {
  const match = createMatch();
  const left = createBoxingCpu({ seed: 3 });
  const right = createBoxingCpu({ seed: 11 });
  let steps = 0;
  while (match.phase !== 'over' && steps < 60 * 60 * 5) {
    stepMatch(match, [left.think(match, 0), right.think(match, 1)]);
    steps += 1;
  }
  assert.equal(match.phase, 'over', `still ${match.phase} after ${steps} steps`);
});
