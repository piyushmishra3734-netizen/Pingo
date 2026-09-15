import { Group, HemisphereLight, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { CABINET, createCabinet } from './cabinet.js';
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
 * Everything around them - the street, the shop, the other machines and
 * people - is shop.js. The pair lives in the shop's interior, so it is hidden
 * from the street along with the rest of the inside.
 *
 * ## Light
 *
 * One `HemisphereLight` and nothing else: sky above, bounce from the floor
 * below, no position and no shadow map to compute. The machines' own glow
 * (glow.js) does the rest, the way it does in a real arcade.
 */

/** Backs 4 cm apart at the spine, so the pair reads as two machines. */
const CABINET_OFFSET = CABINET.back + 0.02;
/** Where a player sits: half a metre in front of the control panel. */
const SEAT_OFFSET = CABINET_OFFSET + CABINET.front + 0.5;
/**
 * The seat camera's height: a little above and behind a seated head, rather
 * than in it - from here the screen and the dome on the lid are both in
 * frame, which is what the seat is for: play on one, news on the other.
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

  // One mesh for all of them: they share a texture, so merging is free.
  // `depthWrite: false` because these are decals.
  return new Mesh(
    mergeGeometries(planes),
    new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
}

export function createRoom() {
  const group = new Group();

  // Night: a dim violet sky and a dark floor bounce.
  group.add(new HemisphereLight(0xb8a6ff, 0x1a1024, 0.8));

  // The stools are Kenney bar stools, baked in with the rest of the shop.
  const shop = createShop([
    furniture('stoolBar', 0, -SEAT_OFFSET),
    furniture('stoolBar', 0, SEAT_OFFSET),
  ]);
  group.add(shop.group);

  // The model faces +Z: B needs nothing, A turns round to face its own seat.
  const cabinetA = createCabinet();
  cabinetA.group.position.z = -CABINET_OFFSET;
  cabinetA.group.rotation.y = Math.PI;

  const cabinetB = createCabinet();
  cabinetB.group.position.z = CABINET_OFFSET;

  shop.interior.add(
    cabinetA.group,
    cabinetB.group,
    contactShadows([
      { x: 0, z: -CABINET_OFFSET, w: 0.95, d: 0.95 },
      { x: 0, z: CABINET_OFFSET, w: 0.95, d: 0.95 },
      { x: 0, z: -SEAT_OFFSET, w: 0.8, d: 0.8 },
      { x: 0, z: SEAT_OFFSET, w: 0.8, d: 0.8 },
    ]),
  );

  // The pair and its stools are solid too.
  const reach = CABINET_OFFSET + CABINET.front;
  shop.colliders.push(
    [-0.4, -reach, 0.4, reach],
    [-0.25, -SEAT_OFFSET - 0.25, 0.25, -SEAT_OFFSET + 0.25],
    [-0.25, SEAT_OFFSET - 0.25, 0.25, SEAT_OFFSET + 0.25],
  );

  /*
   * Where each player's camera sits and what it looks at: seated eye height,
   * a little behind the stool, aimed between the screen and the dome.
   */
  const screenZ = CABINET_OFFSET + CABINET.screen.z;
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
  const lidZ = CABINET_OFFSET + CABINET.lid.z;
  const domes = createDomeLights([
    [0, CABINET.lid.y, -lidZ],
    [0, CABINET.lid.y, lidZ],
  ]);
  shop.interior.add(domes.group);

  return {
    group,
    cabinets: [cabinetA, cabinetB],
    seats,
    /** `set(light)` from the session, `update(now)` every frame. */
    domes,
    colliders: shop.colliders,
    bounds: shop.bounds,
    spawn: shop.spawn,
    /** Door, people, glow, and what is visible from where: once a frame. */
    update: shop.update,
    /** Resolves when the cabinets and the whole shop are in the scene. */
    ready: Promise.all([cabinetA.ready, cabinetB.ready, shop.ready]),
  };
}
