import {
  Bone,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Group,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three';
import { box, createBuilder } from '../builder.js';
import { CARRIAGE, GAUGE, TRAM_COLOURS } from './contract.js';

/**
 * The film's open carriage: a salmon wooden frame of arched, glassless
 * openings over a big, finely ribbed silver panel that carries the whole side,
 * a slim green band under the sill and a dark green skirt below, a gold-brown
 * name board, a rounded green nose with two headlamps at each end, and a green
 * sliding door with fold-out steps in the middle of each side. Teal benches
 * inside face the doors, under a ceiling panel that glows at dusk.
 *
 * Draw calls: two. Everything except the headlamp glass is ONE skinned mesh;
 * the doors, steps and wheels are its bones, so they can still be moved as
 * ordinary Object3Ds without each costing a draw call. The glass is a second
 * mesh so its emissive can follow the night.
 *
 * Layout (local space, see contract.js): green skirt y 0.12..0.34, silver
 * panel 0.34..1.42, green band to the 1.55 waist sill, open frame
 * 1.55..wallTop, floor at 0.76.
 */

const { length: L, width: W, wallTop: TOP } = CARRIAGE;
const HW = W / 2;
const HL = L / 2;
/** How far the rounded nose reaches past the straight sides. */
const NOSE = 1.0;
/** Straight-side half length; the 0.05 keeps the bellied nose inside the length. */
const ZS = HL - NOSE - 0.05;
const WAIST = 1.55;
const FLOOR_Y = 0.76;
/** Half the doorway, along z. */
const DOOR = 0.55;
/** Rail-top clearance under the skirt. */
const SKIRT_BOTTOM = 0.12;

const col = (hex) => new Color(hex);
const C = Object.fromEntries(Object.entries(TRAM_COLOURS).map(([k, v]) => [k, col(v)]));
const FLOOR_WOOD = col('#8f6446');
const SEAT_BACK = col('#2f6f74');
const SKIRT_DARK = col('#8d918d');
const GREEN_RIB = C.bodyGreen.clone().multiplyScalar(0.86);
const LETTERING = col('#e6cf8a');

const identity = (x, y, z) => [x, y, z];

/**
 * A closed loop round the car at outset `o` from the base outline: the right
 * side, the front nose (half ellipse), the left side, the back nose. Points
 * carry `side: true` on the straight sides so the doorway can be skipped.
 */
function outline(o, step, endSegs) {
  const pts = [];
  const sideZ = [];
  const run = (a, b) => {
    const n = Math.max(1, Math.ceil((b - a) / step));
    for (let i = 0; i < n; i += 1) sideZ.push(a + ((b - a) * i) / n);
  };
  run(-ZS, -DOOR);
  run(-DOOR, DOOR);
  run(DOOR, ZS);
  const hx = HW + o;
  const rz = NOSE + o;
  for (const z of sideZ) pts.push({ x: hx, z, side: true });
  for (let i = 0; i < endSegs; i += 1) {
    const a = (Math.PI * i) / endSegs;
    pts.push({ x: hx * Math.cos(a), z: ZS + rz * Math.sin(a), side: i === 0 });
  }
  for (const z of sideZ) pts.push({ x: -hx, z: -z, side: true });
  for (let i = 0; i < endSegs; i += 1) {
    const a = Math.PI + (Math.PI * i) / endSegs;
    pts.push({ x: hx * Math.cos(a), z: -ZS + rz * Math.sin(a), side: i === 0 });
  }
  return pts;
}

/** True when the segment p-q is the doorway gap on either side. */
const inDoorway = (p, q) =>
  p.side && q.side && Math.abs(p.x) === Math.abs(q.x) && Math.abs((p.z + q.z) / 2) < DOOR - 1e-6 && Math.abs(p.z - q.z) > 1e-6;

/**
 * A ribbed barrel surface: rows of the outline at [y, outset], quads between
 * them, alternating two colours per segment so it reads as fine vertical ribs.
 */
function ribbedSurface(k, rows, [c1, c2], step, endSegs) {
  const rings = rows.map(([, o]) => outline(o, step, endSegs));
  const n = rings[0].length;
  for (let r = 0; r + 1 < rows.length; r += 1) {
    const [y0] = rows[r];
    const [y1] = rows[r + 1];
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const a = rings[r][i];
      const b = rings[r][j];
      if (inDoorway(a, b)) continue;
      const c = rings[r + 1][j];
      const d = rings[r + 1][i];
      k.quad([a.x, y0, a.z], [b.x, y0, b.z], [c.x, y1, c.z], [d.x, y1, d.z], i % 2 ? c2 : c1);
    }
  }
}

