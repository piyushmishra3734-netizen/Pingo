import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial, TorusGeometry } from 'three';

import { box, createBuilder, leaf } from '../builder.js';
import { TRAM_COLOURS } from './contract.js';

/**
 * The carriage roofs, chosen in "Build your tram": the film's Hearth leaves,
 * and two in the same spirit - Magnolia crown and Coastal canvas.
 *
 * Each roof is built for a mount `{ length, width }` with its underside at the
 * mount's y = 0, centred, the canopy overhanging the car a little and its edge
 * (scallops, petals, valance) hanging just below the mount over the windows.
 * A roof is two meshes: everything in one vertex-coloured Lambert mesh, and
 * the lantern glass in a second whose emissive follows `glow` (0 day, 1 night).
 * `group.userData.lights` lists the lantern centres in roof-local space, and
 * `group.userData.setGlow(g)` retunes the glow without a rebuild.
 */

const hex = (c) => new Color(c);
const at = (x, y, z) => [x, y, z];
const IRON = hex(TRAM_COLOURS.iron);
const BRASS = hex(TRAM_COLOURS.brass);

/** One material for every roof body; the glass material is per roof (it carries glow). */
const bodyMaterial = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });

function cube(b, [x, y, z], [sx, sy, sz], colour) {
  box(b, at, { cx: x, cy: y, cz: z, sx, sy, sz }, colour);
}

/** A leaf blob (smooth icosahedron) scaled and moved into place. */
function blob(b, [x, y, z], [sx, sy, sz], colour, detail = 0) {
  const g = leaf(detail).clone();
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  b.addGeometry(g, colour);
}

/**
 * A smooth (nu x nv) grid surface from fn(u, v) -> [x, y, z]. With `fan`, the
 * v = 0 row is one point (a disc or leaf centre), so its degenerate half is skipped.
 */
