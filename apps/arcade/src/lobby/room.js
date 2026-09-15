import {
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { createCabinet } from './cabinet.js';
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

/**
 * Distance from the room's centre to a cabinet's own centre.
 *
 * Wide enough that the pair reads as two machines sharing a spine rather than
 * one block: at 0.42 the shells met and the seam disappeared.
 */
const CABINET_OFFSET = 0.48;
/** Where a player sits, and where that seat's camera lives. */
const SEAT_OFFSET = 1.35;

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

  // Seat A looks along +Z, seat B along -Z; the cabinet in front of each one
  // is turned to face its player.
  const cabinetA = createCabinet({ accentColor: 0xff4f8b, label: 'PINGO' });
  cabinetA.group.position.z = -CABINET_OFFSET;

  const cabinetB = createCabinet({ accentColor: 0x38e0d0, label: 'PINGO' });
  cabinetB.group.position.z = CABINET_OFFSET;
  cabinetB.group.rotation.y = Math.PI;

  group.add(cabinetA.group, cabinetB.group);

  const stoolA = createStool();
  stoolA.position.set(0, 0, -SEAT_OFFSET);
  const stoolB = createStool();
  stoolB.position.set(0, 0, SEAT_OFFSET);
  group.add(stoolA, stoolB);

  group.add(
    contactShadows([
      { x: 0, z: -CABINET_OFFSET - 0.05, w: 1.5, d: 1.25 },
      { x: 0, z: CABINET_OFFSET + 0.05, w: 1.5, d: 1.25 },
      { x: 0, z: -SEAT_OFFSET, w: 0.8, d: 0.8 },
      { x: 0, z: SEAT_OFFSET, w: 0.8, d: 0.8 },
    ]),
  );

  /**
   * Where each player's camera sits, and what it looks at: seated eye height,
   * a little back from the stool, aimed at that cabinet's screen.
   */
  const seats = [
    { id: 'A', position: [0, 1.02, -SEAT_OFFSET + 0.05], lookAt: [0, 1.0, -CABINET_OFFSET] },
    { id: 'B', position: [0, 1.02, SEAT_OFFSET - 0.05], lookAt: [0, 1.0, CABINET_OFFSET] },
  ];

  return { group, cabinets: [cabinetA, cabinetB], seats };
}
