import assert from 'node:assert/strict';
import test from 'node:test';

import { Group, Object3D } from 'three';

import { DOOR_OFFSET, MAX_ROLL, WHEEL_RADIUS, createTramAnimator, swapPart } from '../src/world/tram/animate.js';

/** A CarParts made of empties; the roof mount sits on top of the body. */
function mockCar() {
  const group = new Group();
  const body = new Object3D();
  const roofMount = new Object3D();
  roofMount.position.y = 3.2;
  body.add(roofMount);
  const doors = [new Object3D(), new Object3D()];
  doors[0].position.set(1.35, 0.75, 2);
  doors[1].position.set(-1.35, 0.75, -2);
  const steps = [new Object3D(), new Object3D()];
  const wheels = [new Object3D(), new Object3D()];
  wheels[1].userData.radius = 0.5;
  const lantern = new Object3D();
  lantern.userData.flicker = true;
  lantern.material = { emissiveIntensity: 2 };
  body.add(lantern);
  group.add(body, ...doors, ...steps, ...wheels);
  return { group, length: 10, body, roofMount, doors, steps, wheels, lights: [] };
}

const run = (anim, seconds, state, steps = 60) => {
  for (let i = 0; i < steps; i += 1) anim.update(seconds / steps, state);
};

test('wheels turn by distance over radius', () => {
  const car = mockCar();
  const anim = createTramAnimator([car]);
  run(anim, 0.5, { speed: 2 });
  assert.ok(Math.abs(car.wheels[0].rotation.x - 1 / WHEEL_RADIUS) < 1e-9);
  assert.ok(Math.abs(car.wheels[1].rotation.x - 1 / 0.5) < 1e-9);
});

test('doors slide to their offset and back; steps fold out and stow', () => {
  const car = mockCar();
  const anim = createTramAnimator([car]);
  run(anim, 6, { doorsOpen: 1 });
  assert.ok(Math.abs(car.doors[0].position.z - (2 - DOOR_OFFSET)) < 1e-3);
  assert.ok(Math.abs(car.doors[1].position.z - (-2 + DOOR_OFFSET)) < 1e-3);
  assert.ok(Math.abs(car.steps[0].rotation.x - Math.PI / 2) < 1e-3);
  run(anim, 6, { doorsOpen: 0 });
  assert.ok(Math.abs(car.doors[0].position.z - 2) < 1e-3);
  assert.ok(Math.abs(car.steps[0].rotation.x) < 1e-3);
});

test('steps lead the doors on open and trail them on close', () => {
  const car = mockCar();
  const anim = createTramAnimator([car]);
  run(anim, 0.3, { doorsOpen: 1 }, 10);
  assert.ok(car.steps[0].rotation.x > 0.1);
  assert.equal(car.doors[0].position.z, 2);
  run(anim, 6, { doorsOpen: 1 });
  run(anim, 0.3, { doorsOpen: 0 }, 10);
  assert.ok(car.doors[0].position.z > 2 - DOOR_OFFSET + 0.05);
  assert.ok(Math.abs(car.steps[0].rotation.x - Math.PI / 2) < 1e-6);
});

test('lean rolls the body within the limit; lanterns follow glow', () => {
  const car = mockCar();
  const anim = createTramAnimator([car]);
  run(anim, 8, { lean: 5, glow: 1 });
  assert.ok(Math.abs(car.body.rotation.z - MAX_ROLL) < 1e-3);
  assert.equal(car.roofMount.rotation.z, 0); // rolls with its parent, not twice
  const lit = car.body.children.find((o) => o.userData.flicker).material.emissiveIntensity;
  assert.ok(lit > 1.7 && lit <= 2.2);
});

test('one long step and sixty short ones end close', () => {
  const a = mockCar();
  const b = mockCar();
  const animA = createTramAnimator([a]);
  const animB = createTramAnimator([b]);
  const state = { speed: 0, lean: 0.8, doorsOpen: 1 };
  animA.update(1, state);
  run(animB, 1, state);
  assert.ok(Math.abs(a.body.rotation.z - b.body.rotation.z) < 1e-9);
  assert.ok(Math.abs(a.doors[0].position.z - b.doors[0].position.z) < 1e-9);
  assert.ok(Math.abs(a.steps[0].rotation.x - b.steps[0].rotation.x) < 1e-9);
});

test('swapPart lifts the old part away and settles the new one on the mount', async () => {
  const car = mockCar();
  const oldRoof = new Object3D();
  car.roofMount.add(oldRoof);
  const newRoof = new Object3D();
  const statuses = [];
  const anim = createTramAnimator([car]);
  const done = anim.swapPart({
    parent: car.roofMount,
    oldPart: oldRoof,
    newPart: newRoof,
    onStatus: (text, progress) => {
      assert.ok(progress >= 0 && progress <= 1);
      if (statuses.at(-1) !== text) statuses.push(text);
    },
  });

  anim.update(0.5);
  assert.ok(oldRoof.position.y > 0);
  assert.equal(newRoof.parent, null);

  let lowest = Infinity;
  for (let i = 0; i < 200; i += 1) {
    anim.update(1 / 60);
    if (newRoof.parent) lowest = Math.min(lowest, newRoof.position.y);
  }
  await done;
  assert.deepEqual(statuses, ['Lifting the old part', 'Securing the mounts', 'Ready to ride']);
  assert.equal(oldRoof.parent, null);
  assert.equal(newRoof.parent, car.roofMount);
  assert.deepEqual(newRoof.position.toArray(), [0, 0, 0]);
  assert.ok(lowest < 0, 'settles with an overshoot');
});

test('swapPart reports skipped statuses in order on one huge step', async () => {
  const parent = new Object3D();
  const oldPart = new Object3D();
  parent.add(oldPart);
  const newPart = new Object3D();
  const statuses = [];
  const swap = swapPart({ parent, oldPart, newPart, onStatus: (text) => statuses.push(text) });
  swap.update(10);
  await swap;
  assert.deepEqual(statuses, ['Lifting the old part', 'Securing the mounts', 'Ready to ride']);
  assert.equal(parent.children[0], newPart);
  assert.equal(parent.children.length, 1);
});