function surface(b, nu, nv, fn, colour, fan = false) {
  const pos = [];
  for (let j = 0; j <= nv; j += 1) for (let i = 0; i <= nu; i += 1) pos.push(...fn(i / nu, j / nv));
  const index = [];
  for (let j = 0; j < nv; j += 1) {
    for (let i = 0; i < nu; i += 1) {
      const a = j * (nu + 1) + i;
      const c = a + nu + 1;
      if (!(fan && j === 0)) index.push(a, a + 1, c + 1);
      index.push(a, c + 1, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  b.addGeometry(g, colour);
}

/** A square rod from p to q, sides only: rails, posts, hoops, rope. */
function beam(b, p, q, r, colour) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const len = Math.hypot(...d) || 1;
  const up = Math.abs(d[1]) / len > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
  const norm = (v) => {
    const l = Math.hypot(...v) || 1;
    return v.map((k) => (k * r) / l);
  };
  const s = norm(cross(d, up));
  const t = norm(cross(s, d));
  const c = (o, i, j) => [o[0] + s[0] * i + t[0] * j, o[1] + s[1] * i + t[1] * j, o[2] + s[2] * i + t[2] * j];
  const ring = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  for (let k = 0; k < 4; k += 1) {
    const [i0, j0] = ring[k];
    const [i1, j1] = ring[(k + 1) % 4];
    b.quad(c(p, i0, j0), c(p, i1, j1), c(q, i1, j1), c(q, i0, j0), colour);
  }
}

/** A thin flat ribbon through points (veins), widened sideways in the horizontal plane. */
function strip(b, pts, w, colour) {
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [p, q] = [pts[i], pts[i + 1]];
    const dx = q[0] - p[0];
    const dz = q[2] - p[2];
    const l = Math.hypot(dx, dz);
    const [nx, nz] = l > 1e-4 ? [(-dz / l) * w, (dx / l) * w] : [w, 0];
    b.quad([p[0] - nx, p[1], p[2] - nz], [q[0] - nx, q[1], q[2] - nz], [q[0] + nx, q[1], q[2] + nz], [p[0] + nx, p[1], p[2] + nz], colour);
  }
}

/** A round drum standing at y (bottom radius r0, top r1), with an optional lid. */
function drum(b, [x, y, z], r0, r1, h, n, colour, lid = true, lidColour = colour) {
  surface(b, n, 1, (u, v) => {
    const a = u * Math.PI * 2;
    const r = r0 + (r1 - r0) * v;
    return [x + Math.cos(a) * r, y + h * v, z - Math.sin(a) * r];
  }, colour);
  if (lid) surface(b, n, 1, (u, v) => [x + Math.cos(u * Math.PI * 2) * r1 * v, y + h, z - Math.sin(u * Math.PI * 2) * r1 * v], lidColour, true);
}

/** The flattened-dome canopy height at (x, z): flat on top, rolling over sides and ends. */
function domeTop(hw, hl, base, rise) {
  return (x, z) => {
    const sx = Math.min(1, Math.abs(x / hw));
    const sz = Math.min(1, Math.abs(z / hl));
    return base + rise * (1 - sx ** 4) * (1 - sz ** 8);
  };
}

/** The canopy shell over (hw, hl), its thin rim down to y = 0 and a ceiling at y = 0. */
function domeShell(b, hw, hl, base, top, colour, d) {
  const spread = (t) => Math.sin(((t * 2 - 1) * Math.PI) / 2);
  surface(b, [4, 6, 8, 10][d], [6, 10, 12, 16][d], (u, v) => {
    const x = spread(u) * hw;
    const z = spread(v) * hl;
    return [x, top(x, z), z];
  }, colour);
  const rim = colour.clone().multiplyScalar(0.7);
  const c = [
    [-hw, -hl],
    [hw, -hl],
    [hw, hl],
    [-hw, hl],
  ];
  for (let k = 0; k < 4; k += 1) {
    const [x0, z0] = c[k];
    const [x1, z1] = c[(k + 1) % 4];
    b.quad([x0, 0, z0], [x1, 0, z1], [x1, base, z1], [x0, base, z0], rim);
  }
  b.quad([-hw, 0, hl], [hw, 0, hl], [hw, 0, -hl], [-hw, 0, -hl], rim);
}

// --- Shared cargo ---------------------------------------------------------

/** A railed luggage rack: runners on the roof, posts, and a top rail all round. */
function rack(b, x, z0, z1, y, h, colour, d) {
  const runner = colour.clone().multiplyScalar(0.65);
  const posts = d >= 2 ? 3 : 2;
  for (const s of [-1, 1]) {
    beam(b, [s * x, y, z0], [s * x, y, z1], 0.03, runner);
    beam(b, [s * x, y + h, z0], [s * x, y + h, z1], 0.018, colour);
    for (let k = 0; k < posts; k += 1) {
      const z = z0 + ((z1 - z0) * k) / (posts - 1);
      beam(b, [s * x, y, z], [s * x, y + h, z], 0.018, colour);
    }
  }
  for (const z of [z0, z1]) {
    beam(b, [-x, y + h, z], [x, y + h, z], 0.018, colour);
    if (d >= 1) beam(b, [-x, y, z], [x, y, z], 0.03, runner);
  }
}

/** A wooden crate resting on y, with slat bands at higher detail. */
function crate(b, [x, y, z], [sx, sy, sz], colour, d) {
  cube(b, [x, y + sy, z], [sx, sy, sz], hex(colour));
  if (d >= 2) cube(b, [x, y + sy, z], [sx + 0.012, 0.03, sz + 0.012], hex(colour).multiplyScalar(0.75));
}

/** A trunk resting on y with two bands (brass by default) and a lid seam. */
function trunk(b, [x, y, z], [sx, sy, sz], colour, d, band = BRASS) {
  cube(b, [x, y + sy, z], [sx, sy, sz], hex(colour));
  cube(b, [x, y + sy * 1.3, z], [sx + 0.012, 0.018, sz + 0.012], hex(colour).multiplyScalar(0.7));
  for (const f of d >= 1 ? [-0.55, 0.55] : [0]) cube(b, [x, y + sy, z + f * sz], [sx + 0.02, sy + 0.012, 0.03], band);
}

/** A clay pot on y with a plant: leafy, or leafy with a few flowers. */
function pot(b, [x, y, z], d, flowers = null, size = 1) {
  const n = d >= 2 ? 7 : 5;
  drum(b, [x, y, z], 0.1 * size, 0.13 * size, 0.2 * size, n, hex('#b8613e'), true, hex('#4a3526'));
  const green = hex('#4f8a45');
  blob(b, [x, y + 0.3 * size, z], [0.2 * size, 0.16 * size, 0.2 * size], green);
  if (d >= 1) blob(b, [x + 0.05, y + 0.45 * size, z - 0.03], [0.11 * size, 0.14 * size, 0.11 * size], green.clone().offsetHSL(0, 0, 0.05));
  if (flowers && d >= 1) {
    for (const [dx, dz] of d >= 2 ? [[0.1, 0.06], [-0.1, 0.02], [0.02, -0.12]] : [[0, 0]]) {
      blob(b, [x + dx * size, y + 0.46 * size, z + dz * size], [0.06 * size, 0.05 * size, 0.06 * size], hex(flowers));
    }
  }
}

/**
 * A cylindrical lantern standing on y: iron foot, glass (in the glow mesh),
 * a sloped cap and a finial. Registers its glass centre as a light.
 */
function lantern(b, g, [x, y, z], glass, d, { r = 0.09, h = 0.22, trim = IRON } = {}) {
  const n = d >= 2 ? 8 : 6;
  if (d >= 1) drum(b, [x, y, z], r * 1.2, r * 1.2, 0.03, n, trim, false);
  drum(g, [x, y + 0.03, z], r, r, h, n, hex(glass), false);
  drum(b, [x, y + 0.03 + h, z], r * 1.3, r * 0.45, 0.07, n, trim);
  if (d >= 2) cube(b, [x, y + 0.13 + h, z], [0.02, 0.03, 0.02], trim);
  g.lights.push([x, y + 0.03 + h / 2, z]);
}

/** A little slatted bench facing +z, sitting on y. */
function bench(b, [x, y, z], colour, d) {
  const c = hex(colour);
  const dark = c.clone().multiplyScalar(0.75);
  cube(b, [x, y + 0.2, z], [0.32, 0.025, 0.12], c);
  for (const s of [-1, 1]) cube(b, [x + s * 0.28, y + 0.2, z], [0.025, 0.2, 0.12], dark);
  cube(b, [x, y + 0.5, z - 0.11], [0.32, 0.03, 0.02], c);
  if (d >= 2) for (const s of [-0.16, 0, 0.16]) cube(b, [x + s, y + 0.34, z - 0.11], [0.03, 0.14, 0.015], c);
}

/** A cupped petal from `o` along (dx, dz): rises at angle a0, curls down, tapers to a round tip. */
function petal(b, [ox, oy, oz], [dx, dz], { len, wid, a0, curl, cup }, colour, nu, nv) {
  const [tx, tz] = [-dz, dx];
  const [ca, sa] = [Math.cos(a0), Math.sin(a0)];
  surface(b, nu, nv, (u, v) => {
    const across = u * 2 - 1;
    const w = across * wid * Math.sin(Math.PI * (0.14 + 0.86 * v)) ** 0.7;
    const h = len * v * ca;
    const y = len * (v * sa - curl * v * v) + cup * across * across * wid;
    return [ox + dx * h + tx * w, oy + y, oz + dz * h + tz * w];
  }, colour);
}

/** A group of the two meshes, with glow and the light points. */
function finish(b, g, glow) {
  const group = new Group();
  const body = new Mesh(b.build(), bodyMaterial);
  body.name = 'roof';
  group.add(body);
  const glass = new MeshLambertMaterial({ vertexColors: true, emissive: hex('#ffc878') });
  const setGlow = (v) => {
    glass.emissiveIntensity = 0.15 + 0.85 * v;
  };
  setGlow(glow);
  const lamps = new Mesh(g.build(), glass);
  lamps.name = 'roof-glow';
  group.add(lamps);
  group.userData.lights = g.lights;
  group.userData.setGlow = setGlow;
  return group;
}

const level = (detail) => Math.max(0, Math.min(3, Math.round(detail)));

// --- Hearth leaves ----------------------------------------------------------

/**
 * The film's roof: a leaf canopy. A flat-topped green dome, round lily-pad
 * leaves lying on top, and big rounded leaves all round the edge that climb
 * the dome and curl down over the sides in a scallop, each with pale veins
 * fanning from its base. Cargo as in the workshop shots: a railed rack with a
 * crate, a brass-banded trunk and a white box; clay pots with plants and pink
 * flowers; a row of white, cream and brown lanterns towards the front; a
 * little bench at the back.
 */
function hearthLeaves({ length, width, detail = 2, glow = 0 }) {
  const d = level(detail);
  const b = createBuilder();
  const g = createBuilder();
  const hw = width / 2 + 0.08;
  const hl = length / 2 + 0.08;
  const base = 0.1;
  const top = domeTop(hw, hl, base, 0.32);
  const green = hex(TRAM_COLOURS.leafGreen);
  const vein = hex(TRAM_COLOURS.leafVein);
  const shades = [hex('#2f7a5d'), hex('#37866a'), hex('#2a6f58')];

  domeShell(b, hw, hl, base, top, green, d);

  /** One edge leaf centred on the rim at (cx, cz), facing out along (dx, dz). */
  const edgeLeaf = (cx, cz, dx, dz, rw, rv, colour, lift) => {
    const [tx, tz] = [-dz, dx];
    const inset = 0.14;
    const pointAt = (th, v, extra = 0) => {
      const l = lift + extra;
      const along = Math.cos(th) * rw * v;
      const o = Math.sin(th) * rv * v - inset;
      const x = cx + tx * along + dx * o;
      const z = cz + tz * along + dz * o;
      const y = o < 0 ? top(x, z) + 0.02 + l : base + 0.02 + l - 0.75 * o - 1.5 * o * o;
      return [x + dx * l, y, z + dz * l];
    };
    // Even sample counts, so the leaf tip (u = 0.5) is always a vertex.
    surface(b, [4, 4, 6, 6][d], d >= 1 ? 2 : 1, (u, v) => pointAt(-0.25 * Math.PI + u * 1.5 * Math.PI, v), colour, true);
    const up = Math.PI / 2;
    if (d >= 1) strip(b, (d >= 2 ? [0.1, 0.55, 0.95] : [0.1, 0.95]).map((v) => pointAt(up, v, 0.012)), 0.014, vein);
    if (d >= 2) {
      for (const s of [-1, 1]) strip(b, [pointAt(up + s * 0.5, 0.25, 0.012), pointAt(up + s * 0.75, 0.85, 0.012)], 0.01, vein);
    }
  };

  const sideStep = d >= 2 ? 0.8 : 1.05;
  const n = Math.max(4, Math.round((2 * hl) / sideStep));
  const sp = (2 * hl) / n;
  const m = Math.max(2, Math.round((2 * hw) / sideStep));
  const spx = (2 * hw) / m;
  let k = 0;
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i += 1, k += 1) edgeLeaf(s * hw, -hl + sp * (i + 0.5), s, 0, sp * 0.62, 0.38, shades[k % 3], (k % 2) * 0.014);
    for (let i = 0; i < m; i += 1, k += 1) edgeLeaf(-hw + spx * (i + 0.5), s * hl, 0, s, spx * 0.62, 0.36, shades[k % 3], (k % 2) * 0.014);
    for (const t of [-1, 1]) edgeLeaf(t * hw, s * hl, t * Math.SQRT1_2, s * Math.SQRT1_2, 0.3, 0.34, shades[(k += 1) % 3], 0.02);
  }

  // Lily-pad leaves on top, each a shallow disc with radial veins.
  const rackZ = [-3.1, 0.3];
  if (d >= 1) {
    const pads = [];
    for (let z = -hl + 0.8, i = 0; z < hl - 0.6; z += 1.3, i += 1) {
      for (const s of [-1, 1]) {
        const pz = z + (s > 0 ? 0.65 : 0);
        if (pz > rackZ[0] - 0.4 && pz < rackZ[1] + 0.4) continue;
        pads.push([s * 0.62, pz, i]);
      }
    }
    pads.forEach(([px, pz], i) => {
      const r = 0.5;
      const lift = 0.03 + (i % 3) * 0.008;
      const y = (x, z, v) => top(x, z) + lift + 0.03 * (1 - v * v);
      const colour = i % 2 ? hex('#4a9a74') : hex('#43916c');
      surface(b, [0, 7, 8, 9][d], 1, (u, v) => {
        const x = px + Math.cos(u * Math.PI * 2) * r * v;
        const z = pz + Math.sin(u * Math.PI * 2) * r * v;
        return [x, y(x, z, v), z];
      }, colour, true);
      const spokes = d >= 2 ? 6 : 4;
      for (let j = 0; j < spokes; j += 1) {
        const a = (j / spokes) * Math.PI * 2 + i;
        const p = (v) => {
          const x = px + Math.cos(a) * r * v;
          const z = pz + Math.sin(a) * r * v;
          return [x, y(x, z, v) + 0.012, z];
        };
        strip(b, [p(0.12), p(0.9)], 0.01, vein);
      }
    });
  }

  // The luggage rack and its cargo.
  const rackY = top(0.72, 0) + 0.02;
  rack(b, 0.72, rackZ[0], rackZ[1], rackY, 0.3, hex('#d8cfb8'), d);
  trunk(b, [0.05, rackY, -2.3], [0.42, 0.2, 0.34], '#6b3f26', d);
  crate(b, [-0.3, rackY, -1.1], [0.3, 0.2, 0.36], '#b27a44', d);
  cube(b, [0.32, rackY + 0.17, -0.3], [0.24, 0.17, 0.22], hex('#f1eee6'));
  if (d >= 1) crate(b, [0.33, rackY, -1.2], [0.22, 0.16, 0.24], '#8f5d38', d);

  // Pots with plants round the rack and at the back.
  pot(b, [-0.95, top(0.95, -3.4), -3.4], d, '#e58fb0');
  pot(b, [0.95, top(0.95, -3.4), -3.4], d, '#f0c2d4', 0.9);
  if (d >= 1) pot(b, [-0.35, top(0.35, -4.3), -4.3], d, null, 1.1);
  if (d >= 2) pot(b, [0.95, top(0.95, 0.7), 0.7], d, '#e58fb0', 0.8);

  // The lantern row along the ridge towards the front.
  const lanterns = [
    [0.1, 1.2, '#f3efe2'],
    [-0.15, 2.0, '#efe3c4'],
    [0.15, 2.8, '#6b4a30'],
    [-0.1, 3.6, '#f3efe2'],
    [0.05, 4.4, '#e9dcc0'],
  ];
  for (const [x, z, colour] of d >= 1 ? lanterns : lanterns.filter((_, i) => i % 2 === 0)) {
    lantern(b, g, [x, top(x, z) + 0.05, z], colour, d);
  }

  if (d >= 1) bench(b, [0.45, top(0.45, -4.5) + 0.02, -4.5], '#c9c27a', d);
  return finish(b, g, glow);
}

