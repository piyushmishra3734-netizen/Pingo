import { CanvasTexture, Color, Mesh, MeshLambertMaterial, RepeatWrapping, SRGBColorSpace } from 'three';

import { GLASS, PLAIN, box, createBuilder, getLeafDetail, leaf, setLeafDetail } from './builder.js';

/**
 * Towns: plaster houses with tiled hip roofs, umbrella pines, lamps and a
 * lighthouse - every one of them in a single merged mesh on one material.
 *
 * The trick that keeps it one draw call: walls sample a painted "bay" tile
 * (plaster, a shuttered window) that repeats across each face, while roofs,
 * trunks and leaves point their UVs at a plain patch of that same tile and
 * take their colour from vertex colours. At night the window glass in the
 * tile is the emissive map, so every window lights at once for free.
 */

const BAY = 2.4;

const FLOOR = 2.9;

// Sampled from the film: muted plaster - stone grey, sand, putty, a pale
// ochre - under dark maroon tiles.
export const WALLS = ['#d2c9ba', '#c4bcae', '#d8cdb7', '#bfb8ac', '#ddd0b2', '#cbc3b6', '#d6c3a8'];

export const ROOFS = ['#6e2f2b', '#7a3530', '#5f2a27', '#84413a'];

function bayTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  // Plaster, painted: a warm off-white with soft blotches.
  c.fillStyle = '#f4efe6';
  c.fillRect(0, 0, size, size);
  let seed = 5;
  const r = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 60; i += 1) {
    c.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(170,150,120,0.08)';
    c.beginPath();
    c.arc(r() * size, r() * size, 4 + r() * 14, 0, Math.PI * 2);
    c.fill();
  }
  // A darker band at the foot of each storey, like a painted cornice.
  c.fillStyle = 'rgba(120,100,80,0.18)';
  c.fillRect(0, size - 7, size, 7);
  // Shutters, frame, glass.
  c.fillStyle = '#6f8f76';
  c.fillRect(30, 30, 12, 62);
  c.fillRect(86, 30, 12, 62);
  c.fillStyle = '#efe7d6';
  c.fillRect(42, 28, 44, 66);
  c.fillStyle = '#3a4458';
  c.fillRect(46, 32, 36, 58);
  c.fillStyle = '#efe7d6';
  c.fillRect(62, 32, 3, 58);
  c.fillRect(46, 58, 36, 3);
  // A sill.
  c.fillStyle = '#d9cbb2';
  c.fillRect(38, 92, 52, 5);

  const emissive = document.createElement('canvas');
  emissive.width = size;
  emissive.height = size;
  const e = emissive.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, size, size);
  const glow = e.createLinearGradient(0, 32, 0, 90);
  glow.addColorStop(0, '#fff0c8');
  glow.addColorStop(1, '#ffd592');
  e.fillStyle = glow;
  e.fillRect(46, 32, 36, 58);

  const make = (source) => {
    const texture = new CanvasTexture(source);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.colorSpace = SRGBColorSpace;
    return texture;
  };
  return { map: make(canvas), emissive: make(emissive) };
}

/**
 * A house: plaster box, windows in bays, a hip roof with eaves.
 * @param {ReturnType<typeof createBuilder>} b
 */
