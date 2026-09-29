import { encodeQr, mixRgb as mix, type Rgb } from './qr.js';

/**
 * A voxel garden: the tree, the lawn and the cat drawn as real blocks, the way
 * the sakura invite artwork draws them.
 *
 * Samples for choosing a look, shown at `/dev/garden-lab`. Nothing ships from
 * here yet; `VoxelQr` is still what the invite card plays.
 *
 * Everything is cubes seen from a true isometric camera. The garden does not
 * move, so it is drawn once into two layers (the ground, then the tree) and
 * each frame only redraws the cat between them, plus a sway and some falling
 * petals. That keeps a scene of ten thousand blocks cheap enough for a phone.
 */

/** A cube. World units are QR modules; `s` is 1 or 0.5. */
interface Vox {
  x: number;
  y: number;
  z: number;
  s: number;
  c: Rgb;
  /** Top face colour when it differs from the sides. */
  top?: Rgb;
  /** Which faces are hidden by a neighbour: 1 top, 2 +x, 4 +y. */
  hide?: number;
}

export type CatKind = 'black' | 'ginger' | 'snow';
export type TreeKind = 'clumps' | 'dome';
export type GrassKind = 'tufts' | 'meadow';

export interface GardenOptions {
  value: string;
  size: number;
  cat: CatKind;
  tree: TreeKind;
  grass: GrassKind;
}

const css = (c: Rgb, k = 1) => `rgb(${(c[0] * k) | 0},${(c[1] * k) | 0},${(c[2] * k) | 0})`;

/** A small deterministic hash, so the same garden grows every time. */
function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ---- drawing -------------------------------------------------------------- */

interface Proj {
  ox: number;
  oy: number;
  u: number;
}

const ISO = Math.cos(Math.PI / 6);
const sx = (p: Proj, x: number, y: number) => p.ox + (x - y) * p.u * ISO;
const sy = (p: Proj, x: number, y: number, z: number) => p.oy + (x + y) * p.u * 0.5 - z * p.u;

/** Faces lit from above and to the left: top brightest, then the left, then the right. */
const SHADE_LEFT = 0.8;
const SHADE_RIGHT = 0.64;

function face(ctx: CanvasRenderingContext2D, p: Proj, pts: [number, number, number][], fill: string) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 1) {
    const [x, y, z] = pts[i]!;
    if (i === 0) ctx.moveTo(sx(p, x, y), sy(p, x, y, z));
    else ctx.lineTo(sx(p, x, y), sy(p, x, y, z));
  }
  ctx.closePath();
  ctx.fill();
  // The same colour round the edge, so neighbouring faces meet without a hairline.
  ctx.stroke();
}

function drawVox(ctx: CanvasRenderingContext2D, p: Proj, v: Vox) {
  const { x, y, z, s } = v;
  const h = v.hide ?? 0;
  const X = x + s;
  const Y = y + s;
  const Z = z + s;
  if (!(h & 4)) face(ctx, p, [[x, Y, Z], [X, Y, Z], [X, Y, z], [x, Y, z]], css(v.c, SHADE_LEFT));
  if (!(h & 2)) face(ctx, p, [[X, y, Z], [X, Y, Z], [X, Y, z], [X, y, z]], css(v.c, SHADE_RIGHT));
  if (!(h & 1)) face(ctx, p, [[x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]], css(v.top ?? v.c));
}

/** Painter's order: further from the camera first. Centres, so both sizes sort together. */
const depth = (v: Vox) => v.x + v.y + v.z + v.s * 1.5;

function drawAll(ctx: CanvasRenderingContext2D, p: Proj, list: Vox[]) {
  ctx.lineWidth = 0.6;
  ctx.lineJoin = 'round';
  const sorted = [...list].sort((a, b) => depth(a) - depth(b));
  for (const v of sorted) drawVox(ctx, p, v);
}

/**
 * Hides the faces a neighbour covers and drops blocks buried on every side a
 * camera could see. Only against blocks of the same size.
 */
