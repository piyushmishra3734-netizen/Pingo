import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry } from 'three';

import { loadGltf } from './kit.js';
import { attractTexture } from './textures.js';

/**
 * A PINGO cabinet: "Arcade Cabinet .glb (v0.9)" by Lady Lion Studios
 * (Sketchfab, CC-BY 4.0 - credited in public/CREDITS.txt, linked from the
 * page), plus our own screen.
 *
 * Prepared offline for phones: its 360-degree backdrop dropped, thirteen
 * textures (two of them 4096 px, 12 MB in all) packed into one 1024 px atlas
 * and one material, 8,050 triangles down to 2,050, baked to metres facing +Z
 * with the origin on the floor under the middle of its footprint. Flat
 * shaded: the normals went so the simplifier could weld its faces.
 *
 * ## Our screen, on top of theirs
 *
 * The model's screen is a curved CRT carrying a picture from the texture. A
 * plane of our own floats just in front of the bulge at the glass's own tilt,
 * 16:10 like every game here, and Phase 2 hands it the running game with
 * `setScreenTexture` - one assignment, nothing reloaded.
 */

const MODEL_URL = 'models/pingo-cabinet.glb';
const FAR_URL = 'models/pingo-cabinet-far.glb';

/** The cabinet's measurements, in metres, from the prepared model. */
export const CABINET = {
  /** From its origin to the back panel; and to the front of the control panel. */
  back: 0.363,
  front: 0.363,
  /**
   * Our screen: 16:10 inside the CRT's 0.54 x 0.45 m, 2 cm clear of its
   * bulge, tipped back 8 degrees like the glass.
   */
  screen: { width: 0.5, height: 0.3125, y: 1.245, z: 0.045, tilt: -0.139 },
  /** Where the dome light stands on the lid. */
  lid: { y: 1.8, z: -0.02 },
};

/**
 * Kenney's Mini Arcade machine is 0.725 units tall; this makes it 1.75 m. The
 * whole shop - walls, floor, the other machines - is built at this scale.
 */
export const KENNEY_SCALE = 1.75 / 0.725;

const models = {};

/**
 * Fetched once however many cabinets there are - the PINGO pair shares one
 * geometry and material.
 *
 * `far` is the same cabinet at ~600 triangles instead of ~1,900, for the row
 * on the back wall: the careful simplifier stops at the UV seams, the sloppy
 * one does not, and from across the room nobody can tell. It keeps the
 * inside of the shop under the 20k-triangle budget.
 *
 * @param {'near' | 'far'} [detail]
 */
export function loadCabinetModel(detail = 'near') {
  models[detail] ??= loadGltf(detail === 'far' ? FAR_URL : MODEL_URL).then((gltf) => {
    let mesh;
    gltf.scene.traverse((object) => {
      if (object.isMesh) mesh = object;
    });
    const material = new MeshLambertMaterial({ map: mesh.material.map, flatShading: true });
    mesh.material.dispose();
    return { geometry: mesh.geometry, material };
  });
  return models[detail];
}

/**
 * Faces +Z; the room turns it.
 * @param {{ label?: string }} [options]
 */
export function createCabinet(options = {}) {
  const { label = 'PINGO' } = options;
  const group = new Group();
  const { screen: glass } = CABINET;

  const screenMaterial = new MeshBasicMaterial({ map: attractTexture(label) });
  const screen = new Mesh(new PlaneGeometry(glass.width, glass.height), screenMaterial);
  screen.rotation.x = glass.tilt;
  screen.position.set(0, glass.y, glass.z);
  group.add(screen);

  // The screen is there at once; the body follows when the file arrives.
  const ready = loadCabinetModel().then(({ geometry, material }) => {
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