// --- Magnolia crown ---------------------------------------------------------

/**
 * A cream dome ringed by cupped pink and cream magnolia petals that arch out
 * and curl down over the sides, taller petals fanning up at both ends like a
 * crown, and blossoms scattered on top. Cargo: a brass rack of hatboxes and a
 * wicker basket, a potted magnolia sapling, and paper lanterns on posts.
 */
function magnoliaCrown({ length, width, detail = 2, glow = 0 }) {
  const d = level(detail);
  const b = createBuilder();
  const g = createBuilder();
  const hw = width / 2 + 0.06;
  const hl = length / 2 + 0.06;
  const base = 0.08;
  const top = domeTop(hw, hl, base, 0.26);
  const pink = hex('#f3cfd4');
  const cream = hex('#f6eadb');
  const blush = hex('#e7a9b6');
  const [nu, nv] = [[2, 2, 3, 3][d], [2, 3, 3, 4][d]];

  domeShell(b, hw, hl, base, top, hex('#efe0d2'), d);

  /** A small blossom: petals round a green-gold heart. */
  const blossom = ([x, y, z], size, colour) => {
    const count = d >= 2 ? 6 : 4;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2 + x;
      petal(b, [x, y, z], [Math.cos(a), Math.sin(a)], { len: 0.26 * size, wid: 0.1 * size, a0: 0.95, curl: 0.4, cup: 0.3 }, hex(colour), 2, 2);
    }
    blob(b, [x, y + 0.04 * size, z], [0.05 * size, 0.05 * size, 0.05 * size], hex('#d8cf6a'));
  };

  // Arching petals down both sides.
  const n = Math.max(4, Math.round((2 * hl) / (d >= 2 ? 0.9 : 1.2)));
  const sp = (2 * hl) / n;
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i += 1) {
      const z = -hl + sp * (i + 0.5);
      const x = s * (hw - 0.2);
      const long = i % 2 ? 0.7 : 0.62;
      petal(b, [x, top(x, z) - 0.02 + (i % 2) * 0.015, z], [s, 0], { len: long, wid: sp * 0.58, a0: 0.78, curl: 1.16, cup: 0.25 }, i % 2 ? pink : cream, nu, nv);
    }
  }

  // The crown: petals fanning up and out at each end.
  const fan = d >= 2 ? [-0.7, -0.35, 0, 0.35, 0.7] : [-0.6, 0, 0.6];
  for (const s of [-1, 1]) {
    fan.forEach((f, i) => {
      const x = f * hw * 0.9;
      const z = s * (hl - 0.25);
      const dir = [Math.sin(f * 0.8), s * Math.cos(f * 0.8)];
      const tall = i === (fan.length - 1) / 2 ? 1 : 0.8;
      petal(b, [x, top(x, z) - 0.03, z], dir, { len: 0.9 * tall, wid: 0.3, a0: 1.25, curl: 0.5, cup: 0.35 }, i % 2 ? blush : pink, nu, nv);
    });
  }

  // Blossoms on top.
  const tops = [
    [-0.8, -4.1, '#f7e3e6'],
    [0.85, 3.9, '#f3cfd4'],
    [0.8, -1.0, '#f7e3e6'],
    [-0.85, 1.9, '#f3cfd4'],
  ];
  for (const [x, z, c] of d >= 1 ? tops : tops.slice(0, 2)) blossom([x, top(x, z), z], 1.1, c);

  // A brass rack of hatboxes and a basket.
  const rackY = top(0.6, 0) + 0.02;
  rack(b, 0.6, -2.3, 0.7, rackY, 0.22, BRASS, d);
  const hn = d >= 2 ? 10 : 6;
  drum(b, [-0.25, rackY, -1.7], 0.24, 0.24, 0.24, hn, hex('#9fd3c0'), true, hex('#e7a9b6'));
  drum(b, [0.28, rackY, -0.4], 0.2, 0.2, 0.2, hn, hex('#e7a9b6'), true, hex('#f6eadb'));
  if (d >= 1) drum(b, [-0.25, rackY + 0.24, -1.7], 0.15, 0.15, 0.14, hn, hex('#f6eadb'), true, hex('#9fd3c0'));
  crate(b, [-0.22, rackY, 0.25], [0.26, 0.14, 0.2], '#c8a060', d);
  if (d >= 1) {
    const hy = rackY + 0.28;
    beam(b, [-0.44, hy, 0.25], [-0.22, hy + 0.15, 0.25], 0.012, hex('#8a6a3a'));
    beam(b, [-0.22, hy + 0.15, 0.25], [0, hy, 0.25], 0.012, hex('#8a6a3a'));
  }
  cube(b, [0.3, rackY + 0.12, -1.5], [0.2, 0.12, 0.2], cream);
  if (d >= 2) cube(b, [0.3, rackY + 0.12, -1.5], [0.21, 0.13, 0.03], blush);

  // A magnolia sapling in a pot at the back.
  if (d >= 1) {
    const [px, pz] = [0.1, -3.4];
    const py = top(px, pz);
    drum(b, [px, py, pz], 0.12, 0.16, 0.24, 7, hex('#b8613e'), true, hex('#4a3526'));
    beam(b, [px, py + 0.24, pz], [px + 0.05, py + 0.75, pz], 0.022, hex('#6b4a30'));
    blob(b, [px + 0.05, py + 0.8, pz], [0.28, 0.18, 0.28], hex('#5f9a5a'));
    blossom([px - 0.12, py + 0.9, pz + 0.1], 0.8, '#f7e3e6');
    if (d >= 2) blossom([px + 0.2, py + 0.88, pz - 0.08], 0.7, '#f3cfd4');
  }

  // Paper lanterns on slim posts towards the front.
  const lamps = [
    [0.35, 2.2, '#f7c9cf'],
    [-0.35, 3.1, '#f6e7c6'],
    [0.35, 4.0, '#f7c9cf'],
  ];
  for (const [x, z, colour] of d >= 1 ? lamps : lamps.slice(1, 2)) {
    const y = top(x, z);
    beam(b, [x, y, z], [x, y + 0.5, z], 0.015, hex('#6b4a30'));
    blob(g, [x, y + 0.62, z], [0.13, 0.16, 0.13], hex(colour), d >= 2 ? 1 : 0);
    cube(b, [x, y + 0.79, z], [0.06, 0.02, 0.06], IRON);
    g.lights.push([x, y + 0.62, z]);
  }
  return finish(b, g, glow);
}