function cull(list: Vox[]): Vox[] {
  const key = (x: number, y: number, z: number, s: number) =>
    `${s}:${Math.round(x / s)},${Math.round(y / s)},${Math.round(z / s)}`;
  const taken = new Set(list.map((v) => key(v.x, v.y, v.z, v.s)));
  const out: Vox[] = [];
  for (const v of list) {
    let hide = 0;
    if (taken.has(key(v.x, v.y, v.z + v.s, v.s))) hide |= 1;
    if (taken.has(key(v.x + v.s, v.y, v.z, v.s))) hide |= 2;
    if (taken.has(key(v.x, v.y + v.s, v.z, v.s))) hide |= 4;
    if (hide === 7) continue;
    out.push({ ...v, hide });
  }
  return out;
}

/* ---- the tree ------------------------------------------------------------- */

const BARK: Rgb[] = [
  [128, 86, 58],
  [108, 72, 48],
  [142, 98, 66],
];
const BLOSSOM_DEEP: Rgb = [226, 112, 150];
const BLOSSOM: Rgb = [246, 150, 184];
const BLOSSOM_LIGHT: Rgb = [255, 196, 216];
const FLOWER: Rgb = [255, 234, 242];
const POLLEN: Rgb = [255, 206, 96];

/** Trunk height, in modules. */
const TRUNK_H = 11;

interface Clump {
  x: number;
  y: number;
  z: number;
  r: number;
}

function clumps(kind: TreeKind): Clump[] {
  if (kind === 'clumps') {
    // A crown of separate puffs on branches, like a cherry you can see through.
    const out: Clump[] = [{ x: 0, y: 0, z: TRUNK_H + 8, r: 4.8 }];
    for (let k = 0; k < 6; k += 1) {
      const a = (k / 6) * Math.PI * 2 + 0.4;
      const d = k % 2 ? 9 : 7.6;
      out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, z: TRUNK_H + 3 + (k % 3) * 1.5, r: 3.8 + (k % 2) * 0.7 });
    }
    return out;
  }
  // One wide, bumpy dome: many small puffs on a flattened half sphere.
  const out: Clump[] = [{ x: 0, y: 0, z: TRUNK_H + 5, r: 6 }];
  const R = 9;
  for (let ring = 0; ring < 3; ring += 1) {
    const tilt = (ring / 3) * (Math.PI / 2) + 0.15;
    const count = [10, 7, 4][ring]!;
    for (let k = 0; k < count; k += 1) {
      const a = (k / count) * Math.PI * 2 + ring * 0.5;
      out.push({
        x: Math.cos(a) * Math.cos(tilt) * R,
        y: Math.sin(a) * Math.cos(tilt) * R,
        z: TRUNK_H + 3.5 + Math.sin(tilt) * R * 0.6,
        r: 4.2 + hash(ring, k) * 1.4,
      });
    }
  }
  return out;
}

