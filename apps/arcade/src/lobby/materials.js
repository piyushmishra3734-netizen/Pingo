import { MeshBasicMaterial, MeshLambertMaterial } from 'three';

/**
 * Every material the room uses, shared.
 *
 * Shared because a draw call is per material *and* geometry: two cabinets that
 * point at the same four materials cost four, not eight. And Lambert rather
 * than Standard on purpose - Lambert shades per vertex, which on a budget
 * phone's GPU is the difference between a room that runs at 60 and one that
 * warms up in your hand. Nothing here is PBR and nothing casts a real shadow.
 */

/** The cabinet shell: the off-white plastic of a Japanese candy cab. */
export const SHELL = new MeshLambertMaterial({ color: 0xd8d3e0 });

/** Bezel, pedestal and anything that should read as shadowed plastic. */
export const DARK = new MeshLambertMaterial({ color: 0x1b1826 });

/** Stool seat and frame. */
export const STOOL = new MeshLambertMaterial({ color: 0x2b2740 });

/** The marquee, lit from inside - unlit so it glows without a light. */
export const MARQUEE = new MeshBasicMaterial({ color: 0xfff3f7 });

const accents = new Map();

/**
 * One accent material per colour, so the two cabinets can differ without
 * adding a draw call each time the same colour is asked for again.
 */
export function accent(color) {
  let material = accents.get(color);
  if (!material) {
    material = new MeshLambertMaterial({ color });
    accents.set(color, material);
  }
  return material;
}
