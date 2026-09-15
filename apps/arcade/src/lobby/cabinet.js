import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry } from 'three';

import { attractTexture } from './textures.js';

/**
 * An arcade cabinet: Kenney's CC0 "Mini Arcade" machine, plus our own screen.
 *
 * The model is 392 triangles and 39 KB, with an 8.7 KB palette texture shared
 * by everything in the pack - so the characters that will walk up to it later
 * come from the same place and look like they belong. Licence in
 * public/models/LICENSE-kenney-mini-arcade.txt (CC0, no credit required).
 *
 * ## Our screen, on top of theirs
 *
 * The model is one mesh; its screen is a palette cell, not something a texture
 * can be swapped into. So a plane of our own sits 3 mm (model units) in front
 * of the model's glass, at the glass's own angle. Phase 2 hands that plane the
 * running 2D game with `setScreenTexture` - one assignment, nothing reloaded.
 */

const MODEL_URL = 'models/arcade-machine.glb';

/** Kenney's machine is 0.725 units tall; this makes it a 1.75 m upright. */
export const CABINET_SCALE = 1.75 / 0.725;

/** Distance from the model's origin to its back panel, in model units. */
export const CABINET_BACK = 0.244;

/*
 * The model's own screen, in model units, found by grouping its
 * forward-facing triangles: the inset panel with its own palette cell, 0.3
 * wide, 0.19 along its slope, tipped back 18.7 degrees. Its centre and normal
 * come straight from the vertex data, not from eyeballing a render.
 */
const SCREEN = { width: 0.3, height: 0.1875, y: 0.42, z: 0.088, tilt: -0.326 };
/** How far in front of the model's glass our plane floats, along its normal. */
const SCREEN_LIFT = 0.003;

/**
 * A point on the cabinet's lid, in model units, for the dome light to stand
 * on. The lid is not flat - it rises 7 degrees toward the front, from 0.683
 * at the back to 0.725 over the screen (measured from its upward faces) - so
 * this is where that slope is at 0.1 forward of the origin: toward the
 * player, where the dome is seen from the seat.
 */
export const LID = { y: 0.715, z: 0.1 };

let model;

/**
 * Fetched once, whatever the number of cabinets: both share one geometry and
 * one material, which is also what keeps each at a single draw call.
 */
function loadModel() {
  /*
   * The loader is its own chunk, fetched here rather than at boot.
   *
   * GLTFLoader is 104 KB of minified JavaScript - measured, it took the main
   * bundle from 527 KB to 631 KB. Imported statically, the first frame on 2G
   * waits for all of it; imported here, the floor, stools and screens draw
   * while it and the model download side by side.
   */
  model ??= import('three/addons/loaders/GLTFLoader.js')
    .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(MODEL_URL))
    .then((gltf) => {
    let mesh;
    gltf.scene.traverse((object) => {
      if (object.isMesh) mesh = object;
    });
    // Kenney ships a PBR material; the room's rule is Lambert. Same palette
    // texture, lit per vertex instead of per pixel.
    const material = new MeshLambertMaterial({ map: mesh.material.map });
    mesh.material.dispose();
    return { geometry: mesh.geometry, material };
  });
  return model;
}

/**
 * Faces +Z, the way Kenney built it; the room turns it.
 *
 * @param {{ label?: string }} [options]
 */
export function createCabinet(options = {}) {
  const { label = 'PINGO' } = options;
  const group = new Group();
  group.scale.setScalar(CABINET_SCALE);

  const screenMaterial = new MeshBasicMaterial({ map: attractTexture(label) });
  const screen = new Mesh(new PlaneGeometry(SCREEN.width, SCREEN.height), screenMaterial);
  screen.rotation.x = SCREEN.tilt;
  // Pushed out along the glass's normal, (0, sin, cos) of the tilt, so it can
  // never fight the model's own screen for depth.
  screen.position.set(
    0,
    SCREEN.y + Math.sin(-SCREEN.tilt) * SCREEN_LIFT,
    SCREEN.z + Math.cos(SCREEN.tilt) * SCREEN_LIFT,
  );
  group.add(screen);

  // The screen is there at once; the body follows when the file arrives, so a
  // slow line shows the room filling in rather than nothing at all.
  const ready = loadModel().then(({ geometry, material }) => {
    group.add(new Mesh(geometry, material));
  });

  return {
    group,
    screen,
    /** Resolves when the cabinet body is in the scene. */
    ready,
    /**
     * Hands the screen a new texture - the running game in Phase 2.
     * @param {import('three').Texture} texture
     */
    setScreenTexture(texture) {
      screenMaterial.map = texture;
      screenMaterial.needsUpdate = true;
    },
  };
}
