import { CatmullRomCurve3, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { CABINET, createCabinet } from '../lobby/cabinet.js';
import { createDomeLights } from '../lobby/dome-light.js';
import { contactShadowTexture } from '../lobby/textures.js';
import { createClouds } from './clouds.js';
import { createIslands } from './islands.js';
import { paletteFor } from './palette.js';
import { createSky } from './sky.js';
import { ROOFS, WALLS, createTown } from './town.js';

/**
 * The world above the clouds.
 *
 * It keeps the interface the arcade's room had (group, seats, cabinets,
 * colliders, bounds, spawn, update, ready), so the player, the camera, the
 * network and the games work on it unchanged. What it draws is new: a sky, a
 * sea with broken cloud far below, floating islands with paved towns on them,
 * and an elevated line looping through it all.
 *
 * Draw calls, by design: sky 1, cloud sea 1, puffs 1, every island 1, every
 * building, tree, lamp and the line 1.
 */

const CABINET_OFFSET = CABINET.back + 0.02;
const SEAT_OFFSET = CABINET_OFFSET + CABINET.front + 0.5;
const EYE_HEIGHT = 1.45;
const CAMERA_BEHIND_STOOL = 0.55;

// Walkable tops are flat (dome 0): the player stands at y = 0 on the home island.
const HOME = { x: 0, y: -0.02, z: 0, radius: 28, depth: 30, seed: 3, top: 'town', segments: 40, dome: 0 };

/** The places, each on its own island. Tops are at `y`. */
const TOWN = { x: 96, y: -12, z: -88, radius: 40, depth: 34, stretch: 1.25, seed: 21, top: 'town', segments: 44, dome: 0 };
const TERRACE = { x: 78, y: -6, z: -104, radius: 15, depth: 6.5, seed: 27, top: 'town', segments: 30, dome: 0 };
const BEACON = { x: 34, y: 20, z: -205, radius: 27, depth: 26, seed: 23, top: 'town', segments: 36, dome: 0 };
const GARDEN = { x: -98, y: 10, z: -52, radius: 16, depth: 18, seed: 22, top: 'meadow', segments: 30 };
const VILLAGE = { x: -132, y: -16, z: 84, radius: 23, depth: 24, seed: 26, top: 'town', segments: 34, dome: 0 };
const ISLES = [
  { x: 146, y: 4, z: 44, radius: 12, depth: 14, seed: 25, top: 'grass' },
  { x: -64, y: -26, z: -168, radius: 13, depth: 15, seed: 24, top: 'meadow' },
];

/** Far islands: silhouettes in the haze. */
const FAR = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 + 0.3;
  const d = 330 + ((i * 73) % 5) * 60;
  return { x: Math.cos(a) * d, y: -30 + ((i * 37) % 7) * 12, z: Math.sin(a) * d, radius: 22 + ((i * 29) % 4) * 11, depth: 20, seed: 50 + i, top: i % 3 ? 'town' : 'meadow', segments: 16 };
});

/** The line, as a loop (x, y, z): home station, across the town, the lighthouse, and round. */
const LINE = [
  [21, 0.35, 18],
  [21, 0.35, -10],
  [40, 2, -42],
  [66, -11.65, -70],
  [96, -11.65, -80],
  [124, -11.65, -96],
  [142, -4, -136],
  [98, 14, -190],
  [48, 20.35, -210],
  [14, 20.35, -214],
  [-30, 12, -192],
  [-72, -4, -140],
  [-104, 8, -84],
  [-74, 10, -18],
  [-34, 5, 42],
  [4, 1, 48],
];

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Houses packed around a centre in rough streets, never on the line. */
function cluster({ x, y, z, count, spread, seed, stretch = 1, floors = [2, 4], avoid = () => false }) {
  const r = seeded(seed);
  const houses = [];
  let tries = 0;
  while (houses.length < count && tries < count * 30) {
    tries += 1;
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * spread;
    const hx = x + Math.cos(a) * d * stretch;
    const hz = z + Math.sin(a) * d;
    const w = 5 + r() * 3;
    const dd = 4.5 + r() * 2.5;
    if (avoid(hx, hz)) continue;
    if (houses.some((o) => Math.hypot(o.x - hx, o.z - hz) < (Math.max(o.w, o.d) + Math.max(w, dd)) * 0.55)) continue;
    // Streets: houses square to one another, with a little hand-made slop.
    houses.push({
      x: hx,
      y,
      z: hz,
      w,
      d: dd,
      floors: floors[0] + Math.floor(r() * (floors[1] - floors[0] + 1)),
      turn: Math.round(r() * 2) * (Math.PI / 2) + (r() - 0.5) * 0.06,
      wall: WALLS[Math.floor(r() * WALLS.length)],
      roof: ROOFS[Math.floor(r() * ROOFS.length)],
    });
  }
  return houses;
}

