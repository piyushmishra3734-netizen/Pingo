/**
 * The tram's shared contract - read this before building any part of it.
 *
 * The tram is made of swappable parts, built by different people at the same
 * time, and put together by index.js. Everything below is what they agree on.
 *
 * ## Space
 *
 * Every car is built in its own local space:
 * - +z is forward (the direction of travel), +y is up, +x is the car's left
 *   when you face forward... in three.js terms, just use +x as "right side".
 * - The origin is the centre of the car's footprint at RAIL TOP height: the
 *   car's wheels touch y = 0; nothing of the car goes below y = -0.05.
 * - Metres. The track gauge is GAUGE (rail centres at x = +-GAUGE / 2).
 *
 * ## Cars
 *
 * A car module exports a builder returning a `CarParts` object:
 *   {
 *     group:      THREE.Group - everything; add this to the scene
 *     length:     number      - bumper to bumper along z
 *     body:       THREE.Object3D - the fixed shell
 *     roofMount:  THREE.Object3D - an empty at the top of the walls, centred;
 *                 a roof built by roofs.js is added as its child
 *     doors:      THREE.Object3D[] - each a pivot/slider for a door leaf,
 *                 closed at rest (animate.js moves them)
 *     steps:      THREE.Object3D[] - fold-out steps under each door, stowed
 *                 at rest
 *     wheels:     THREE.Object3D[] - each spins about its local x axis
 *     lights:     number[][]  - [x, y, z] local points that glow (headlamps,
 *                 lanterns) for light pools
 *   }
 *
 * ## Roofs
 *
 * roofs.js exports ROOFS: { [id]: { name, build(dims) -> THREE.Group } }.
 * A roof is built for a mount of `dims = { length, width }` (the car's), with
 * its underside at the mount's y = 0, and carries its own cargo.
 *
 * ## Materials and colour
 *
 * Parts may make their own materials but should share them within a car
 * (aim: at most 4 draw calls per car, roof included). No realistic PBR:
 * MeshLambertMaterial (or MeshBasicMaterial for glow) with vertex colours
 * and/or small canvas textures. Warm glow at night uses emissive, scaled by
 * the palette's `windows` value (0 day ... 1 night) passed in as `glow`.
 *
 * ## Budgets (triangles)
 *
 * carriage body 3k, a roof 2.5k, a front car 2k - all at full detail. Take a
 * `detail` number (0 low ... 3 ultra) and drop small parts at low detail.
 */

export const GAUGE = 2.4;

/** The film's open carriage. */
export const CARRIAGE = { length: 10, width: 2.7, floor: 0.75, wallTop: 3.2 };

/** The film's cars that go in front of the carriage. */
export const DRIVING_CAB = { length: 5.5, width: 2.6, floor: 0.75, wallTop: 3.0 };
export const COMPANION = { length: 4.6, width: 2.6, floor: 0.75, wallTop: 2.9 };

/** Gap between coupled cars, bumper to bumper. */
export const COUPLING_GAP = 0.8;

/** The film's palette for the tram, sampled from the reference. */
export const TRAM_COLOURS = {
  frameWood: '#d9957a', // salmon-pink arched window frames
  bodyGreen: '#2f7f6d', // lower body, nose and door
  bodyGreenDark: '#205e52',
  skirtSilver: '#b9bdb8', // ribbed metal skirt
  nameBoard: '#8a7440', // gold-brown board with lettering
  seatTeal: '#3f8a8f',
  leafGreen: '#3e8f6a', // Hearth leaves roof
  leafVein: '#b9e0c4',
  cabWood: '#7a5238', // brown driving cab
  cabRoof: '#4e3526',
  companionWood: '#e0a88a', // Little Companion pink wood
  lanternWhite: '#f3efe2',
  brass: '#c9a24a',
  iron: '#2f3238',
};
