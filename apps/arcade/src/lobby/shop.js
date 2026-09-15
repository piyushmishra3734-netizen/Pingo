import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

import { KENNEY_SCALE } from './cabinet.js';
import { createGlow } from './glow.js';
import { bake, loadLive } from './kit.js';
import { loadPerson } from './people.js';
import { createLiveScreens } from './screens.js';
import { signTexture } from './textures.js';

/**
 * PINGO ARCADE: the shop, and the pavement in front of it.
 *
 * - The storefront and the pavement: Quaternius's Downtown City MegaKit (CC0),
 *   composed offline into models/downtown/storefront.glb - a dark metal shop
 *   front with a glass door, a cornice band for the sign, a brick floor above.
 * - Inside: Kenney's Mini Arcade (walls, floor, machines) and Furniture Kit
 *   (stools, rug, plants); the PINGO pair in the middle is room.js.
 * - People: Quaternius's Modular Men (people.js).
 *
 * ## The plan, from above (+Z is the street)
 *
 *   back wall:  basketball  dance   .  speakers  .  arcade x3  slots
 *   left wall:  claw x2, pinball x2          right wall: prizes, tickets, wheel, vending
 *   middle:     the PINGO versus pair (room.js), air hockey on the left,
 *               the prize counter and its attendant on the right
 *   front:      the storefront, door in the middle, sign on the cornice
 *   outside:    pavement, doormat, plants - then only the night
 *
 * ## Three groups, one of them always hidden
 *
 * From the street the storefront hides the inside, so the inside is not drawn
 * there at all; step up to the door and it appears behind the glass. Inside,
 * the storefront goes instead - the camera is behind you, and it is the one
 * wall that would stand between the two. Either way about half the shop's
 * triangles are never drawn.
 *
 * ## Units
 *
 * The Kenney kit is scaled so its machine is 1.75 m; one wall piece is one
 * grid step (`U`, 2.41 m). The storefront is metres already.
 */

const U = KENNEY_SCALE;
const HALF_W = 3 * U;
const HALF_D = 2.5 * U;
/** Half a Kenney wall piece's thickness. */
const WALL = 0.3 * U;
const INNER_W = HALF_W - WALL;
const INNER_D = HALF_D - WALL;

/** The storefront's line - storefront.glb was composed on it. */
const FACADE_Z = HALF_D;
/** The storefront's inside face, and its street face (the door stands proud of the line). */
const FACADE_BACK = FACADE_Z - 0.22;
export const FRONT = FACADE_Z + 0.11;
/** Half the door's opening: 1 m in the kit, stretched with the facade from 14 m to 16. */
const WIDE = 16 / 14;
const DOOR_HALF = 0.5 * WIDE;
/** The pavement's edge: past it, only the night. */
const KERB = FACADE_Z + 6.05;
/** How far the glass door swings in, in radians. */
const DOOR_OPEN = -1.5;

const FURNITURE = 1.75;

const arcade = (name, x, z, rot = 0, extra = {}) => ({ url: `models/${name}.glb`, x, z, rot, scale: U, solid: true, ...extra });
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

/** The last stretch of each side wall, from the last full piece to the storefront. */
const FILL = FACADE_BACK - 2 * U;

const SHELL = [
  ...range(-2, 2).map((i) => arcade('wall', i * U, -HALF_D)),
  arcade('wall-corner', -HALF_W, -HALF_D, Math.PI / 2),
  arcade('wall-corner', HALF_W, -HALF_D, 0),
  ...[-1.5, -0.5, 0.5, 1.5].flatMap((j) => [
    arcade('wall', -HALF_W, j * U, Math.PI / 2),
    arcade('wall', HALF_W, j * U, -Math.PI / 2),
  ]),
  // A wall piece squeezed along its length closes each side up to the storefront.
  arcade('wall', -HALF_W, 2 * U + FILL / 2, Math.PI / 2, { scale: [FILL, U, U] }),
  arcade('wall', HALF_W, 2 * U + FILL / 2, -Math.PI / 2, { scale: [FILL, U, U] }),
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
  onLeftWall('claw-machine', 3.4, 0.347),
  onLeftWall('claw-machine', 1.6, 0.347),
  onLeftWall('pinball', -0.8, 0.325),
  onRightWall('prizes', 3.0, 0.2),
  onRightWall('ticket-machine', 0.9, 0.163),
  onRightWall('prize-wheel', -0.4, 0.15),
  onRightWall('vending-machine', -1.9, 0.225),
  arcade('cash-register', 4.1, 3.0, FACING_LEFT),
  arcade('air-hockey', -2.9, 2.4),
];

