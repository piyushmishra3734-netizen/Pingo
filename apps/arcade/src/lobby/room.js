import {
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { CABINET_BACK, CABINET_SCALE, LID, createCabinet } from './cabinet.js';
import { createDomeLights } from './dome-light.js';
import { createStool } from './stool.js';
import { contactShadowTexture, floorTexture } from './textures.js';

/**
 * The room: floor, two cabinets back to back, a stool at each, and the soft
 * patches that make all of it sit on the ground.
 *
 * ## The versus layout
 *
 * The cabinets share a spine at the centre and face outward, so the two
 * players sit facing each other with the machines between them - a Japanese
 * arcade's taisen setup. Seat A is at -Z, seat B at +Z, and each seat's camera
 * anchor looks at its own screen.
 *
 * ## Light
 *
 * One `HemisphereLight` and nothing else: sky above, bounce from the floor
 * below, no position and no shadow map to compute. It is the cheapest thing in
 * three that still gives a surface a top and a bottom. The dome light over
 * each cabinet arrives in step 4 and glows by material, not by lighting the
 * room.
 */

/** Backs 4 cm apart at the spine, so the pair reads as two machines. */
const CABINET_OFFSET = CABINET_BACK * CABINET_SCALE + 0.02;
/** Where a player sits: a stool's width in front of the control panel. */
const SEAT_OFFSET = 1.8;
/** Seated on a 0.52 m stool, an adult's eyes are about here. */
const EYE_HEIGHT = 1.27;

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

  group.add(new HemisphereLight(0xdfe4ff, 0x241f30, 1.15));

  const floor = new Mesh(
    new PlaneGeometry(14, 14),
    new MeshLambertMaterial({ map: floorTexture() }),
  );
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  // The model faces +Z: B needs nothing, A turns round to face its own seat.
  const cabinetA = createCabinet();
  cabinetA.group.position.z = -CABINET_OFFSET;
  cabinetA.group.rotation.y = Math.PI;

  const cabinetB = createCabinet();
  cabinetB.group.position.z = CABINET_OFFSET;

  group.add(cabinetA.group, cabinetB.group);

  const stoolA = createStool();
  stoolA.position.set(0, 0, -SEAT_OFFSET);
  const stoolB = createStool();
  stoolB.position.set(0, 0, SEAT_OFFSET);
  group.add(stoolA, stoolB);

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

  /*
   * Where each player's camera sits and what it looks at: seated eye height,
   * just behind the stool, aimed at the middle of that cabinet's screen
   * (0.42 model units up, 0.088 forward of the cabinet's origin).
   */
  const screenY = 0.42 * CABINET_SCALE;
  const screenZ = CABINET_OFFSET + 0.088 * CABINET_SCALE;
  const seats = [
    { id: 'A', position: [0, EYE_HEIGHT, -SEAT_OFFSET - 0.15], lookAt: [0, screenY, -screenZ] },
    { id: 'B', position: [0, EYE_HEIGHT, SEAT_OFFSET + 0.15], lookAt: [0, screenY, screenZ] },
  ];

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
    /** Resolves when both cabinet bodies are in the scene. */
    ready: Promise.all([cabinetA.ready, cabinetB.ready]),
  };
}