/** A flat fan over the whole (convex) outline at height y. */
function fan(k, y, o, endSegs, colour) {
  const ring = outline(o, 1e9, endSegs);
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    k.tri([0, y, 0], [b.x, y, b.z], [a.x, y, a.z], [], colour);
  }
}

/**
 * A cylinder along x or z (wheels, lamp housings): a rim and optional caps.
 * `cap0`/`cap1` add a disc at the start/end of the axis.
 */
function cylinder(k, [cx, cy, cz], axis, r, h0, h1, segs, colour, { cap0 = false, cap1 = false, rim = true } = {}) {
  const p = (a, h) => {
    const u = Math.cos(a) * r;
    const v = Math.sin(a) * r;
    return axis === 'x' ? [cx + h, cy + v, cz + u] : [cx + u, cy + v, cz + h];
  };
  const centre = (h) => (axis === 'x' ? [cx + h, cy, cz] : [cx, cy, cz + h]);
  for (let i = 0; i < segs; i += 1) {
    const a0 = (2 * Math.PI * i) / segs;
    const a1 = (2 * Math.PI * (i + 1)) / segs;
    if (rim) k.quad(p(a0, h0), p(a1, h0), p(a1, h1), p(a0, h1), colour);
    if (cap0) k.tri(centre(h0), p(a1, h0), p(a0, h0), [], colour);
    if (cap1) k.tri(centre(h1), p(a0, h1), p(a1, h1), [], colour);
  }
}

/**
 * One arched opening in the frame, between wall points p0 and p1 ([x, z]):
 * a solid spandrel from the arch curve up to the top rail, and the arch's
 * underside so it has depth from below.
 */
function arch(k, p0, p1, segs, colour) {
  const yt = TOP - 0.15;
  const ys = TOP - 0.34;
  const ya = yt - 0.07;
  const dx = p1[0] - p0[0];
  const dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz);
  const nx = (dz / len) * 0.045;
  const nz = (-dx / len) * 0.045;
  const at = (t) => {
    const x = p0[0] + dx * t;
    const z = p0[1] + dz * t;
    // A shouldered arch: steep near the posts, flat under the rail.
    const y = ys + (ya - ys) * Math.sin(Math.PI * t) ** 0.45;
    return [x, y, z];
  };
  for (let i = 0; i < segs; i += 1) {
    const a = at(i / segs);
    const b = at((i + 1) / segs);
    k.quad(a, b, [b[0], yt, b[2]], [a[0], yt, a[2]], colour);
    const under = colour.clone().multiplyScalar(0.8);
    k.quad([a[0] - nx, a[1], a[2] - nz], [b[0] - nx, b[1], b[2] - nz], [b[0] + nx, b[1], b[2] + nz], [a[0] + nx, a[1], a[2] + nz], under);
  }
}

/**
 * Builds the carriage (see contract.js for the CarParts shape).
 *
 * Animating: `doors[i].position.z += doors[i].userData.slide * t` opens a door
 * (slide it open before folding its steps: the stowed steps sit behind the
 * leaf); `steps[i].rotation.x = steps[i].userData.fold * t` folds a step out
 * (rotation order is YXZ, the yaw faces it outward); wheels spin on rotation.x.
 */
