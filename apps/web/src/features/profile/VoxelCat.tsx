import { useEffect, useRef } from 'react';

/**
 * The cat that lies on top of the invite card, paws over the edge and tail
 * hanging down the front - drawn in the same chunky voxel style as the cat in
 * the tree scene, so the two read as one cat.
 *
 * ## How it is drawn
 *
 * A small set of cubes, projected obliquely: each cube shows its front, its top
 * and its right side, with depth running up and to the right. Faces that touch
 * another cube are skipped, so the shape reads as one solid rather than a pile
 * of boxes. Drawn back to front, left to right, bottom to top.
 *
 * ## Alive, gently
 *
 * The tail swings slowly from where it leaves the card, and now and then an ear
 * flicks. Nothing else moves - it sits beside a QR code that has to be held
 * steady. With reduced motion it is a still drawing.
 */

type Rgb = [number, number, number];
interface Voxel { x: number; y: number; z: number; c: Rgb }

const FUR: Rgb = [26, 23, 38];
const WHITE: Rgb = [246, 244, 250];
const PINK: Rgb = [242, 128, 166];
const NOSE: Rgb = [247, 140, 172];

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** The cat, in voxel units. y is up, the card's top edge is y = 0, z is depth (negative is in front of the card). */
function buildCat(): { body: Map<string, Voxel>; tail: Voxel[]; earL: Voxel[]; earR: Voxel[] } {
  const body = new Map<string, Voxel>();
  const put = (x: number, y: number, z: number, c: Rgb = FUR) => body.set(key(x, y, z), { x, y, z, c });

  // The body, lying along the edge behind and to the right of the head: a low oval, mostly hidden.
  for (let x = 10; x <= 26; x += 1) for (let y = 0; y <= 8; y += 1) for (let z = 1; z <= 8; z += 1) {
    const e = ((x - 18) / 8.6) ** 2 + ((y - 2) / 5.4) ** 2 + ((z - 4.5) / 4.2) ** 2;
    if (e <= 1) put(x, y, z);
  }
  // The head: round, flat at the front where the face is drawn.
  for (let x = 0; x <= 16; x += 1) for (let y = 0; y <= 13; y += 1) {
    if (((x - 8) / 8.6) ** 2 + ((y - 6.4) / 6.6) ** 2 > 1) continue;
    for (let z = -1; z <= 5; z += 1) put(x, y, z);
  }

  // The face: wide happy closed eyes, a pink nose, a white muzzle with a little dark mouth.
  for (const [x, y] of [[2, 7], [3, 8], [4, 8], [5, 8], [6, 8], [7, 7], [3, 7], [6, 7], [9, 7], [10, 8], [11, 8], [12, 8], [13, 8], [14, 7], [10, 7], [13, 7]] as const) put(x, y, -1, WHITE);
  put(8, 6, -1, NOSE); put(7, 6, -1, NOSE); put(9, 6, -1, NOSE);
  for (const [x, y] of [[6, 5], [7, 5], [9, 5], [10, 5], [6, 4], [10, 4], [7, 4], [9, 4]] as const) put(x, y, -1, WHITE);

  // Front paws, white, resting over the card's edge.
  for (let x = 2; x <= 5; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -3; z <= -2; z += 1) if (!((x === 2 || x === 5) && y === -1)) put(x, y, z, WHITE);
  for (let x = 11; x <= 14; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -3; z <= -2; z += 1) if (!((x === 11 || x === 14) && y === -1)) put(x, y, z, WHITE);

  const ear = (mirror: boolean): Voxel[] => {
    const cells: Voxel[] = [];
    const rows: [number, number, number][] = [[10, 0, 6], [11, 0, 6], [12, 0, 6], [13, 1, 6], [14, 1, 5], [15, 1, 4], [16, 2, 4], [17, 2, 3], [18, 2, 2]];
    for (const [y, x0, x1] of rows) for (let x = x0; x <= x1; x += 1) {
      const inner = y >= 12 && y <= 16 && x > x0 && x < x1;
      for (let z = 0; z <= 1; z += 1) cells.push({ x: mirror ? 16 - x : x, y, z, c: inner && z === 0 ? PINK : FUR });
    }
    return cells;
  };

  // The tail: from under the body beside the head, over the edge, and down the card in a lazy S.
  const tail: Voxel[] = [];
  const t = (x: number, y: number, z: number) => tail.push({ x, y, z, c: FUR });
  for (let x = 16; x <= 18; x += 1) for (let z = -2; z <= 1; z += 1) t(x, 0, z);
  for (let y = -20; y <= -1; y += 1) {
    const dx = Math.round(Math.sin(-y / 5) * 1.5);
    for (let x = 16 + dx; x <= 18 + dx; x += 1) for (let z = -2; z <= -1; z += 1) t(x, y, z);
  }

  return { body, tail, earL: ear(false), earR: ear(true) };
}

const CAT = buildCat();

/** Depth offset per unit of z, as a fraction of the voxel size. */
const DEPTH = 0.32;

function shade(c: Rgb, f: number): string {
  return `rgb(${Math.round(Math.min(255, c[0] * f))},${Math.round(Math.min(255, c[1] * f))},${Math.round(Math.min(255, c[2] * f))})`;
}

/** Lighter shade for a very dark colour: multiplying black does nothing, so lift it. */
function lift(c: Rgb, add: number): string {
  return `rgb(${Math.min(255, c[0] + add)},${Math.min(255, c[1] + add)},${Math.min(255, c[2] + add)})`;
}

