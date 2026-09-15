import { AnimationMixer, Group, LoopOnce, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

import { CABINET_SCALE } from './cabinet.js';
import { bake, loadLive } from './kit.js';
import { signTexture } from './textures.js';

/**
 * The street and the arcade on it, built from Kenney's CC0 kits:
 * Mini Arcade (walls, door, floor, machines, people), City Kit Commercial
 * (the neighbours), City Kit Roads (the road, the paving, street lights) and
 * the Furniture Kit (stools, rugs, plants).
 *
 * ## The plan, from above (+Z is the street)
 *
 *   back wall:  basketball  dance   .  speakers  .  arcade x3  slots
 *   left wall:  claw x2, pinball x2          right wall: prizes, tickets, wheel, vending
 *   middle:     the PINGO versus pair (room.js), air hockey on the left,
 *               the prize counter and its attendant on the right
 *   front:      wall, window, DOOR, window, wall - sign on top
 *   outside:    paving, doormat, plants, the neighbours, then the road
 *
 * ## Units
 *
 * Everything in the Mini Arcade kit is scaled by the cabinet's own factor, so
 * one wall piece is one grid step (`U`, 2.41 m) and the machines keep the size
 * room.js already gave the PINGO cabinets. The other kits are scaled to sit
 * with it: a road 7 m across, bar stools 75 cm high.
 */

const U = CABINET_SCALE;
const HALF_W = 3 * U;
const HALF_D = 2.5 * U;
/** Half a wall piece's thickness. */
const WALL = 0.3 * U;
const INNER_W = HALF_W - WALL;
const INNER_D = HALF_D - WALL;
/** The shop front's street face. */
export const FRONT = HALF_D + WALL;

const CITY = 7;
const ROADS = 7;
const FURNITURE = 1.75;

const arcade = (name, x, z, rot = 0, extra = {}) => ({ url: `models/${name}.glb`, x, z, rot, scale: U, solid: true, ...extra });
const city = (name, x, z, rot = 0, extra = {}) => ({ url: `models/city/${name}.glb`, x, z, rot, scale: CITY, solid: true, ...extra });
const road = (name, x, z, rot = 0, extra = {}) => ({ url: `models/roads/${name}.glb`, x, z, rot, scale: ROADS, ...extra });
export const furniture = (name, x, z, rot = 0, extra = {}) => ({
  url: `models/furniture/${name}.glb`, x, z, rot, scale: FURNITURE, centre: true, ...extra,
});

// Kenney models face +Z. These turn one to face into the room from a wall.
const FACING_RIGHT = Math.PI / 2;
const FACING_LEFT = -Math.PI / 2;
/** Backed onto a wall: `depth` is how far the model reaches behind its pivot, in model units. */
const onBackWall = (name, x, depth) => arcade(name, x, -INNER_D + depth * U);
const onLeftWall = (name, z, depth) => arcade(name, -INNER_W + depth * U, z, FACING_RIGHT);
const onRightWall = (name, z, depth) => arcade(name, INNER_W - depth * U, z, FACING_LEFT);

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The street-side wall, apart from the rest: it disappears when you are inside. */
const FRONT_WALL = [
  arcade('wall', -2 * U, HALF_D),
  arcade('wall-window', -U, HALF_D),
  arcade('wall-window', U, HALF_D),
  arcade('wall', 2 * U, HALF_D),
  arcade('wall-corner', HALF_W, HALF_D, -Math.PI / 2),
  arcade('wall-corner', -HALF_W, HALF_D, Math.PI),
  city('detail-awning-wide', -U, FRONT - 0.22, 0, { y: 1.5, scale: 2.2, solid: false }),
  city('detail-awning-wide', U, FRONT - 0.22, 0, { y: 1.5, scale: 2.2, solid: false }),
];

const SHELL = [
  ...range(-2, 2).map((i) => arcade('wall', i * U, -HALF_D)),
  arcade('wall-corner', -HALF_W, -HALF_D, Math.PI / 2),
  arcade('wall-corner', HALF_W, -HALF_D, 0),
  ...[-1.5, -0.5, 0.5, 1.5].flatMap((j) => [
    arcade('wall', -HALF_W, j * U, Math.PI / 2),
    arcade('wall', HALF_W, j * U, -Math.PI / 2),
  ]),
  // Floor tiles sunk by their own thickness, so their top is y = 0.
  ...range(0, 5).flatMap((i) =>
    range(-2, 2).map((j) => arcade('floor', (i - 2.5) * U, j * U, 0, { y: -0.025 * U, solid: false })),
  ),
];

// Depths measured from each GLB's bounds (its -min z).
const MACHINES = [
  onBackWall('basketball-game', -5.2, 0.5),
  onBackWall('dance-machine', -3.2, 0.487),
  onBackWall('arcade-machine', 2.2, 0.244),
  onBackWall('arcade-machine', 3.3, 0.244),
  onBackWall('arcade-machine', 4.4, 0.244),
  onBackWall('gambling-machine', 5.6, 0.244),
  onLeftWall('claw-machine', 3.4, 0.347),
  onLeftWall('claw-machine', 1.6, 0.347),
  onLeftWall('pinball', -0.2, 0.325),
  onLeftWall('pinball', -1.5, 0.325),
  onRightWall('prizes', 3.0, 0.2),
  onRightWall('ticket-machine', 0.9, 0.163),
  onRightWall('prize-wheel', -0.4, 0.15),
  onRightWall('vending-machine', -1.9, 0.225),
  arcade('cash-register', 4.1, 3.0, FACING_LEFT),
  arcade('air-hockey', -2.9, 2.4),
];

const DECOR = [
  // Under the versus pair, long side along it.
  furniture('rugRectangle', 0, 0, Math.PI / 2, { scale: [3.7, 1, 2.83] }),
  furniture('pottedPlant', -6.0, 4.75, 0, { scale: 2, solid: true }),
  furniture('pottedPlant', 6.0, 4.75, 0, { scale: 2, solid: true }),
  furniture('speaker', -1.9, -5.0, 0, { scale: 2, solid: true }),
  furniture('speaker', 1.35, -5.0, 0, { scale: 2, solid: true }),
  furniture('rugDoormat', 0, FRONT + 0.7, 0, { scale: [3.6, 1, 3.6] }),
  furniture('pottedPlant', -1.75, FRONT + 0.6, 0, { scale: 2, solid: true }),
  furniture('pottedPlant', 1.75, FRONT + 0.6, 0, { scale: 2, solid: true }),
  furniture('trashcan', 4.2, FRONT + 0.6, 0, { scale: 1.1, solid: true }),
];

/** The pavement's edge - the road starts here. */
const KERB = 13.75;

const STREET = [
  // The ground: one paving tile stretched. Its colour is one palette cell, so
  // stretching it costs nothing and saves ~30 tiles. 2 cm below the shop floor.
  road('tile-low', 0, -3.25, 0, { y: -0.16, scale: [44, ROADS, 34] }),
  ...[-21, -14, -7, 0, 7, 14, 21].map((x) => road('road-side', x, KERB + 0.81 * ROADS, 0, { y: -0.14 })),
  road('light-square', -9, KERB + 1.2, Math.PI),
  road('light-square', 9, KERB + 1.2, Math.PI),
  // Neighbours, fronts flush with the shop's.
  city('building-a', -11.2, FRONT - 0.47 * CITY),
  city('building-d', 11.1, FRONT - 0.45 * CITY),
  city('low-detail-building-wide-a', -17.8, FRONT - 0.25 * CITY),
  city('low-detail-building-wide-a', 17.8, FRONT - 0.25 * CITY),
  // No skyline behind the shop: on a portrait phone the camera's tall view
  // turned the kit's low-detail towers into blank grey slabs filling the top half.
];

/**
 * @param {import('./kit.js').Placement[]} [extra] - room.js's own pieces (the stools)
 */
export function createShop(extra = []) {
  const group = new Group();
  /** Everything on the street side of the shop: hidden once you are in. */
  const front = new Group();
  group.add(front);

  /** Footprints to walk into; filled as the models arrive. */
  const colliders = [
    // The door frame's posts, either side of the opening.
    [0.4 * U, HALF_D - WALL, 0.5 * U, HALF_D + WALL],
    [-0.5 * U, HALF_D - WALL, -0.4 * U, HALF_D + WALL],
    // The attendant.
    [4.9, 2.7, 5.5, 3.3],
  ];

  const sign = new Mesh(new PlaneGeometry(5.2, 1.3), new MeshBasicMaterial({ map: signTexture('PINGO ARCADE') }));
  sign.position.set(0, U + 0.65, FRONT + 0.02);
  front.add(sign);

  const mixers = [];
  const door = { actions: {}, open: false };

  const ready = Promise.all([
    bake([...SHELL, ...MACHINES, ...DECOR, ...STREET, ...extra]).then(({ meshes, colliders: solid }) => {
      group.add(...meshes);
      colliders.push(...solid);
    }),
    bake(FRONT_WALL).then(({ meshes, colliders: solid }) => {
      front.add(...meshes);
      colliders.push(...solid);
    }),
    loadLive('models/wall-door-rotate.glb').then((gltf) => {
      gltf.scene.scale.setScalar(U);
      gltf.scene.position.set(0, 0, HALF_D);
      front.add(gltf.scene);
      const mixer = new AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        const action = mixer.clipAction(clip);
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
        door.actions[clip.name] = action;
      }
      mixers.push(mixer);
    }),
    loadLive('models/character-employee.glb').then((gltf) => {
      gltf.scene.scale.setScalar(U);
      gltf.scene.position.set(5.2, 0, 3.0);
      gltf.scene.rotation.y = FACING_LEFT;
      group.add(gltf.scene);
      const mixer = new AnimationMixer(gltf.scene);
      mixer.clipAction(gltf.animations.find((clip) => clip.name === 'idle')).play();
      mixers.push(mixer);
    }),
  ]);

  function setDoor(open) {
    if (open === door.open || !door.actions.open) return;
    door.open = open;
    door.actions[open ? 'close' : 'open'].stop();
    door.actions[open ? 'open' : 'close'].reset().play();
  }

  return {
    group,
    colliders,
    ready,
    /** Where a player walks: the pavement, the shop and the gaps between. */
    bounds: { minX: -20, maxX: 20, minZ: -INNER_D, maxZ: KERB + 1.6 },
    /** On the pavement, facing the door. */
    spawn: { x: 0, z: 11.2, facing: Math.PI },

    /**
     * Once a frame: the door opens for whoever walks up to it, and the front
     * wall steps aside once they are in - with the camera behind and above
     * the player, it is the one wall that would stand between the two.
     */
    update(dt, player) {
      const inside = player.z < INNER_D + 0.4 && Math.abs(player.x) < INNER_W;
      front.visible = !inside;
      setDoor(Math.abs(player.x) < 2.5 && Math.abs(player.z - HALF_D) < 3.2);
      for (const mixer of mixers) mixer.update(dt);
    },
  };
}
