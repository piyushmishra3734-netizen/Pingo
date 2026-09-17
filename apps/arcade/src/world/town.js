import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  IcosahedronGeometry,
  Mesh,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three';

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
/** A plain plaster spot in the tile, for everything that is not a wall. */
const PLAIN = [0.08, 0.2];
/** A spot on the window glass: things that glow at night (lamps, the lighthouse). */
const GLASS = [0.42, 0.62];

export const WALLS = ['#f3e6c8', '#f1d99a', '#d6e6c8', '#dcd2e8', '#e8b59c', '#f2cfb4', '#eadfcf'];
export const ROOFS = ['#b5503c', '#c8663f', '#9c4a3a', '#b86147'];

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
  c.fillStyle = '#2f3d52';
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
  glow.addColorStop(0, '#ffcf80');
  glow.addColorStop(1, '#ff9a4a');
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

/** A growing pile of triangles, each with position, normal, uv and colour. */
function createBuilder() {
  const position = [];
  const normal = [];
  const uv = [];
  const color = [];
  const scratch = new Color();

  function tri(a, b, c, uvs, colour) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const [p, t] of [
      [a, uvs[0]],
      [b, uvs[1]],
      [c, uvs[2]],
    ]) {
      position.push(...p);
      normal.push(nx, ny, nz);
      uv.push(...t);
      color.push(colour.r, colour.g, colour.b);
    }
  }

  /** A quad a-b-c-d (counter-clockwise seen from outside). */
  function quad(a, b, c, d, colour, uvs = [PLAIN, PLAIN, PLAIN, PLAIN]) {
    tri(a, b, c, [uvs[0], uvs[1], uvs[2]], colour);
    tri(a, c, d, [uvs[0], uvs[2], uvs[3]], colour);
  }

  return {
    tri,
    quad,
    /** Adds a smooth-shaded geometry (leaves, domes) in one colour, UVs on the plain patch. */
    addGeometry(geometry, colour) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      for (let i = 0; i < p.count; i += 1) {
        position.push(p.getX(i), p.getY(i), p.getZ(i));
        normal.push(n.getX(i), n.getY(i), n.getZ(i));
        uv.push(...PLAIN);
        // A little variation per vertex, so leaves read as painted, not flat.
        scratch.copy(colour).offsetHSL(0, 0, (((i * 7919) % 13) / 13 - 0.5) * 0.06);
        color.push(scratch.r, scratch.g, scratch.b);
      }
    },
    build() {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
      geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3));
      return geometry;
    },
  };
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
    const pot = leaf(leafDetail - 1).clone();
    pot.scale(0.45, 0.35, 0.3);
    pot.translate(fx, fy, fz);
    b.addGeometry(pot, new Color(i % 2 ? '#6a9a55' : blooms[(seed + i) % blooms.length]));
  }
}

/** A box from its centre and half-sizes, in a house's local frame (`at`). Top and four sides. */
function box(b, at, { cx, cy, cz, sx, sy, sz }, colour) {
  const p = (dx, dy, dz) => at(cx + dx * sx, cy + dy * sy, cz + dz * sz);
  const side = colour.clone().multiplyScalar(0.88);
  b.quad(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), colour);
  b.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), side);
  b.quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), side);
  b.quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), colour);
  b.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), colour);
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
function bench(b, { x, y = 0, z, turn = 0 }) {
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
  const iron = new Color('#3b4048');
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

/**
 * Leaf blobs, smooth-shaded: on a unit sphere the normal is the position, and
 * `scale()` carries normals along correctly - so a squashed blob still shades
 * like a soft cushion of leaves rather than a cut gem.
 */
function blob(detail) {
  const g = new IcosahedronGeometry(1, detail);
  g.setAttribute('normal', g.getAttribute('position').clone());
  return g;
}
/** Leaf smoothness, set per world from the graphics quality. */
let leafDetail = 1;
const blobs = new Map();
const leaf = (detail) => {
  const d = Math.max(0, detail);
  if (!blobs.has(d)) blobs.set(d, blob(d));
  return blobs.get(d);
};

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
    [0, 0.2, 0, height * 0.5, height * 0.18, height * 0.45, leaf(leafDetail)],
    [height * 0.25, 0.5, height * 0.1, height * 0.32, height * 0.14, height * 0.3, leaf(leafDetail - 1)],
  ]) {
    const lobe = shape.clone();
    lobe.scale(sx, sy, sz);
    lobe.rotateY(seed);
    lobe.translate(top[0] + dx * Math.cos(seed), top[1] + dy, top[2] + dx * Math.sin(seed) + dz);
    b.addGeometry(lobe, leaves);
  }
}

