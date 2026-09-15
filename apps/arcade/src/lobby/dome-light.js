import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { Light } from '../core/session.js';
import { DOME_COLORS, domeLook } from './dome-look.js';
import { glowTexture } from './textures.js';

/**
 * The dome lights on top of the cabinets - one per cabinet, one state.
 *
 * Both domes always show the same thing (there is one match, and each player
 * should see it from their own seat), so they share their materials: one
 * colour change per frame updates both. The two bases are merged into one
 * mesh and the two domes into another, so the whole thing is four draw calls
 * - two bases-and-domes and two halos - and about 260 triangles.
 *
 * ## No light is lit
 *
 * The dome is an unlit material whose colour moves between dark and the
 * state's colour; the halo is an additive sprite. Nothing here adds to the
 * lighting of the room, which is the point: a real point light would be
 * evaluated for every vertex in the scene, every frame, on the phone.
 */

const DOME_RADIUS = 0.09;
const BASE_HEIGHT = 0.05;
const HALO_SIZE = 0.8;

const OFF = new Color(DOME_COLORS[Light.OFF]);

/**
 * @param {Array<[number, number, number]>} positions - world positions of the
 *   base of each dome, i.e. the point on the cabinet top it stands on.
 */
export function createDomeLights(positions) {
  const group = new Group();

  const bases = positions.map(([x, y, z]) => {
    const base = new CylinderGeometry(0.1, 0.115, BASE_HEIGHT, 10);
    base.translate(x, y + BASE_HEIGHT / 2, z);
    return base;
  });
  group.add(new Mesh(mergeGeometries(bases), new MeshLambertMaterial({ color: 0x1b1826 })));

  const domes = positions.map(([x, y, z]) => {
    // Top half of a sphere: 12 around, 6 up - round at phone size, 144 triangles.
    const dome = new SphereGeometry(DOME_RADIUS, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(x, y + BASE_HEIGHT, z);
    return dome;
  });
  const domeMaterial = new MeshBasicMaterial({ color: OFF.clone() });
  group.add(new Mesh(mergeGeometries(domes), domeMaterial));

  const haloMaterial = new SpriteMaterial({
    map: glowTexture(),
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0,
  });
  const halos = positions.map(([x, y, z]) => {
    const halo = new Sprite(haloMaterial);
    halo.scale.setScalar(HALO_SIZE);
    halo.position.set(x, y + BASE_HEIGHT + DOME_RADIUS * 0.5, z);
    halo.visible = false;
    group.add(halo);
    return halo;
  });

  let light = Light.OFF;
  const target = new Color();

  return {
    group,

    /** The session's light: `off`, `blink-orange` or `green`. */
    set(next) {
      light = next;
    },

    /** Once per frame, before rendering, with the frame's timestamp. */
    update(nowMs) {
      const { color, strength } = domeLook(light, nowMs);
      target.setHex(color);
      domeMaterial.color.lerpColors(OFF, target, strength);
      haloMaterial.color.copy(target);
      haloMaterial.opacity = strength;
      // An invisible sprite is skipped entirely - no draw call while off.
      const show = strength > 0.01;
      for (const halo of halos) halo.visible = show;
    },
  };
}