// --- Coastal canvas ---------------------------------------------------------

/**
 * A striped awning, cream and sea-blue, stretched over slim driftwood hoops
 * and sagging a touch between them, with a scalloped valance down the sides,
 * a ridge rope and guy ropes, and a small flag at the front. Cargo on a plank
 * deck: a banded sea chest, fish crates, a coil of rope, a lifebuoy, and two
 * ship's lanterns.
 */
function coastalCanvas({ length, width, detail = 2, glow = 0 }) {
  const d = level(detail);
  const b = createBuilder();
  const g = createBuilder();
  const hw = width / 2 + 0.12;
  const hl = length / 2 + 0.15;
  const base = 0.06;
  const rise = 0.5;
  const stripes = [hex('#f1e8d2'), hex('#3f86a8')];
  const wood = hex('#8a6a4a');
  const rope = hex('#d8c49a');

  // Hoops: evenly spaced, the end ones set in from the canvas edge.
  const hn = Math.max(2, Math.round((2 * hl - 0.4) / 1.7));
  const hs = (2 * hl - 0.4) / hn;
  const hoopZ = Array.from({ length: hn + 1 }, (_, i) => -hl + 0.2 + i * hs);
  const sag = (z) => Math.sin((Math.PI * (z - hoopZ[0])) / hs) ** 2 * (Math.abs(z) < hl - 0.2 ? 1 : 0);
  const canvasY = (x, z) => base + rise * Math.sqrt(Math.max(0, 1 - (x / hw) ** 2)) * (1 - 0.08 * sag(z));

  const seg = [3, 4, 6, 6][d];
  for (const z of hoopZ) {
    for (let i = 0; i < seg; i += 1) {
      const [a0, a1] = [(i / seg) * Math.PI, ((i + 1) / seg) * Math.PI];
      const p = (a) => [(hw - 0.03) * Math.cos(a), base - 0.03 + rise * Math.sin(a), z];
      beam(b, p(a0), p(a1), 0.025, wood);
    }
    for (const s of [-1, 1]) beam(b, [s * (hw - 0.03), 0, z], [s * (hw - 0.03), base - 0.03, z], 0.025, wood);
  }

  // Canvas stripes, each its own strip so the colours stay crisp.
  const m = Math.round((2 * hl) / 0.42);
  const sw = (2 * hl) / m;
  const across = [4, 6, 7, 8][d];
  for (let j = 0; j < m; j += 1) {
    const z0 = -hl + j * sw;
    surface(b, across, 1, (u, v) => {
      const x = hw * Math.cos(u * Math.PI);
      const z = z0 + v * sw;
      return [x, canvasY(x, z), z];
    }, stripes[j % 2]);
    if (d >= 1) {
      for (const s of [-1, 1]) {
        surface(b, d >= 2 ? 3 : 2, 1, (u, v) => [s * (hw + 0.005), base - v * (0.1 + 0.07 * Math.sin(Math.PI * u)), z0 + u * sw], stripes[j % 2]);
      }
    }
  }

  // Ropes: along the ridge, and guys from the end hoops down to the eaves.
  const ridge = base + rise + 0.015;
  if (d >= 1) {
    for (let i = 0; i < hn; i += 1) beam(b, [0, ridge, hoopZ[i]], [0, ridge - 0.02, hoopZ[i] + hs / 2], 0.012, rope), beam(b, [0, ridge - 0.02, hoopZ[i] + hs / 2], [0, ridge, hoopZ[i + 1]], 0.012, rope);
    for (const s of [-1, 1]) {
      const z = s * (hl - 0.2);
      for (const t of [-1, 1]) {
        const mid = [t * hw * 0.55, base + rise * 0.72, s * hl];
        beam(b, [0, ridge, z], mid, 0.012, rope);
        beam(b, mid, [t * (hw + 0.05), base - 0.05, s * (hl + 0.05)], 0.012, rope);
      }
    }
  }

  // A small flag on a pole at the front.
  const fz = hoopZ[hn];
  beam(b, [0, ridge, fz], [0, ridge + 0.9, fz], 0.018, wood);
  const flag = hex('#d9574a');
  const fy = ridge + 0.86;
  const wave = [
    [0, 0],
    [0.22, 0.04],
    [0.45, -0.02],
  ];
  for (let i = 0; i < 2; i += 1) {
    const [[x0, w0], [x1, w1]] = [wave[i], wave[i + 1]];
    const shrink = (x) => 0.13 * (1 - x / 0.62);
    b.quad([w0, fy - 2 * shrink(x0), fz - x0], [w1, fy - 2 * shrink(x1), fz - x1], [w1, fy, fz - x1], [w0, fy, fz - x0], i ? stripes[0] : flag);
  }
  b.tri([-0.02, fy - 2 * 0.13 * (1 - 0.45 / 0.62), fz - 0.45], [0, fy - 0.13 * (1 - 0.45 / 0.62), fz - 0.62], [-0.02, fy, fz - 0.45], [[0, 0], [0, 0], [0, 0]], flag);

  // A plank deck over the middle hoops, railed, with the cargo.
  const [dz0, dz1] = [-2.2, 1.0];
  const deckY = ridge + 0.03;
  for (const x of d >= 1 ? [-0.47, -0.16, 0.16, 0.47] : [-0.32, 0.32]) cube(b, [x, deckY, (dz0 + dz1) / 2], [d >= 1 ? 0.14 : 0.3, 0.02, (dz1 - dz0) / 2], hex('#b08a5a'));
  for (const z of [dz0, dz1]) {
    for (const s of [-1, 1]) beam(b, [s * 0.55, canvasY(0.55, z), z], [s * 0.55, deckY, z], 0.02, wood);
  }
  if (d >= 1) rack(b, 0.6, dz0, dz1, deckY + 0.02, 0.18, wood, d);
  const on = deckY + 0.02;
  trunk(b, [0.05, on, -1.6], [0.4, 0.2, 0.3], '#2f5f6f', d);
  crate(b, [-0.3, on, -0.5], [0.26, 0.15, 0.3], '#b08a5a', d);
  if (d >= 2) crate(b, [-0.3, on + 0.3, -0.5], [0.2, 0.12, 0.24], '#9a7448', d);
  if (d >= 1) {
    const coil = new TorusGeometry(0.15, 0.05, d >= 2 ? 4 : 3, d >= 2 ? 8 : 6);
    coil.rotateX(Math.PI / 2);
    coil.translate(0.3, on + 0.05, 0.4);
    b.addGeometry(coil, rope);
    const buoy = new TorusGeometry(0.17, 0.05, 4, d >= 2 ? 10 : 7);
    buoy.rotateY(Math.PI / 2);
    buoy.translate(0.35, on + 0.23, -0.55);
    b.addGeometry(buoy, hex('#f1e8d2'));
    for (const [y, z] of [[0.17, 0], [-0.17, 0], [0, 0.17], [0, -0.17]]) cube(b, [0.35, on + 0.23 + y, -0.55 + z], [0.058, 0.04, 0.04], flag);
  }

  // Ship's lanterns at the ends of the deck.
  for (const z of d >= 1 ? [dz0 - 0.35, dz1 + 0.35] : [dz1 + 0.35]) {
    lantern(b, g, [0, canvasY(0, z) + 0.01, z], '#fff3d6', d, { r: 0.08, h: 0.2, trim: BRASS });
  }
  return finish(b, g, glow);
}

export const ROOFS = {
  hearthLeaves: { name: 'Hearth leaves', build: hearthLeaves },
  magnoliaCrown: { name: 'Magnolia crown', build: magnoliaCrown },
  coastalCanvas: { name: 'Coastal canvas', build: coastalCanvas },
};
