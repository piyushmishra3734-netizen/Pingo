/**
 * The pull-down that opens Locked chats: when it opens, and when it must not.
 *
 *   pnpm verify:pull-to-locked
 */
import assert from 'node:assert/strict';

import { MOST, OPEN_AT, PullGesture } from '../src/features/lock/pull-gesture.js';

let checks = 0;
const check = (name: string, run: () => void) => {
  run();
  checks += 1;
  console.log('PASS ', name);
};

const drag = (g: PullGesture, from: [number, number], to: [number, number], scrollTop = 0) => {
  g.start(1, from[0], from[1], scrollTop);
  return g.move(to[0], to[1], scrollTop);
};

check('a long pull from the top opens on release', () => {
  const g = new PullGesture();
  const step = drag(g, [100, 100], [102, 300]); // 200px down, halved: 100
  assert.equal(step.pull, 100);
  assert.equal(step.consume, true);
  assert.equal(g.end(), true);
});

check('a short pull does not open', () => {
  const g = new PullGesture();
  const step = drag(g, [100, 100], [100, 200]); // 100px down: 50
  assert.equal(step.pull, 50);
  assert.ok(step.pull < OPEN_AT);
  assert.equal(g.end(), false);
});

check('it follows the finger at half speed and stops at the most', () => {
  const g = new PullGesture();
  assert.equal(drag(g, [0, 0], [0, 100]).pull, 50);
  assert.equal(g.move(0, 10_000, 0).pull, MOST);
});

check('it never starts from a list that has been scrolled', () => {
  const g = new PullGesture();
  const step = drag(g, [100, 100], [100, 400], 40);
  assert.equal(step.pull, 0);
  assert.equal(step.consume, false);
  assert.equal(g.end(), false);
});

check('a mostly sideways drag (the stories row) is not a pull', () => {
  const g = new PullGesture();
  const step = drag(g, [100, 100], [300, 160]);
  assert.equal(step.pull, 0);
  assert.equal(step.consume, false);
  assert.equal(g.end(), false);
});

check('two fingers are not a pull', () => {
  const g = new PullGesture();
  g.start(2, 100, 100, 0);
  assert.equal(g.move(100, 400, 0).pull, 0);
  assert.equal(g.end(), false);
});

check('pulling back up past the start cancels it', () => {
  const g = new PullGesture();
  drag(g, [100, 100], [100, 300]);
  const back = g.move(100, 80, 0);
  assert.equal(back.pull, 0);
  assert.equal(g.end(), false);
});

check('the list starting to scroll mid-pull cancels it', () => {
  const g = new PullGesture();
  drag(g, [100, 100], [100, 300]);
  assert.equal(g.move(100, 320, 12).pull, 0);
  assert.equal(g.end(), false);
});

check('it signals "enough" once per pull, not on every move', () => {
  const g = new PullGesture();
  g.start(1, 0, 0, 0);
  const seen: boolean[] = [];
  for (const y of [40, 100, 160, 180, 220, 260]) seen.push(g.move(0, y, 0).justArmed);
  assert.equal(seen.filter(Boolean).length, 1);
  assert.equal(seen.indexOf(true), 2); // 160px down is a pull of 80, the first past 72
});

check('a second pull starts clean', () => {
  const g = new PullGesture();
  drag(g, [0, 0], [0, 300]);
  assert.equal(g.end(), true);
  const again = drag(g, [0, 0], [0, 100]);
  assert.equal(again.pull, 50);
  assert.equal(g.end(), false);
});

console.log(`\nAll ${checks} pull-to-locked checks passed.`);