function buildTree(kind: TreeKind): Vox[] {
  const S = 0.5;
  const cells = new Map<string, Vox>();
  const put = (x: number, y: number, z: number, c: Rgb, top?: Rgb) => {
    cells.set(`${x},${y},${z}`, { x: x * S, y: y * S, z: z * S, s: S, c, top });
  };

  // The trunk: round, flaring into roots at the foot, bark in vertical streaks.
  const height = TRUNK_H / S;
  for (let z = 0; z < height + 4; z += 1) {
    const r = z < 3 ? 3.4 - z * 0.3 : 2.5;
    for (let x = -4; x <= 4; x += 1) {
      for (let y = -4; y <= 4; y += 1) {
        if (Math.hypot(x, y) > r) continue;
        const streak = BARK[(Math.abs(x * 3 + y) + (z >> 2)) % 3]!;
        put(x, y, z, streak);
      }
    }
  }

  const crown = clumps(kind);

  // Branches, from the top of the trunk out to each puff.
  for (const c of crown) {
    const from = [0, 0, height - 2];
    const to = [c.x / S, c.y / S, c.z / S - c.r];
    const steps = Math.ceil(Math.hypot(to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / Math.max(1, steps);
      const bx = Math.round(from[0]! + (to[0]! - from[0]!) * t);
      const by = Math.round(from[1]! + (to[1]! - from[1]!) * t);
      const bz = Math.round(from[2]! + (to[2]! - from[2]!) * t);
      const w = t < 0.5 ? 1 : 0;
      for (let dx = -w; dx <= w; dx += 1) for (let dy = -w; dy <= w; dy += 1) put(bx + dx, by + dy, bz, BARK[1]!);
    }
  }

  const bloom = new Set<string>();
  // The blossom: each puff a noisy ball, pale on top, deep underneath, speckled with flowers.
  for (const c of crown) {
    const r = c.r / S;
    const cx = c.x / S;
    const cy = c.y / S;
    const cz = c.z / S;
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
        for (let z = Math.floor(cz - r * 0.85 - 1); z <= cz + r * 0.85 + 1; z += 1) {
          // A flat-ish underside, so the trunk shows beneath the crown.
          if (z * S < TRUNK_H - 1.5) continue;
          const d = Math.hypot(x - cx, y - cy, (z - cz) / 0.85);
          const edge = r * (0.86 + 0.22 * hash(x, y, z));
          if (d > edge) continue;
          // Height in the puff, and a tilt toward the light, picks the pink.
          const up = (z - (cz - r * 0.85)) / (r * 1.7);
          const lit = up * 0.8 + ((cx - x + cy - y) / r) * 0.1 + (hash(z, x, y) - 0.5) * 0.14;
          let col = lit < 0.35 ? mix(BLOSSOM_DEEP, BLOSSOM, lit / 0.35) : mix(BLOSSOM, BLOSSOM_LIGHT, Math.min(1, (lit - 0.35) / 0.55));
          put(x, y, z, col);
          bloom.add(`${x},${y},${z}`);
        }
      }
    }
  }

  /*
   * Flowers: little five-petal blossoms stamped on the outside of the crown,
   * each lying flat on whichever side of its block faces out - the top, or
   * one of the two sides the camera sees. A pale cross of petals round a
   * darker heart is what turns a pink mass into a tree in flower.
   */
  const has = (x: number, y: number, z: number) => cells.has(`${x},${y},${z}`);
  const paint = (x: number, y: number, z: number, c: Rgb) => {
    const key = `${x},${y},${z}`;
    const v = cells.get(key);
    if (v && bloom.has(key)) v.c = c;
  };
  for (const key of bloom) {
    const [x, y, z] = key.split(',').map(Number) as [number, number, number];
    if (hash(x * 13, y * 17, z * 19) > 0.05) continue;
    let axes: [number, number, number][] | undefined;
    if (!has(x, y, z + 1)) axes = [[1, 0, 0], [0, 1, 0]];
    else if (!has(x + 1, y, z)) axes = [[0, 1, 0], [0, 0, 1]];
    else if (!has(x, y + 1, z)) axes = [[1, 0, 0], [0, 0, 1]];
    if (!axes) continue;
    for (const [a, b, c] of axes) {
      paint(x + a, y + b, z + c, FLOWER);
      paint(x - a, y - b, z - c, FLOWER);
    }
    paint(x, y, z, hash(x, z, y) < 0.5 ? POLLEN : BLOSSOM_DEEP);
  }

  return cull([...cells.values()]);
}

/* ---- the lawn ------------------------------------------------------------- */

const GRASS: Rgb[] = [
  [92, 170, 62],
  [110, 190, 70],
  [78, 150, 52],
];
const GRASS_TIP: Rgb = [176, 226, 104];
const DAISY: Rgb = [255, 255, 255];
const PINK_FLOWER: Rgb = [255, 150, 186];
const MODULE: Rgb = [132, 132, 142];
const FINDER: Rgb = [72, 146, 58];

/** Width of the grass border round the code, in modules. */
const BORDER = 3;

interface Lawn {
  voxels: Vox[];
  /** Flat tiles on the ground: the code's modules and fallen petals. */
  tiles: { x: number; y: number; w: number; c: Rgb }[];
  half: number;
}

