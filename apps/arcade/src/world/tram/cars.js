import { Color, DoubleSide, Group, Mesh, MeshLambertMaterial, Object3D } from 'three';

import { createBuilder } from '../builder.js';
import { COMPANION, DRIVING_CAB, GAUGE, TRAM_COLOURS as C } from './contract.js';

/**
 * The two small cars that run in front of the film's carriage.
 *
 * The driving cab is the short brown wooden car seen leading the tram on the
 * ride: framed timber lower walls, open upper sides between slim posts, a
 * cambered planked roof with edge boards, two round headlamps low on the nose
 * and a lamp under the roof. The Little Companion is the workshop's pink car:
 * the same build in salmon wood, arched frames in every bay, a rounded dome of
 * radial slats, teal cushioned seats, a lantern and one headlamp.
 *
 * Each car is two meshes - the wooden shell (vertex colours, double sided so
 * the open interior shades correctly from any side) and the glowing lamps -
 * so two draw calls. Wheels are empty pivots: the visible wheel discs are
 * baked into the shell, where a spinning plain disc looks the same.
 */

const col = (hex, f = 1) => new Color(hex).multiplyScalar(f);

/** Box from min and max corners: top, bottom (optional) and four sides. */
function boxer(b) {
  return (x0, x1, y0, y1, z0, z1, colour, bottom = false) => {
    const side = colour.clone().multiplyScalar(0.86);
    b.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], colour);
    b.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], colour);
    b.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], colour);
    b.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side);
    b.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side);
    if (bottom) b.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], side);
  };
}

/** A square beam of width w between two points (no end caps), for arches and brackets. */
function beamer(b) {
  return (p, q, w, colour) => {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const len = Math.hypot(...d) || 1;
    d[0] /= len;
    d[1] /= len;
    d[2] /= len;
    const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const cross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
    const s = cross(d, up);
    const sl = Math.hypot(...s);
    const sx = s.map((v) => (v / sl) * (w / 2));
    const ux = cross(sx, d);
    const at = (o, i, j) => [o[0] + sx[0] * i + ux[0] * j, o[1] + sx[1] * i + ux[1] * j, o[2] + sx[2] * i + ux[2] * j];
    const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k += 1) {
      const [a, c] = [ring[k], ring[(k + 1) % 4]];
      b.quad(at(p, ...a), at(p, ...c), at(q, ...c), at(q, ...a), k % 2 ? colour.clone().multiplyScalar(0.86) : colour);
    }
  };
}

/** A round lamp or wheel: an n-sided prism along +z (or +x) with its outer cap. */
function discer(b) {
  return (cx, cy, cz, r, depth, n, colour, axis = 'z') => {
    const pt = (a, t) => {
      const u = Math.cos(a) * r;
      const v = Math.sin(a) * r;
      return axis === 'z' ? [cx + u, cy + v, cz + t] : [cx + t, cy + v, cz + u];
    };
    const sign = depth < 0 ? -1 : 1;
    const centre = axis === 'z' ? [cx, cy, cz + depth] : [cx + depth, cy, cz];
    for (let i = 0; i < n; i += 1) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      b.quad(pt(a0, 0), pt(a1, 0), pt(a1, depth), pt(a0, depth), colour.clone().multiplyScalar(0.8));
      if (sign > 0) b.tri(centre, pt(a0, depth), pt(a1, depth), [[0, 0], [0, 0], [0, 0]], colour);
      else b.tri(centre, pt(a1, depth), pt(a0, depth), [[0, 0], [0, 0], [0, 0]], colour);
    }
  };
}

/** The two meshes and the empties every car hands back. */
function assemble(shell, lamps, glow, { wallTop, wheelZ }) {
  const body = new Mesh(
    shell.build(),
    new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
  );
  const light = new Mesh(
    lamps.build(),
    new MeshLambertMaterial({
      vertexColors: true,
      emissive: new Color('#ffcf85'),
      emissiveIntensity: 0.35 + 0.9 * glow,
    }),
  );
  const group = new Group();
  group.add(body, light);
  const roofMount = new Object3D();
  roofMount.position.set(0, wallTop, 0);
  group.add(roofMount);
  const wheels = [];
  for (const z of wheelZ) {
    for (const x of [-GAUGE / 2, GAUGE / 2]) {
      const w = new Object3D();
      w.position.set(x, 0.36, z);
      group.add(w);
      wheels.push(w);
    }
  }
  return { group, body, roofMount, wheels, light };
}

