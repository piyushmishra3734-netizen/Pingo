import assert from 'node:assert/strict';
import test from 'node:test';

import { FARE, PLATFORM_WINDOW, createTramDrive, stepTramDrive } from '../src/world/tram/drive.js';

const DT = 1 / 60;
const STATIONS = [
  { name: 'Saltlight Terminus', at: 20 },
  { name: 'Mango Tide', at: 420 },
  { name: 'Lighthouse', at: 900 },
];
const make = (seed = 7) => createTramDrive({ routeLength: 1200, stations: STATIONS, seed });

/** Runs `seconds` of steps; `policy(state)` gives the input. Returns every event. */
function run(state, seconds, policy) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    stepTramDrive(state, policy(state), DT);
    events.push(...state.events);
  }
  return events;
}

/** A careful driver: leans into the wind, cruises, brakes to stop on the mark. */
const careful = (s) => {
  const stopping = s.distanceToNext < (s.speed * s.speed) / (2 * 4.5) + 1.5;
  return { power: !stopping && s.speed < 11, brake: stopping, lean: s.crosswind, openDoors: s.canOpenDoors };
};

test('accelerates with power, tops out near 50 km/h, and stops with the brake', () => {
  const s = make();
  run(s, 3, () => ({ power: true }));
  assert.ok(s.speedKmh > 15, `speed after 3 s: ${s.speedKmh}`);
  run(s, 30, () => ({ power: true }));
  assert.ok(s.speedKmh >= 40 && s.speedKmh <= 55, `top speed ${s.speedKmh}`);
  const coasting = s.speed;
  run(s, 1, () => ({}));
  assert.ok(s.speed < coasting, 'drag slows a coasting tram');
  run(s, 6, () => ({ brake: true }));
  assert.equal(s.speed, 0);
  assert.equal(s.speedKmh, 0);
});

test('cannot open doors while moving or away from a station', () => {
  const s = make();
  run(s, 4, () => ({ power: true, openDoors: true }));
  assert.equal(s.canOpenDoors, false);
  assert.notEqual(s.phase, 'doors');
  // Stop in the middle of the leg, far from any platform.
  run(s, 6, () => ({ brake: true, openDoors: true }));
  assert.equal(s.speed, 0);
  assert.ok(s.distanceToNext > PLATFORM_WINDOW);
  assert.equal(s.canOpenDoors, false);
  assert.notEqual(s.phase, 'doors');
});

test('a full stop at a station opens doors, exchanges passengers, pays and moves on', () => {
  const s = make();
  const aboard = s.aboard;
  const events = run(s, 90, (st) => (st.fromStation === 'Mango Tide' ? { lean: st.crosswind } : careful(st)));
  const types = events.map((e) => e.type);
  assert.ok(types.includes('stopped'), 'stopped at the platform');
  assert.ok(!types.includes('missed-station'));
  const opening = events.find((e) => e.type === 'doors-opening');
  assert.equal(opening.station, 'Mango Tide');
  const paid = events.find((e) => e.type === 'paid');
  assert.ok(paid.coins > 0 && paid.coins <= FARE * aboard * 2);
  const exchanged = events.find((e) => e.type === 'exchanged');
  assert.equal(s.aboard, aboard - exchanged.alighted + exchanged.boarded);
  assert.ok(s.aboard <= s.capacity);
  assert.ok(types.indexOf('doors-closed') > types.indexOf('paid'));
  assert.equal(s.coins, paid.coins);
  assert.equal(s.fromStation, 'Mango Tide');
  assert.equal(s.nextStation, 'Lighthouse');
  assert.equal(s.doorsOpen, 0);
});

test('doorsOpen animates 0 to 1 and back while the doors phase runs', () => {
  const s = make();
  let peak = 0;
  let sawPartial = false;
  run(s, 90, (st) => {
    if (st.phase === 'doors') {
      peak = Math.max(peak, st.doorsOpen);
      if (st.doorsOpen > 0.1 && st.doorsOpen < 0.9) sawPartial = true;
    }
    return st.fromStation === 'Mango Tide' ? {} : careful(st);
  });
  assert.equal(peak, 1);
  assert.ok(sawPartial);
});

test('leaning against the wind keeps it steady and builds the multiplier to x2.0', () => {
  const s = make();
  const events = run(s, 25, (st) => ({ power: st.speed < 11, lean: st.crosswind }));
  assert.ok(s.steady);
  assert.equal(s.multiplier, 2);
  assert.ok(!events.some((e) => e.type === 'streak-broken'));
  assert.ok(events.some((e) => e.type === 'multiplier'));
  assert.ok(s.comfort > 0.9);
});

test('not leaning breaks the streak and resets the multiplier', () => {
  // Find a moment of strong wind for a few seeds; at least one must break.
  let broke = false;
  for (let seed = 1; seed <= 5 && !broke; seed += 1) {
    const s = make(seed);
    run(s, 12, (st) => ({ power: st.speed < 11, lean: st.crosswind }));
    assert.ok(s.multiplier > 1);
    const events = run(s, 20, (st) => ({ power: st.speed < 11 }));
    const broken = events.find((e) => e.type === 'streak-broken');
    if (broken) {
      broke = true;
      assert.match(broken.message, /Streak broken/);
      assert.ok(s.comfort < 1);
    }
  }
  assert.ok(broke, 'no seed broke the streak without leaning');
});

test('deterministic with the same seed and inputs; different seeds differ', () => {
  const ride = (seed) => {
    const s = make(seed);
    run(s, 80, (st) => ({ ...careful(st), lean: st.time % 7 < 3 ? 0 : st.crosswind }));
    return JSON.stringify(s);
  };
  assert.equal(ride(3), ride(3));
  assert.notEqual(ride(3), ride(4));
});
