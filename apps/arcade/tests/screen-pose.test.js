import assert from 'node:assert/strict';
import test from 'node:test';

import { fitDistance } from '../src/lobby/screen-pose.js';

// The cabinet's screen in the room: 0.724 x 0.453 m (16:10).
const W = 0.724;
const H = 0.453;

function visible(distance, fovDeg, aspect) {
  const halfTan = Math.tan((fovDeg * Math.PI) / 360);
  return { height: 2 * distance * halfTan, width: 2 * distance * halfTan * aspect };
}

test('landscape: the whole screen fits, and one edge touches the frame', () => {
  const d = fitDistance(W, H, 55, 16 / 9);
  const view = visible(d, 55, 16 / 9);
  assert.ok(view.width >= W - 1e-9 && view.height >= H - 1e-9, 'all of it in view');
  assert.ok(Math.abs(view.width - W) < 1e-9 || Math.abs(view.height - H) < 1e-9, 'no closer possible');
});

test('portrait phone: width decides, so the screen spans the display edge to edge', () => {
  const aspect = 400 / 860;
  const d = fitDistance(W, H, 82, aspect);
  const view = visible(d, 82, aspect);
  assert.ok(Math.abs(view.width - W) < 1e-9, 'width exactly fills');
  assert.ok(view.height > H, 'room to spare above and below');
});

test('a wider view needs less distance for the same screen', () => {
  assert.ok(fitDistance(W, H, 82, 1) < fitDistance(W, H, 55, 1));
});