/** Undercarriage shared by both cars: skirt, sill, buffer beams, couplers, wheel discs. */
function chassis(bx, disc, { hx, hz, floor, dark, sill, detail, wheelZ, frontCoupler }) {
  bx(-hx + 0.15, hx - 0.15, 0.2, floor - 0.13, -hz + 0.2, hz - 0.2, dark);
  bx(-hx, hx, floor - 0.13, floor + 0.05, -hz, hz, sill, true);
  bx(-hx + 0.1, hx - 0.1, 0.34, floor - 0.13, hz - 0.2, hz + 0.06, dark);
  bx(-hx + 0.1, hx - 0.1, 0.34, floor - 0.13, -hz - 0.06, -hz + 0.2, dark);
  const iron = col(C.iron);
  bx(-0.08, 0.08, 0.42, 0.54, -hz - 0.36, -hz - 0.06, iron);
  if (detail >= 1) bx(-0.14, 0.14, 0.38, 0.58, -hz - 0.46, -hz - 0.36, iron);
  if (frontCoupler) bx(-0.08, 0.08, 0.42, 0.54, hz + 0.06, hz + 0.3, iron);
  if (detail >= 1) {
    for (const z of wheelZ) {
      for (const s of [-1, 1]) disc(s * (GAUGE / 2 + 0.02), 0.36, z, 0.36, s * 0.1, detail >= 3 ? 12 : 8, iron, 'x');
    }
  }
}

/**
 * The film's brown driving car. It has its own planked roof; roofMount still
 * sits at the wall top so a roof from roofs.js could be swapped in if wanted.
 */
