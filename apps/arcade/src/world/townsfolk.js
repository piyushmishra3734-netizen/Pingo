import { Group } from 'three';

import { loadPerson } from '../lobby/people.js';

/**
 * Townsfolk: people strolling round the home plaza and waiting on the
 * station platform, so the world is lived in. They use the same CC0 people as
 * the players (lobby/people.js); how many there are is a quality setting,
 * since every one is a skinned mesh and a draw call of its own.
 *
 * Walkers go round circles at their own pace and radius; waiters stand on the
 * platform facing the line and now and then look about (a wave).
 */

const LOOKS = ['casual2', 'suit', 'worker', 'beach', 'punk', 'casual'];

/**
 * @param {{ count: number, plaza: { x: number, z: number }, platform: Array<{ x: number, y: number, z: number, facing: number }> }} spec
 */
export function createTownsfolk({ count, plaza, platform }) {
  const group = new Group();
  const people = [];
  let s = 31;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };

  const waiters = Math.min(platform.length, Math.floor(count / 3));
  const ready = Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const person = await loadPerson(LOOKS[i % LOOKS.length]);
      group.add(person.body);
      if (i < waiters) {
        const spot = platform[i];
        person.body.position.set(spot.x, spot.y, spot.z);
        person.body.rotation.y = spot.facing;
        person.play(i % 2 ? 'Idle' : 'Idle_Neutral');
        person.offset(r() * 3);
        people.push({ person, walk: null, next: 4 + r() * 8 });
      } else {
        // Between the kiosk and the benches, so nobody walks through either.
        const walk = { radius: 5.2 + r() * 2.4, angle: r() * Math.PI * 2, speed: (0.9 + r() * 0.5) * (r() > 0.5 ? 1 : -1) };
        person.play('Walk', { speed: Math.abs(walk.speed) * 0.9 });
        person.offset(r() * 2);
        people.push({ person, walk });
      }
    }),
  );

  return {
    group,
    ready,
    update(dt) {
      for (const one of people) {
        const { person, walk } = one;
        if (walk) {
          walk.angle += (walk.speed / walk.radius) * dt;
          const x = plaza.x + Math.cos(walk.angle) * walk.radius;
          const z = plaza.z + Math.sin(walk.angle) * walk.radius;
          person.body.position.set(x, 0, z);
          // Facing along the circle, the way they are walking.
          person.body.rotation.y = -walk.angle + (walk.speed > 0 ? Math.PI : 0);
        } else {
          one.next -= dt;
          if (one.next <= 0) {
            person.once('Wave', 'Idle');
            one.next = 10 + r() * 14;
          }
        }
        person.update(dt);
      }
    },
  };
}
