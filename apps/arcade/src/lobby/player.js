import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

import { collide } from './collide.js';
import { loadPerson } from './people.js';
import { contactShadowTexture } from './textures.js';

/**
 * You, on foot: one of Quaternius's Modular Men, walking where the stick or
 * the keys say.
 *
 * Movement is in world axes - up on the stick is into the screen, which with
 * the camera always behind and to the south is always "towards the back of
 * the shop". The body turns to face where it walks; a light push walks, a
 * full one runs.
 */

const SPEED = 3.4;
const RADIUS = 0.35;
/** How quickly the body turns to face its heading. */
const TURN = 12;
const DEAD_ZONE = 0.15;
/** Past this much push on the stick, the walk becomes a run. */
const RUN_FROM = 0.72;

/** The shortest signed turn from one heading to another. */
const shortest = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * @param {{ colliders: number[][], bounds: { minX: number, maxX: number, minZ: number, maxZ: number } }} world
 */
export function createPlayer({ colliders, bounds }) {
  const group = new Group();

  const shadow = new Mesh(
    new PlaneGeometry(0.9, 0.9),
    new MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.008;
  group.add(shadow);

  let person;
  let heading = 0;
  /** Metres walked since the last footstep - main.js turns it into sound. */
  let stride = 0;

  const ready = loadPerson('casual').then((loaded) => {
    person = loaded;
    group.add(person.body);
    person.play('Idle');
  });

  return {
    group,
    ready,

    get position() {
      return group.position;
    },

    place(x, z, facing) {
      group.position.set(x, 0, z);
      heading = facing;
      group.rotation.y = heading;
    },

    /**
     * @param {number} dt - seconds
     * @param {{ x: number, y: number }} move - the stick; y up is into the screen
     * @returns {boolean} whether a foot came down this frame
     */
    update(dt, move) {
      const push = Math.hypot(move.x, move.y);
      let footfall = false;
      if (push > DEAD_ZONE) {
        const pace = Math.min(1, push);
        const step = (pace * SPEED * dt) / push;
        const from = { x: group.position.x, z: group.position.z };
        let [x, z] = collide(from.x + move.x * step, from.z - move.y * step, RADIUS, colliders);
        x = Math.min(bounds.maxX, Math.max(bounds.minX, x));
        z = Math.min(bounds.maxZ, Math.max(bounds.minZ, z));
        group.position.x = x;
        group.position.z = z;
        heading += shortest(Math.atan2(move.x, -move.y) - heading) * Math.min(1, TURN * dt);
        group.rotation.y = heading;
        const running = pace > RUN_FROM;
        person?.play(running ? 'Run' : 'Walk', { speed: running ? 0.9 + pace * 0.3 : 0.8 + pace * 0.5 });
        // A footstep every ~0.8 m walking, ~1.3 m running.
        stride += Math.hypot(x - from.x, z - from.z);
        const every = running ? 1.3 : 0.8;
        if (stride >= every) {
          stride -= every;
          footfall = true;
        }
      } else {
        person?.play('Idle');
        stride = 0;
      }
      person?.update(dt);
      return footfall;
    },
  };
}