function scatter({ x, y, z, count, spread, seed, minD = 0, stretch = 1, avoid = () => false }, make) {
  const r = seeded(seed);
  const out = [];
  for (let i = 0; i < count * 8 && out.length < count; i += 1) {
    const a = r() * Math.PI * 2;
    const d = minD + Math.sqrt(r()) * (spread - minD);
    const px = x + Math.cos(a) * d * stretch;
    const pz = z + Math.sin(a) * d;
    if (!avoid(px, pz)) out.push(make(px, y, pz, r));
  }
  return out;
}

const pineAt = (px, py, pz, r) => ({ x: px, y: py, z: pz, height: 5.5 + r() * 3.5, lean: r() * 0.8, seed: Math.floor(r() * 100) });

function layout(avoidLine, quality, curve) {
  // The corridor the camera looks down from the spawn stays open.
  const view = (px, pz) => pz > 6 && Math.abs(px) < 12;
  const offPlaza = (px, pz) => Math.hypot(px, pz - 2) < 14 || avoidLine(px, pz) || view(px, pz);
  const onTerrace = (px, pz) => Math.hypot(px - TERRACE.x, pz - TERRACE.z) < TERRACE.radius + 4;
  const houses = [
    ...cluster({ x: -6, y: 0, z: -8, count: 9, spread: 21, seed: 101, floors: [2, 3], avoid: (px, pz) => offPlaza(px, pz) || Math.hypot(px, pz) > 22 || pz > 4 }),
    ...cluster({ x: TOWN.x, y: TOWN.y, z: TOWN.z, count: 34, spread: TOWN.radius * 0.8, stretch: TOWN.stretch, seed: 102, avoid: (px, pz) => avoidLine(px, pz) || onTerrace(px, pz) }),
    ...cluster({ x: TERRACE.x, y: TERRACE.y, z: TERRACE.z, count: 6, spread: TERRACE.radius * 0.7, seed: 106, floors: [2, 3], avoid: avoidLine }),
    ...cluster({ x: BEACON.x + 8, y: BEACON.y, z: BEACON.z + 6, count: 10, spread: BEACON.radius * 0.72, seed: 103, avoid: (px, pz) => avoidLine(px, pz) || Math.hypot(px - (BEACON.x - 12), pz - (BEACON.z - 12)) < 7 }),
    ...cluster({ x: VILLAGE.x, y: VILLAGE.y, z: VILLAGE.z, count: 12, spread: VILLAGE.radius * 0.8, seed: 104, avoid: avoidLine }),
    ...cluster({ x: ISLES[0].x, y: ISLES[0].y, z: ISLES[0].z, count: 3, spread: 7, seed: 105, floors: [1, 2], avoid: avoidLine }),
  ];
  const clear = (px, pz) => houses.some((h) => Math.hypot(h.x - px, h.z - pz) < 4.5);
  const pines = [
    ...scatter({ x: 0, y: 0, z: 0, count: 10, spread: 25, minD: 16, seed: 201, avoid: (px, pz) => avoidLine(px, pz) || view(px, pz) || clear(px, pz) }, pineAt),
    ...scatter({ x: TOWN.x, y: TOWN.y, z: TOWN.z, count: 18, spread: TOWN.radius * 0.95, stretch: TOWN.stretch, seed: 202, avoid: (px, pz) => avoidLine(px, pz) || onTerrace(px, pz) || clear(px, pz) }, pineAt),
    ...scatter({ x: TERRACE.x, y: TERRACE.y, z: TERRACE.z, count: 3, spread: TERRACE.radius * 0.8, seed: 207, avoid: clear }, pineAt),
    ...scatter({ x: GARDEN.x, y: GARDEN.y, z: GARDEN.z, count: 8, spread: GARDEN.radius * 0.8, seed: 203, avoid: avoidLine }, pineAt),
    ...scatter({ x: BEACON.x, y: BEACON.y, z: BEACON.z, count: 8, spread: BEACON.radius * 0.9, seed: 204, avoid: (px, pz) => avoidLine(px, pz) || clear(px, pz) }, pineAt),
    ...scatter({ x: VILLAGE.x, y: VILLAGE.y, z: VILLAGE.z, count: 7, spread: VILLAGE.radius * 0.9, seed: 208, avoid: clear }, pineAt),
    ...scatter({ x: ISLES[1].x, y: ISLES[1].y, z: ISLES[1].z, count: 5, spread: 9, seed: 205 }, pineAt),
  ];
  const bushes = [
    ...scatter({ x: 0, y: 0, z: 2, count: 18, spread: 17, minD: 13, seed: 301, avoid: (px, pz) => avoidLine(px, pz) || (pz > 12 && Math.abs(px) < 5) }, (px, py, pz, r) => ({ x: px, y: py, z: pz, size: 0.6 + r() * 0.6, colour: r() > 0.7 ? '#8fb86a' : '#6a9a55' })),
    ...scatter({ x: GARDEN.x, y: GARDEN.y, z: GARDEN.z, count: 16, spread: GARDEN.radius * 0.9, seed: 302 }, (px, py, pz, r) => ({ x: px, y: py, z: pz, size: 0.8 + r(), colour: r() > 0.6 ? '#b8c77a' : '#7aa85e' })),
    ...scatter({ x: ISLES[1].x, y: ISLES[1].y, z: ISLES[1].z, count: 8, spread: 10, seed: 303 }, (px, py, pz, r) => ({ x: px, y: py, z: pz, size: 0.8 + r() * 0.8 })),
  ];
  // Lamps round the home plaza, and beside the line wherever it crosses a paved island.
  const lamps = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    return { x: Math.cos(a) * 11.5, y: 0, z: 2 + Math.sin(a) * 11.5 };
  }).filter((l) => !avoidLine(l.x, l.z) && !view(l.x, l.z));
  const tops = [HOME, TOWN, BEACON];
  for (let i = 0; i < 160; i += 1) {
    const t = i / 160;
    const p = curve.getPointAt(t);
    const island = tops.find((s) => Math.abs(p.y - s.y - 0.35) < 0.3 && Math.hypot((p.x - s.x) / (s.stretch ?? 1), p.z - s.z) < s.radius * 0.8);
    if (!island || i % 3) continue;
    const side = curve.getTangentAt(t).cross(new Vector3(0, 1, 0)).normalize();
    lamps.push({ x: p.x + side.x * 3.6, y: island.y, z: p.z + side.z * 3.6 });
  }
  return {
    houses,
    pines,
    bushes,
    lighthouses: [{ x: BEACON.x - 12, y: BEACON.y, z: BEACON.z - 12, height: 26 }],
    lamps,
    railway: { curve, sleeperEvery: quality.sleeperEvery },
  };
}

