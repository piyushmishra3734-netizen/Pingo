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
function house(b, { x, y = 0, z, w, d, floors = 2, turn = 0, wall = WALLS[0], roof = ROOFS[0] }) {
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
    b.quad(d, c, bq, a, wood);
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
 * @param {{ houses?: any[], pines?: any[], bushes?: any[], lighthouses?: any[], lamps?: any[], railway?: any }} layout
 * @param {{ windows: number }} palette
 */
export function createTown(layout, palette, quality = { leaf: 1 }) {
  leafDetail = quality.leaf;
  const b = createBuilder();
  for (const spec of layout.houses ?? []) house(b, spec);
  for (const spec of layout.pines ?? []) pine(b, spec);
  for (const spec of layout.bushes ?? []) bush(b, spec);
  for (const spec of layout.lighthouses ?? []) lighthouse(b, spec);
  for (const spec of layout.lamps ?? []) lamp(b, spec);
  if (layout.railway) railway(b, layout.railway);
  const { map, emissive } = bayTexture();
  const material = new MeshLambertMaterial({
    map,
    vertexColors: true,
    emissive: new Color('#ffb45c'),
    emissiveMap: emissive,
    emissiveIntensity: palette.windows,
  });
  const mesh = new Mesh(b.build(), material);
  mesh.frustumCulled = false;
  return { mesh };
}