function buildLawn(value: string, kind: GrassKind): Lawn {
  const modules = encodeQr(value, 'M');
  const n = modules.length;
  const half = n / 2 + BORDER;
  const tiles: Lawn['tiles'] = [];
  const isFinder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (!modules[y]?.[x]) continue;
      tiles.push({ x: x - n / 2, y: y - n / 2, w: 1, c: isFinder(x, y) ? FINDER : MODULE });
    }
  }
  // Petals on the white, fallen from the tree.
  for (let i = 0; i < 40; i += 1) {
    const a = i * 2.39996;
    const r = (n / 2 - 1) * Math.sqrt(hash(i, 3));
    tiles.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, w: 0.55, c: PINK_FLOWER });
  }

  const S = 0.5;
  const voxels: Vox[] = [];
  const meadow = kind === 'meadow';
  const cellsPer = half / S;
  for (let gx = -cellsPer; gx < cellsPer; gx += 1) {
    for (let gy = -cellsPer; gy < cellsPer; gy += 1) {
      const x = gx * S;
      const y = gy * S;
      const inner = Math.max(Math.abs(x + S / 2), Math.abs(y + S / 2)) < n / 2 + (meadow ? 0.2 : 0.4);
      if (inner) continue;
      const shade = GRASS[Math.floor(hash(gx, gy) * 3)]!;
      // A clump every few cells, taller in the meadow.
      const tall = hash(gx, gy, 9);
      const h = meadow ? (tall < 0.5 ? 1 : tall < 0.8 ? 2 : tall < 0.94 ? 3 : 4) : tall < 0.55 ? 1 : tall < 0.88 ? 2 : 3;
      for (let k = 0; k < h; k += 1) {
        const tip = k === h - 1 && h > 1;
        voxels.push({ x, y, z: k * S, s: S, c: tip ? mix(shade, GRASS_TIP, 0.55) : shade });
      }
      const bloom = hash(gx * 3, gy * 7, 1);
      if (bloom < (meadow ? 0.1 : 0.045)) {
        const c = meadow && bloom < 0.035 ? PINK_FLOWER : DAISY;
        voxels.push({ x, y, z: h * S, s: S, c, top: bloom < 0.02 ? POLLEN : c });
      }
    }
  }
  return { voxels: cull(voxels), tiles, half };
}

/* ---- the cat -------------------------------------------------------------- */

interface Coat {
  body: Rgb;
  /** Stripes or patches. */
  mark: Rgb;
  paw: Rgb;
  ear: Rgb;
  eye: Rgb;
  cheek: Rgb;
  nose: Rgb;
  muzzle: Rgb;
}

const COATS: Record<CatKind, Coat> = {
  black: {
    body: [40, 36, 50],
    mark: [40, 36, 50],
    paw: [250, 250, 252],
    ear: [255, 150, 186],
    eye: [245, 245, 250],
    cheek: [255, 138, 176],
    nose: [255, 138, 176],
    muzzle: [40, 36, 50],
  },
  ginger: {
    body: [246, 160, 78],
    mark: [214, 116, 46],
    paw: [255, 250, 244],
    ear: [255, 170, 176],
    eye: [58, 40, 38],
    cheek: [255, 128, 128],
    nose: [236, 100, 110],
    muzzle: [255, 250, 244],
  },
  snow: {
    body: [250, 248, 252],
    mark: [150, 148, 166],
    paw: [250, 248, 252],
    ear: [255, 160, 190],
    eye: [52, 48, 66],
    cheek: [255, 160, 190],
    nose: [245, 120, 150],
    muzzle: [250, 248, 252],
  },
};

/**
 * The cat, facing +x, in half-module cubes: a round body on four short legs,
 * a big head, ears with pink insides, a tail up in a curl.
 *
 * `step` drives the walk: diagonal pairs of legs lift in turn, the body bobs
 * with them and the tail swings.
 */
