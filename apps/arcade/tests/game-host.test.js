import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_STEPS, STEP_MS, stepsFor } from '../src/games/game-host.js';

test('one 60 Hz display frame is one step', () => {
  const { steps, accumulator } = stepsFor(0, STEP_MS);
  assert.equal(steps, 1);
  assert.ok(accumulator < 1e-9);
});

test('a 120 Hz display runs a step every other frame, never faster', () => {
  let accumulator = 0;
  let total = 0;
  for (let i = 0; i < 120; i += 1) {
    const next = stepsFor(accumulator, 1000 / 120);
    accumulator = next.accumulator;
    total += next.steps;
  }
  assert.ok(total >= 59 && total <= 60, `${total} steps in one second`);
});

test('a 30 fps phone runs two steps a frame, so the game keeps real time', () => {
  const { steps } = stepsFor(0, 1000 / 30);
  assert.equal(steps, 2);
});

test('a stall is capped, not fast-forwarded', () => {
  assert.equal(stepsFor(0, 60_000).steps, MAX_STEPS);
});

test('a clock that jumps backwards runs nothing', () => {
  assert.equal(stepsFor(0, -50).steps, 0);
});
