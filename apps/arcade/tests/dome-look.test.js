import assert from 'node:assert/strict';
import test from 'node:test';

import { Light } from '../src/core/session.js';
import { BLINK_FLOOR, BLINK_HZ, DOME_COLORS, domeLook } from '../src/lobby/dome-look.js';

test('off is dark at every moment', () => {
  for (const t of [0, 123, 5000]) {
    assert.deepEqual(domeLook(Light.OFF, t), { color: DOME_COLORS[Light.OFF], strength: 0 });
  }
});

test('green is solid: full strength whatever the clock says', () => {
  for (const t of [0, 77, 312, 9999]) {
    assert.deepEqual(domeLook(Light.GREEN, t), { color: DOME_COLORS[Light.GREEN], strength: 1 });
  }
});

test('orange blinks between its floor and full, once per period', () => {
  const periodMs = 1000 / BLINK_HZ;
  const samples = Array.from({ length: 200 }, (_, i) => domeLook(Light.BLINK_ORANGE, (i / 200) * periodMs));

  for (const { color, strength } of samples) {
    assert.equal(color, DOME_COLORS[Light.BLINK_ORANGE]);
    assert.ok(strength >= BLINK_FLOOR - 1e-9 && strength <= 1 + 1e-9, `strength ${strength} in range`);
  }
  const strengths = samples.map((s) => s.strength);
  assert.ok(Math.max(...strengths) > 0.99, 'reaches full brightness');
  assert.ok(Math.min(...strengths) < BLINK_FLOOR + 0.01, 'dips to the floor');
});

test('orange never goes fully dark, so the dome stays visible', () => {
  for (let t = 0; t < 2000; t += 7) {
    assert.ok(domeLook(Light.BLINK_ORANGE, t).strength >= BLINK_FLOOR);
  }
});

test('the blink repeats exactly each period', () => {
  const periodMs = 1000 / BLINK_HZ;
  for (const t of [10, 200, 400]) {
    const a = domeLook(Light.BLINK_ORANGE, t).strength;
    const b = domeLook(Light.BLINK_ORANGE, t + periodMs).strength;
    assert.ok(Math.abs(a - b) < 1e-9, `t=${t}`);
  }
});
