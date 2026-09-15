import { AnimationMixer, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

import { CABINET_SCALE } from './cabinet.js';
import { collide } from './collide.js';
import { loadLive } from './kit.js';
import { contactShadowTexture } from './textures.js';

/**
 * You, on foot: Kenney's gamer, walking where the stick or the keys say.
 *
 * Movement is in world axes - up on the stick is into the screen, which with
 * the camera always behind and to the south is always "towards the back of
 * the shop". The body turns to face where it walks, and plays walk or idle
 * from the model's own animation set.
 */

const SPEED = 3.4;
const RADIUS = 0.35;
/** How quickly the body turns to face its heading. */
const TURN = 12;
const DEAD_ZONE = 0.15;

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

  const actions = {};
  let mixer;
  let current;
  let heading = 0;

  function play(name, speed = 1) {
    const next = actions[name];
    if (!next) return;
    next.timeScale = speed;
    if (next === current) return;
    next.reset().fadeIn(0.15).play();
    current?.fadeOut(0.15);
    current = next;
  }

  const ready = loadLive('models/character-gamer.glb').then((gltf) => {
    gltf.scene.scale.setScalar(CABINET_SCALE);
    group.add(gltf.scene);
    mixer = new AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
    play('idle');
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
     */
    update(dt, move) {
      const push = Math.hypot(move.x, move.y);
      if (push > DEAD_ZONE) {
        const pace = Math.min(1, push);
        const step = (pace * SPEED * dt) / push;
        let [x, z] = collide(group.position.x + move.x * step, group.position.z - move.y * step, RADIUS, colliders);
        x = Math.min(bounds.maxX, Math.max(bounds.minX, x));
        z = Math.min(bounds.maxZ, Math.max(bounds.minZ, z));
        group.position.x = x;
        group.position.z = z;
        heading += shortest(Math.atan2(move.x, -move.y) - heading) * Math.min(1, TURN * dt);
        group.rotation.y = heading;
        play('walk', 0.6 + pace);
      } else {
        play('idle');
      }
      mixer?.update(dt);
    },
  };
}