function house(b, { x, y = 0, z, w, d, floors = 2, turn = 0, wall = WALLS[0], roof = ROOFS[0], props = 1, seed = 0 }) {
  const h = floors * FLOOR;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const at = (px, py, pz) => [x + px * cos - pz * sin, y + py, z + px * sin + pz * cos];
  const wallColour = new Color(wall);
  const shade = wallColour.clone().multiplyScalar(0.92);
  const hw = w / 2;
  const hd = d / 2;
  const face = (ax, az, bx, bz, length, colour) => {
    const u = Math.max(1, Math.round(length / BAY));
    b.quad(at(ax, 0, az), at(bx, 0, bz), at(bx, h, bz), at(ax, h, az), colour, [
      [0, 0],
      [u, 0],
      [u, floors],
      [0, floors],
    ]);
  };
  face(-hw, hd, hw, hd, w, wallColour);
  face(hw, hd, hw, -hd, d, shade);
  face(hw, -hd, -hw, -hd, w, wallColour);
  face(-hw, -hd, -hw, hd, d, shade);

  // A front door, just proud of the wall, and on every third house a shop:
  // a striped awning over the ground floor.
  const doorX = (seed % 3) - 1;
  const door = new Color(['#5b3f2e', '#3f5a52', '#6b3a34'][seed % 3]);
  b.quad(at(doorX - 0.55, 0, hd + 0.03), at(doorX + 0.55, 0, hd + 0.03), at(doorX + 0.55, 2.2, hd + 0.03), at(doorX - 0.55, 2.2, hd + 0.03), door);
  if (props >= 1 && seed % 3 === 0) {
    const stripes = [new Color(['#c2513f', '#3f7a6a', '#d9a13b'][seed % 3 === 0 ? (seed >> 2) % 3 : 0]), new Color('#f2ece0')];
    const n = Math.max(4, Math.round(w * 1.2));
    for (let i = 0; i < n; i += 1) {
      const x0 = -hw + (w * i) / n;
      const x1 = -hw + (w * (i + 1)) / n;
      b.quad(at(x0, 2.35, hd + 1.1), at(x1, 2.35, hd + 1.1), at(x1, 2.85, hd), at(x0, 2.85, hd), stripes[i % 2]);
      b.quad(at(x1, 2.35, hd + 1.1), at(x0, 2.35, hd + 1.1), at(x0, 2.85, hd), at(x1, 2.85, hd), stripes[i % 2].clone().multiplyScalar(0.7));
    }
  }

  // Hip roof: eaves overhang, slopes to a short ridge along the long side.
  const roofColour = new Color(roof);
  const dark = roofColour.clone().multiplyScalar(0.8);
  const o = 0.45;
  const rise = Math.min(w, d) * 0.42;
  const ridge = Math.max(0, (Math.max(w, d) - Math.min(w, d)) / 2);
  const alongX = w >= d;
  const e = [at(-hw - o, h, hd + o), at(hw + o, h, hd + o), at(hw + o, h, -hd - o), at(-hw - o, h, -hd - o)];
  const r1 = alongX ? at(-ridge, h + rise, 0) : at(0, h + rise, ridge);
  const r2 = alongX ? at(ridge, h + rise, 0) : at(0, h + rise, -ridge);
  if (alongX) {
    b.quad(e[0], e[1], r2, r1, roofColour);
    b.tri(e[1], e[2], r2, [PLAIN, PLAIN, PLAIN], dark);
    b.quad(e[2], e[3], r1, r2, roofColour);
    b.tri(e[3], e[0], r1, [PLAIN, PLAIN, PLAIN], dark);
  } else {
    b.tri(e[0], e[1], r1, [PLAIN, PLAIN, PLAIN], roofColour);
    b.quad(e[1], e[2], r2, r1, dark);
    b.tri(e[2], e[3], r2, [PLAIN, PLAIN, PLAIN], roofColour);
    b.quad(e[3], e[0], r1, r2, dark);
  }
  // The underside of the eaves, so the overhang is solid from below.
  b.quad(e[3], e[2], e[1], e[0], dark.clone().multiplyScalar(0.7));

  if (props < 1) return;
  // A chimney standing out of the roof.
  const brick = new Color('#9a6450');
  box(b, at, { cx: (alongX ? ridge * 0.6 : 0.6) * (seed % 2 ? 1 : -1), cy: h + rise * 0.55, cz: alongX ? 0.5 : ridge * 0.4, sx: 0.35, sy: rise * 0.75 + 0.6, sz: 0.35 }, brick);

  // A balcony on the front at the first floor, on about half the houses: a
  // slab, an iron rail, and at higher settings flowers spilling over it.
  if (floors < 2 || seed % 2) return;
  const bw = Math.min(w * 0.55, 3.2);
  const deep = 0.85;
  const floorY = FLOOR - 0.1;
  const stone = new Color('#e6dccb');
  box(b, at, { cx: 0, cy: floorY - 0.08, cz: hd + deep / 2, sx: bw / 2, sy: 0.08, sz: deep / 2 }, stone);
  const iron = new Color('#3b4048');
  const railY = floorY + 0.9;
  b.quad(at(-bw / 2, floorY, hd + deep), at(bw / 2, floorY, hd + deep), at(bw / 2, railY, hd + deep), at(-bw / 2, railY, hd + deep), iron);
  b.quad(at(bw / 2, floorY, hd + deep), at(-bw / 2, floorY, hd + deep), at(-bw / 2, railY, hd + deep), at(bw / 2, railY, hd + deep), iron);
  if (props < 2) return;
  const blooms = ['#e58fa8', '#f2c14e', '#f4f1ea', '#b99be0'];
  for (let i = 0; i < 3; i += 1) {
    const [fx, fy, fz] = at(-bw / 2 + bw * (0.2 + i * 0.3), railY - 0.1, hd + deep + 0.1);
    const pot = leaf(getLeafDetail() - 1).clone();
    pot.scale(0.45, 0.35, 0.3);
    pot.translate(fx, fy, fz);
    b.addGeometry(pot, new Color(i % 2 ? '#6a9a55' : blooms[(seed + i) % blooms.length]));
  }
}