function catModel(kind: CatKind, step: number): Vox[] {
  const k = COATS[kind];
  const out: [number, number, number, Rgb][] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: (x: number, y: number, z: number) => Rgb) => {
    for (let x = x0; x < x1; x += 1) for (let y = y0; y < y1; y += 1) for (let z = z0; z < z1; z += 1) out.push([x, y, z, c(x, y, z)]);
  };

  const swing = Math.sin(step);
  const liftA = swing > 0.2 ? 1 : 0;
  const liftB = swing < -0.2 ? 1 : 0;
  const bob = liftA || liftB ? 1 : 0;

  // Legs: short, and diagonal pairs move together, the way a cat walks.
  const legs: [number, number, number][] = [
    [6, 0, liftA],
    [0, 3, liftA],
    [6, 3, liftB],
    [0, 0, liftB],
  ];
  for (const [lx, ly, lift] of legs) {
    const reach = lift ? 1 : 0;
    box(lx + reach, lx + reach + 2, ly, ly + 2, lift, 2 + bob, (_x, _y, z) => (z === lift ? k.paw : k.body));
  }

  // Stripes across the back for the tabby, soft patches for the white cat.
  const coat = (x: number, y: number, z: number): Rgb => {
    if (kind === 'ginger' && z >= 5 + bob && x % 2 === 0) return k.mark;
    if (kind === 'snow' && hash(x >> 1, (y + 4) >> 1, 4) < 0.2 && z >= 4 + bob && x < 6) return k.mark;
    return k.body;
  };
  // A short round body: the head is the star.
  box(0, 8, 0, 5, 2 + bob, 6 + bob, coat);

  /*
   * The head: big, wide and forward, the proportions of a chibi cat. Nine
   * cubes wide so the face has a middle column for the nose, and the eyes are
   * happy closed arches either side of it.
   */
  const hz = 3 + bob;
  box(6, 13, -2, 7, hz, hz + 7, (x, y, z) => {
    const row = z - hz;
    if (x !== 12) return kind === 'ginger' && row >= 5 && x % 2 === 0 ? k.mark : k.body;
    // The face itself is drawn on afterwards (see `paintFace`); only the muzzle is blocks.
    if (row <= 1 && y >= 1 && y <= 3) return k.muzzle;
    return k.body;
  });

  // Ears: pink inside, a tip leaning out.
  for (const [inner, outer] of [[-1, -2], [5, 6]] as const) {
    const top = hz + 7;
    out.push([11, outer, top, k.body]);
    out.push([12, outer, top, k.body]);
    out.push([11, inner, top, k.body]);
    out.push([12, inner, top, k.ear]);
    out.push([12, outer, top + 1, k.body]);
    out.push([11, outer, top + 1, k.body]);
  }

  // Tail: up from the rump in a curl that swings as it walks.
  const sway = Math.round(Math.sin(step * 0.5) * 1);
  const tail: [number, number, number][] = [
    [-1, 0, 4],
    [-2, 0, 5],
    [-2, 0, 6],
    [-2, sway, 7],
    [-2, sway, 8],
    [-1, sway, 9],
    [0, sway, 9],
  ];
  for (const [tx, ty, tz] of tail) {
    const c = kind === 'ginger' && tz % 2 === 0 ? k.mark : k.body;
    out.push([tx, 2 + ty, tz + bob, c]);
  }

  return out.map(([x, y, z, c]) => ({ x, y, z, s: 1, c }));
}

/** One cat cube, in modules. A little over half a module, so the cat reads at card size. */
const CAT_S = 0.6;

/** Turns the model to face one of four ways, then places it on the lawn. */
function placeCat(model: Vox[], dir: number, px: number, py: number): Vox[] {
  const S = CAT_S;
  // The model's middle, which it turns around.
  // Chosen so every cube centre lands on a half, and turning keeps cubes on the grid.
  const mx = 6;
  const my = 3;
  const turned = model.map((v) => {
    const u = v.x + 0.5 - mx;
    const w = v.y + 0.5 - my;
    const [a, b] = dir === 0 ? [u, w] : dir === 1 ? [-w, u] : dir === 2 ? [-u, -w] : [w, -u];
    return { ...v, x: Math.round(a - 0.5), y: Math.round(b - 0.5) };
  });
  return cull(turned.map((v) => ({ ...v, x: px + v.x * S, y: py + v.y * S, z: v.z * S, s: S })));
}

