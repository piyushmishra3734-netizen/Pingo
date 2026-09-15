import assert from 'node:assert/strict';
import test from 'node:test';

import { IN, MAX_HP, MOVES, ROUND_FRAMES, SUB, createBout, stepBout } from '../src/games/brawler/bout.js';
import { createCpu } from '../src/games/brawler/cpu.js';

/** A bout past its intro, fighters placed `gapPx` apart around x 150. */
function fighting(gapPx = 20) {
  const bout = createBout();
  while (bout.phase !== 'fight') stepBout(bout, [0, 0]);
  bout.fighters[0].x = 150 * SUB;
  bout.fighters[1].x = (150 + gapPx) * SUB;
  return bout;
}

/** Runs `steps` steps with the same inputs; returns the bout. */
function run(bout, steps, inputs = [0, 0]) {
  for (let i = 0; i < steps; i += 1) stepBout(bout, inputs);
  return bout;
}

/** A single press: one step holding `bits`, then released. */
function tap(bout, player, bits) {
  const inputs = [0, 0];
  inputs[player] = bits;
  stepBout(bout, inputs);
}

test('a punch in reach lands: damage, and the other one reels', () => {
  const bout = fighting(20);
  tap(bout, 0, IN.PUNCH);
  run(bout, MOVES.punch.startup + 1);
  const [, target] = bout.fighters;
  assert.equal(target.hp, MAX_HP - MOVES.punch.damage);
  assert.equal(target.state, 'hurt');
});

test('a punch out of reach whiffs', () => {
  const bout = fighting(60);
  tap(bout, 0, IN.PUNCH);
  run(bout, 30);
  assert.equal(bout.fighters[1].hp, MAX_HP);
});

test('the kick reaches further than the punch', () => {
  // Reach is to the body's edge, 10 px short of its centre: punch 36, kick 44.
  const punch = fighting(40);
  tap(punch, 0, IN.PUNCH);
  run(punch, 30);
  assert.equal(punch.fighters[1].hp, MAX_HP, 'the punch falls short at 40 px');

  const kick = fighting(40);
  tap(kick, 0, IN.KICK);
  run(kick, 30);
  assert.equal(kick.fighters[1].hp, MAX_HP - MOVES.kick.damage, 'the kick connects');
});

test('blocking turns a hit into a chip and blockstun', () => {
  const bout = fighting(20);
  stepBout(bout, [IN.PUNCH, IN.BLOCK]);
  run(bout, MOVES.punch.startup + 1, [0, IN.BLOCK]);
  const [, target] = bout.fighters;
  assert.equal(target.hp, MAX_HP - Math.floor(MOVES.punch.damage / 5));
  assert.equal(target.state, 'blockstun');
});

test('holding punch throws one punch, not a stream', () => {
  const bout = fighting(20);
  run(bout, 90, [IN.PUNCH, 0]);
  assert.equal(bout.fighters[1].hp, MAX_HP - MOVES.punch.damage);
});

test('a knockout ends the round, and two rounds end the match', () => {
  const bout = fighting(20);
  bout.fighters[1].hp = 3;
  tap(bout, 0, IN.PUNCH);
  run(bout, MOVES.punch.startup + 1);
  assert.equal(bout.fighters[1].state, 'ko');
  assert.equal(bout.phase, 'ko');

  run(bout, 200);
  assert.deepEqual(bout.wins, [1, 0]);
  assert.equal(bout.round, 2);
  assert.equal(bout.fighters[1].hp, MAX_HP, 'a new round starts fresh');

  while (bout.phase !== 'fight') stepBout(bout, [0, 0]);
  bout.fighters[0].x = 150 * SUB;
  bout.fighters[1].x = 170 * SUB;
  bout.fighters[1].hp = 3;
  tap(bout, 0, IN.PUNCH);
  run(bout, 200);
  assert.equal(bout.phase, 'over');
  assert.equal(bout.winner, 0);
});

test('when time runs out, the one with more health takes the round', () => {
  const bout = fighting(80);
  bout.fighters[0].hp = 80;
  bout.fighters[1].hp = 50;
  bout.timer = 1;
  stepBout(bout, [0, 0]);
  assert.equal(bout.phase, 'timeup');
  run(bout, 130);
  assert.deepEqual(bout.wins, [1, 0]);
  assert.equal(bout.timer, ROUND_FRAMES);
});

test('fighters on the ground cannot walk through each other', () => {
  const bout = fighting(40);
  for (let i = 0; i < 180; i += 1) {
    stepBout(bout, [IN.RIGHT, IN.LEFT]);
    const [a, b] = bout.fighters;
    assert.ok(a.x < b.x, `step ${i}: still on their own sides`);
  }
});

test('the computer is deterministic: same seed, same fight', () => {
  const play = (seed) => {
    const bout = createBout();
    const left = createCpu({ seed, level: 'normal' });
    const right = createCpu({ seed: seed + 1, level: 'hard' });
    const trace = [];
    for (let i = 0; i < 3000; i += 1) {
      stepBout(bout, [left.think(bout, 0), right.think(bout, 1)]);
      trace.push(bout.fighters[0].hp * 1000 + bout.fighters[1].hp);
    }
    return trace;
  };
  assert.deepEqual(play(42), play(42));
});

test('two computers finish a whole match - no stalemate, no stuck state', () => {
  const bout = createBout();
  const left = createCpu({ seed: 3, level: 'normal' });
  const right = createCpu({ seed: 9, level: 'normal' });
  let steps = 0;
  while (bout.phase !== 'over' && steps < 60 * 60 * 8) {
    stepBout(bout, [left.think(bout, 0), right.think(bout, 1)]);
    steps += 1;
  }
  assert.equal(bout.phase, 'over', `still ${bout.phase} after ${steps} steps`);
  assert.ok(bout.wins[0] >= 2 || bout.wins[1] >= 2);
});

test('the computer blocks a slow kick more than a fast punch', () => {
  // Normal reacts after 6 steps: after the punch's 4-step startup, before the kick's 8.
  const blocks = (move) => {
    let blocked = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const bout = fighting(24);
      const cpu = createCpu({ seed, level: 'normal' });
      stepBout(bout, [move, cpu.think(bout, 1)]);
      for (let i = 0; i < 20; i += 1) stepBout(bout, [0, cpu.think(bout, 1)]);
      if (bout.fighters[1].state === 'blockstun' || bout.fighters[1].hp > MAX_HP - 3) blocked += 1;
    }
    return blocked;
  };
  assert.ok(blocks(IN.KICK) > blocks(IN.PUNCH), `kick ${blocks(IN.KICK)} vs punch ${blocks(IN.PUNCH)}`);
});