/** A tuft of flowers: two crossed cards, both faces, in one bloom colour. */
function flowers(b, { x, y = 0, z, colour = '#e58fa8', size = 0.5 }) {
  const c = new Color(colour);
  const stem = new Color('#6f9a55');
  for (const [dx, dz] of [
    [size, 0],
    [0, size],
  ]) {
    const a = [x - dx, y, z - dz];
    const bq = [x + dx, y, z + dz];
    const tA = [x - dx, y + size * 1.2, z - dz];
    const tB = [x + dx, y + size * 1.2, z + dz];
    b.tri(a, bq, tB, [PLAIN, PLAIN, PLAIN], stem);
    b.tri(a, tB, tA, [PLAIN, PLAIN, PLAIN], c);
    b.tri(bq, a, tA, [PLAIN, PLAIN, PLAIN], stem);
    b.tri(bq, tA, tB, [PLAIN, PLAIN, PLAIN], c);
  }
}

/** A bench: seat and back, for the promenades. */
export function bench(b, { x, y = 0, z, turn = 0 }) {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const at = (px, py, pz) => [x + px * cos - pz * sin, y + py, z + px * sin + pz * cos];
  const wood = new Color('#8a6446');
  box(b, at, { cx: 0, cy: 0.45, cz: 0, sx: 0.9, sy: 0.05, sz: 0.25 }, wood);
  box(b, at, { cx: 0, cy: 0.8, cz: -0.24, sx: 0.9, sy: 0.25, sz: 0.04 }, wood);
  const iron = new Color('#3b4048');
  box(b, at, { cx: -0.8, cy: 0.22, cz: 0, sx: 0.05, sy: 0.22, sz: 0.2 }, iron);
  box(b, at, { cx: 0.8, cy: 0.22, cz: 0, sx: 0.05, sy: 0.22, sz: 0.2 }, iron);
}

/** A railing round part of a circle (a promenade edge): posts and a top rail. */
function railing(b, { x, y = 0, z, radius, from = 0, to = Math.PI * 2, gaps = () => false }) {
  const iron = new Color('#2f5446');
  const steps = Math.max(8, Math.round((radius * (to - from)) / 2));
  for (let i = 0; i < steps; i += 1) {
    const a0 = from + ((to - from) * i) / steps;
    const a1 = from + ((to - from) * (i + 1)) / steps;
    const p0 = [x + Math.cos(a0) * radius, z + Math.sin(a0) * radius];
    const p1 = [x + Math.cos(a1) * radius, z + Math.sin(a1) * radius];
    if (gaps(p0[0], p0[1]) || gaps(p1[0], p1[1])) continue;
    // Top rail, both faces, and a post.
    b.quad([p0[0], y + 0.95, p0[1]], [p1[0], y + 0.95, p1[1]], [p1[0], y + 1.05, p1[1]], [p0[0], y + 1.05, p0[1]], iron);
    b.quad([p1[0], y + 0.95, p1[1]], [p0[0], y + 0.95, p0[1]], [p0[0], y + 1.05, p0[1]], [p1[0], y + 1.05, p1[1]], iron);
    const at = (px, py, pz) => [p0[0] + px, y + py, p0[1] + pz];
    box(b, at, { cx: 0, cy: 0.5, cz: 0, sx: 0.04, sy: 0.5, sz: 0.04 }, iron);
  }
}