export function buildDrivingCab({ detail = 2, glow = 0 } = {}) {
  const { length, width, floor, wallTop } = DRIVING_CAB;
  const hx = width / 2;
  const hz = length / 2;
  const shell = createBuilder();
  const lamps = createBuilder();
  const bx = boxer(shell);
  const beam = beamer(shell);
  const disc = discer(shell);
  const wood = col(C.cabWood);
  const frame = col(C.cabWood, 0.72);
  const light = col(C.cabWood, 1.25);
  const roof = col(C.cabRoof);
  const brass = col(C.brass);
  const iron = col(C.iron);
  const wheelZ = [-1.7, 1.7];

  chassis(bx, disc, { hx, hz, floor, dark: col('#34261d'), sill: frame, detail, wheelZ, frontCoupler: false });

  const y0 = floor + 0.05;
  const belt = 1.72;
  const t = 0.06;
  // Lower walls: sides, nose, and the back with a gangway into the next car.
  for (const s of [-1, 1]) bx(s < 0 ? -hx : hx - t, s < 0 ? -hx + t : hx, y0, belt, -hz, hz, wood);
  bx(-hx, hx, y0, belt, hz - t, hz, wood);
  bx(-hx, -0.45, y0, belt, -hz, -hz + t, wood);
  bx(0.45, hx, y0, belt, -hz, -hz + t, wood);

  // Framed panels: stiles and rails standing proud of the boards.
  const sideStiles = [-hz, -0.92, 0.92, hz];
  if (detail >= 2) {
    const p = 0.025;
    for (const s of [-1, 1]) {
      const xo = s * (hx + p / 2);
      for (const z of sideStiles) bx(xo - p, xo + p, y0, belt, z - 0.05, z + 0.05, frame);
      for (const y of [y0 + 0.06, belt - 0.08]) bx(xo - p, xo + p, y - 0.05, y + 0.05, -hz, hz, frame);
    }
    for (const x of [-hx + 0.05, 0, hx - 0.05]) bx(x - 0.05, x + 0.05, y0, belt, hz, hz + 0.03, frame);
    for (const y of [y0 + 0.06, belt - 0.08]) bx(-hx, hx, y - 0.05, y + 0.05, hz, hz + 0.03, frame);
  }
  // Belt rail capping the lower walls.
  bx(-hx - 0.04, hx + 0.04, belt, belt + 0.08, hz - 0.1, hz + 0.05, light);
  for (const s of [-1, 1]) bx(s < 0 ? -hx - 0.04 : hx - 0.1, s < 0 ? -hx + 0.1 : hx + 0.04, belt, belt + 0.08, -hz - 0.04, hz, light);

  // Open upper: slim posts, a transom rail, and a deep header board.
  const top = wallTop;
  const header = top - 0.24;
  const post = (x, z) => bx(x - 0.05, x + 0.05, belt + 0.08, header, z - 0.05, z + 0.05, frame);
  for (const z of sideStiles) for (const s of [-1, 1]) post(s * (hx - 0.05), Math.max(-hz + 0.05, Math.min(hz - 0.05, z)));
  post(0, hz - 0.05);
  post(-0.45, -hz + 0.05);
  post(0.45, -hz + 0.05);
  const band = (ya, yb, c) => {
    for (const s of [-1, 1]) bx(s < 0 ? -hx : hx - 0.08, s < 0 ? -hx + 0.08 : hx, ya, yb, -hz, hz, c);
    bx(-hx, hx, ya, yb, hz - 0.08, hz, c);
    bx(-hx, hx, ya, yb, -hz, -hz + 0.08, c);
  };
  band(header, top, wood);
  if (detail >= 2) band(header - 0.3, header - 0.25, frame);

  // Roof: cambered planks running nose to tail, overhanging, with edge boards.
  const rx = hx + 0.18;
  const rzb = -hz - 0.1;
  const rzf = hz + 0.15;
  const camber = (x) => top + 0.1 + 0.14 * (1 - (x / rx) ** 2);
  const planks = detail >= 3 ? 12 : detail >= 1 ? 6 : 4;
  for (let i = 0; i < planks; i += 1) {
    const xa = -rx + (2 * rx * i) / planks;
    const xb = -rx + (2 * rx * (i + 1)) / planks;
    const c = i % 2 ? roof : roof.clone().multiplyScalar(1.12);
    shell.quad([xa, camber(xa), rzf], [xb, camber(xb), rzf], [xb, camber(xb), rzb], [xa, camber(xa), rzb], c);
    shell.quad([xa, top, rzf], [xb, top, rzf], [xb, camber(xb), rzf], [xa, camber(xa), rzf], frame);
    shell.quad([xb, top, rzb], [xa, top, rzb], [xa, camber(xa), rzb], [xb, camber(xb), rzb], frame);
  }
  shell.quad([-rx, top, rzb], [rx, top, rzb], [rx, top, rzf], [-rx, top, rzf], roof.clone().multiplyScalar(0.7));
  for (const s of [-1, 1]) bx(s * rx - 0.03, s * rx + 0.03, top - 0.04, camber(rx) + 0.04, rzb, rzf, light);
  if (detail >= 3) {
    // Cross battens where the planks are nailed down.
    for (const z of [rzb + 0.3, 0, rzf - 0.3]) {
      for (let i = 0; i < 6; i += 1) {
        const xa = -rx + (2 * rx * i) / 6;
        const xb = -rx + (2 * rx * (i + 1)) / 6;
        beam([xa, camber(xa) + 0.02, z], [xb, camber(xb) + 0.02, z], 0.05, frame);
      }
    }
  }

  // Two round headlamps low on the nose, and a lamp under the roof.
  const n = detail >= 2 ? 10 : 6;
  const lights = [];
  for (const x of [-0.82, 0.82]) {
    disc(x, 1.05, hz, 0.15, 0.1, n, brass);
    discer(lamps)(x, 1.05, hz + 0.1, 0.11, 0.02, n, col(C.lanternWhite));
    lights.push([x, 1.05, hz + 0.15]);
  }
  bx(-0.03, 0.03, top - 0.3, top, hz - 0.3, hz - 0.24, iron);
  boxer(lamps)(-0.09, 0.09, top - 0.52, top - 0.32, hz - 0.36, hz - 0.18, col(C.lanternWhite), true);
  bx(-0.11, 0.11, top - 0.32, top - 0.28, hz - 0.38, hz - 0.16, brass);
  lights.push([0, top - 0.42, hz - 0.27]);

  // Inside: benches along both walls and the driver's controller stand.
  if (detail >= 1) {
    for (const s of [-1, 1]) {
      const xi = s * (hx - 0.06);
      const xo = s * (hx - 0.5);
      bx(Math.min(xi, xo), Math.max(xi, xo), y0, 1.2, -hz + 0.15, 0.6, light);
      if (detail >= 2) bx(Math.min(xi, s * (hx - 0.14)), Math.max(xi, s * (hx - 0.14)), 1.2, 1.65, -hz + 0.15, 0.6, frame);
    }
  }
  if (detail >= 2) {
    bx(0.45, 0.61, y0, 1.6, hz - 0.5, hz - 0.34, iron);
    disc(0.53, 1.6, hz - 0.42, 0.14, 0.1, n, brass, 'x');
    shell.quad([0.43, 1.66, hz - 0.28], [0.63, 1.66, hz - 0.28], [0.63, 1.66, hz - 0.56], [0.43, 1.66, hz - 0.56], brass);
    beam([0.53, 1.66, hz - 0.42], [0.35, 1.76, hz - 0.3], 0.04, brass);
    bx(-0.2, 0.2, y0, 1.25, hz - 1.2, hz - 0.9, light);
  }

  const parts = assemble(shell, lamps, glow, { wallTop, wheelZ });
  return { group: parts.group, length, body: parts.body, roofMount: parts.roofMount, doors: [], steps: [], wheels: parts.wheels, lights };
}