const INTERIOR_DECOR = [
  // Under the versus pair, long side along it.
  furniture('rugRectangle', 0, 0, Math.PI / 2, { scale: [3.7, 1, 2.83] }),
  furniture('pottedPlant', -6.0, 4.75, 0, { scale: 2, solid: true }),
  furniture('pottedPlant', 6.0, 4.75, 0, { scale: 2, solid: true }),
];

const STREET_DECOR = [
  furniture('rugDoormat', 0, FRONT + 0.7, 0, { scale: [3.6, 1, 3.6] }),
  furniture('pottedPlant', -1.75, FRONT + 0.6, 0, { scale: 2, solid: true }),
  furniture('pottedPlant', 1.75, FRONT + 0.6, 0, { scale: 2, solid: true }),
  furniture('trashcan', 4.2, FRONT + 0.6, 0, { scale: 1.1, solid: true }),
];

/** Regulars at the machines, standing where a player would, facing the glass. */
const REGULARS = [
  { name: 'punk', x: -4.3, z: 3.4, facing: -Math.PI / 2 }, // claw machine
  { name: 'beach', x: -4.2, z: -0.8, facing: -Math.PI / 2 }, // pinball
  { name: 'worker', x: 3.3, z: -3.45, facing: Math.PI }, // arcade cabinet
];

/** The row of Kenney arcade machines on the back wall, whose screens run. */
const ARCADE_ROW = [2.2, 3.3, 4.4].map((x) => ({ x, z: -INNER_D + 0.244 * U }));

const PINK = 0xff4f8b;
const TEAL = 0x38e0d0;
const VIOLET = 0x8b5cff;
const AMBER = 0xffb347;
const WHITE = 0xdfe8ff;
const pool = (x, z, w, d, color, strength = 0.55) => ({ x, z, w, h: d, color, strength, floor: true });

/*
 * Where the light falls inside: a pool in front of every machine in its own
 * colour, the PINGO pair brightest, neon tubes along the tops of the walls.
 */
const INSIDE_GLOW = [
  ...ARCADE_ROW.map(({ x }, i) => pool(x, -3.7, 1.5, 1.6, [TEAL, PINK, VIOLET][i])),
  pool(-3.2, -2.4, 2.2, 1.8, PINK, 0.7),
  pool(-5.2, -2.4, 1.8, 1.6, AMBER),
  pool(-4.5, 3.4, 1.8, 1.8, TEAL),
  pool(-4.5, 1.6, 1.8, 1.8, TEAL),
  pool(-4.4, -0.8, 1.6, 1.5, VIOLET),
  pool(-2.9, 2.4, 3.2, 2.4, VIOLET, 0.45),
  pool(3.6, 3.0, 1.8, 2.6, AMBER, 0.45),
  pool(5.4, 0.9, 1.4, 1.4, AMBER),
  pool(5.5, -0.4, 1.6, 1.6, PINK),
  pool(5.3, -1.9, 1.4, 1.4, WHITE, 0.4),
  pool(0, 1.4, 2.0, 1.8, PINK, 0.7),
  pool(0, -1.4, 2.0, 1.8, PINK, 0.7),
  { x: 0, y: U - 0.12, z: -INNER_D + 0.02, w: 2 * INNER_W, h: 0.16, color: PINK, strength: 1.2, tube: true },
  { x: -INNER_W + 0.02, y: U - 0.12, z: 0, w: 2 * INNER_D, h: 0.16, color: TEAL, strength: 1.2, tube: true, rot: Math.PI / 2 },
  { x: INNER_W - 0.02, y: U - 0.12, z: 0, w: 2 * INNER_D, h: 0.16, color: TEAL, strength: 1.2, tube: true, rot: -Math.PI / 2 },
];

/** Outside: the sign, the lit windows and the open door throw colour on the pavement. */
const STREET_GLOW = [
  pool(0, FRONT + 2.4, 10, 4.5, PINK, 0.45),
  ...[-4, -2, 2, 4].map((bay, i) => pool(bay * WIDE, FRONT + 1.1, 2.1, 2.0, i % 2 ? PINK : VIOLET, 0.35)),
  pool(0, FRONT + 0.9, 1.6, 1.4, AMBER, 0.4),
  { x: 0, y: 3.5, z: FACADE_Z + 0.115, w: 6.6, h: 2.2, color: PINK, strength: 0.6 },
];

/** Mostly steady, with the two quick stutters a tired neon tube gives every few seconds. */
function neonFlicker(now) {
  const t = (now / 1000) % 7;
  return (t > 5.1 && t < 5.17) || (t > 5.3 && t < 5.36) ? 0.35 : 1;
}

/**
 * @param {import('./kit.js').Placement[]} [extra] - room.js's own pieces (the stools)
 */