/** An umbrella pine: a leaning trunk and a broad, flat, two-lobed crown. */
function pine(b, { x, y = 0, z, height = 6, lean = 0.3, seed = 1 }) {
  const trunk = new Color('#6b5040');
  const t = 0.18;
  const top = [x + Math.cos(seed) * lean, y + height, z + Math.sin(seed) * lean];
  const base = [
    [x - t, y, z - t],
    [x + t, y, z - t],
    [x + t, y, z + t],
    [x - t, y, z + t],
  ];
  const tip = [
    [top[0] - t * 0.6, top[1], top[2] - t * 0.6],
    [top[0] + t * 0.6, top[1], top[2] - t * 0.6],
    [top[0] + t * 0.6, top[1], top[2] + t * 0.6],
    [top[0] - t * 0.6, top[1], top[2] + t * 0.6],
  ];
  for (let i = 0; i < 4; i += 1) {
    const n = (i + 1) % 4;
    b.quad(base[n], base[i], tip[i], tip[n], trunk);
  }
  const leaves = new Color(seed % 2 ? '#5f8f4e' : '#4f7f48');
  for (const [dx, dy, dz, sx, sy, sz, shape] of [
    [0, 0.2, 0, height * 0.5, height * 0.18, height * 0.45, leaf(getLeafDetail())],
    [height * 0.25, 0.5, height * 0.1, height * 0.32, height * 0.14, height * 0.3, leaf(getLeafDetail() - 1)],
  ]) {
    const lobe = shape.clone();
    lobe.scale(sx, sy, sz);
    lobe.rotateY(seed);
    lobe.translate(top[0] + dx * Math.cos(seed), top[1] + dy, top[2] + dx * Math.sin(seed) + dz);
    b.addGeometry(lobe, leaves);
  }
}

/** A broadleaf tree: a straight trunk under a round crown of three soft lobes. */
function broadleaf(b, { x, y = 0, z, height = 5, seed = 1 }) {
  const trunk = new Color('#5e4636');
  const t = 0.16;
  for (let i = 0; i < 4; i += 1) {
    const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
    b.quad(
      [x + Math.cos(a1) * t, y, z + Math.sin(a1) * t],
      [x + Math.cos(a0) * t, y, z + Math.sin(a0) * t],
      [x + Math.cos(a0) * t * 0.7, y + height * 0.62, z + Math.sin(a0) * t * 0.7],
      [x + Math.cos(a1) * t * 0.7, y + height * 0.62, z + Math.sin(a1) * t * 0.7],
      trunk,
    );
  }
  const leaves = new Color(['#4f7f45', '#5b8c4a', '#46753f'][seed % 3]);
  const crown = height * 0.32;
  for (const [dx, dy, dz, s] of [
    [0, 0.75, 0, 1],
    [0.45, 0.62, 0.2, 0.72],
    [-0.35, 0.6, -0.3, 0.7],
  ]) {
    const lobe = leaf(getLeafDetail()).clone();
    lobe.scale(crown * s, crown * s * 0.85, crown * s);
    lobe.translate(x + dx * crown, y + height * dy, z + dz * crown);
    b.addGeometry(lobe, leaves);
  }
}

/** A round bush or garden tree: one soft blob on a short stem. */
function bush(b, { x, y = 0, z, size = 1.2, colour = '#6a9a55' }) {
  const blob = leaf(getLeafDetail() - 1).clone();
  blob.scale(size, size * 0.8, size);
  blob.translate(x, y + size * 0.7, z);
  b.addGeometry(blob, new Color(colour));
}

