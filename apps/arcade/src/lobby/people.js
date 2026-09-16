import { AnimationMixer, Box3, LoopOnce, LoopRepeat, MeshLambertMaterial } from 'three';

import { loadGltf } from './kit.js';

/**
 * The people in the arcade: Quaternius's "Ultimate Modular Men" (CC0).
 *
 * Each file in public/models/people was prepared offline for phones - the
 * colours baked into the vertices, the body's parts joined into one skinned
 * mesh, the triangles simplified, only the clips used here kept - so a person
 * is one draw call on one shared material. The models are faceted by design,
 * and flat shading draws them that way without carrying normals at all.
 *
 * Clips: Idle, Idle_Neutral, Walk, Run, Interact, Punch_Left, Punch_Right,
 * Kick_Left, Kick_Right, Wave, HitRecieve (sic, the pack's own spelling).
 */

/** Everyone is this tall, whatever the file's own units. */
export const HEIGHT = 1.78;

const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

/**
 * @param {'casual' | 'casual2' | 'punk' | 'suit' | 'beach' | 'worker'} name
 */
export async function loadPerson(name) {
  const gltf = await loadGltf(`models/people/${name}.glb`);
  const body = gltf.scene;
  body.traverse((object) => {
    if (!object.isMesh) return;
    object.material = material;
    // A skinned mesh's bounds are its bind pose; a walking arm can leave them.
    object.frustumCulled = false;
  });
  body.updateMatrixWorld(true);
  const box = new Box3().setFromObject(body);
  body.scale.multiplyScalar(HEIGHT / (box.max.y - box.min.y));

  const mixer = new AnimationMixer(body);
  const actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
  let current;
  let after;

  function play(clip, { speed = 1, fade = 0.2 } = {}) {
    const next = actions[clip];
    if (!next) return;
    next.timeScale = speed;
    if (next === current) return;
    next.setLoop(LoopRepeat, Infinity);
    next.reset().fadeIn(fade).play();
    current?.fadeOut(fade);
    current = next;
  }

  mixer.addEventListener('finished', ({ action }) => {
    if (action === current && after) play(after);
  });

  return {
    body,

    /** Loop a clip, crossfading from whatever was playing. */
    play,

    /**
     * Play a clip once - a wave, a punch - then go back to `then`. `hold`
     * keeps its last frame instead (a knockout stays down).
     */
    once(clip, then = 'Idle', { speed = 1, hold = false } = {}) {
      const next = actions[clip];
      if (!next) return;
      after = hold ? undefined : then;
      next.setLoop(LoopOnce, 1);
      next.clampWhenFinished = hold;
      next.timeScale = speed;
      next.reset().fadeIn(0.2).play();
      current?.fadeOut(0.2);
      current = next;
    },

    /** Starts a loop part-way through, so a row of people is not in lockstep. */
    offset(seconds) {
      mixer.update(seconds);
    },

    update(dt) {
      mixer.update(dt);
    },
  };
}
