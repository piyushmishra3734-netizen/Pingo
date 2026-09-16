import assert from 'node:assert/strict';
import test from 'node:test';

import { createRacingCpu } from '../src/games/racing/cpu.js';
import { COUNTDOWN, DRIFT_LEVELS, IN, createRace, stepRace } from '../src/games/racing/race.js';
import { TRACKS, buildTrack } from '../src/games/racing/track.js';

const racing = (track = TRACKS[0]) => {
  const race = createRace(track);
  while (race.phase === 'countdown') stepRace(race, [0, 0, 0, 0]);
  return race;
};

test('every circuit closes on itself without tiles overlapping', () => {
  for (const track of TRACKS) {
    const built = buildTrack(track.layout);
    assert.ok(built.closed, `${track.name} does not close`);
    assert.ok(!built.overlaps, `${track.name} overlaps itself`);
  }
});

test('computers drive every circuit to the finish, in a sensible time', () => {
  for (const track of TRACKS) {
    const race = createRace(track);
    const drivers = race.karts.map((_, i) => createRacingCpu({ seed: 5 + i, lane: [-2, 2, -1, 1][i], player: -1 }));
    let steps = 0;
    while (!race.karts.every((k) => k.finished) && steps < 60 * 60 * 4) {
      stepRace(race, drivers.map((d, i) => d.think(race, i)));
      steps += 1;
    }
    const times = race.karts.map((k) => +(k.finished / 60).toFixed(1));
    assert.ok(race.karts.every((k) => k.finished), `${track.name}: laps ${race.karts.map((k) => k.lap)} after ${steps} steps`);
    console.log(track.name, 'finish times', times);
  }
});

test('a held drift through a corner charges a mini-turbo on release', () => {
  const race = racing();
  const k = race.karts[0];
  for (let i = 0; i < 90; i += 1) stepRace(race, [0, 0, 0, 0]);
  stepRace(race, [IN.DRIFT | IN.RIGHT, 0, 0, 0]);
  // Counter-steering holds the drift gently along the straight, charging one a step.
  for (let i = 0; i < DRIFT_LEVELS[0] + 5; i += 1) stepRace(race, [IN.DRIFT | IN.LEFT, 0, 0, 0]);
  assert.ok(k.drift !== 0, 'drifting');
  stepRace(race, [0, 0, 0, 0]);
  assert.ok(k.boost > 0, 'turbo on release');
});

test('DRIFT just before the lights is a rocket start; too early stalls', () => {
  const race = createRace(TRACKS[0]);
  for (let t = 1; t <= COUNTDOWN; t += 1) {
    const bits = [0, 0, 0, 0];
    if (t === COUNTDOWN - 10) bits[0] = IN.DRIFT;
    if (t === 70) bits[1] = IN.DRIFT;
    stepRace(race, bits);
  }
  assert.ok(race.karts[0].boost > 0, 'rocket');
  assert.ok(race.karts[1].stall > 0, 'stalled');
});

test('the same inputs make the same race', () => {
  const run = () => {
    const race = createRace(TRACKS[1]);
    const drivers = race.karts.map((_, i) => createRacingCpu({ seed: 9 + i }));
    for (let i = 0; i < 1500; i += 1) stepRace(race, drivers.map((d, j) => d.think(race, j)));
    return race.karts.map((k) => [k.x, k.z, k.lap]);
  };
  assert.deepEqual(run(), run());
});
