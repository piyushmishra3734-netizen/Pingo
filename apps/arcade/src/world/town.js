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
 *
 * Detail scales with `props` (graphics quality): at 0 a house is a textured
 * box under a roof with an eave board; from 1 it gains a cornice, a painted
 * base course, chimneys, balconies and awnings; from 2 window sills and door
 * steps and balcony balusters stand out; at 3 every window also has a hood
 * and sills are solid from below.
 */

/** Width of one window bay along a wall, in metres. */
const BAY = 2.2;

const FLOOR = 2.9;

/**
 * Where the painted window sits inside one bay tile, as fractions: across the
 * bay (0 left, 1 right) and up the storey (0 floor, 1 ceiling). The texture
 * and the geometry that stands proud of it (sills, hoods, doors) both read
 * these, so they always line up.
 */
const WIN = {
  glass: [0.365, 0.635],
  frame: [0.335, 0.665],
  shutters: [0.205, 0.795],
  sill: [0.215, 0.25],
  bottom: 0.28,
  top: 0.7,
  head: [0.73, 0.755],
};

// Sampled from the film: muted plaster - stone grey, sand, putty, a pale
// ochre - under dark maroon tiles.
export const WALLS = ['#d2c9ba', '#c4bcae', '#d8cdb7', '#bfb8ac', '#ddd0b2', '#cbc3b6', '#d6c3a8'];

export const ROOFS = ['#6e2f2b', '#7a3530', '#5f2a27', '#84413a'];

/**
 * The shared tile: one window bay of one storey. Plaster with faint painted
 * blotches, a cream-framed window with a mullion and transom, dark teal
 * louvred shutters, a stone sill, a lintel shadow, and a thin string course
 * at the foot of the storey. PLAIN (0.08, 0.2) lands on clean plaster and
 * GLASS (0.42, 0.62) inside the lower-left pane, clear of the glazing bars.
 */
