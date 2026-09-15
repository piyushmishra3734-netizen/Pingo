import { Group, HemisphereLight, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { CABINET_BACK, CABINET_SCALE, LID, createCabinet } from './cabinet.js';
import { createDomeLights } from './dome-light.js';
import { createShop, furniture } from './shop.js';
import { contactShadowTexture } from './textures.js';

/**
 * The PINGO versus pair in the middle of the shop: two cabinets back to back,
 * a stool at each, the dome lights, and the seats players sit in.
 *
 * ## The versus layout
 *
 * The cabinets share a spine at the centre and face outward, so the two
 * players sit facing each other with the machines between them - a Japanese
 * arcade's taisen setup. Seat A is at -Z (the back of the shop), seat B at +Z
 * (the door side), and each seat's camera anchor looks at its own screen.
 *
 * Everything around them - the street, the shop, the other machines - is
 * shop.js.
 *
 * ## Light
 *
 * One `HemisphereLight` and nothing else: sky above, bounce from the floor
 * below, no position and no shadow map to compute. It is the cheapest thing in
 * three that still gives a surface a top and a bottom. The dome lights glow by
 * material, not by lighting the room.
 */

/** Backs 4 cm apart at the spine, so the pair reads as two machines. */
const CABINET_OFFSET = CABINET_BACK * CABINET_SCALE + 0.02;
/** Where a player sits: a stool's width in front of the control panel. */
const SEAT_OFFSET = 1.8;
/**
 * The seat camera's height: a little above and behind a seated head, rather
 * than in it.
 *
 * At a true seated eye height (1.27 m) the cabinet's top slab filled the upper
 * half of the view and hid the dome behind its front edge - measured, only its
 * top sliver and halo showed. From here the screen and most of the dome are
 * both in frame, which is what the seat is for: play on one, news on the other.
 */
const EYE_HEIGHT = 1.45;
/** How far behind the stool the seat camera sits. */
const CAMERA_BEHIND_STOOL = 0.55;

function contactShadows(spots) {
  const texture = contactShadowTexture();
  const planes = spots.map(({ x, z, w, d }) => {
    const plane = new PlaneGeometry(w, d);
    plane.rotateX(-Math.PI / 2);
    // 6mm above the floor: enough to never fight it for depth, too little to
    // read as floating.
    plane.translate(x, 0.006, z);
    return plane;
  });

  /*
   * All of them in one mesh.
   *
   * They share a texture, so merging costs nothing and turns four draw calls
   * into one. `depthWrite: false` because these are decals: they must not stop
   * anything else from drawing where they lie.
   */
  return new Mesh(
    mergeGeometries(planes),
    new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
}

export function createRoom() {
  const group = new Group();

  // Night: a dim violet sky and a dark floor bounce. The machines' own glow
  // (glow.js) does the rest of the lighting, the way it does in a real arcade.
  group.add(new HemisphereLight(0xb8a6ff, 0x1a1024, 0.8));

  // The model faces +Z: B needs nothing, A turns round to face its own seat.
  const cabinetA = createCabinet();
  cabinetA.group.position.z = -CABINET_OFFSET;
  cabinetA.group.rotation.y = Math.PI;

  const cabinetB = createCabinet();
  cabinetB.group.position.z = CABINET_OFFSET;

  group.add(cabinetA.group, cabinetB.group);

  // The stools are Kenney bar stools, baked in with the rest of the shop.
  const shop = createShop([
    furniture('stoolBar', 0, -SEAT_OFFSET),
    furniture('stoolBar', 0, SEAT_OFFSET),
  ]);
  group.add(shop.group);

  // Footprint of one cabinet, a little larger than the model so the shadow
  // softens past its edges; centred where the model's mass is.
  const cabinetShadow = { w: 1.25, d: 1.55 };
  const cabinetMiddle = CABINET_OFFSET + 0.025 * CABINET_SCALE;
  group.add(
    contactShadows([
      { x: 0, z: -cabinetMiddle, ...cabinetShadow },
      { x: 0, z: cabinetMiddle, ...cabinetShadow },
      { x: 0, z: -SEAT_OFFSET, w: 0.8, d: 0.8 },
      { x: 0, z: SEAT_OFFSET, w: 0.8, d: 0.8 },
    ]),
  );

  // The pair and its stools are solid too.
  const pairReach = CABINET_OFFSET + 0.294 * CABINET_SCALE;
  shop.colliders.push(
    [-0.5, -pairReach, 0.5, pairReach],
    [-0.25, -SEAT_OFFSET - 0.25, 0.25, -SEAT_OFFSET + 0.25],
    [-0.25, SEAT_OFFSET - 0.25, 0.25, SEAT_OFFSET + 0.25],
  );

  /*
   * Where each player's camera sits and what it looks at.
   *
   * Seated eye height, a little behind the stool, aimed between the screen
   * (1.01 m) and the dome on the lid (1.87 m) so both are in frame: the
   * screen is what you came to play, and the dome is what tells you whether
   * anyone is coming.
   */
  const screenZ = CABINET_OFFSET + 0.088 * CABINET_SCALE;
  const aimY = 1.3;

  const seats = [-1, 1].map((side, index) => ({
    id: index === 0 ? 'A' : 'B',
    position: [0, EYE_HEIGHT, side * (SEAT_OFFSET + CAMERA_BEHIND_STOOL)],
    lookAt: [0, aimY, side * screenZ],
    /** The stool, on the ground: walk within reach of it to sit. */
    stool: [0, side * SEAT_OFFSET],
    /** Where you are standing after you get up: beside the stool, facing away. */
    standAt: [0.95, side * SEAT_OFFSET],
    facing: side < 0 ? Math.PI : 0,
  }));

  // A dome on each lid, both driven by the one session: each player sees the
  // match's state from their own seat.
  const lidY = LID.y * CABINET_SCALE;
  const lidZ = CABINET_OFFSET + LID.z * CABINET_SCALE;
  const domes = createDomeLights([
    [0, lidY, -lidZ],
    [0, lidY, lidZ],
  ]);
  group.add(domes.group);

  return {
    group,
    cabinets: [cabinetA, cabinetB],
    seats,
    /** `set(light)` from the session, `update(now)` every frame. */
    domes,
    colliders: shop.colliders,
    bounds: shop.bounds,
    spawn: shop.spawn,
    /** Door, attendant, and the front wall's cutaway: once a frame. */
    update: shop.update,
    /** Resolves when the cabinets and the whole shop are in the scene. */
    ready: Promise.all([cabinetA.ready, cabinetB.ready, shop.ready]),
  };
}