/** Where the front of the head is, in the world: a corner and its two edges. */
function faceFrame(dir: number, px: number, py: number, step: number): [number, number, number][] {
  const S = CAT_S;
  const bob = Math.abs(Math.sin(step)) > 0.2 ? 1 : 0;
  const hz = 3 + bob;
  const turn = (x: number, y: number, z: number): [number, number, number] => {
    const u = x - 6;
    const w = y - 3;
    const [a, b] = dir === 0 ? [u, w] : dir === 1 ? [-w, u] : dir === 2 ? [-u, -w] : [w, -u];
    return [px + a * S, py + b * S, z * S];
  };
  // The head's +y edge is on the left of the screen whichever way it faces.
  return [turn(13, 7, hz), turn(13, -2, hz), turn(13, 7, hz + 7)];
}

/**
 * The face, drawn onto the front of the head: happy shut eyes, pink cheeks, a
 * little nose and the curl of a mouth. Drawn rather than built from cubes,
 * because at this size a face made of cubes reads as a row of teeth.
 */
function paintFace(ctx: CanvasRenderingContext2D, p: Proj, frame: [number, number, number][], k: Coat, dpr: number) {
  const [o, a, b] = frame as [[number, number, number], [number, number, number], [number, number, number]];
  const O = [sx(p, o[0], o[1]), sy(p, o[0], o[1], o[2])];
  const A = [sx(p, a[0], a[1]), sy(p, a[0], a[1], a[2])];
  const B = [sx(p, b[0], b[1]), sy(p, b[0], b[1], b[2])];
  // Face units: 9 across, 7 up.
  ctx.save();
  ctx.setTransform(
    (dpr * (A[0]! - O[0]!)) / 9,
    (dpr * (A[1]! - O[1]!)) / 9,
    (dpr * (B[0]! - O[0]!)) / 7,
    (dpr * (B[1]! - O[1]!)) / 7,
    dpr * O[0]!,
    dpr * O[1]!,
  );
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.fillStyle = css(k.cheek);
  ctx.globalAlpha = 0.85;
  for (const cx of [1.25, 7.75]) {
    ctx.beginPath();
    ctx.ellipse(cx, 2.3, 0.85, 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Shut and smiling: arches, up in the middle.
  ctx.strokeStyle = css(k.eye);
  ctx.lineWidth = 0.5;
  for (const cx of [2.55, 6.45]) {
    ctx.beginPath();
    ctx.arc(cx, 3.5, 0.95, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
  }

  ctx.fillStyle = css(k.nose);
  ctx.beginPath();
  ctx.moveTo(4.5 - 0.45, 2.75);
  ctx.lineTo(4.5 + 0.45, 2.75);
  ctx.lineTo(4.5, 2.2);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = css(k.nose, 0.8);
  ctx.lineWidth = 0.28;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(4.5 + side * 0.38, 2.05, 0.38, Math.PI, 0, false);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---- the scene ------------------------------------------------------------ */

/**
 * Draws a garden into `canvas` and keeps it alive until the returned function
 * is called.
 */
export function plantGarden(canvas: HTMLCanvasElement, opts: GardenOptions): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { size } = opts;
  canvas.width = size * dpr;
  canvas.height = size * dpr;

  const lawn = buildLawn(opts.value, opts.grass);
  const tree = buildTree(opts.tree);
  const half = lawn.half;

  // Fit the whole scene, crown and lawn, into the canvas.
  const unit: Proj = { ox: 0, oy: 0, u: 1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number, z: number) => {
    const X = sx(unit, x, y);
    const Y = sy(unit, x, y, z);
    minX = Math.min(minX, X);
    maxX = Math.max(maxX, X);
    minY = Math.min(minY, Y);
    maxY = Math.max(maxY, Y);
  };
  for (const [x, y] of [[-half, -half], [half, -half], [half, half], [-half, half]] as const) {
    grow(x, y, 0);
    grow(x, y, -1);
  }
  for (const v of tree) grow(v.x, v.y, v.z + v.s);
  const u = (size * 0.94) / Math.max(maxX - minX, maxY - minY);
  const p: Proj = { ox: size / 2 - ((minX + maxX) / 2) * u, oy: size / 2 - ((minY + maxY) / 2) * u, u };

  const layer = () => {
    const c = document.createElement('canvas');
    c.width = size * dpr;
    c.height = size * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { c, g };
  };

  // The ground: a slab, the code's tiles on it, the grass round the edge.
  const ground = layer();
  {
    const g = ground.g;
    const slab = 1;
    const corner = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
    face(g, p, [corner(-half, half, 0), corner(half, half, 0), corner(half, half, -slab), corner(-half, half, -slab)], css(GRASS[2]!, SHADE_LEFT));
    face(g, p, [corner(half, -half, 0), corner(half, half, 0), corner(half, half, -slab), corner(half, -half, -slab)], css(GRASS[2]!, SHADE_RIGHT));
    face(g, p, [corner(-half, -half, 0), corner(half, -half, 0), corner(half, half, 0), corner(-half, half, 0)], css(GRASS[0]!));
    const n = half - BORDER;
    face(g, p, [corner(-n, -n, 0), corner(n, -n, 0), corner(n, n, 0), corner(-n, n, 0)], 'rgb(255,255,255)');
    for (const t of lawn.tiles) {
      face(g, p, [[t.x, t.y, 0], [t.x + t.w, t.y, 0], [t.x + t.w, t.y + t.w, 0], [t.x, t.y + t.w, 0]], css(t.c));
    }
    drawAll(g, p, lawn.voxels);
  }

  const crown = layer();
  drawAll(crown.g, p, tree);
  const trunkFoot = sy(p, 0, 0, 0);

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ringR = (half - BORDER) * 0.62;
  let frame = 0;

  const draw = (now: number) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(ground.c, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /*
     * The cat strolls across the front of the tree, stops at each end to sit
     * and look out, and strolls back. Walking right it faces +x and walking
     * left it faces +y: both are towards the camera, so its face is always
     * the side you see.
     */
    const t = still ? 1 : now / 1000;
    const LEG = 6;
    const PAUSE = 1.6;
    const cycle = (t % ((LEG + PAUSE) * 2)) / (LEG + PAUSE);
    const leg = Math.floor(cycle);
    const along = Math.min(1, (cycle - leg) * ((LEG + PAUSE) / LEG));
    const walking = along < 1 && !still;
    const ease = along * along * (3 - 2 * along);
    const span = ringR * 1.1;
    const sPos = leg === 0 ? -span + ease * span * 2 : span - ease * span * 2;
    const front = ringR * 0.95;
    const cx = (front + sPos) / 2;
    const cy = (front - sPos) / 2;
    const dir = leg === 0 ? 0 : 1;
    const cat = placeCat(catModel(opts.cat, walking ? t * 10 : 0), dir, cx, cy);

    // Its shadow, so it stands on the lawn rather than over it.
    ctx.fillStyle = 'rgba(40,30,60,0.16)';
    ctx.beginPath();
    ctx.ellipse(sx(p, cx, cy), sy(p, cx, cy, 0), u * 3, u * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const behind = cx + cy < 0;
    const step = walking ? t * 10 : 0;
    const paintCat = () => {
      drawAll(ctx, p, cat);
      paintFace(ctx, p, faceFrame(dir, cx, cy, step), COATS[opts.cat], dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const paintTree = () => {
      // A breeze: the crown leans a little, more the higher it is.
      const lean = still ? 0 : Math.sin(t * 1.4) * 0.018;
      ctx.save();
      ctx.setTransform(1, 0, -lean, 1, lean * trunkFoot * dpr, 0);
      ctx.drawImage(crown.c, 0, 0);
      ctx.restore();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    if (behind) {
      paintCat();
      paintTree();
    } else {
      paintTree();
      paintCat();
    }

    // Petals coming down from the crown.
    if (!still) {
      for (let i = 0; i < 12; i += 1) {
        const k = (t / 5 + i / 12) % 1;
        const a = i * 2.39996;
        const r = 3 + (i % 5) * 1.6;
        const x = Math.cos(a) * r + Math.sin(k * 6 + i) * 1.2;
        const y = Math.sin(a) * r;
        const z = (TRUNK_H + 2) * (1 - k);
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - k) * 4) * 0.9;
        ctx.translate(sx(p, x, y), sy(p, x, y, z));
        ctx.rotate(k * 8 + i);
        ctx.fillStyle = css(PINK_FLOWER);
        ctx.beginPath();
        ctx.ellipse(0, 0, u * 0.55, u * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(frame);
}
