import { Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

import { CABINET, KENNEY_SCALE, loadCabinetModel } from './cabinet.js';
import { createGlow } from './glow.js';
import { bake, loadLive } from './kit.js';
import { loadPerson } from './people.js';
import { createLiveScreens } from './screens.js';
import { createShell } from './shell.js';
import { signTexture } from './textures.js';

/**
 * PINGO ARCADE: the shop, and the pavement in front of it.
 *
 * - The storefront, pavement, planters, bollards, AC units and the two steel
 *   columns inside: Quaternius's Downtown City MegaKit (CC0), composed offline
 *   into models/downtown/storefront.glb.
 * - The room: carpet, brick walls and a dark concrete ceiling (shell.js).
 * - The machines: the PINGO cabinet (Lady Lion Studios, CC-BY) for the pair in
 *   the middle (room.js) and the row on the back wall; Kenney's Mini Arcade for
 *   the rest; Kenney's Furniture Kit for stools and plants.
 * - People: Quaternius's Modular Men (people.js).
 *
 * ## The plan, from above (+Z is the street)
 *
 *   back wall:  basketball  dance   .   .   PINGO cabinets x3 (shooter, breakout, snake)
 *   left wall:  claw x2, pinball             right wall: prizes, tickets, wheel, vending
 *   middle:     the PINGO versus pair (room.js) between two steel columns,
 *               air hockey on the left, the prize counter and its attendant on the right
 *   front:      the storefront, door in the middle, sign on the cornice
 *   outside:    pavement, planters, bollards - then only the night
 *
 * ## Three groups, one of them always hidden
 *
 * From the street the storefront hides the inside, so the inside is not drawn
 * there at all; step up to the door and it appears behind the glass. Inside,
 * the camera comes down to your shoulder and the storefront goes instead.
 *
 * ## Units
 *
 * Metres. The Kenney machines are scaled so theirs is 1.75 m tall (`U`), and
 * the room keeps the grid they were laid out on.
 */

const U = KENNEY_SCALE;
/** The side walls' inside faces, and the back wall's. */
const INNER_W = 2.7 * U;
const INNER_D = 2.2 * U;

/** The storefront's line - storefront.glb was composed on it. */
const FACADE_Z = 2.5 * U;
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
/** High enough for the tallest machine (the dance machine, 2.3 m), low enough to feel like a room. */
const CEILING = 3.0;

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

// Depths measured from each GLB's bounds (its -min z).
const MACHINES = [
  onBackWall('basketball-game', -5.2, 0.5),
  onBackWall('dance-machine', -3.2, 0.487),
  onLeftWall('pinball', -0.8, 0.325),
  onRightWall('prizes', 3.0, 0.2),
  onRightWall('ticket-machine', 0.9, 0.163),
  onRightWall('prize-wheel', -0.4, 0.15),
  onRightWall('vending-machine', -1.9, 0.225),
  arcade('cash-register', 4.1, 3.0, FACING_LEFT),
  arcade('air-hockey', -2.9, 2.4),
];

const INTERIOR_DECOR = [
  furniture('pottedPlant', -6.0, 4.75, 0, { scale: 2, solid: true }),
  furniture('pottedPlant', 6.0, 4.75, 0, { scale: 2, solid: true }),
];

const STREET_DECOR = [furniture('rugDoormat', 0, FRONT + 0.7, 0, { scale: [3.6, 1, 3.6] })];

/** The back-wall row: three more PINGO cabinets, each running its own game. */
const ARCADE_ROW = [
  { x: 2.2, game: 'shooter' },
  { x: 3.3, game: 'breakout' },
  { x: 4.4, game: 'snake' },
].map((machine) => ({ ...machine, z: -INNER_D + CABINET.back, rot: 0 }));

/**
 * The claw machines on the left wall (Sketchfab, CC-BY - see CREDITS.txt),
 * facing into the room. `size` is the model's footprint and height as
 * prepared; `pivot` where its footprint centre is, in the file's own units.
 */
const CLAWS = [
  { url: 'models/claw-ladylion.glb', z: 3.4, height: 1.95, fileHeight: 1.947, pivot: [0, 0], depth: 1.233, turn: 0 },
  // Its front faces +Z in the file: a quarter turn puts it facing the room.
  { url: 'models/claw-efx.glb', z: 1.6, height: 1.95, fileHeight: 2.38, pivot: [0.54, 0.96], depth: 1.15, turn: Math.PI / 2 },
].map((claw) => ({ ...claw, x: -INNER_W + claw.depth / 2 + 0.05 }));

/** As placed in storefront.glb: the columns inside, planters and bollards outside. */
const PILLARS = [[-2.4, -1.0], [2.4, -1.0]];
const PLANTERS = [[-7.2, FRONT + 1.3], [7.2, FRONT + 1.3]];
const BOLLARDS = [-6, -3, 3, 6].map((x) => [x, KERB - 0.45]);

/** Regulars at the machines, standing where a player would, facing the glass. */
const REGULARS = [
  { name: 'punk', x: -4.3, z: 3.4, facing: -Math.PI / 2 }, // claw machine
  { name: 'beach', x: -4.2, z: -0.8, facing: -Math.PI / 2 }, // pinball
  { name: 'worker', x: 3.3, z: -3.9, facing: Math.PI }, // the shooter cabinet
];

const PINK = 0xff4f8b;
const TEAL = 0x38e0d0;
const VIOLET = 0x8b5cff;
const AMBER = 0xffb347;
const WHITE = 0xdfe8ff;
const pool = (x, z, w, d, color, strength = 0.55) => ({ x, z, w, h: d, color, strength, floor: true });

/*
 * Where the light falls inside: a pool in front of every machine in its own
 * colour, the PINGO pair brightest, neon tubes along the walls under the ceiling.
 */
const SIDE_LENGTH = FACADE_BACK + INNER_D;
const SIDE_MIDDLE = (FACADE_BACK - INNER_D) / 2;
const TUBE_Y = CEILING - 0.15;
const INSIDE_GLOW = [
  ...ARCADE_ROW.map(({ x }, i) => pool(x, -3.9, 1.3, 1.5, [TEAL, PINK, VIOLET][i], 0.6)),
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
  { x: 0, y: TUBE_Y, z: -INNER_D + 0.02, w: 2 * INNER_W, h: 0.16, color: PINK, strength: 1.2, tube: true },
  { x: -INNER_W + 0.02, y: TUBE_Y, z: SIDE_MIDDLE, w: SIDE_LENGTH, h: 0.16, color: TEAL, strength: 1.2, tube: true, rot: Math.PI / 2 },
  { x: INNER_W - 0.02, y: TUBE_Y, z: SIDE_MIDDLE, w: SIDE_LENGTH, h: 0.16, color: TEAL, strength: 1.2, tube: true, rot: -Math.PI / 2 },
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

const square = ([x, z], half) => [x - half, z - half, x + half, z + half];

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

  const shell = createShell({ minX: -INNER_W, maxX: INNER_W, minZ: -INNER_D, maxZ: FACADE_BACK, height: CEILING });
  interior.add(shell.floor, shell.walls, shell.ceiling);

  /** Footprints to walk into; filled as the models arrive. */
  const colliders = [
    // The room's walls.
    [-9, -INNER_D - 1, 9, -INNER_D],
    [-INNER_W - 1, -INNER_D - 1, -INNER_W, FACADE_BACK],
    [INNER_W, -INNER_D - 1, INNER_W + 1, FACADE_BACK],
    // The storefront, either side of the door.
    [-8.1, FACADE_BACK, -DOOR_HALF, FRONT],
    [DOOR_HALF, FACADE_BACK, 8.1, FRONT],
    ...PILLARS.map((p) => square(p, 0.28)),
    ...PLANTERS.map((p) => square(p, 1)),
    ...BOLLARDS.map((p) => square(p, 0.12)),
    ...ARCADE_ROW.map(({ x, z }) => [x - 0.36, z - CABINET.back, x + 0.36, z + CABINET.front]),
    ...CLAWS.map(({ x, z, depth }) => [x - depth / 2, z - 0.72, x + depth / 2, z + 0.72]),
    // The attendant, and the regulars at their machines.
    [4.9, 2.7, 5.5, 3.3],
    ...REGULARS.map(({ x, z }) => square([x, z], 0.3)),
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
  const screens = createLiveScreens(ARCADE_ROW);
  interior.add(insideGlow.mesh, screens.mesh);
  street.add(streetGlow.mesh);

  let door;
  let doorAngle = 0;
  let doorOpen = false;

  const ready = Promise.all([
    bake([...MACHINES, ...INTERIOR_DECOR, ...extra]).then(({ meshes, colliders: solid }) => {
      interior.add(...meshes);
      colliders.push(...solid);
    }),
    bake(STREET_DECOR).then(({ meshes }) => street.add(...meshes)),
    loadLive('models/downtown/storefront.glb').then((gltf) => {
      const part = (name) => gltf.scene.getObjectByName(name);
      const [facade, leaf, pavement, props, pillars] = ['facade', 'door', 'pavement', 'props', 'pillars'].map(part);
      front.add(facade, leaf);
      street.add(pavement, props);
      interior.add(pillars);
      door = leaf;
    }),
    ...CLAWS.map(({ url, x, z, height, fileHeight, pivot, turn }) =>
      loadLive(url).then((gltf) => {
        const scale = height / fileHeight;
        const holder = new Group();
        gltf.scene.scale.setScalar(scale);
        gltf.scene.position.set(-pivot[0] * scale, 0, -pivot[1] * scale);
        holder.add(gltf.scene);
        holder.position.set(x, 0, z);
        holder.rotation.y = turn;
        interior.add(holder);
      }),
    ),
    // The back-wall row: one geometry drawn three times in one call.
    loadCabinetModel().then(({ geometry, material }) => {
      const row = new InstancedMesh(geometry, material, ARCADE_ROW.length);
      ARCADE_ROW.forEach(({ x, z, rot }, i) => row.setMatrixAt(i, new Matrix4().makeRotationY(rot).setPosition(x, 0, z)));
      row.computeBoundingSphere();
      interior.add(row);
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

  /** In the shop, rather than on the street or in the doorway. */
  const inside = (p) => p.z < FACADE_BACK - 0.1 && Math.abs(p.x) < INNER_W;

  return {
    group,
    /** room.js puts the PINGO pair in here. */
    interior,
    colliders,
    ready,
    inside,
    /** Where a player walks: the pavement and the shop. */
    bounds: { minX: -8.6, maxX: 8.6, minZ: -INNER_D, maxZ: KERB - 0.3 },
    /** Where the camera may stand indoors: never through a wall. */
    cameraBox: { minX: -INNER_W + 0.35, maxX: INNER_W - 0.35, maxZ: FACADE_BACK - 0.3 },
    /** On the pavement, facing the door. */
    spawn: { x: 0, z: FRONT + 4, facing: Math.PI },

    /**
     * Once a frame: what is visible from where you are, the door swinging for
     * whoever walks up to it, the neon, the screens and the people.
     * @returns {boolean} true the moment the door starts to open
     */
    update(dt, player, now) {
      const isIn = inside(player);
      // Only right at the door does the street draw both at once - the costliest view.
      const atDoor = Math.abs(player.x) < 1.5 && player.z < FRONT + 1.2;
      front.visible = !isIn;
      interior.visible = isIn || atDoor;

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
