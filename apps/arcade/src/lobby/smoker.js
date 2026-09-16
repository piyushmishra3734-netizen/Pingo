import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, CylinderGeometry, Euler, Group, Mesh, MeshBasicMaterial, Points, PointsMaterial, Quaternion } from 'three';

import { loadPerson } from './people.js';

/**
 * The regular outside: leaning by the door, a cigarette in hand. Every few
 * seconds the hand comes up, the tip glows, and a puff drifts off into the
 * night - life on the street before you are even in.
 *
 * The arm is a pose laid over Idle (like sitting in friend.js); the smoke is
 * one Points draw call, additive, each puff fading to black instead of alpha.
 */

/** Hand at the mouth, in radians per bone (local XYZ), tuned by eye. */
export const DRAG = {
  UpperArmR: [-0.6, 0, 0],
  LowerArmR: [0, 0, 1.9],
};
/** Leaning back on the wall, one foot up against it: always on, over Idle. */
export const LEAN = {
  Torso: [-0.18, 0, 0],
  UpperLegL: [-0.7, 0, 0],
  LowerLegL: [1.7, 0, 0],
};
const CYCLE = 6.5;
const RAISE = 0.6;
const HOLD = 1.3;
const PUFFS = 60;
const LIFE = 2.6;

const euler = new Euler();
const turn = new Quaternion();

function softDot() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/** @param {{ x: number, z: number, facing: number, look?: string }} spot */
export function createSmoker({ x, z, facing, look = 'punk' }) {
  const group = new Group();
  group.position.set(x, 0, z);
  group.rotation.y = facing;

  const cigarette = new Mesh(new CylinderGeometry(0.011, 0.011, 0.1, 5), new MeshBasicMaterial({ color: 0xf2f2f2 }));
  const tip = new Mesh(new CylinderGeometry(0.012, 0.012, 0.018, 5), new MeshBasicMaterial({ color: 0xff5a1f }));
  tip.position.y = 0.05;
  cigarette.add(tip);

  const positions = new Float32Array(PUFFS * 3);
  const colors = new Float32Array(PUFFS * 3);
  const puffs = Array.from({ length: PUFFS }, () => ({ age: LIFE, vx: 0, vy: 0, vz: 0 }));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const smoke = new Points(
    geometry,
    new PointsMaterial({ size: 0.26, map: softDot(), vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending }),
  );
  // In world space, so a puff stays where it was blown.
  smoke.frustumCulled = false;

  let person;
  let bones = {};
  /** Bind pose of the posed bones: the clip does not drive them all, so the layer must not pile up. */
  let rest = {};
  let hand;
  let head;
  let t = Math.random() * CYCLE;
  let next = 0;

  const ready = loadPerson(look).then((loaded) => {
    person = loaded;
    group.add(person.body);
    person.play('Idle_Neutral', { speed: 0.6 });
    bones = Object.fromEntries([...Object.keys(LEAN), ...Object.keys(DRAG)].map((name) => [name, person.body.getObjectByName(name)]));
    rest = Object.fromEntries(Object.entries(bones).map(([name, bone]) => [name, bone?.quaternion.clone()]));
    hand = person.body.getObjectByName('WristR');
    head = person.body.getObjectByName('Head');
    if (hand) {
      // Bones carry the file's units: undo the hand's world scale so the cigarette is 9 cm.
      person.body.updateWorldMatrix(true, true);
      const size = hand.getWorldScale(cigarette.scale).x;
      hand.add(cigarette);
      cigarette.scale.setScalar(1 / size);
      cigarette.position.set(0, 0.1 / size, 0);
    }
  });

  function blow(from, strength, wide) {
    for (let i = 0; i < strength; i += 1) {
      const puff = puffs[next];
      next = (next + 1) % PUFFS;
      puff.age = -i * 0.04;
      puff.faint = false;
      puff.x = from.x;
      puff.y = from.y;
      puff.z = from.z;
      const a = group.rotation.y + (Math.random() - 0.5) * wide;
      puff.vx = Math.sin(a) * 0.35 + (Math.random() - 0.5) * 0.1;
      puff.vz = Math.cos(a) * 0.35 + (Math.random() - 0.5) * 0.1;
      puff.vy = 0.18 + Math.random() * 0.1;
    }
  }

  const at = { x: 0, y: 0, z: 0 };
  const worldOf = (object) => {
    object.updateWorldMatrix(true, false);
    const e = object.matrixWorld.elements;
    at.x = e[12];
    at.y = e[13];
    at.z = e[14];
    return at;
  };

  return {
    group,
    smoke,
    ready,

    update(dt) {
      if (!person) return;
      for (const [name, bone] of Object.entries(bones)) if (bone) bone.quaternion.copy(rest[name]);
      person.update(dt);
      t = (t + dt) % CYCLE;
      // 0 at rest, 1 with the hand at the mouth.
      const up = t < RAISE ? t / RAISE : t < RAISE + HOLD ? 1 : t < RAISE * 2 + HOLD ? 1 - (t - RAISE - HOLD) / RAISE : 0;
      const eased = up * up * (3 - 2 * up);
      for (const [name, [rx, ry, rz]] of Object.entries(LEAN)) bones[name]?.quaternion.multiply(turn.setFromEuler(euler.set(rx, ry, rz)));
      for (const [name, [rx, ry, rz]] of Object.entries(DRAG)) bones[name]?.quaternion.multiply(turn.setFromEuler(euler.set(rx * eased, ry * eased, rz * eased)));
      tip.material.color.setRGB(1, 0.25 + 0.35 * eased, 0.1 * eased);

      const before = t - dt;
      // Out of the mouth just after the hand comes down; a thin wisp from the tip now and then.
      if (before < RAISE * 2 + HOLD && t >= RAISE * 2 + HOLD && head) blow(worldOf(head), 12, 0.7);
      if (Math.floor(t * 6) !== Math.floor(before * 6) && hand) {
        worldOf(tip);
        const puff = puffs[next];
        next = (next + 1) % PUFFS;
        Object.assign(puff, { age: 0, x: at.x, y: at.y, z: at.z, vx: (Math.random() - 0.5) * 0.12, vy: 0.2 + Math.random() * 0.08, vz: (Math.random() - 0.5) * 0.12, faint: true });
      }

      for (let i = 0; i < PUFFS; i += 1) {
        const puff = puffs[i];
        puff.age += dt;
        const alive = puff.age >= 0 && puff.age < LIFE;
        const k = alive ? 1 - puff.age / LIFE : 0;
        if (alive) {
          puff.x += puff.vx * dt;
          puff.y += puff.vy * dt;
          puff.z += puff.vz * dt;
          puff.vx *= 1 - dt * 0.8;
          puff.vz *= 1 - dt * 0.8;
        }
        positions[i * 3] = alive ? puff.x : 0;
        positions[i * 3 + 1] = alive ? puff.y : -10;
        positions[i * 3 + 2] = alive ? puff.z : 0;
        // A wisp from the tip is faint; a breath out is thicker. Both thin as they rise.
        const c = (puff.faint ? 0.07 : 0.16) * k * Math.min(1, puff.age * 3 + 0.3);
        colors[i * 3] = c;
        colors[i * 3 + 1] = c;
        colors[i * 3 + 2] = c * 1.05;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    },
  };
}