function bayTexture() {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const c = canvas.getContext('2d');
  // Canvas y runs down, texture v runs up: a storey fraction f is at y = 1 - f.
  const rect = (x0, x1, f0, f1, colour) => {
    c.fillStyle = colour;
    c.fillRect(x0 * S, (1 - f1) * S, (x1 - x0) * S, (f1 - f0) * S);
  };

  c.fillStyle = '#f1ebe0';
  c.fillRect(0, 0, S, S);
  let seed = 5;
  const r = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const plainX = PLAIN[0] * S;
  const plainY = (1 - PLAIN[1]) * S;
  for (let i = 0; i < 90; i += 1) {
    const bx = r() * S;
    const by = r() * S;
    const br = 6 + r() * 26;
    const light = r() > 0.5;
    // Everything that is not a wall samples the PLAIN spot: keep it clean.
    if (Math.hypot(bx - plainX, by - plainY) < br + 6) continue;
    c.fillStyle = light ? 'rgba(255,255,255,0.16)' : 'rgba(150,130,105,0.07)';
    c.beginPath();
    c.arc(bx, by, br, 0, Math.PI * 2);
    c.fill();
  }
  // Rain streaks fading down the wall under the sill.
  const streak = c.createLinearGradient(0, (1 - WIN.sill[0]) * S, 0, 0.95 * S);
  streak.addColorStop(0, 'rgba(110,95,75,0.14)');
  streak.addColorStop(1, 'rgba(110,95,75,0)');
  c.fillStyle = streak;
  c.fillRect(WIN.frame[0] * S, (1 - WIN.sill[0]) * S, (WIN.frame[1] - WIN.frame[0]) * S, (WIN.sill[0] - 0.05) * S);
  // A string course at the foot of each storey: a lit edge over a shadow.
  rect(0, 1, 0.03, 0.045, 'rgba(255,255,255,0.35)');
  rect(0, 1, 0.015, 0.03, 'rgba(95,80,62,0.14)');
  // Lintel shadow over the window.
  rect(WIN.frame[0] - 0.01, WIN.frame[1] + 0.01, WIN.head[0], WIN.head[1], 'rgba(120,105,85,0.16)');

  // Shutters, louvred: dark teal with slat lines and a darker edge.
  const [s0, s1] = WIN.shutters;
  for (const [x0, x1] of [
    [s0, WIN.frame[0]],
    [WIN.frame[1], s1],
  ]) {
    rect(x0, x1, WIN.bottom - 0.005, WIN.top + 0.015, '#2f4a45');
    rect(x0 + 0.006, x1 - 0.006, WIN.bottom + 0.004, WIN.top + 0.006, '#3f5f58');
    for (let f = WIN.bottom + 0.02; f < WIN.top; f += 0.024) rect(x0 + 0.01, x1 - 0.01, f, f + 0.006, 'rgba(15,30,28,0.35)');
  }

  // Frame, reveal shadow, glass, glazing bars.
  rect(WIN.frame[0], WIN.frame[1], WIN.bottom - 0.03, WIN.top + 0.03, '#fbf6ea');
  rect(WIN.glass[0], WIN.glass[1], WIN.bottom, WIN.top, '#77706a');
  const glassTop = (1 - WIN.top) * S;
  const pane = c.createLinearGradient(0, glassTop, 0, (1 - WIN.bottom) * S);
  pane.addColorStop(0, '#8d949c');
  pane.addColorStop(1, '#5d5b58');
  c.fillStyle = pane;
  c.fillRect((WIN.glass[0] + 0.01) * S, glassTop + 0.01 * S, (WIN.glass[1] - WIN.glass[0] - 0.02) * S, (WIN.top - WIN.bottom - 0.01) * S);
  const bars = (ctx) => {
    ctx.fillStyle = '#fbf6ea';
    ctx.fillRect(0.5 * S - 1.5, glassTop, 3, (WIN.top - WIN.bottom) * S);
    ctx.fillRect(WIN.glass[0] * S, (1 - 0.55) * S - 1.5, (WIN.glass[1] - WIN.glass[0]) * S, 3);
  };
  bars(c);
  // The sill, with a shadow line under it.
  rect(WIN.frame[0] - 0.02, WIN.frame[1] + 0.02, WIN.sill[0], WIN.sill[1], '#e3d6bf');
  rect(WIN.frame[0] - 0.02, WIN.frame[1] + 0.02, WIN.sill[0] - 0.012, WIN.sill[0], 'rgba(90,75,60,0.28)');

  // Night: only the glass glows, warm and a touch brighter at the top.
  const emissive = document.createElement('canvas');
  emissive.width = S;
  emissive.height = S;
  const e = emissive.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  const glow = e.createLinearGradient(0, glassTop, 0, (1 - WIN.bottom) * S);
  glow.addColorStop(0, '#fff4d2');
  glow.addColorStop(1, '#ffd694');
  e.fillStyle = glow;
  e.fillRect(WIN.glass[0] * S, glassTop, (WIN.glass[1] - WIN.glass[0]) * S, (WIN.top - WIN.bottom) * S);
  e.fillStyle = '#000';
  e.fillRect(0.5 * S - 1.5, glassTop, 3, (WIN.top - WIN.bottom) * S);
  e.fillRect(WIN.glass[0] * S, (1 - 0.55) * S - 1.5, (WIN.glass[1] - WIN.glass[0]) * S, 3);

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
 * A house: plaster box, windows in bays, a hip roof on an eave board.
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

  // The four walls, counter-clockwise from the front (+z). A point on wall i
  // is given by how far along it (s), how high (py) and how far out (out).
  const corners = [
    [-hw, hd],
    [hw, hd],
    [hw, -hd],
    [-hw, -hd],
  ];
  const walls = corners.map(([ax, az], i) => {
    const [bx, bz] = corners[(i + 1) % 4];
    const length = i % 2 ? d : w;
    const dx = (bx - ax) / length;
    const dz = (bz - az) / length;
    const bays = Math.max(1, Math.round(length / BAY));
    return { length, bays, bay: length / bays, colour: i % 2 ? shade : wallColour, on: (s, py, out) => at(ax + dx * s - dz * out, py, az + dz * s + dx * out) };
  });

  /** A slab standing out of wall i: along s0..s1, up y0..y1, out o0..o1; front and top, and optionally bottom and ends. */
  const slab = (wl, s0, s1, y0, y1, o0, o1, colour, { top = true, bottom = false, ends = false } = {}) => {
    const P = wl.on;
    const side = colour.clone().multiplyScalar(0.86);
    b.quad(P(s0, y0, o1), P(s1, y0, o1), P(s1, y1, o1), P(s0, y1, o1), colour);
    if (top) b.quad(P(s0, y1, o1), P(s1, y1, o1), P(s1, y1, o0), P(s0, y1, o0), colour.clone().multiplyScalar(1.06));
    if (bottom) b.quad(P(s0, y0, o0), P(s1, y0, o0), P(s1, y0, o1), P(s0, y0, o1), side.clone().multiplyScalar(0.8));
    if (ends) {
      b.quad(P(s0, y0, o0), P(s0, y0, o1), P(s0, y1, o1), P(s0, y1, o0), side);
      b.quad(P(s1, y0, o1), P(s1, y0, o0), P(s1, y1, o0), P(s1, y1, o1), side);
    }
  };

  for (const wl of walls) {
    b.quad(wl.on(0, 0, 0), wl.on(wl.length, 0, 0), wl.on(wl.length, h, 0), wl.on(0, h, 0), wl.colour, [
      [0, 0],
      [wl.bays, 0],
      [wl.bays, floors],
      [0, floors],
    ]);
  }

  // The front door fills one ground-floor window bay between its shutters.
  const front = walls[0];
  const doorBay = seed % front.bays;
  const balconyBay = floors >= 2 && seed % 2 === 0 ? Math.floor(front.bays / 2) : -1;
  const bayAt = (wl, i, t) => wl.bay * (i + t);
  const door = new Color(['#5b3f2e', '#3f5a52', '#6b3a34'][seed % 3]);
  const cream = new Color('#efe6d4');
  const doorS0 = bayAt(front, doorBay, WIN.frame[0] - 0.02);
  const doorS1 = bayAt(front, doorBay, WIN.frame[1] + 0.02);
  const inset = (WIN.frame[1] - WIN.frame[0]) * front.bay * 0.12;
  if (props >= 1) {
    slab(front, doorS0, doorS1, 0, FLOOR * WIN.head[1], 0, 0.06, cream, { ends: props >= 2 });
    b.quad(front.on(doorS0 + inset, 0, 0.065), front.on(doorS1 - inset, 0, 0.065), front.on(doorS1 - inset, FLOOR * WIN.head[0] - inset, 0.065), front.on(doorS0 + inset, FLOOR * WIN.head[0] - inset, 0.065), door);
  } else {
    b.quad(front.on(doorS0, 0, 0.03), front.on(doorS1, 0, 0.03), front.on(doorS1, FLOOR * WIN.head[1], 0.03), front.on(doorS0, FLOOR * WIN.head[1], 0.03), door);
  }

  // Hip roof on an eave board: the overhang, a board round its edge, the
  // soffit beneath, and slopes rising to a short ridge along the long side.
  const roofColour = new Color(roof);
  const dark = roofColour.clone().multiplyScalar(0.8);
  const o = 0.55;
  const board = 0.24;
  const rise = Math.min(w, d) * 0.3;
  const ridge = Math.max(0, (Math.max(w, d) - Math.min(w, d)) / 2);
  const alongX = w >= d;
  const eave = corners.map(([cx, cz]) => [cx + Math.sign(cx) * o, cz + Math.sign(cz) * o]);
  const low = eave.map(([ex, ez]) => at(ex, h, ez));
  const e = eave.map(([ex, ez]) => at(ex, h + board, ez));
  const fascia = roofColour.clone().lerp(new Color('#c9a58f'), 0.25);
  for (let i = 0; i < 4; i += 1) {
    const n = (i + 1) % 4;
    b.quad(low[i], low[n], e[n], e[i], i % 2 ? fascia.clone().multiplyScalar(0.9) : fascia);
  }
  const top = h + board + rise;
  const r1 = alongX ? at(-ridge, top, 0) : at(0, top, ridge);
  const r2 = alongX ? at(ridge, top, 0) : at(0, top, -ridge);
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
  // The soffit, so the overhang is solid from below: shadowed plaster.
  b.quad(low[3], low[2], low[1], low[0], wallColour.clone().multiplyScalar(0.55));

  if (props < 1) return;

  // A pale cornice under the eaves and a darker painted base course: the
  // two lines that frame every facade in the film.
  const corniceColour = wallColour.clone().lerp(new Color('#f6eedd'), 0.55);
  const baseColour = wallColour.clone().multiplyScalar(0.78);
  for (const wl of walls) {
    slab(wl, -0.1, wl.length + 0.1, h - 0.3, h, 0, 0.1, corniceColour, { top: false, bottom: true });
    slab(wl, -0.05, wl.length + 0.05, 0, 0.5, 0, 0.05, baseColour);
  }

  // Sills (high) and hoods (ultra) standing out of the painted windows.
  if (props >= 2) {
    const stone = new Color('#e8dcc6');
    walls.forEach((wl, wi) => {
      for (let i = 0; i < wl.bays; i += 1) {
        const s0 = bayAt(wl, i, WIN.frame[0] - 0.03);
        const s1 = bayAt(wl, i, WIN.frame[1] + 0.03);
        for (let f = 0; f < floors; f += 1) {
          if (wi === 0 && ((f === 0 && i === doorBay) || (f === 1 && i === balconyBay))) continue;
          const fy = f * FLOOR;
          slab(wl, s0, s1, fy + FLOOR * WIN.sill[0] - 0.05, fy + FLOOR * WIN.sill[1], 0, 0.13, stone, { bottom: props >= 3 });
          if (props >= 3) slab(wl, s0, s1, fy + FLOOR * WIN.head[0], fy + FLOOR * WIN.head[1], 0, 0.08, stone, { bottom: true });
        }
      }
    });
    // A stone step at the door.
    slab(front, doorS0 - 0.1, doorS1 + 0.1, 0, 0.14, 0, 0.35, new Color('#bdb3a3'), { ends: true });
  }

  // A shop on every third house: a striped awning over the ground floor.
  if (seed % 3 === 0) {
    const stripes = [new Color(['#b0463a', '#3f7a6a', '#c9913a'][(seed >> 2) % 3]), new Color('#f2ece0')];
    const n = Math.max(4, Math.round(w * 1.2));
    // Tucked lower under a balcony, so the slab does not cut through it.
    const hi = balconyBay >= 0 ? 2.62 : 2.85;
    const lo = hi - 0.5;
    for (let i = 0; i < n; i += 1) {
      const x0 = -hw + (w * i) / n;
      const x1 = -hw + (w * (i + 1)) / n;
      b.quad(at(x0, lo, hd + 1.1), at(x1, lo, hd + 1.1), at(x1, hi, hd), at(x0, hi, hd), stripes[i % 2]);
      b.quad(at(x1, lo, hd + 1.1), at(x0, lo, hd + 1.1), at(x0, hi, hd), at(x1, hi, hd), stripes[i % 2].clone().multiplyScalar(0.7));
      // A valance hanging from the front edge.
      if (props >= 2) {
        b.quad(at(x0, lo - 0.22, hd + 1.1), at(x1, lo - 0.22, hd + 1.1), at(x1, lo, hd + 1.1), at(x0, lo, hd + 1.1), stripes[i % 2]);
        b.quad(at(x1, lo - 0.22, hd + 1.1), at(x0, lo - 0.22, hd + 1.1), at(x0, lo, hd + 1.1), at(x1, lo, hd + 1.1), stripes[i % 2].clone().multiplyScalar(0.7));
      }
    }
  }

  // A chimney out of the roof on two houses in three, capped on high.
  if (seed % 3 !== 1) {
    const brick = new Color('#9a6450');
    const cx = (alongX ? ridge * 0.6 : 0.6) * (seed % 2 ? 1 : -1);
    const cz = alongX ? 0.5 : ridge * 0.4;
    box(b, at, { cx, cy: top - rise * 0.2, cz, sx: 0.3, sy: rise * 0.2 + 0.7, sz: 0.3 }, brick);
    if (props >= 2) box(b, at, { cx, cy: top + 0.76, cz, sx: 0.38, sy: 0.06, sz: 0.38 }, new Color('#6f4a3d'));
  }

  // A balcony at the first floor on about half the houses, in front of one
  // bay: a stone slab, an iron rail on balusters, and flowers on high.
  if (balconyBay < 0) return;
  const s0 = bayAt(front, balconyBay, WIN.shutters[0] - 0.08);
  const s1 = bayAt(front, balconyBay, WIN.shutters[1] + 0.08);
  const deep = 0.85;
  const floorY = FLOOR - 0.06;
  slab(front, s0, s1, floorY - 0.16, floorY, 0, deep, new Color('#e6dccb'), { bottom: true, ends: true });
  const iron = new Color('#2f343b');
  const railY = floorY + 0.95;
  slab(front, s0, s1, railY - 0.06, railY, deep - 0.06, deep, iron, { bottom: true, ends: props >= 2 });
  const posts = props >= 2 ? Math.round((s1 - s0) / 0.17) : 4;
  const baluster = (P) => {
    b.quad(P(-0.02, floorY), P(0.02, floorY), P(0.02, railY), P(-0.02, railY), iron);
    b.quad(P(0.02, floorY), P(-0.02, floorY), P(-0.02, railY), P(0.02, railY), iron);
  };
  for (let i = 0; i <= posts; i += 1) {
    const s = s0 + 0.04 + ((s1 - s0 - 0.08) * i) / posts;
    baluster((ds, py) => front.on(s + ds, py, deep - 0.03));
  }
  if (props < 2) return;
  // Side rails back to the wall.
  for (const s of [s0 + 0.03, s1 - 0.03]) {
    b.quad(front.on(s, railY - 0.06, 0), front.on(s, railY - 0.06, deep), front.on(s, railY, deep), front.on(s, railY, 0), iron);
    b.quad(front.on(s, railY - 0.06, deep), front.on(s, railY - 0.06, 0), front.on(s, railY, 0), front.on(s, railY, deep), iron);
    for (let k = 1; k < 4; k += 1) {
      const out = (deep * k) / 4;
      const P = (dz, py) => front.on(s, py, out + dz);
      b.quad(P(0.02, floorY), P(-0.02, floorY), P(-0.02, railY), P(0.02, railY), iron);
      b.quad(P(-0.02, floorY), P(0.02, floorY), P(0.02, railY), P(-0.02, railY), iron);
    }
  }
  const blooms = ['#e58fa8', '#f2c14e', '#f4f1ea', '#b99be0'];
  for (let i = 0; i < 3; i += 1) {
    const [fx, fy, fz] = front.on(s0 + (s1 - s0) * (0.2 + i * 0.3), railY - 0.05, deep + 0.08);
    const pot = leaf(getLeafDetail() - 1).clone();
    pot.scale(0.4, 0.3, 0.26);
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

/** A bench: slatted seat and back on iron legs, for the promenades. */
export function bench(b, { x, y = 0, z, turn = 0 }) {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const at = (px, py, pz) => [x + px * cos - pz * sin, y + py, z + px * sin + pz * cos];
  const wood = new Color('#8a6446');
  box(b, at, { cx: 0, cy: 0.45, cz: -0.1, sx: 0.9, sy: 0.03, sz: 0.1 }, wood);
  box(b, at, { cx: 0, cy: 0.45, cz: 0.12, sx: 0.9, sy: 0.03, sz: 0.1 }, wood);
  box(b, at, { cx: 0, cy: 0.68, cz: -0.25, sx: 0.9, sy: 0.07, sz: 0.03 }, wood);
  box(b, at, { cx: 0, cy: 0.9, cz: -0.25, sx: 0.9, sy: 0.07, sz: 0.03 }, wood);
  const iron = new Color('#2f343b');
  for (const side of [-0.8, 0.8]) {
    box(b, at, { cx: side, cy: 0.21, cz: 0, sx: 0.04, sy: 0.21, sz: 0.2 }, iron);
    box(b, at, { cx: side, cy: 0.7, cz: -0.28, sx: 0.04, sy: 0.28, sz: 0.02 }, iron);
  }
}

/**
 * A railing round part of a circle (a promenade edge): posts, a top rail and,
 * on high, a mid rail and stone planters of clipped hedge along the outside.
 */
function railing(b, { x, y = 0, z, radius, from = 0, to = Math.PI * 2, gaps = () => false, props = 1 }) {
  const iron = new Color('#2e5446');
  const stone = new Color('#aaa396');
  const hedge = new Color('#4f8045');
  const steps = Math.max(8, Math.round((radius * (to - from)) / 2));
  const rail = (p0, p1, y0, y1) => {
    b.quad([p0[0], y + y0, p0[1]], [p1[0], y + y0, p1[1]], [p1[0], y + y1, p1[1]], [p0[0], y + y1, p0[1]], iron);
    b.quad([p1[0], y + y0, p1[1]], [p0[0], y + y0, p0[1]], [p0[0], y + y1, p0[1]], [p1[0], y + y1, p1[1]], iron);
  };
  for (let i = 0; i < steps; i += 1) {
    const a0 = from + ((to - from) * i) / steps;
    const a1 = from + ((to - from) * (i + 1)) / steps;
    const p0 = [x + Math.cos(a0) * radius, z + Math.sin(a0) * radius];
    const p1 = [x + Math.cos(a1) * radius, z + Math.sin(a1) * radius];
    if (gaps(p0[0], p0[1]) || gaps(p1[0], p1[1])) continue;
    rail(p0, p1, 0.95, 1.05);
    if (props >= 2) rail(p0, p1, 0.5, 0.56);
    const at = (px, py, pz) => [p0[0] + px, y + py, p0[1] + pz];
    box(b, at, { cx: 0, cy: 0.5, cz: 0, sx: 0.04, sy: 0.5, sz: 0.04 }, iron);
    if (props < 2 || i % 4 !== 2) continue;
    // A planter just outside the rail, square to it.
    const a = (a0 + a1) / 2;
    const tx = -Math.sin(a);
    const tz = Math.cos(a);
    const cx = x + Math.cos(a) * (radius + 0.6);
    const cz = z + Math.sin(a) * (radius + 0.6);
    const local = (px, py, pz) => [cx + px * tx - pz * Math.cos(a), y + py, cz + px * tz - pz * Math.sin(a)];
    box(b, local, { cx: 0, cy: 0.22, cz: 0, sx: 0.85, sy: 0.22, sz: 0.28 }, stone);
    const bush = leaf(Math.min(getLeafDetail() - 1, 1)).clone();
    bush.scale(0.85, 0.32, 0.26);
    bush.rotateY(-a - Math.PI / 2);
    bush.translate(cx, y + 0.5, cz);
    b.addGeometry(bush, hedge);
  }
}

/** A tapering four-sided trunk from a base point up to a top point. */
function trunk(b, base, top, r0, r1, colour) {
  const ring = (p, r) => [
    [p[0] - r, p[1], p[2] - r],
    [p[0] + r, p[1], p[2] - r],
    [p[0] + r, p[1], p[2] + r],
    [p[0] - r, p[1], p[2] + r],
  ];
  const lo = ring(base, r0);
  const hi = ring(top, r1);
  for (let i = 0; i < 4; i += 1) {
    const n = (i + 1) % 4;
    b.quad(lo[n], lo[i], hi[i], hi[n], colour);
  }
}

/** A leaf blob scaled and placed. */
function lobe(b, detail, [px, py, pz], [sx, sy, sz], colour, turn = 0) {
  const g = leaf(detail).clone();
  g.scale(sx, sy, sz);
  if (turn) g.rotateY(turn);
  g.translate(px, py, pz);
  b.addGeometry(g, colour);
}

/**
 * An umbrella pine: a tall leaning trunk that forks under a broad, flat crown
 * of overlapping discs, lit a shade lighter on top - the stone pines that
 * stand over the film's rooftops.
 */
function pine(b, { x, y = 0, z, height = 6, lean = 0.3, seed = 1, props = 1 }) {
  const bark = new Color('#5a4436');
  const dir = [Math.cos(seed), Math.sin(seed)];
  const top = [x + dir[0] * lean, y + height, z + dir[1] * lean];
  trunk(b, [x, y, z], top, 0.18, 0.1, bark);
  const d = getLeafDetail();
  const leaves = new Color(seed % 3 ? '#4f7f48' : '#5a8a4c');
  const lit = leaves.clone().lerp(new Color('#9cc27a'), 0.3);
  const reach = height * 0.28;
  lobe(b, d, [top[0], top[1] + 0.2, top[2]], [height * 0.42, height * 0.1, height * 0.38], leaves, seed);
  const side = [top[0] + dir[0] * reach, top[1] - 0.35, top[2] + dir[1] * reach];
  trunk(b, [top[0], top[1] - 1, top[2]], side, 0.08, 0.05, bark);
  lobe(b, d - 1, [side[0], side[1] + 0.15, side[2]], [height * 0.28, height * 0.08, height * 0.25], leaves, seed + 1);
  if (props < 2) return;
  const back = [top[0] - dir[1] * reach * 0.8, top[1] + 0.25, top[2] + dir[0] * reach * 0.8];
  trunk(b, [top[0], top[1] - 0.8, top[2]], back, 0.07, 0.04, bark);
  lobe(b, d - 2, [back[0], back[1] + 0.15, back[2]], [height * 0.22, height * 0.07, height * 0.2], leaves, seed + 2);
  lobe(b, d - 2, [top[0] - dir[0] * 0.3, top[1] + 0.2 + height * 0.07, top[2] - dir[1] * 0.3], [height * 0.26, height * 0.05, height * 0.24], lit, seed);
}

/**
 * A broadleaf tree: a straight trunk under a round crown of soft clumps, the
 * top clump lighter where the sky catches it.
 */
function broadleaf(b, { x, y = 0, z, height = 5, seed = 1, props = 1 }) {
  trunk(b, [x, y, z], [x, y + height * 0.62, z], 0.16, 0.1, new Color('#5e4636'));
  const leaves = new Color(['#4f7f45', '#5b8c4a', '#46753f'][seed % 3]);
  const lit = leaves.clone().lerp(new Color('#a6c97e'), 0.35);
  const crown = height * 0.32;
  const d = getLeafDetail();
  // Small clumps stay coarse: their silhouette hides under the big one.
  const small = Math.min(d - 1, 1);
  const clumps = [
    [0, 0.74, 0, 1, leaves, d],
    [0.6, 0.64, 0.25, 0.66, leaves, small],
    [-0.5, 0.63, 0.35, 0.62, leaves, small],
    [0.05, 0.62, -0.6, 0.64, leaves, small],
    [-0.15, 0.93, -0.1, 0.58, lit, small],
  ];
  for (const [dx, dy, dz, s, colour, detail] of props >= 1 ? clumps : clumps.slice(0, 3)) {
    const a = seed * 0.7;
    const rx = dx * Math.cos(a) - dz * Math.sin(a);
    const rz = dx * Math.sin(a) + dz * Math.cos(a);
    lobe(b, detail, [x + rx * crown, y + height * dy, z + rz * crown], [crown * s, crown * s * 0.82, crown * s], colour);
  }
}

/** A round bush or garden tree: one soft blob on a short stem. */
function bush(b, { x, y = 0, z, size = 1.2, colour = '#6a9a55' }) {
  lobe(b, getLeafDetail() - 1, [x, y + size * 0.7, z], [size, size * 0.8, size], new Color(colour));
}

/**
 * A lighthouse: a tapering white tower on a stone plinth, a gallery with an
 * iron rail, a glowing lamp room and a dark cap - slit windows up the tower.
 */
function lighthouse(b, { x, y = 0, z, height = 16, props = 1 }) {
  const sides = props >= 2 ? 12 : 8;
  const ang = (i) => (i / sides) * Math.PI * 2;
  const pt = (i, r, py) => [x + Math.cos(ang(i)) * r, y + py, z + Math.sin(ang(i)) * r];
  const band = (r0, y0, r1, y1, colour) => {
    for (let i = 0; i < sides; i += 1) b.quad(pt(i + 1, r0, y0), pt(i, r0, y0), pt(i, r1, y1), pt(i + 1, r1, y1), colour);
  };
  const disc = (r, py, colour, up) => {
    for (let i = 0; i < sides; i += 1) {
      const c = [x, y + py, z];
      if (up) b.tri(c, pt(i + 1, r, py), pt(i, r, py), [PLAIN, PLAIN, PLAIN], colour);
      else b.tri(c, pt(i, r, py), pt(i + 1, r, py), [PLAIN, PLAIN, PLAIN], colour);
    }
  };
  const white = new Color('#ece7dc');
  const stone = new Color('#b3ab9d');
  band(2.7, 0, 2.6, 1.4, stone);
  disc(2.6, 1.4, stone, true);
  band(2.15, 1.4, 1.45, height, white);
  // The gallery: a deck wider than the tower, its rim and underside, and a rail.
  const gallery = new Color('#d9d3c7');
  band(1.45, height - 0.5, 2.2, height, gallery.clone().multiplyScalar(0.7));
  band(2.2, height, 2.2, height + 0.2, gallery);
  disc(2.2, height + 0.2, gallery, true);
  const iron = new Color('#2f343b');
  if (props >= 1) {
    for (let i = 0; i < sides; i += 1) {
      b.quad(pt(i + 1, 2.1, height + 1.05), pt(i, 2.1, height + 1.05), pt(i, 2.1, height + 1.15), pt(i + 1, 2.1, height + 1.15), iron);
      b.quad(pt(i, 2.1, height + 1.05), pt(i + 1, 2.1, height + 1.05), pt(i + 1, 2.1, height + 1.15), pt(i, 2.1, height + 1.15), iron);
      const [px, py, pz] = pt(i, 2.1, height + 0.2);
      box(b, (ax, ay, az) => [px + ax, py + ay, pz + az], { cx: 0, cy: 0.45, cz: 0, sx: 0.04, sy: 0.45, sz: 0.04 }, iron);
    }
    // Slit windows up the tower, facing out on two sides.
    const g = GLASS;
    for (const f of [0.3, 0.5, 0.7]) {
      const py = 1.4 + (height - 1.4) * f;
      const r = (2.15 + (1.45 - 2.15) * f) * Math.cos(Math.PI / sides) + 0.03;
      for (const face of [0, sides / 2]) {
        const a = ang(face) + Math.PI / sides;
        const cx = x + Math.cos(a) * r;
        const cz = z + Math.sin(a) * r;
        const tx = -Math.sin(a) * 0.22;
        const tz = Math.cos(a) * 0.22;
        b.quad([cx + tx, y + py, cz + tz], [cx - tx, y + py, cz - tz], [cx - tx, y + py + 0.9, cz - tz], [cx + tx, y + py + 0.9, cz + tz], new Color('#ffffff'), [g, g, g, g]);
      }
    }
  }
  // Lamp room (window-glass UVs, so it glows at night) under a dark cap.
  const lampY = height + 0.2;
  const glass = new Color('#ffffff');
  const g = GLASS;
  for (let i = 0; i < sides; i += 1) b.quad(pt(i + 1, 1.1, lampY), pt(i, 1.1, lampY), pt(i, 1.1, lampY + 1.8), pt(i + 1, 1.1, lampY + 1.8), glass, [g, g, g, g]);
  const cap = new Color('#3f4a5c');
  band(1.1, lampY + 1.8, 1.55, lampY + 1.8, cap.clone().multiplyScalar(0.6));
  band(1.55, lampY + 1.8, 1.55, lampY + 2.0, cap);
  for (let i = 0; i < sides; i += 1) b.tri(pt(i + 1, 1.55, lampY + 2.0), pt(i, 1.55, lampY + 2.0), [x, y + lampY + 3.3, z], [PLAIN, PLAIN, PLAIN], cap);
}

/**
 * A street lamp: a black post on a plinth with a lantern head - a tapered
 * glass box that glows at night under a pyramid cap.
 */
export function lamp(b, { x, y = 0, z }) {
  const post = new Color('#26292f');
  const h = 3.2;
  const at = (px, py, pz) => [x + px, y + py, z + pz];
  box(b, at, { cx: 0, cy: 0.25, cz: 0, sx: 0.12, sy: 0.25, sz: 0.12 }, post);
  trunk(b, [x, y + 0.5, z], [x, y + h, z], 0.06, 0.045, post);
  b.lights.push([x, y, z]);
  const g = GLASS;
  const glass = new Color('#ffffff');
  const sq = (r, py) => [
    [x - r, y + py, z + r],
    [x + r, y + py, z + r],
    [x + r, y + py, z - r],
    [x - r, y + py, z - r],
  ];
  const lo = sq(0.11, h);
  const hi = sq(0.17, h + 0.52);
  for (let i = 0; i < 4; i += 1) {
    const n = (i + 1) % 4;
    b.quad(lo[i], lo[n], hi[n], hi[i], glass, [g, g, g, g]);
  }
  const eaves = sq(0.23, h + 0.52);
  const tip = [x, y + h + 0.8, z];
  for (let i = 0; i < 4; i += 1) {
    const n = (i + 1) % 4;
    b.tri(eaves[i], eaves[n], tip, [PLAIN, PLAIN, PLAIN], post);
  }
  b.quad(eaves[3], eaves[2], eaves[1], eaves[0], post);
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
  // Roof: a hip roof in two teal tones on a cream eave board.
  const roof = new Color('#2f6e64');
  const dark = roof.clone().multiplyScalar(0.75);
  const o = 0.6;
  const h = 3.35;
  const board = 0.2;
  const rise = 1.6;
  const low = [at(-hw - o, h, hd + o), at(hw + o, h, hd + o), at(hw + o, h, -hd - o), at(-hw - o, h, -hd - o)];
  const e = low.map(([px, py, pz]) => [px, py + board, pz]);
  const trim = new Color('#e9dfc9');
  for (let i = 0; i < 4; i += 1) b.quad(low[i], low[(i + 1) % 4], e[(i + 1) % 4], e[i], trim);
  const r1 = at(0, h + board + rise, hd * 0.45);
  const r2 = at(0, h + board + rise, -hd * 0.45);
  b.tri(e[0], e[1], r1, [PLAIN, PLAIN, PLAIN], roof);
  b.quad(e[1], e[2], r2, r1, dark);
  b.tri(e[2], e[3], r2, [PLAIN, PLAIN, PLAIN], roof);
  b.quad(e[3], e[0], r1, r2, dark);
  b.quad(low[3], low[2], low[1], low[0], dark.clone().multiplyScalar(0.6));
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
 * @param {{ houses?: any[], pines?: any[], bushes?: any[], lighthouses?: any[], lamps?: any[], flowers?: any[], benches?: any[], railings?: any[], kiosks?: any[], railway?: any }} layout
 */
export function createTown(layout, material, quality = { leaf: 1, props: 1 }) {
  setLeafDetail(quality.leaf);
  const b = createBuilder();
  const props = quality.props;
  for (const spec of layout.houses ?? []) house(b, { ...spec, props });
  // Half the trees are umbrella pines, half round broadleaves, as in the film.
  for (const spec of layout.pines ?? []) (spec.seed % 2 ? pine : broadleaf)(b, { ...spec, props });
  for (const spec of layout.bushes ?? []) bush(b, spec);
  for (const spec of layout.lighthouses ?? []) lighthouse(b, { ...spec, props });
  for (const spec of layout.lamps ?? []) lamp(b, spec);
  for (const spec of layout.flowers ?? []) flowers(b, spec);
  for (const spec of layout.benches ?? []) bench(b, spec);
  for (const spec of layout.railings ?? []) railing(b, { ...spec, props });
  for (const spec of layout.kiosks ?? []) kiosk(b, spec);
  const geometry = b.build();
  geometry.computeBoundingSphere();
  return new Mesh(geometry, material);
}
