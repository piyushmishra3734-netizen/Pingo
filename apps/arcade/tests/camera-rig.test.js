import assert from 'node:assert/strict';
import test from 'node:test';

import { easeInOutCubic, tweenProgress } from '../src/lobby/camera-rig.js';

test('the easing starts at rest, ends at rest, and passes the middle at half way', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
});

test('the easing only ever moves forward', () => {
  let previous = 0;
  for (let i = 1; i <= 100; i += 1) {
    const value = easeInOutCubic(i / 100);
    assert.ok(value >= previous, `step ${i}`);
    previous = value;
  }
});

test('progress is clamped: before the start is 0, after the end is 1', () => {
  assert.equal(tweenProgress(50, 100, 900), 0);
  assert.equal(tweenProgress(5000, 100, 900), 1);
  assert.equal(tweenProgress(550, 100, 900), 0.5);
});

test('a zero-length move arrives at once rather than dividing by zero', () => {
  assert.equal(tweenProgress(100, 100, 0), 1);
});
