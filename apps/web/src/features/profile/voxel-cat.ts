import type { Rgb } from './qr.js';

/**
 * The cat that strolls round the cherry tree, built from blocks the way the
 * sakura invite artwork builds its cat: a round body on short legs, a big
 * head, pink insides to the ears and a tail up in a curl.
 *
 * The body is cubes seen from an isometric camera, which is the same view the
 * tree stands in while it is a tree. The face is drawn onto the front of the
 * head rather than built from cubes: at this size a face made of cubes reads
 * as a row of teeth, and shut smiling eyes need a curve.
 */

/** A cube. Units are the cat's own cubes until `placeCat` sizes them. */
interface Vox {
  x: number;
  y: number;
  z: number;
  s: number;
  c: Rgb;
  /** Which faces are hidden by a neighbour: 1 top, 2 +x, 4 +y. */
  hide?: number;
}

export type CatKind = 'black' | 'ginger' | 'snow';

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
  if (!(h & 1)) face(ctx, p, [[x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]], css(v.c));
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

  // Relative to whatever the caller is fading the cat by.
  const alpha = ctx.globalAlpha;
  ctx.fillStyle = css(k.cheek);
  ctx.globalAlpha = alpha * 0.85;
  for (const cx of [1.25, 7.75]) {
    ctx.beginPath();
    ctx.ellipse(cx, 2.3, 0.85, 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = alpha;

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

/**
 * Draws the cat with its feet at (`x`, `y`) on the canvas.
 *
 * `unit` is the size of one cube in px. `dir` 0 faces down-right and 1 faces
 * down-left: both are towards the camera, so the face is always the side you
 * see. `step` runs the walk; hold it still for a cat standing.
 */
export function drawVoxelCat(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  unit: number,
  kind: CatKind,
  step: number,
  dir: 0 | 1,
  dpr: number,
) {
  const p: Proj = { ox: x, oy: y, u: unit / CAT_S };
  drawAll(ctx, p, placeCat(catModel(kind, step), dir, 0, 0));
  paintFace(ctx, p, faceFrame(dir, 0, 0, step), COATS[kind], dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
