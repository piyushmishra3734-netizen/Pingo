import assert from 'node:assert/strict';
import test from 'node:test';

import { datan2, dcos, dhypot, dsin } from '../src/games/dmath.js';

test('deterministic trig agrees with Math to 1e-10', () => {
  for (let a = -20; a <= 20; a += 0.0137) {
    assert.ok(Math.abs(dsin(a) - Math.sin(a)) < 1e-10, `sin ${a}`);
    assert.ok(Math.abs(dcos(a) - Math.cos(a)) < 1e-10, `cos ${a}`);
  }
  for (let y = -3; y <= 3; y += 0.173) {
    for (let x = -3; x <= 3; x += 0.191) {
      assert.ok(Math.abs(datan2(y, x) - Math.atan2(y, x)) < 1e-10, `atan2 ${y} ${x}`);
    }
  }
  assert.equal(datan2(1, 0), Math.PI / 2);
  assert.equal(dhypot(3, 4), 5);
});
