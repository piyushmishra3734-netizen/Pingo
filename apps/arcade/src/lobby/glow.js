import { AdditiveBlending, Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { glowTexture } from './textures.js';

/**
 * The arcade's light, without lights.
 *
 * A real arcade is lit by its machines: colour pooling on the floor in front
 * of each screen, a halo round the sign, neon tubes along the walls. Real
 * lights would cost per-pixel work on every surface; these are soft quads
 * drawn additively - brightening whatever is under them, the way light does -
 * all merged into one mesh: one draw call for the whole room's glow.
 *
 * @typedef {{
 *   x: number, z: number, y?: number, w: number, h: number, color: number,
 *   strength?: number, floor?: boolean, rot?: number, tube?: boolean,
 * }} Glow
 * `floor` lays it flat as a pool; otherwise it stands, facing +Z turned by
 * `rot`. `tube` keeps the falloff across its width only - a neon line, not a
 * blob that fades out along its length.
 */

/** @param {Glow[]} spots */
export function createGlow(spots) {
  const planes = spots.map(({ x, y = 0.02, z, w, h, color, strength = 1, floor = false, rot = 0, tube = false }) => {
    const plane = new PlaneGeometry(w, h);
    if (tube) {
      const uv = plane.attributes.uv;
      for (let i = 0; i < uv.count; i += 1) uv.setX(i, 0.5);
    }
    if (floor) plane.rotateX(-Math.PI / 2);
    else plane.rotateY(rot);
    plane.translate(x, y, z);
    const tint = new Color(color).multiplyScalar(strength);
    const colours = new Float32Array(plane.attributes.position.count * 3);
    for (let i = 0; i < colours.length; i += 3) colours.set([tint.r, tint.g, tint.b], i);
    plane.setAttribute('color', new Float32BufferAttribute(colours, 3));
    return plane;
  });

  const material = new MeshBasicMaterial({
    map: glowTexture(),
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    // Light does not fade into fog the way surfaces do.
    fog: false,
  });
  const mesh = new Mesh(mergeGeometries(planes), material);
  // After the room's surfaces, so it brightens them rather than being hidden.
  mesh.renderOrder = 1;

  return {
    mesh,
    /** A slow breath, so the room feels powered rather than painted. */
    update(now) {
      material.opacity = 0.9 + 0.1 * Math.sin(now / 900);
    },
  };
}