export function buildCarriage({ detail = 2, glow = 0 } = {}) {
  const d = Math.max(0, Math.min(3, Math.round(detail)));
  const step = [0.8, 0.5, 0.3, 0.2][d];
  const endSegs = [4, 6, 8, 10][d];
  const archSegs = [2, 3, 4, 5][d];
  const lampSegs = [6, 8, 10, 12][d];
  const wheelSegs = [6, 8, 8, 10][d];

  const group = new Group();
  group.name = 'carriage';

  // A builder that also records which bone owns each vertex.
  const b = createBuilder();
  const skin = [];
  let bone = 0;
  const k = {
    tri(p, q, r, uvs, colour) {
      b.tri(p, q, r, [[0.08, 0.2], [0.08, 0.2], [0.08, 0.2]], colour);
      skin.push(bone, bone, bone);
    },
    quad(p, q, r, s, colour) {
      b.quad(p, q, r, s, colour);
      skin.push(bone, bone, bone, bone, bone, bone);
    },
  };
  const bones = [new Bone()];
  const addBone = (x, y, z) => {
    const bn = new Bone();
    bn.position.set(x, y, z);
    bones[0].add(bn);
    bones.push(bn);
    bone = bones.length - 1;
    return bn;
  };

  // --- Shell (bone 0) ------------------------------------------------------

  // Ribbed silver skirt, bellied like a barrel, then the rounded green body.
  // Dark green under the floor, then the big ribbed silver panel that carries
  // the whole side up to a slim green band under the sill (as in the film).
  ribbedSurface(k, [[SKIRT_BOTTOM, -0.09], [0.34, -0.02]], [C.bodyGreenDark, GREEN_RIB], step, endSegs);
  ribbedSurface(k, [[0.34, -0.02], [0.8, 0.05], [1.2, 0.04], [1.42, 0]], [C.skirtSilver, SKIRT_DARK], step, endSegs);
  ribbedSurface(k, [[1.42, 0], [WAIST, -0.02]], [C.bodyGreen, GREEN_RIB], step, endSegs);

  // Underplate, floor, and the green deck on top of each nose.
  fan(k, SKIRT_BOTTOM, -0.09, endSegs, C.iron);
  fan(k, FLOOR_Y, -0.12, endSegs, FLOOR_WOOD);
  const deckRing = outline(-0.02, 1e9, endSegs);
  // The coarse ring has 3 points per side, so each nose arc starts after one.
  for (const s of [1, -1]) {
    const ring = deckRing;
    const start = s > 0 ? 3 : 6 + endSegs;
    for (let i = 0; i < endSegs; i += 1) {
      const a = ring[start + i];
      const q = ring[(start + i + 1) % ring.length];
      k.tri([0, WAIST, s * ZS], [q.x, WAIST, q.z], [a.x, WAIST, a.z], [], C.bodyGreenDark);
    }
  }

  // Salmon waist sills along both sides, split at the doorway, and a dark
  // back wall in each doorway so the space under the floor is not seen.
  for (const sx of [1, -1]) {
    for (const [z0, z1] of [[-ZS, -DOOR], [DOOR, ZS]]) {
      k.quad([sx * (HW - 0.14), WAIST, z0], [sx * (HW - 0.14), WAIST, z1], [sx * (HW + 0.02), WAIST, z1], [sx * (HW + 0.02), WAIST, z0], C.frameWood);
    }
    k.quad([sx * (HW - 0.3), SKIRT_BOTTOM, -DOOR], [sx * (HW - 0.3), SKIRT_BOTTOM, DOOR], [sx * (HW - 0.3), FLOOR_Y, DOOR], [sx * (HW - 0.3), FLOOR_Y, -DOOR], C.bodyGreenDark);
  }

  // The wooden frame: posts, top rails, arched openings.
  const postX = HW - 0.07;
  const posts = [0, 1, 2, 3].map((i) => DOOR + ((ZS - DOOR) * i) / 3);
  const postH = (TOP - 0.15 - WAIST) / 2;
  for (const sx of [1, -1]) {
    for (const pz of posts) {
      for (const sz of [1, -1]) {
        box(k, identity, { cx: sx * postX, cy: WAIST + postH, cz: sz * pz, sx: 0.05, sy: postH, sz: 0.05 }, C.frameWood);
      }
    }
    box(k, identity, { cx: sx * postX, cy: TOP - 0.075, cz: 0, sx: 0.06, sy: 0.075, sz: ZS + 0.06 }, C.frameWood);
    box(k, identity, { cx: 0, cy: TOP - 0.075, cz: sx * ZS, sx: postX + 0.06, sy: 0.075, sz: 0.06 }, C.frameWood);
    box(k, identity, { cx: 0, cy: WAIST + postH, cz: sx * ZS, sx: 0.05, sy: postH, sz: 0.05 }, C.frameWood);
    const openings = [[-DOOR, DOOR], ...[0, 1, 2].flatMap((i) => [[posts[i], posts[i + 1]], [-posts[i + 1], -posts[i]]])];
    for (const [z0, z1] of openings) arch(k, [sx * postX, z0 + 0.05], [sx * postX, z1 - 0.05], archSegs, C.frameWood);
    arch(k, [-postX + 0.05, sx * ZS], [-0.05, sx * ZS], archSegs, C.frameWood);
    arch(k, [0.05, sx * ZS], [postX - 0.05, sx * ZS], archSegs, C.frameWood);
  }

  // Teal benches, one per bay, their backs to the ends so riders face the doors.
  for (const sx of [1, -1]) {
    for (let i = 0; i < 3; i += 1) {
      for (const sz of [1, -1]) {
        const mid = sz * (posts[i] + posts[i + 1]) / 2;
        const cx = sx * 0.78;
        box(k, identity, { cx, cy: 1.15, cz: mid, sx: 0.42, sy: 0.05, sz: 0.22 }, C.seatTeal);
        box(k, identity, { cx, cy: 1.45, cz: mid + sz * 0.3, sx: 0.42, sy: 0.3, sz: 0.04 }, SEAT_BACK);
        if (d >= 2) box(k, identity, { cx, cy: 0.95, cz: mid, sx: 0.36, sy: 0.19, sz: 0.14 }, C.bodyGreenDark);
      }
    }
  }

  // Gold-brown name boards on the skirt, and brass grab rails at the waist.
  for (const sx of [1, -1]) {
    const bz = sx * 2.3;
    box(k, identity, { cx: sx * (HW + 0.02), cy: 0.62, cz: bz, sx: 0.03, sy: 0.14, sz: 1.0 }, C.nameBoard);
    if (d >= 2) {
      for (let i = 0; i < 6; i += 1) {
        const z = bz - 0.62 + i * 0.25;
        const x = sx * (HW + 0.056);
        k.quad([x, 0.57, z - 0.08], [x, 0.57, z + 0.08], [x, 0.67, z + 0.08], [x, 0.67, z - 0.08], LETTERING);
      }
      for (const [z0, z1] of [[-ZS + 0.3, -DOOR - 0.15], [DOOR + 0.15, ZS - 0.3]]) {
        box(k, identity, { cx: sx * (HW + 0.1), cy: 1.3, cz: (z0 + z1) / 2, sx: 0.02, sy: 0.02, sz: (z1 - z0) / 2 }, C.brass);
      }
    }
  }

  // Brass headlamp housings on each nose; their glass goes on the lamp mesh.
  const lampB = createBuilder();
  const lampK = { tri: (p, q, r, _u, c) => lampB.tri(p, q, r, [[0.42, 0.62], [0.42, 0.62], [0.42, 0.62]], c), quad: lampB.quad };
  const lights = [];
  const LAMP_Y = 1.12;
  for (const sz of [1, -1]) {
    for (const sx of [1, -1]) {
      const x = sx * 0.7;
      const z = sz * (HL - 0.04);
      cylinder(k, [x, LAMP_Y, z], 'z', 0.14, -sz * 0.16, sz * 0.02, lampSegs, C.brass);
      cylinder(lampK, [x, LAMP_Y, z], 'z', 0.11, sz * 0.03, sz * 0.03, lampSegs, C.lanternWhite, { rim: false, cap1: true });
      lights.push([x, LAMP_Y, sz * HL]);
    }
    if (d >= 1) box(k, identity, { cx: 0, cy: 0.3, cz: sz * (HL - 0.12), sx: 0.9, sy: 0.07, sz: 0.1 }, C.iron);
  }

  // A warm ceiling panel down the middle: the lit interior seen through the
  // open sides at dusk, as in the film. It lives on the lamp mesh, so it
  // brightens with the hour.
  const CEIL = TOP - 0.17;
  for (const sx of [1, -1]) {
    lampK.quad([sx * 0.12, CEIL, -ZS], [sx * 0.12, CEIL, ZS], [sx * 0.55, CEIL, ZS], [sx * 0.55, CEIL, -ZS], C.lanternWhite);
  }

  // Bogie frames under the skirt (visible from below).
  const BOGIE_Z = 2.8;
  const WHEELBASE = 0.7;
  if (d >= 2) {
    for (const sz of [1, -1]) box(k, identity, { cx: 0, cy: 0.42, cz: sz * BOGIE_Z, sx: GAUGE / 2 - 0.1, sy: 0.08, sz: WHEELBASE + 0.35 }, C.iron);
  }

  // --- Moving parts (one bone each) ----------------------------------------

  const doors = [];
  const steps = [];
  const wheels = [];

  // Door leaves: outside the body, centred on the doorway, closed at rest.
  for (const sx of [1, -1]) {
    const x = sx * (HW + 0.07);
    const door = addBone(x, 0, 0);
    door.name = 'door';
    door.userData.slide = 1.15;
    doors.push(door);
    box(k, identity, { cx: x, cy: 0.88, cz: 0, sx: 0.03, sy: 0.73, sz: DOOR }, C.bodyGreen);
    for (const sz of [1, -1]) {
      box(k, identity, { cx: x, cy: 2.17, cz: sz * (DOOR - 0.05), sx: 0.03, sy: 0.56, sz: 0.05 }, C.bodyGreenDark);
    }
    box(k, identity, { cx: x, cy: 2.68, cz: 0, sx: 0.03, sy: 0.05, sz: DOOR }, C.bodyGreenDark);
    // Leaf emblem: a pointed lens with a pale vein.
    const ex = sx * (HW + 0.105);
    const top = [ex, 1.28, 0];
    const bot = [ex, 0.82, 0];
    k.quad(bot, [ex, 1.0, -sx * 0.13], top, [ex, 1.06, sx * 0.13], C.leafGreen);
    if (d >= 2) k.quad([ex * 1.001, 0.86, -0.012], [ex * 1.001, 0.86, 0.012], [ex * 1.001, 1.24, 0.012], [ex * 1.001, 1.24, -0.012], C.leafVein);
  }

  // Fold-out steps, stowed hanging inside the doorway recess behind the leaf.
  // Authored in their deployed pose (local z outward, y up), then rotated up
  // into the stowed pose; the bone's yaw points local z out of the car.
  for (const sx of [1, -1]) {
    const px = sx * (HW - 0.15);
    const py = 0.7;
    const yaw = (sx * Math.PI) / 2;
    const stp = addBone(px, py, 0);
    stp.name = 'step';
    stp.rotation.order = 'YXZ';
    stp.rotation.y = yaw;
    stp.userData.fold = -Math.PI / 2;
    steps.push(stp);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    // deployed (x, y, z) -> stowed (x, -z, y) -> yawed -> pivot
    const at = (x, y, z) => {
      const lx = x;
      const ly = -z;
      const lz = y;
      return [px + lx * cy + lz * sy, py + ly, -lx * sy + lz * cy];
    };
    box(k, at, { cx: 0, cy: -0.05, cz: 0.25, sx: 0.45, sy: 0.03, sz: 0.2 }, C.iron);
    box(k, at, { cx: 0, cy: -0.3, cz: 0.53, sx: 0.45, sy: 0.03, sz: 0.17 }, C.iron);
  }

  // Wheels: two bogies, four wheels each, spinning about x.
  const R = 0.36;
  for (const bz of [BOGIE_Z, -BOGIE_Z]) {
    for (const wz of [bz - WHEELBASE, bz + WHEELBASE]) {
      for (const sx of [1, -1]) {
        const wx = sx * (GAUGE / 2);
        const wheel = addBone(wx, R, wz);
        wheel.name = 'wheel';
        wheels.push(wheel);
        cylinder(k, [wx, R, wz], 'x', R, -0.05, 0.05, wheelSegs, C.iron, { cap0: true, cap1: true });
      }
    }
  }

  // --- Assemble -------------------------------------------------------------

  const geometry = b.build();
  const count = geometry.getAttribute('position').count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    skinIndex[i * 4] = skin[i];
    skinWeight[i * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));

  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const body = new SkinnedMesh(geometry, material);
  body.name = 'carriage-body';
  body.add(bones[0]);
  group.add(body);
  group.updateMatrixWorld(true);
  body.bind(new Skeleton(bones));

  const lampMaterial = new MeshLambertMaterial({
    vertexColors: true,
    emissive: col('#ffd98a'),
    emissiveIntensity: glow,
  });
  const lamps = new Mesh(lampB.build(), lampMaterial);
  lamps.name = 'carriage-lamps';
  group.add(lamps);
  group.userData.lampMaterial = lampMaterial;

  const roofMount = new Object3D();
  roofMount.name = 'roof-mount';
  roofMount.position.set(0, TOP, 0);
  group.add(roofMount);

  return { group, length: L, body, roofMount, doors, steps, wheels, lights };
}
