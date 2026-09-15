import assert from 'node:assert/strict';
import test from 'node:test';

import { collide } from '../src/lobby/collide.js';

const BOX = [[0, 0, 2, 2]];
const close = (actual, expected) =>
  assert.ok(Math.abs(actual[0] - expected[0]) < 1e-9 && Math.abs(actual[1] - expected[1]) < 1e-9, `${actual} vs ${expected}`);

test('a walker clear of every box is left alone', () => {
  close(collide(5, 5, 0.35, BOX), [5, 5]);
});

test('walking into a side stops at the side, sliding along it', () => {
  close(collide(-0.1, 1.3, 0.35, BOX), [-0.35, 1.3]);
});

test('a corner pushes out diagonally', () => {
  const [x, z] = collide(2.1, 2.1, 0.35, BOX);
  assert.ok(Math.abs(Math.hypot(x - 2, z - 2) - 0.35) < 1e-9);
});

test('a walker inside a box leaves by the nearest side', () => {
  close(collide(1.9, 1, 0.35, BOX), [2.35, 1]);
});

test('in a corridor between two boxes, it stays out of both', () => {
  // 1 m between them, 0.7 m of walker: pushed off one, not into the other.
  close(collide(1.1, 5, 0.35, [[0, 0, 1, 10], [2, 0, 3, 10]]), [1.35, 5]);
});