function draw(ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, swing: number, flick: number) {
  const project = (x: number, y: number, z: number): [number, number] => [ox + (x + z * DEPTH) * s, oy - (y + z * DEPTH) * s];

  const all: Voxel[] = [...CAT.body.values()];
  const filled = new Set(all.map((v) => key(v.x, v.y, v.z)));
  const ears = [...CAT.earL.map((v) => ({ ...v, y: v.y + (flick > 0 ? 0 : 0), x: v.x - (flick > 0 && v.y >= 15 ? 1 : 0) })), ...CAT.earR];
  for (const v of ears) { all.push(v); filled.add(key(v.x, v.y, v.z)); }
  for (const v of CAT.tail) filled.add(key(v.x, v.y, v.z));

  const cube = (v: Voxel, own: Set<string>) => {
    const dark = v.c[0] + v.c[1] + v.c[2] < 200;
    // A little variation from cube to cube, the way a built model never has two identical blocks.
    const jitter = (((v.x * 73856093) ^ (v.y * 19349663) ^ (v.z * 83492791)) >>> 0) % 7;
    if (dark) v = { ...v, c: [v.c[0] + jitter, v.c[1] + jitter, v.c[2] + jitter + 4] };
    const front = shade(v.c, 1);
    const top = dark ? lift(v.c, 48) : shade(v.c, 1.06);
    const side = dark ? shade(v.c, 0.5) : shade(v.c, 0.8);
    const [fx, fy] = project(v.x, v.y + 1, v.z);
    // Right face, then top, then front, so the front edge sits crisp on top.
    if (!own.has(key(v.x + 1, v.y, v.z))) {
      const a = project(v.x + 1, v.y + 1, v.z), b = project(v.x + 1, v.y + 1, v.z + 1), c = project(v.x + 1, v.y, v.z + 1), d = project(v.x + 1, v.y, v.z);
      ctx.fillStyle = side; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.lineTo(...d); ctx.closePath(); ctx.fill();
    }
    if (!own.has(key(v.x, v.y + 1, v.z))) {
      const a = project(v.x, v.y + 1, v.z), b = project(v.x, v.y + 1, v.z + 1), c = project(v.x + 1, v.y + 1, v.z + 1), d = project(v.x + 1, v.y + 1, v.z);
      ctx.fillStyle = top; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.lineTo(...d); ctx.closePath(); ctx.fill();
    }
    if (!own.has(key(v.x, v.y, v.z - 1))) {
      ctx.fillStyle = front;
      ctx.fillRect(fx - 0.02, fy - 0.02, s + 0.04, s + 0.04);
      // A bevel, so each cube reads as a cube: light along the top and left, shade along the bottom and right.
      const bw = Math.max(0.6, s * 0.14);
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.45)';
      ctx.fillRect(fx, fy, s, bw);
      ctx.fillRect(fx, fy, bw, s);
      ctx.fillStyle = dark ? 'rgba(0,0,0,0.2)' : 'rgba(120,110,140,0.18)';
      ctx.fillRect(fx, fy + s - bw, s, bw);
      ctx.fillRect(fx + s - bw, fy, bw, s);
    }
  };

  const order = (a: Voxel, b: Voxel) => b.z - a.z || a.y - b.y || a.x - b.x;

  // Body and ears.
  all.sort(order);
  for (const v of all) cube(v, filled);

  // The tail swings from where it leaves the card's edge.
  const [px, py] = project(17, 0, -1);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(swing);
  ctx.translate(-px, -py);
  const tail = [...CAT.tail].sort(order);
  const tailSet = new Set(tail.map((v) => key(v.x, v.y, v.z)));
  for (const v of tail) cube(v, tailSet);
  ctx.restore();

  // Whiskers: three thin white lines from each cheek.
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = Math.max(1, s * 0.32);
  ctx.lineCap = 'round';
  const whisk = (x: number, y: number, dx: number, dy: number) => {
    const [ax, ay] = project(x, y, -1);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + dx * s, ay + dy * s); ctx.stroke();
  };
  whisk(4, 5.6, -6, -1.2); whisk(4, 4.9, -6.4, 0.1); whisk(4.2, 4.2, -5.6, 1.4);
  whisk(13, 5.6, 6, -1.2); whisk(13, 4.9, 6.4, 0.1); whisk(12.8, 4.2, 5.6, 1.4);
}

/** Canvas bounds, in voxels. */
const MIN_X = -8, MAX_X = 30, MIN_Y = -23, MAX_Y = 23;

export function VoxelCat({ size = 4.4, className, style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = (MAX_X - MIN_X) * size;
  const height = (MAX_Y - MIN_Y) * size;

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const ox = -MIN_X * size, oy = MAX_Y * size;
    let frame = 0;
    const start = performance.now();
    const paint = (now: number) => {
      const t = (now - start) / 1000;
      const swing = still ? 0 : Math.sin(t * 1.3) * 0.07;
      // An ear flick every few seconds, for a fifth of a second.
      const flick = !still && t % 4.2 > 4.0 ? 1 : 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      draw(ctx, size, ox, oy, swing, flick);
      if (!still) frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [size, width, height]);

  return <canvas ref={ref} aria-hidden className={className} style={{ width, height, ...style }} />;
}

/** Where the card's top edge (y = 0, z = 0) sits in the canvas, from its top and left, in px. */
export function catEdge(size = 4.4) {
  return { top: MAX_Y * size, left: -MIN_X * size };
}