/** A lighthouse: a tapering white tower with a red band and a lamp room. */
function lighthouse(b, { x, y = 0, z, height = 16 }) {
  const sides = 8;
  const rings = [
    [0, 2.2, '#f3eee4'],
    [height * 0.45, 1.8, '#f3eee4'],
    [height * 0.55, 1.72, '#c25a45'],
    [height * 0.65, 1.62, '#f3eee4'],
    [height, 1.4, '#f3eee4'],
  ];
  for (let k = 0; k < rings.length - 1; k += 1) {
    const [y0, r0, c0] = rings[k];
    const [y1, r1] = rings[k + 1];
    const colour = new Color(c0);
    for (let i = 0; i < sides; i += 1) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      b.quad(
        [x + Math.cos(a1) * r0, y + y0, z + Math.sin(a1) * r0],
        [x + Math.cos(a0) * r0, y + y0, z + Math.sin(a0) * r0],
        [x + Math.cos(a0) * r1, y + y1, z + Math.sin(a0) * r1],
        [x + Math.cos(a1) * r1, y + y1, z + Math.sin(a1) * r1],
        colour,
      );
    }
  }
  // Lamp room (window-glass UVs, so it glows at night) and a dark cap.
  const lampY = y + height;
  const glass = new Color('#ffffff');
  for (let i = 0; i < sides; i += 1) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const g = GLASS;
    b.quad(
      [x + Math.cos(a1) * 1.1, lampY, z + Math.sin(a1) * 1.1],
      [x + Math.cos(a0) * 1.1, lampY, z + Math.sin(a0) * 1.1],
      [x + Math.cos(a0) * 1.1, lampY + 1.8, z + Math.sin(a0) * 1.1],
      [x + Math.cos(a1) * 1.1, lampY + 1.8, z + Math.sin(a1) * 1.1],
      glass,
      [g, g, g, g],
    );
    b.tri(
      [x + Math.cos(a1) * 1.5, lampY + 1.8, z + Math.sin(a1) * 1.5],
      [x + Math.cos(a0) * 1.5, lampY + 1.8, z + Math.sin(a0) * 1.5],
      [x, lampY + 3.2, z],
      [PLAIN, PLAIN, PLAIN],
      new Color('#3f4a5c'),
    );
  }
}

/** A street lamp: thin dark post, glass head that glows at night. */
export function lamp(b, { x, y = 0, z }) {
  const post = new Color('#3a3f4a');
  const s = 0.06;
  const h = 3.2;
  for (const [ax, az, bx, bz] of [
    [-s, s, s, s],
    [s, s, s, -s],
    [s, -s, -s, -s],
    [-s, -s, -s, s],
  ]) {
    b.quad([x + ax, y, z + az], [x + bx, y, z + bz], [x + bx, y + h, z + bz], [x + ax, y + h, z + az], post);
  }
  b.lights.push([x, y, z]);
  const g = GLASS;
  const glass = new Color('#ffffff');
  const r = 0.2;
  for (const [ax, az, bx, bz] of [
    [-r, r, r, r],
    [r, r, r, -r],
    [r, -r, -r, -r],
    [-r, -r, -r, r],
  ]) {
    b.quad([x + ax, y + h, z + az], [x + bx, y + h, z + bz], [x + bx, y + h + 0.4, z + bz], [x + ax, y + h + 0.4, z + az], glass, [g, g, g, g]);
  }
}

/**
 * The game kiosk on the home plaza: a little pavilion on four posts with a
 * teal hip roof and lanterns under the eaves, over the two game machines -
 * a market stall where people sit down to play.
 */