/**
 * Rock spikes that hold the line up where it is out over the cloud: a slim
 * inverted cone with a grassy top just under the girder, every 60 m or so.
 */
function spikes(curve, islands) {
  const out = [];
  const count = Math.floor(curve.getLength() / 60);
  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    const p = curve.getPointAt(t);
    const overIsland = islands.some((s) => Math.hypot((p.x - s.x) / (s.stretch ?? 1), p.z - s.z) < s.radius + 8);
    if (overIsland) continue;
    out.push({ x: p.x, y: p.y - 1.2, z: p.z, radius: 3.2 + (i % 3) * 0.6, depth: 11 + (i % 4) * 2, seed: 400 + i, top: 'meadow', segments: 12, dome: 0.3 });
  }
  return out;
}

/** Clouds up in the sky: small painted clusters, as in the film; the sea below carries the rest. */
function cloudPuffs(density = 1) {
  const puffs = [];
  const r = seeded(7);
  for (let i = 0; i < Math.round(22 * density); i += 1) {
    const a = r() * Math.PI * 2;
    const d = 250 + r() * 650;
    puffs.push({ x: Math.cos(a) * d, y: 110 + r() * 170, z: Math.sin(a) * d, w: 50 + r() * 70 });
  }
  return puffs;
}

/**
 * The cloud field lying on the sea: painted billows on a jittered grid, thick
 * near the islands and thinning out to open water towards the horizon.
 */
function cloudField(density = 1) {
  const out = [];
  const r = seeded(99);
  const step = 64 / Math.sqrt(density);
  for (let x = -1500; x <= 1500; x += step) {
    for (let z = -1500; z <= 1500; z += step) {
      const d = Math.hypot(x, z);
      // Open water shows through: fewer clouds with distance, and gaps everywhere.
      if (r() > 0.5 - d / 3400) continue;
      out.push({ x: x + (r() - 0.5) * step, y: -64 + r() * 10, z: z + (r() - 0.5) * step, w: 55 + r() * 95 + d * 0.04 });
    }
  }
  return out;
}