/**
 * The Little Companion from the workshop: pink wood, arched bays, a dome of
 * radial slats, teal seats facing in pairs, a lantern and one headlamp.
 */
export function buildCompanion({ detail = 2, glow = 0 } = {}) {
  const { length, width, floor, wallTop } = COMPANION;
  const hx = width / 2;
  const hz = length / 2;
  const shell = createBuilder();
  const lamps = createBuilder();
  const bx = boxer(shell);
  const beam = beamer(shell);
  const disc = discer(shell);
  const wood = col(C.companionWood);
  const frame = col(C.companionWood, 0.8);
  const pale = col(C.companionWood, 1.1);
  const teal = col(C.seatTeal);
  const brass = col(C.brass);
  const wheelZ = [-1.35, 1.35];

  chassis(bx, disc, { hx, hz, floor, dark: col('#4a3530'), sill: frame, detail, wheelZ, frontCoupler: true });

  const y0 = floor + 0.05;
  const belt = 1.55;
  const t = 0.06;
  for (const s of [-1, 1]) bx(s < 0 ? -hx : hx - t, s < 0 ? -hx + t : hx, y0, belt, -hz, hz, wood);
  bx(-hx, -0.45, y0, belt, hz - t, hz, wood);
  bx(0.45, hx, y0, belt, hz - t, hz, wood);
  bx(-hx, -0.45, y0, belt, -hz, -hz + t, wood);
  bx(0.45, hx, y0, belt, -hz, -hz + t, wood);

  const sideStiles = [-hz, -0.77, 0.77, hz];
  if (detail >= 2) {
    const p = 0.025;
    for (const s of [-1, 1]) {
      const xo = s * (hx + p / 2);
      for (const z of sideStiles) bx(xo - p, xo + p, y0, belt, z - 0.05, z + 0.05, frame);
      bx(xo - p, xo + p, y0 + 0.02, y0 + 0.12, -hz, hz, frame);
    }
  }
  bx(-hx - 0.04, hx + 0.04, belt, belt + 0.07, hz - 0.1, hz + 0.04, pale);
  bx(-hx - 0.04, hx + 0.04, belt, belt + 0.07, -hz - 0.04, -hz + 0.1, pale);
  for (const s of [-1, 1]) bx(s < 0 ? -hx - 0.04 : hx - 0.1, s < 0 ? -hx + 0.1 : hx + 0.04, belt, belt + 0.07, -hz, hz, pale);

  // Upper frames: posts, an arch in every bay, a header rail.
  const top = wallTop;
  const header = top - 0.12;
  const yb = belt + 0.07;
  const spring = header - 0.36;
  const segs = detail >= 2 ? 4 : 2;
  const arch = (a, b) => {
    // a and b are [x, z] post centres; the arch rises from spring to the header.
    for (let i = 0; i < segs; i += 1) {
      const f0 = i / segs;
      const f1 = (i + 1) / segs;
      const y = (f) => spring + (header - spring) * Math.sin(f * Math.PI);
      const p = (f) => [a[0] + (b[0] - a[0]) * f, 0, a[1] + (b[1] - a[1]) * f];
      const [pa, pb] = [p(f0), p(f1)];
      pa[1] = y(f0);
      pb[1] = y(f1);
      beam(pa, pb, 0.06, frame);
    }
  };
  const inX = hx - 0.05;
  const inZ = hz - 0.05;
  const sidePosts = sideStiles.map((z) => Math.max(-inZ, Math.min(inZ, z)));
  for (const s of [-1, 1]) {
    for (const z of sidePosts) bx(s * inX - 0.05, s * inX + 0.05, yb, top, z - 0.05, z + 0.05, frame);
    for (let i = 0; i < sidePosts.length - 1; i += 1) arch([s * inX, sidePosts[i]], [s * inX, sidePosts[i + 1]]);
  }
  for (const zs of [-1, 1]) {
    const endPosts = [-inX, -0.45, 0.45, inX];
    for (const x of endPosts.slice(1, 3)) bx(x - 0.05, x + 0.05, yb, top, zs * inZ - 0.05, zs * inZ + 0.05, frame);
    for (let i = 0; i < 3; i += 1) arch([endPosts[i], zs * inZ], [endPosts[i + 1], zs * inZ]);
  }
  for (const s of [-1, 1]) bx(s < 0 ? -hx : hx - 0.08, s < 0 ? -hx + 0.08 : hx, header, top, -hz, hz, wood);
  bx(-hx, hx, header, top, hz - 0.08, hz, wood);
  bx(-hx, hx, header, top, -hz, -hz + 0.08, wood);

  // Dome of radial slats over a rounded-rectangle eave.
  const ax = hx + 0.15;
  const az = hz + 0.15;
  const rise = 0.5;
  const sectors = detail >= 3 ? 32 : detail >= 1 ? 20 : 12;
  const rings = detail >= 2 ? 4 : 2;
  const se = (v) => Math.sign(v) * Math.abs(v) ** 0.5; // superellipse, exponent 4
  const dome = (k, r) => {
    const a = (k / sectors) * Math.PI * 2;
    return [ax * r * se(Math.cos(a)), top + 0.06 + rise * (1 - r * r), az * r * se(Math.sin(a))];
  };
  const radii = Array.from({ length: rings + 1 }, (_, i) => i / rings);
  for (let k = 0; k < sectors; k += 1) {
    const c = k % 2 ? wood : pale;
    for (let j = 0; j < rings; j += 1) {
      const [r0, r1] = [radii[j], radii[j + 1]];
      if (j === 0) shell.tri(dome(k, 0), dome(k, r1), dome(k + 1, r1), [[0, 0], [0, 0], [0, 0]], pale);
      else shell.quad(dome(k, r0), dome(k, r1), dome(k + 1, r1), dome(k + 1, r0), c);
    }
    // Eave board around the rim.
    const [e0, e1] = [dome(k, 1), dome(k + 1, 1)];
    shell.quad([e0[0], top - 0.06, e0[2]], [e1[0], top - 0.06, e1[2]], e1, e0, frame);
    if (detail >= 2 && k % 4 === 0) {
      for (let j = 1; j < rings; j += 1) {
        const [p, q] = [dome(k, radii[j]), dome(k, radii[j + 1])];
        p[1] += 0.03;
        q[1] += 0.03;
        beam(p, q, 0.05, frame);
      }
    }
  }

  // Teal seats in facing pairs either side of the aisle.
  if (detail >= 1) {
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -hx + 0.06 : 0.35;
      const x1 = s < 0 ? -0.35 : hx - 0.06;
      for (const [za, zb, back] of [[-1.55, -1.0, -1.62], [-0.2, 0.35, 0.42], [1.0, 1.55, 1.62]]) {
        bx(x0, x1, y0, 1.12, za, zb, frame);
        bx(x0, x1, 1.12, 1.22, za, zb, teal);
        if (detail >= 2) {
          bx(x0, x1, y0, 1.72, back - 0.05, back + 0.05, frame);
          const inward = back < za ? 1 : -1;
          bx(x0 + 0.04, x1 - 0.04, 1.24, 1.66, Math.min(back + inward * 0.05, back + inward * 0.13), Math.max(back + inward * 0.05, back + inward * 0.13), teal);
        }
      }
    }
  }

  // Lantern hanging at the front of the dome, and a headlamp on the nose.
  const lights = [];
  const n = detail >= 2 ? 10 : 6;
  const lz = hz - 0.35;
  bx(-0.03, 0.03, top - 0.25, top + 0.1, lz - 0.03, lz + 0.03, col(C.iron));
  bx(-0.12, 0.12, top - 0.3, top - 0.25, lz - 0.12, lz + 0.12, brass);
  boxer(lamps)(-0.09, 0.09, top - 0.58, top - 0.3, lz - 0.09, lz + 0.09, col(C.lanternWhite), true);
  if (detail >= 1) bx(-0.1, 0.1, top - 0.63, top - 0.58, lz - 0.1, lz + 0.1, brass);
  lights.push([0, top - 0.44, lz]);
  disc(0, 1.1, hz, 0.14, 0.1, n, brass);
  discer(lamps)(0, 1.1, hz + 0.1, 0.1, 0.02, n, col(C.lanternWhite));
  lights.push([0, 1.1, hz + 0.15]);

  const parts = assemble(shell, lamps, glow, { wallTop, wheelZ });
  return { group: parts.group, length, body: parts.body, roofMount: parts.roofMount, doors: [], steps: [], wheels: parts.wheels, lights };
}