export function createShop(extra = []) {
  const group = new Group();
  /** The inside: hidden from the street, where the storefront hides it anyway. */
  const interior = new Group();
  /** The storefront, its door and its sign: hidden once you are in. */
  const front = new Group();
  /** The pavement and what stands on it. */
  const street = new Group();
  group.add(interior, front, street);

  /** Footprints to walk into; filled as the models arrive. */
  const colliders = [
    // The storefront, either side of the door.
    [-HALF_W - WALL, FACADE_BACK, -DOOR_HALF, FRONT],
    [DOOR_HALF, FACADE_BACK, HALF_W + WALL, FRONT],
    // The attendant, and the regulars at their machines.
    [4.9, 2.7, 5.5, 3.3],
    ...REGULARS.map(({ x, z }) => [x - 0.3, z - 0.3, x + 0.3, z + 0.3]),
  ];
  /** Everyone in the shop but you, animated once a frame. */
  const people = [];
  let attendant;
  /** The attendant waves once each time you come up to the counter. */
  let waved = false;

  const sign = new Mesh(new PlaneGeometry(4.4, 1.1), new MeshBasicMaterial({ map: signTexture('PINGO ARCADE') }));
  // On the cornice band between the shop front and the brick floor above.
  sign.position.set(0, 3.5, FACADE_Z + 0.13);
  front.add(sign);

  const insideGlow = createGlow(INSIDE_GLOW);
  const streetGlow = createGlow(STREET_GLOW);
  const screens = createLiveScreens(ARCADE_ROW, U);
  interior.add(insideGlow.mesh, screens.mesh);
  street.add(streetGlow.mesh);

  let door;
  let doorAngle = 0;
  let doorOpen = false;

  const ready = Promise.all([
    bake([...SHELL, ...MACHINES, ...INTERIOR_DECOR, ...extra]).then(({ meshes, colliders: solid }) => {
      interior.add(...meshes);
      colliders.push(...solid);
    }),
    bake(STREET_DECOR).then(({ meshes, colliders: solid }) => {
      street.add(...meshes);
      colliders.push(...solid);
    }),
    loadLive('models/downtown/storefront.glb').then((gltf) => {
      const [facade, leaf, pavement] = ['facade', 'door', 'pavement'].map((name) => gltf.scene.getObjectByName(name));
      front.add(facade, leaf);
      street.add(pavement);
      door = leaf;
    }),
    loadPerson('suit').then((person) => {
      person.body.position.set(5.2, 0, 3.0);
      person.body.rotation.y = FACING_LEFT;
      person.play('Idle_Neutral');
      interior.add(person.body);
      people.push(person);
      attendant = person;
    }),
    // Regulars, busy at the machines. Their clip's start is staggered so the
    // room is not a row of people pressing buttons in unison.
    ...REGULARS.map(({ name, x, z, facing }, index) =>
      loadPerson(name).then((person) => {
        person.body.position.set(x, 0, z);
        person.body.rotation.y = facing;
        person.play('Interact', { speed: 0.75 + 0.15 * index });
        person.offset(0.6 * index);
        interior.add(person.body);
        people.push(person);
      }),
    ),
  ]);

  return {
    group,
    /** room.js puts the PINGO pair in here. */
    interior,
    colliders,
    ready,
    /** Where a player walks: the pavement and the shop. */
    bounds: { minX: -8.6, maxX: 8.6, minZ: -INNER_D, maxZ: KERB - 0.3 },
    /** On the pavement, facing the door. */
    spawn: { x: 0, z: FRONT + 4, facing: Math.PI },

    /**
     * Once a frame: what is visible from where you are, the door swinging for
     * whoever walks up to it, the neon, the screens and the people.
     * @returns {boolean} true the moment the door starts to open
     */
    update(dt, player, now) {
      const inside = player.z < FACADE_BACK - 0.1 && Math.abs(player.x) < INNER_W;
      // Only right at the door does the street draw both at once - the costliest view.
      const atDoor = Math.abs(player.x) < 2.5 && player.z < FRONT + 2;
      front.visible = !inside;
      interior.visible = inside || atDoor;

      const wantOpen = Math.abs(player.x) < 2.5 && Math.abs(player.z - FACADE_Z) < 3.2;
      const opened = wantOpen && !doorOpen;
      doorOpen = wantOpen;
      if (door) {
        doorAngle += ((doorOpen ? DOOR_OPEN : 0) - doorAngle) * Math.min(1, dt * 5);
        door.rotation.y = doorAngle;
      }

      sign.material.color.setScalar(neonFlicker(now));
      insideGlow.update(now);
      streetGlow.update(now);
      screens.update(now);
      const toCounter = Math.hypot(player.x - 4.1, player.z - 3.0);
      if (attendant && toCounter < 3 && !waved) {
        waved = true;
        attendant.once('Wave', 'Idle_Neutral');
      } else if (toCounter > 5) {
        waved = false;
      }
      for (const person of people) person.update(dt);
      return opened;
    },
  };
}