/** A round bush or garden tree: one soft blob on a short stem. */
function bush(b, { x, y = 0, z, size = 1.2, colour = '#6a9a55' }) {
  const blob = leaf(leafDetail - 1).clone();
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
function lamp(b, { x, y = 0, z }) {
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
 * The elevated line: a smooth closed curve through the islands, two rails and
 * wooden sleepers, and a slim post down to the island or rock beneath where
 * one is close enough to stand on.
 */
function railway(b, { curve, gauge = 2.4, sleeperEvery = 2.2, railEvery = 4.5 }) {
  const length = curve.getLength();
  const wood = new Color('#7a5a40');
  const woodDark = new Color('#5e4431');
  const steel = new Color('#4a4f58');
  const up = new Vector3(0, 1, 0);
  const sample = (every) => {
    const count = Math.ceil(length / every);
    return Array.from({ length: count + 1 }, (_, i) => {
      const t = i / count;
      const tangent = curve.getTangentAt(t);
      return { p: curve.getPointAt(t), tangent, side: new Vector3().crossVectors(tangent, up).normalize() };
    });
  };
  // Sleepers close together, the long parts (rails, girder) in coarser steps:
  // on a smooth curve 4.5 m chords cannot be told from a true curve.
  const sleepers = sample(sleeperEvery);
  const frames = sample(railEvery);
  const v = (vec) => [vec.x, vec.y, vec.z];
  const offset = (f, across, height, along = 0) =>
    v(f.p.clone().addScaledVector(f.side, across).addScaledVector(up, height).addScaledVector(f.tangent, along));

  // Sleepers: a flat plank with a front and back edge.
  // The top and the side that faces along the line are all that ever shows.
  for (const f of sleepers.slice(0, -1)) {
    const w = gauge / 2 + 0.75;
    const l = 0.34;
    const a = offset(f, -w, 0.12, -l);
    const bq = offset(f, w, 0.12, -l);
    const c = offset(f, w, 0.12, l);
    const d = offset(f, -w, 0.12, l);
    b.quad(a, bq, c, d, wood);
    b.quad(offset(f, w, 0, -l), offset(f, -w, 0, -l), a, bq, woodDark);
  }
  // Rails: continuous ribbons with a top and two sides.
  for (const across of [-gauge / 2, gauge / 2]) {
    for (let i = 0; i < frames.length - 1; i += 1) {
      const f0 = frames[i];
      const f1 = frames[i + 1];
      const r = 0.1;
      b.quad(offset(f0, across - r, 0.34), offset(f0, across + r, 0.34), offset(f1, across + r, 0.34), offset(f1, across - r, 0.34), steel);
      b.quad(offset(f0, across + r, 0.12), offset(f1, across + r, 0.12), offset(f1, across + r, 0.34), offset(f0, across + r, 0.34), steel);
      b.quad(offset(f1, across - r, 0.12), offset(f0, across - r, 0.12), offset(f0, across - r, 0.34), offset(f1, across - r, 0.34), steel);
    }
  }
  // Under-girder: one dark beam beneath the centre line, so the track reads as a bridge.
  for (let i = 0; i < frames.length - 1; i += 1) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    const g = 0.6;
    b.quad(offset(f1, -g, -0.9), offset(f1, g, -0.9), offset(f0, g, -0.9), offset(f0, -g, -0.9), woodDark);
    b.quad(offset(f0, g, -0.9), offset(f1, g, -0.9), offset(f1, g, 0), offset(f0, g, 0), woodDark);
    b.quad(offset(f1, -g, -0.9), offset(f0, -g, -0.9), offset(f0, -g, 0), offset(f1, -g, 0), woodDark);
  }
  return curve;
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
    emissive: new Color('#ffb45c'),
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
  leafDetail = quality.leaf;
  const b = createBuilder();
  for (const spec of layout.houses ?? []) house(b, { ...spec, props: quality.props });
  for (const spec of layout.pines ?? []) pine(b, spec);
  for (const spec of layout.bushes ?? []) bush(b, spec);
  for (const spec of layout.lighthouses ?? []) lighthouse(b, spec);
  for (const spec of layout.lamps ?? []) lamp(b, spec);
  for (const spec of layout.flowers ?? []) flowers(b, spec);
  for (const spec of layout.benches ?? []) bench(b, spec);
  for (const spec of layout.railings ?? []) railing(b, spec);
  for (const spec of layout.kiosks ?? []) kiosk(b, spec);
  if (layout.railway) railway(b, layout.railway);
  const geometry = b.build();
  geometry.computeBoundingSphere();
  return new Mesh(geometry, material);
}

/**
 * A station: a raised platform beside the line, a canopy on slim posts along
 * it, benches under the canopy and lamps at the ends.
 *
 * @param {{ curve: import('three').Curve<Vector3>, from: number, to: number, side?: 1 | -1 }} spec
 *   from/to: where along the line (0-1) the platform runs; side: which side of the track
 */
function station(b, { curve, from, to, side = 1 }) {
  const up = new Vector3(0, 1, 0);
  const steps = Math.max(4, Math.round((to - from) * curve.getLength() / 3));
  const stone = new Color('#e7dfcf');
  const edge = new Color('#c9bda6');
  const post = new Color('#3b4048');
  const canopy = new Color('#2f6e64');
  const frame = (t) => {
    const p = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const across = new Vector3().crossVectors(tangent, up).normalize().multiplyScalar(side);
    return { p, across };
  };
  const at = (f, out, height) => [f.p.x + f.across.x * out, f.p.y + height, f.p.z + f.across.z * out];
  for (let i = 0; i < steps; i += 1) {
    const f0 = frame(from + ((to - from) * i) / steps);
    const f1 = frame(from + ((to - from) * (i + 1)) / steps);
    // Platform top (from 2.1 m to 5.6 m off the centre line), and its face to the track.
    const flip = side < 0;
    const q = (a, bq, c, d, colour) => (flip ? b.quad(d, c, bq, a, colour) : b.quad(a, bq, c, d, colour));
    q(at(f0, 2.1, 0.75), at(f0, 5.6, 0.75), at(f1, 5.6, 0.75), at(f1, 2.1, 0.75), stone);
    q(at(f1, 2.1, -0.3), at(f1, 2.1, 0.75), at(f0, 2.1, 0.75), at(f0, 2.1, -0.3), edge);
    // Canopy: a sloped roof over the back half of the platform, both faces.
    q(at(f0, 2.4, 3.9), at(f0, 5.8, 4.4), at(f1, 5.8, 4.4), at(f1, 2.4, 3.9), canopy);
    q(at(f1, 2.4, 3.9), at(f1, 5.8, 4.4), at(f0, 5.8, 4.4), at(f0, 2.4, 3.9), canopy.clone().multiplyScalar(0.7));
    if (i % 2 === 0) {
      const [px, py, pz] = at(f0, 4.9, 0.75);
      const at2 = (dx, dy, dz) => [px + dx, py + dy, pz + dz];
      box(b, at2, { cx: 0, cy: 1.8, cz: 0, sx: 0.06, sy: 1.8, sz: 0.06 }, post);
    }
    if (i % 4 === 1) {
      const [px, py, pz] = at(f0, 4.6, 0.75);
      bench(b, { x: px, y: py, z: pz, turn: Math.atan2(f0.across.x, f0.across.z) + Math.PI });
    }
  }
  const [lx, ly, lz] = at(frame(from), 3.2, 0.75);
  lamp(b, { x: lx, y: ly, z: lz });
  const [mx, my, mz] = at(frame(to), 3.2, 0.75);
  lamp(b, { x: mx, y: my, z: mz });
}

/** Stations along the line, as one mesh. */
export function createStations(specs, material) {
  const b = createBuilder();
  for (const spec of specs) station(b, spec);
  const geometry = b.build();
  geometry.computeBoundingSphere();
  return new Mesh(geometry, material);
}

/** The tram's own window tile: an arched window with passengers in it, over wood panelling. */
function tramTexture() {
  const w = 128;
  const h = 128;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')];
  };
  const [colour, c] = make();
  const [glow, e] = make();
  c.fillStyle = '#f2ece0';
  c.fillRect(0, 0, w, h);
  // Panelling below the windows.
  c.fillStyle = '#d9cfbd';
  c.fillRect(0, 84, w, 44);
  c.fillStyle = 'rgba(80,60,40,0.25)';
  for (let x = 0; x < w; x += 16) c.fillRect(x, 88, 2, 40);
  e.fillStyle = '#000';
  e.fillRect(0, 0, w, h);
  // The arched window and the people behind it.
  const arch = (ctx, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(18, 78);
    ctx.lineTo(18, 34);
    ctx.arc(64, 34, 46, Math.PI, 0);
    ctx.lineTo(110, 78);
    ctx.closePath();
    ctx.fill();
  };
  arch(c, '#2b3a4f');
  const warm = e.createLinearGradient(0, 10, 0, 78);
  warm.addColorStop(0, '#ffe2ad');
  warm.addColorStop(1, '#f6b46f');
  arch(e, warm);
  for (const [ctx, fill] of [
    [c, '#1d2533'],
    [e, '#7a3f1f'],
  ]) {
    ctx.fillStyle = fill;
    for (const [x, s] of [
      [44, 1],
      [82, 0.9],
    ]) {
      ctx.beginPath();
      ctx.arc(x, 50, 9 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, 78, 16 * s, 16 * s, 0, Math.PI, 0);
      ctx.fill();
    }
  }
  const texture = (canvas) => {
    const t = new CanvasTexture(canvas);
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    return t;
  };
  return { map: texture(colour), emissive: texture(glow) };
}