function kiosk(b, { x, y = 0, z, w = 4.2, d = 6.4 }) {
  const at = (px, py, pz) => [x + px, y + py, z + pz];
  const post = new Color('#6b4a33');
  const hw = w / 2;
  const hd = d / 2;
  for (const [px, pz] of [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]) {
    box(b, at, { cx: px, cy: 1.6, cz: pz, sx: 0.1, sy: 1.6, sz: 0.1 }, post);
  }
  // A timber frame along the top.
  box(b, at, { cx: 0, cy: 3.25, cz: -hd, sx: hw + 0.1, sy: 0.1, sz: 0.1 }, post);
  box(b, at, { cx: 0, cy: 3.25, cz: hd, sx: hw + 0.1, sy: 0.1, sz: 0.1 }, post);
  box(b, at, { cx: -hw, cy: 3.25, cz: 0, sx: 0.1, sy: 0.1, sz: hd + 0.1 }, post);
  box(b, at, { cx: hw, cy: 3.25, cz: 0, sx: 0.1, sy: 0.1, sz: hd + 0.1 }, post);
  // Roof: a hip roof in two teal tones, with a lighter band at the eaves.
  const roof = new Color('#2f6e64');
  const dark = roof.clone().multiplyScalar(0.75);
  const o = 0.6;
  const h = 3.35;
  const rise = 1.6;
  const e = [at(-hw - o, h, hd + o), at(hw + o, h, hd + o), at(hw + o, h, -hd - o), at(-hw - o, h, -hd - o)];
  const r1 = at(0, h + rise, hd * 0.45);
  const r2 = at(0, h + rise, -hd * 0.45);
  b.tri(e[0], e[1], r1, [PLAIN, PLAIN, PLAIN], roof);
  b.quad(e[1], e[2], r2, r1, dark);
  b.tri(e[2], e[3], r2, [PLAIN, PLAIN, PLAIN], roof);
  b.quad(e[3], e[0], r1, r2, dark);
  b.quad(e[3], e[2], e[1], e[0], dark.clone().multiplyScalar(0.6));
  // Lanterns hanging at the corners (window-glass UVs: they glow at dusk).
  const glass = new Color('#ffffff');
  for (const [px, pz] of [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]) {
    const lx = x + px * 1.05;
    const lz = z + pz * 1.05;
    const g = GLASS;
    for (const [ax, az, bx, bz] of [
      [-0.16, 0.16, 0.16, 0.16],
      [0.16, 0.16, 0.16, -0.16],
      [0.16, -0.16, -0.16, -0.16],
      [-0.16, -0.16, -0.16, 0.16],
    ]) {
      b.quad([lx + ax, y + 2.6, lz + az], [lx + bx, y + 2.6, lz + bz], [lx + bx, y + 3.0, lz + bz], [lx + ax, y + 3.0, lz + az], glass, [g, g, g, g]);
    }
  }
}

/** The one material every building, tree, lamp, tram and the line share. */
export function townMaterial(palette) {
  const { map, emissive } = bayTexture();
  return new MeshLambertMaterial({
    map,
    vertexColors: true,
    emissive: new Color('#ffe2b0'),
    emissiveMap: emissive,
    emissiveIntensity: palette.windows,
  });
}

/**
 * One place's worth of things - an island's houses, trees and props - as one
 * mesh, so each island is culled on its own when it is out of view.
 *
 * @param {{ houses?: any[], pines?: any[], bushes?: any[], lighthouses?: any[], lamps?: any[], flowers?: any[], benches?: any[], railings?: any[], railway?: any }} layout
 */
export function createTown(layout, material, quality = { leaf: 1, props: 1 }) {
  setLeafDetail(quality.leaf);
  const b = createBuilder();
  for (const spec of layout.houses ?? []) house(b, { ...spec, props: quality.props });
  // Half the trees are umbrella pines, half round broadleaves, as in the film.
  for (const spec of layout.pines ?? []) (spec.seed % 2 ? pine : broadleaf)(b, spec);
  for (const spec of layout.bushes ?? []) bush(b, spec);
  for (const spec of layout.lighthouses ?? []) lighthouse(b, spec);
  for (const spec of layout.lamps ?? []) lamp(b, spec);
  for (const spec of layout.flowers ?? []) flowers(b, spec);
  for (const spec of layout.benches ?? []) bench(b, spec);
  for (const spec of layout.railings ?? []) railing(b, spec);
  for (const spec of layout.kiosks ?? []) kiosk(b, spec);
  const geometry = b.build();
  geometry.computeBoundingSphere();
  return new Mesh(geometry, material);
}