function contactShadows(spots) {
  const texture = contactShadowTexture();
  const planes = spots.map(({ x, z, w, d }) => {
    const plane = new PlaneGeometry(w, d);
    plane.rotateX(-Math.PI / 2);
    plane.translate(x, 0.05, z);
    return plane;
  });
  return new Mesh(mergeGeometries(planes), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
}

export function createWorld({ time = 'dusk', quality = { detail: 1, clouds: 1, leaf: 1, octaves: 4, sleeperEvery: 2.2 } } = {}) {
  const palette = paletteFor(time);
  const group = new Group();

  group.add(new HemisphereLight(palette.hemiSky, palette.hemiGround, palette.hemiIntensity));
  const sun = new DirectionalLight(palette.sun, palette.sunIntensity);
  sun.position.set(...palette.sunDirection).multiplyScalar(100);
  group.add(sun);

  const curve = new CatmullRomCurve3(LINE.map(([x, y, z]) => new Vector3(x, y, z)), true, 'centripetal');
  const places = [HOME, TOWN, TERRACE, BEACON, GARDEN, VILLAGE, ...ISLES];
  const sky = createSky(palette);
  const clouds = createClouds(palette, { sky: cloudPuffs(quality.clouds), field: cloudField(quality.clouds) }, quality);
  // Island smoothness scales with quality; the shapes themselves never change.
  const islands = createIslands(
    [...places, ...spikes(curve, places), ...FAR].map((spec) => ({ ...spec, segments: Math.max(10, Math.round((spec.segments ?? 28) * quality.detail)) })),
  );

  // Nothing is built within 6 m of the line.
  const samples = Array.from({ length: 400 }, (_, i) => curve.getPointAt(i / 400));
  const avoidLine = (px, pz) => samples.some((p) => Math.hypot(px - p.x, pz - p.z) < 6);
  const town = createTown(layout(avoidLine, quality, curve), palette, quality);
  group.add(sky.mesh, clouds.sea, clouds.field, islands, town.mesh, clouds.puffs);

  // The PINGO pair stays for now, on the plaza, as the place games are played.
  const cabinetA = createCabinet();
  cabinetA.group.position.z = -CABINET_OFFSET;
  cabinetA.group.rotation.y = Math.PI;
  const cabinetB = createCabinet();
  cabinetB.group.position.z = CABINET_OFFSET;
  group.add(
    cabinetA.group,
    cabinetB.group,
    contactShadows([
      { x: 0, z: -CABINET_OFFSET, w: 0.95, d: 0.95 },
      { x: 0, z: CABINET_OFFSET, w: 0.95, d: 0.95 },
    ]),
  );

  const screenZ = CABINET_OFFSET + CABINET.screen.z;
  const seats = [-1, 1].map((side, index) => ({
    id: index === 0 ? 'A' : 'B',
    position: [0, EYE_HEIGHT, side * (SEAT_OFFSET + CAMERA_BEHIND_STOOL)],
    lookAt: [0, 1.3, side * screenZ],
    stool: [0, side * SEAT_OFFSET],
    standAt: [0.95, side * SEAT_OFFSET],
    facing: side < 0 ? Math.PI : 0,
  }));
  const lidZ = CABINET_OFFSET + CABINET.lid.z;
  const domes = createDomeLights([
    [0, CABINET.lid.y, -lidZ],
    [0, CABINET.lid.y, lidZ],
  ]);
  group.add(domes.group);

  const reach = CABINET_OFFSET + CABINET.front;
  const colliders = [[-0.4, -reach, 0.4, reach]];

  return {
    group,
    palette,
    curve,
    cabinets: [cabinetA, cabinetB],
    seats,
    domes,
    colliders,
    /** Walkable: inside the home island's edge. */
    bounds: { minX: -16, maxX: 16, minZ: -16, maxZ: 16 },
    spawn: { x: 0, z: 11, facing: Math.PI },
    inside: () => false,
    cameraBox: { minX: -16, maxX: 16, maxZ: 16 },
    ready: Promise.all([cabinetA.ready, cabinetB.ready]),

    /** Once a frame, like the room: nothing opens here. */
    update() {
      return false;
    },

    /** Sky and clouds follow the camera and drift. */
    tick(camera, seconds) {
      sky.update(camera, seconds);
      clouds.update(camera, seconds);
    },
  };
}