/**
 * The tram: a wooden driving car and a long green carriage, arched windows
 * with passengers lit warm down both sides, a headlamp and a trolley pole.
 * Built along +z around its own origin; the world moves it along the line.
 */
export function createTram(palette) {
  const { map, emissive } = tramTexture();
  const material = new MeshLambertMaterial({
    map,
    vertexColors: true,
    emissive: new Color('#ffb45c'),
    emissiveMap: emissive,
    // Lit a little even by day: people are aboard.
    emissiveIntensity: Math.max(0.2, palette.windows * 0.7),
  });
  const PLAIN_T = [0.05, 0.95];
  const cars = [
    { length: 5.5, body: '#8a5c3e', roof: '#4e3526', front: true },
    { length: 10, body: '#3d8a7b', roof: '#28604f', front: false },
  ];
  return cars.map(({ length, body, roof, front }) => {
    const b = createBuilder();
    const at = (px, py, pz) => [px, py, pz];
    const hw = 1.35;
    const hl = length / 2;
    const base = 0.7;
    const top = 3.3;
    const wall = new Color(body);
    const bays = Math.max(2, Math.round(length / 1.7));
    const side = (ax, az, bx, bz, count, colour) =>
      b.quad(at(ax, base, az), at(bx, base, bz), at(bx, top, bz), at(ax, top, az), colour, [
        [0, 0],
        [count, 0],
        [count, 1],
        [0, 1],
      ]);
    const light = new Color('#ffffff').lerp(wall, 0.35);
    side(-hw, hl, hw, hl, 1, light);
    side(hw, hl, hw, -hl, bays, light);
    side(hw, -hl, -hw, -hl, 1, light);
    side(-hw, -hl, -hw, hl, bays, light);
    // Coloured skirt and roof line in the car's own colour.
    const plain = [PLAIN_T, PLAIN_T, PLAIN_T, PLAIN_T];
    for (const [ax, az, bx, bz] of [
      [-hw - 0.02, hl + 0.02, hw + 0.02, hl + 0.02],
      [hw + 0.02, hl + 0.02, hw + 0.02, -hl - 0.02],
      [hw + 0.02, -hl - 0.02, -hw - 0.02, -hl - 0.02],
      [-hw - 0.02, -hl - 0.02, -hw - 0.02, hl + 0.02],
    ]) {
      b.quad(at(ax, base, az), at(bx, base, bz), at(bx, base + 0.75, bz), at(ax, base + 0.75, az), wall, plain);
      b.quad(at(ax, top - 0.35, az), at(bx, top - 0.35, bz), at(bx, top, bz), at(ax, top, az), wall, plain);
    }
    const r = new Color(roof);
    b.quad(at(-hw - 0.15, top, hl + 0.2), at(0, top + 0.45, hl + 0.2), at(0, top + 0.45, -hl - 0.2), at(-hw - 0.15, top, -hl - 0.2), r, plain);
    b.quad(at(0, top + 0.45, hl + 0.2), at(hw + 0.15, top, hl + 0.2), at(hw + 0.15, top, -hl - 0.2), at(0, top + 0.45, -hl - 0.2), r, plain);
    b.quad(at(-hw - 0.15, top, -hl - 0.2), at(hw + 0.15, top, -hl - 0.2), at(hw + 0.15, top, hl + 0.2), at(-hw - 0.15, top, hl + 0.2), r.clone().multiplyScalar(0.6), plain);
    const dark = new Color('#2f3238');
    const tbox = (spec, colour) => {
      const p = (dx, dy, dz) => at(spec.cx + dx * spec.sx, spec.cy + dy * spec.sy, spec.cz + dz * spec.sz);
      const sideC = colour.clone().multiplyScalar(0.88);
      b.quad(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), colour, plain);
      b.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), sideC, plain);
      b.quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), sideC, plain);
      b.quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), colour, plain);
      b.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), colour, plain);
    };
    tbox({ cx: 0, cy: 0.45, cz: 0, sx: hw * 0.8, sy: 0.3, sz: hl * 0.85 }, dark);
    // Bogies at each end.
    for (const z of [-hl * 0.65, hl * 0.65]) tbox({ cx: 0, cy: 0.25, cz: z, sx: hw * 0.9, sy: 0.22, sz: 0.7 }, new Color('#23262b'));
    if (front) {
      // Headlamp: a small lit box on the nose (window-glass UVs glow).
      const g = [0.2, 0.62];
      b.quad(at(-0.25, 1.6, hl + 0.06), at(0.25, 1.6, hl + 0.06), at(0.25, 2.0, hl + 0.06), at(-0.25, 2.0, hl + 0.06), new Color('#ffffff'), [g, g, g, g]);
      // Trolley pole reaching back up to the (unseen) wire.
      tbox({ cx: 0, cy: top + 0.6, cz: -0.4, sx: 0.05, sy: 0.05, sz: 2.2 }, dark);
      tbox({ cx: 0, cy: top + 0.5, cz: 1.4, sx: 0.25, sy: 0.08, sz: 0.25 }, dark);
    }
    const geometry = b.build();
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.userData.length = length;
    return mesh;
  });
}
