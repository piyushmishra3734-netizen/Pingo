import { cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { GARDEN, encodeQr, mixRgb as mix, type QrLevel, type Rgb } from './qr.js';

/**
 * A voxel cherry tree that comes apart into the QR code.
 *
 * The scene is one object seen from two camera angles. At rest it is a tree on
 * a square lawn; when it opens, every block flies to the module it stands for
 * while the camera lifts from three-quarters to straight overhead, so the last
 * frame is a plan view of the code with the grid square to the screen.
 *
 * ## Why the code is the same object as the tree
 *
 * A QR is the least personal thing a profile can offer - it is a target you
 * point a phone at. Having it *arrive from* something rather than appear is the
 * same move as a Ping growing out of its bubble: what you get is visibly what
 * you tapped, and the transition is what says so.
 *
 * It also solves the harder half of showing somebody a QR, which is getting
 * them to look at one. Nobody looks at a QR. People do watch a tree come apart.
 *
 * ## The lawn is the code, already there
 *
 * The slab under the tree is the finished QR at rest: light modules are the
 * lawn itself, and every dark module has a pale tile waiting for its block.
 * That is what makes the landing read as a homecoming rather than a reshuffle -
 * the shape is on the ground the whole time, the blocks are just not in it yet.
 *
 * ## Blossom darkens as it lands
 *
 * In the air the canopy is cherry pink, which is the wrong side of where a
 * scanner puts its threshold. Each block darkens to crimson over its own
 * flight, so the colour that is pretty in the tree and the colour that scans on
 * the ground are the same colour at two points of one move, not a swap.
 *
 * ## Canvas, and not three.js
 *
 * The projection is two angles and four lines of arithmetic; the scene is
 * axis-aligned boxes with no lighting model, no textures and no camera
 * controls. A 3D library would be several hundred kilobytes to avoid writing
 * those four lines, in a product whose performance story is that it runs on the
 * cheapest Android somebody owns.
 *
 * Cubes are drawn only while the tree is standing. Once the camera is overhead
 * the sides are invisible by definition, so those frames draw flat squares and
 * cost a third as much - which is also exactly when the picture has to be a
 * clean scan target rather than a scene.
 *
 * ## It still has to scan
 *
 * `QrArt` states the rule and this defers to it: settled means flat, overhead,
 * full contrast, four modules of quiet zone, light modules genuinely light.
 * Everything else happens on the way there.
 */

/*
 * The camera, as two angles that both run to zero.
 *
 * `SPIN` turns the world so a corner faces the viewer; `PITCH` leans it back
 * from straight down. Together they are the three-quarter view every voxel game
 * uses, and at zero the projection is a plan view with the grid square to the
 * screen - the only orientation a QR may finish in.
 */
const SPIN = Math.PI / 4;
const PITCH = (54 * Math.PI) / 180;

/** Long enough to read as a transformation, short enough not to be a wait. */
const FLIGHT_MS = 1500;

/**
 * Wind, in modules of travel at the top of the crown.
 *
 * A standing tree that does not move is a photograph of a tree. This was a
 * third of a module and too polite to notice; it is closer to a whole one now,
 * over about four seconds, which is a breeze you can see rather than one you
 * have to be told about.
 *
 * It runs out entirely as the code lands, and that is not a taste: a settled QR
 * has to be dead still. A rolling-shutter camera reading a moving target needs
 * to be held steadier for longer, so anything alive on top of a code makes it a
 * worse code however good it looks. Everything here happens before that.
 */
const GUST = 0.85;
const GUST_MS = 3800;

/** How many petals are falling at once, and how long each takes to come down. */
const FALLING = 14;
const FALL_MS = 4600;

/**
 * How long the tree gets to be a tree before an autoplaying scene opens it.
 *
 * Two seconds, which is long by the standards of anything else that moves in
 * this app and is the point. The tree is what somebody looks at; the code is
 * what they point a camera at afterwards. A beat short enough to feel like a
 * loading state would spend the whole idea - and the reason for a tree at all
 * is that nobody looks at a QR.
 */
const HOLD_MS = 2000;

/** The quiet zone, in modules. Non-negotiable - see `QrArt`. */
const QUIET = 4;

/*
 * The module colours live in `qr.ts` - see `GARDEN` there for why. Everything
 * that is only ever seen while the tree is standing lives here.
 */
const { ground: GROUND, blossomAir: BLOSSOM_AIR, blossomInk: BLOSSOM_INK } = GARDEN;
const { grassAir: GRASS_AIR, grassInk: GRASS_INK } = GARDEN;

/** The cut edge of the slab, so the lawn has a thickness while it is tilted. */
const SLAB_SIDE: Rgb = [222, 215, 226];
/** Where a dark module will land. Pale enough to still be a light module. */
const REST: Rgb = [226, 222, 215];
const TRUNK: Rgb = [138, 98, 68];
const PETAL: Rgb = [244, 150, 152];

const css = (c: Rgb) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

/** A highlight tone, so the canopy is lit rather than one flat pink. */
const BLOSSOM_LIT: Rgb = [252, 172, 174];

/**
 * Where a maple leaf's five points face, as bearings from its middle.
 *
 * A tip at the top, a pair out to the sides and a pair swept back, and nothing
 * at all pointing down - which is what leaves the narrow base a leaf has where
 * its stem joins. Read off the reference: at the edge of that canopy, and lying
 * on the ground under it, the leaves are unmistakably maple, and rounding them
 * into blobs was the last thing making this read as gravel rather than blossom.
 */
const TIPS = [90, 26, 154, -34, 214].map((d) => (d * Math.PI) / 180);

/**
 * The leaf, as an outline sampled at fixed bearings.
 *
 * Each point takes the nearest tip's reach, falling away sharply between them -
 * `cos` to the fifth is what cuts the deep notches a maple has, where a gentler
 * curve gives the scallops of a blob.
 *
 * The bearings are the fixed thing. `blossom` moves each point's radius toward
 * the square its module needs and leaves its bearing alone, which is what lets
 * one shape be a leaf at one end of the flight and a module at the other. The
 * step is 15 degrees, so four of the twenty-four land on the square's corners
 * and four on its edge midpoints; every other point lands on an edge between
 * two of those, and a chord between two points of a straight edge is that edge.
 * The landed outline is the square, not a polygon inscribed in it.
 */
const LEAF = Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * Math.PI * 2;
  let lobe = 0;
  for (const tip of TIPS) {
    const c = Math.cos(a - tip);
    if (c > 0) lobe = Math.max(lobe, c ** 5);
  }
  return { a, r: 0.28 + 0.76 * lobe };
});

/**
 * One blossom, part leaf and part module.
 *
 * `t` runs 0 - a leaf hanging on the tree - to 1, the square module it lands
 * on. Only radii and the leaf's own tilt move; every point keeps its bearing,
 * so a leaf becomes its own module rather than being swapped for one.
 */
function blossom(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  hw: number,
  t: number,
  turn: number,
) {
  // Taller than it is wide while it is a leaf, and square by the time it is a
  // module - so the stretch has to run out exactly as the shape does.
  const tall = 1 + 0.16 * (1 - t);
  ctx.beginPath();
  for (let i = 0; i < LEAF.length; i += 1) {
    const { a, r } = LEAF[i]!;
    const square = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    const rad = (r + (square - r) * t) * hw;
    const ang = a + turn * (1 - t);
    const x = sx + Math.cos(ang) * rad;
    const y = sy + Math.sin(ang) * rad * tall;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

const shadeOf = (ink: Rgb, air: Rgb, jitter: number) => mix(ink, air, jitter * GARDEN.jitter);

/**
 * The crown, as the six numbers that decide what kind of tree this is.
 *
 * A prop rather than constants because the shape is a thing to look at rather
 * than reason about - the same reason the radius always was - and because the
 * lab shows several at once to choose between. `SAKURA` is what ships.
 */
export interface Crown {
  /** Height of the dome, as a fraction of the code's width. */
  dome: number;
  /** How far the rim hangs below the flat of the crown. */
  droop: number;
  /** Where the crown starts, above the lawn. */
  base: number;
  /** How far the crown splays past each block's own module. 1 is lawn-width. */
  spread: number;
  /** Trunk height, as a fraction of the code's width. */
  trunk: number;
  /** The lowest a block may hang in the crown. Below 1 gives it a thickness. */
  fill: number;
  /** How fat a leaf is drawn while airborne. Wider crowns need more. */
  leaf: number;
}

/** A round puff of blossom on a clear trunk, a little wider than it is tall. */
export const SAKURA: Crown = {
  dome: 0.72,
  droop: 0,
  base: 0.52,
  spread: 1.2,
  trunk: 0.6,
  fill: 0.6,
  leaf: 3.9,
};

/*
 * The cat: the same black voxel kitten the invite artwork sits on its card,
 * sitting and looking up at you. `public/qr/garden-cat.webp`, cut from the
 * artist's sheet. `ax` is the middle of its feet, from the left edge.
 */
const CAT_SHEET = '/qr/garden-cat.webp';
const CAT = { w: 214, h: 186, ax: 122 };
/** How tall the sitting cat stands, in modules. */
const CAT_HEIGHT = 7.4;
/** Where it sits: on the lawn to the right of the trunk, in modules from the middle. */
const CAT_SPOT = { x: 7, z: -4 };

/*
 * Its face, in the sheet's pixels: where the head is (so it can
 * tilt on its own), and where the eyes and cheeks sit on it.
 */
const HEAD = { x: 72, y: 0, w: 142, h: 114, pivotX: 142, pivotY: 106, clipBelow: 106 };
const EYES = [
  { x: 148, y: 79, rx: 10, ry: 13 },
  { x: 190, y: 79, rx: 8, ry: 13 },
];
const CHEEKS = [
  { x: 136, y: 97 },
  { x: 200, y: 98 },
];
/** The fur round the eyes, for the lids. */
const FUR = 'rgb(30, 24, 37)';

/** 0 to 1 and back over `ms`, eased at both ends, while `t` is inside it. */
const pulse = (t: number, start: number, ms: number) => {
  const u = (t - start) / ms;
  return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2;
};

/** A little heart, for the cat that has just looked up at you. */
function heart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.4, y - r * 0.1, x - r * 0.7, y - r * 1.2, x, y - r * 0.45);
  ctx.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.4, y - r * 0.1, x, y + r * 0.9);
  ctx.closePath();
  ctx.fill();
}

/** Overshoots a little and settles, the way a cartoon pops into place. */
const popIn = (t: number) => {
  const c = 1.9;
  const u = Math.max(0, Math.min(1, t)) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

let catSheet: HTMLImageElement | undefined;
/** The sheet, loading on first use; undefined until it can be drawn. */
function catImage(): HTMLImageElement | undefined {
  if (typeof Image === 'undefined') return undefined;
  if (!catSheet) {
    catSheet = new Image();
    catSheet.decoding = 'async';
    catSheet.src = CAT_SHEET;
  }
  return catSheet.complete && catSheet.naturalWidth > 0 ? catSheet : undefined;
}

interface Cell {
  /** Where it lands: module coordinates, with the quiet zone already added. */
  qx: number;
  qy: number;
  /** Where it starts: the tree, in world units (1 unit = 1 module). */
  tx: number;
  ty: number;
  tz: number;
  /** Finder and rim modules are the grass; everything else is blossom. */
  grass: boolean;
  /** Staggers the flight so the tree comes apart rather than teleporting. */
  delay: number;
  /** How far this leaf hangs off square. Runs out as it lands. */
  turn: number;
  /** Where in the gust this leaf is, so the canopy moves as a wave. */
  phase: number;
  air: Rgb;
  ink: Rgb;
}

/**
 * The tree, built from the code rather than modelled separately.
 *
 * Every lit module gets a place on a trunk-and-canopy silhouette, chosen from
 * its own coordinates so the same profile always grows the same tree.
 *
 * The silhouette comes from `crown` - see `Crown` for what each number does.
 */
function plant(modules: boolean[][], size: number, crown: Crown): Cell[] {
  const cells: Cell[] = [];
  const mid = (size - 1) / 2;

  const isFinder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y]?.[x] !== true) continue;

      /*
       * Deterministic per module: the same profile grows the same tree every
       * time it is opened, which is what makes it an object rather than an
       * effect.
       */
      const seed = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const r2 = (((seed >> 10) % 1000) / 1000) * 2 - 1;
      const r3 = (((seed >> 20) % 1000) / 1000) * 2 - 1;

      /*
       * Grass grows at the edge of the lawn and blossom falls under the
       * canopy, so a dark module is green if it is a corner square or out on
       * the rim, and pink if it is anywhere the tree stands over. Reading it
       * off the geometry rather than off a list is what keeps the two states
       * describing the same garden.
       */
      const reach = Math.max(Math.abs(x - mid), Math.abs(y - mid)) / mid;
      const grass = isFinder(x, y) || reach + r3 * 0.05 > 0.9;

      let tx: number;
      let ty: number;
      let tz: number;

      if (grass) {
        // Grass sits where it already is - it never leaves the ground, it
        // just stops being seen edge-on.
        tx = x - mid;
        tz = y - mid;
        ty = 0;
      } else {
        /*
         * The canopy is the code, lifted.
         *
         * Every blossom module keeps its own bearing from the middle and only
         * moves out along it and up. So the dome is the square splayed wider
         * than the lawn and pushed into a curve, and a block always lands on
         * the module it was hanging over.
         *
         * That is the whole of it. Placing blocks by hashing each module into a
         * sphere - which is what this did - meant a leaf on the left flew to a
         * module on the right, and the transition read as a shuffle rather than
         * a fall. It also left holes, because a hash scatters unevenly, while a
         * mapping covers the dome exactly as densely as the code covers the
         * square.
         */
        const away = Math.hypot(x - mid, y - mid) / mid;
        // Corners reach past 1; clamped so the rim of the dome sits flat
        // rather than curling under.
        const r = Math.min(1, away / 1.35);
        /*
         * How high in the crown this block hangs, as a fraction of the dome.
         *
         * Only the height varies - the radius does not. Scaling the radius too
         * put every low block near the axis, and a few hundred of those stacked
         * into a funnel running down to the trunk. Varying height alone gives
         * the crown a thickness without moving a single block off its bearing.
         */
        const fill = crown.fill + (1 - crown.fill) * Math.abs(r3);
        // The rim hangs below the flat of the canopy, so the skirt droops
        // around the trunk instead of ending in a straight cut.
        // Wide and low, the way a sakura is: the crown is half again as
        // broad as it is tall, and its rim droops rather than ending in a
        // straight cut. A taller dome here read as an oak.
        const dome = size * (crown.dome * Math.sqrt(1 - r * r) - crown.droop * r * r);

        /*
         * A twelfth of a module of slop on the radius. Without it the crown is
         * the code's own pattern blown up, holes and all - the white runs in a
         * QR are wide enough to show as gaps in a canopy. Small enough that a
         * block still lands where it hung.
         */
        const slop = 1 + r2 * 0.16;
        tx = (x - mid) * crown.spread * slop;
        tz = (y - mid) * crown.spread * slop;
        ty = size * crown.base + dome * fill;
      }

      const jitter = Math.abs(r2);
      cells.push({
        qx: x + QUIET,
        qy: y + QUIET,
        tx,
        ty,
        tz,
        grass,
        // Outer modules leave first, so the tree opens from the edges inward.
        delay: Math.min(0.45, (Math.hypot(x - mid, y - mid) / mid) * 0.4),
        turn: r3 * 0.8,
        phase: (seed % 628) / 100,
        // Two close pinks rather than one, which is the difference between a
        // canopy with light in it and a pink shape.
        air: grass ? GRASS_AIR : mix(BLOSSOM_AIR, BLOSSOM_LIT, jitter),
        ink: shadeOf(grass ? GRASS_INK : BLOSSOM_INK, grass ? GRASS_AIR : BLOSSOM_AIR, jitter),
      });
    }
  }

  return cells;
}

/** Smooth in and out, so neither end of the move is abrupt. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function VoxelQr({
  value,
  level = 'M',
  size = 300,
  crown = SAKURA,
  autoPlay = false,
  className,
  label = 'Profile QR code',
  caption,
}: {
  value: string;
  level?: QrLevel;
  size?: number;
  /** What kind of tree. See `Crown`; `SAKURA` is the shipped shape. */
  crown?: Crown;
  /** Open on its own after a beat, which is what the share sheet wants. */
  autoPlay?: boolean;
  className?: string;
  label?: string;
  /** Overrides the tap hint. Pass an empty string for no line at all. */
  caption?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 0 is the tree, 1 is the code. A ref: it changes every frame. */
  const progress = useRef(0);
  /** Which way the cat is pointing, or 0 before the first frame has decided. */
  const target = useRef(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const modules = encodeQr(value, level);
    const count = modules.length;
    const grid = count + QUIET * 2;
    const cells = plant(modules, count, crown);

    /*
     * Reduced motion starts on the code.
     *
     * The movement is the whole of this component, so there is no quieter
     * version to offer - the honest answer is to begin on the state that
     * carries the information, which is the one that scans.
     */
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      progress.current = 1;
      target.current = 1;
      setOpen(true);
    }

    let hold: number | undefined;
    if (autoPlay && !still) {
      hold = window.setTimeout(() => {
        target.current = 1;
        setOpen(true);
      }, HOLD_MS);
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let frame = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;

      // Toward the target at a fixed rate, so a tap mid-flight turns around
      // from wherever it had reached rather than snapping.
      const step = dt / FLIGHT_MS;
      if (progress.current < target.current) {
        progress.current = Math.min(target.current, progress.current + step);
      } else if (progress.current > target.current) {
        progress.current = Math.max(target.current, progress.current - step);
      }

      const p = progress.current;
      const e = ease(p);
      ctx.clearRect(0, 0, size, size);

      const spin = SPIN * (1 - e);
      const pitch = PITCH * (1 - e);
      const cosS = Math.cos(spin);
      const sinS = Math.sin(spin);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);

      /*
       * Zoomed out far enough to hold whatever crown it was given, and back in
       * to exactly the code by the time it lands. Derived from the spread
       * rather than set beside it, so widening a tree cannot crop it.
       */
      const unit = size / (grid * (1 + 0.45 * crown.spread * (1 - e)));
      const half = unit / 2;
      // Pushed down while tilted, so the canopy has somewhere to be.
      const lift = (1 - e) * size * 0.3;

      /** World units (1 = 1 module, origin in the middle of the lawn) to screen. */
      const px = (wx: number, wz: number) => size / 2 + (wx * cosS - wz * sinS) * unit;
      const py = (wx: number, wy: number, wz: number) =>
        size / 2 + lift + ((wx * sinS + wz * cosS) * cosP - wy * sinP) * unit;

      const quad = (pts: [number, number][], colour: Rgb, alpha = 1) => {
        if (alpha <= 0.004) return;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = css(colour);
        ctx.beginPath();
        ctx.moveTo(pts[0]![0], pts[0]![1]);
        for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i]![0], pts[i]![1]);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      };

      /* ---- the lawn ------------------------------------------------------ */

      const edge = grid / 2;
      const at = (wx: number, wz: number, wy: number): [number, number] => [
        px(wx, wz),
        py(wx, wy, wz),
      ];

      const nw = at(-edge, -edge, 0);
      const ne = at(edge, -edge, 0);
      const se = at(edge, edge, 0);
      const sw = at(-edge, edge, 0);

      const depth = 0.9 * (1 - e);
      if (depth > 0.002) {
        // The cut edge, so the lawn reads as a slab rather than a decal. Only
        // the two faces the camera can see; at zero pitch there are none.
        quad([sw, se, at(edge, edge, -depth), at(-edge, edge, -depth)], SLAB_SIDE);
        quad(
          [se, ne, at(edge, -edge, -depth), at(edge, edge, -depth)],
          mix(SLAB_SIDE, [255, 255, 255], 0.18),
        );
      }

      quad([nw, ne, se, sw], GROUND);

      /* ---- where every dark module will land ----------------------------- */

      /*
       * The pale tiles fade as the blocks arrive on top of them: by the time
       * the camera is overhead the code is made of blocks, and a tile still
       * showing under a landed block is a seam.
       */
      const restAlpha = 1 - e;
      if (restAlpha > 0.01) {
        ctx.globalAlpha = restAlpha;
        ctx.fillStyle = css(REST);
        for (const cell of cells) {
          const mx = cell.qx - grid / 2;
          const mz = cell.qy - grid / 2;
          ctx.beginPath();
          ctx.moveTo(px(mx, mz), py(mx, 0, mz));
          ctx.lineTo(px(mx + 1, mz), py(mx + 1, 0, mz));
          ctx.lineTo(px(mx + 1, mz + 1), py(mx + 1, 0, mz + 1));
          ctx.lineTo(px(mx, mz + 1), py(mx, 0, mz + 1));
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      /* ---- fallen petals ------------------------------------------------- */

      if (restAlpha > 0.01) {
        ctx.globalAlpha = restAlpha * 0.85;
        ctx.fillStyle = css(PETAL);
        for (let i = 0; i < 34; i += 1) {
          // The golden angle, so three dozen of them spread evenly without a
          // random number generator or a table of positions.
          const a = (i * 2.39996) % 6.283;
          const r = edge * 0.66 * Math.sqrt(((i * 37) % 100) / 100);
          const fx = Math.cos(a) * r;
          const fz = Math.sin(a) * r;
          /*
           * The same leaf as the canopy, lying down: squashed by the camera's
           * own pitch, so a petal on the ground foreshortens exactly as much as
           * the lawn it is lying on.
           */
          ctx.save();
          ctx.translate(px(fx, fz), py(fx, 0.02, fz));
          ctx.scale(1, Math.max(0.08, cosP));
          blossom(ctx, 0, 0, unit * 0.6, 0, i * 1.7);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }

      /* ---- the trunk ----------------------------------------------------- */

      const trunkH = count * crown.trunk * (1 - e);
      const drawTrunk = () => {
        const top = at(0, 0, trunkH);
        const foot = at(0, 0, 0);
        const height = Math.max(0, foot[1] - top[1]);
        /*
         * Wider at the top than at the ground. That is the wrong way round for
         * a post and the right way round for a cherry, which flares where the
         * branches leave it; a parallel column read as a pole with a cloud
         * balanced on it.
         */
        const wTop = Math.max(1.7, count * 0.085) * unit;
        const wFoot = wTop * 0.62;
        const x = top[0];
        ctx.globalAlpha = Math.min(1, (1 - e) * 2.2);

        /*
         * Branches first, so the flare of the trunk covers where they leave it.
         * Five is enough to read as a crown from any angle and few enough that
         * the canopy still hides most of each one, which is what they are for -
         * a canopy with nothing going into it hangs in the air.
         */
        ctx.strokeStyle = css(mix(TRUNK, [0, 0, 0], 0.1));
        ctx.lineCap = 'round';
        for (let b = -2; b <= 2; b += 1) {
          ctx.lineWidth = wTop * (0.4 - Math.abs(b) * 0.07);
          ctx.beginPath();
          ctx.moveTo(x, top[1] + height * 0.08);
          ctx.quadraticCurveTo(
            x + b * wTop * 1.1,
            top[1] - height * 0.1,
            x + b * wTop * 2.1,
            top[1] - height * 0.34,
          );
          ctx.stroke();
        }

        ctx.fillStyle = css(TRUNK);
        ctx.beginPath();
        ctx.moveTo(x - wTop / 2, top[1]);
        ctx.lineTo(x + wTop / 2, top[1]);
        ctx.lineTo(x + wFoot / 2, foot[1]);
        ctx.lineTo(x - wFoot / 2, foot[1]);
        ctx.closePath();
        ctx.fill();

        // One shaded half, which is the whole lighting model a column needs.
        ctx.fillStyle = css(mix(TRUNK, [0, 0, 0], 0.24));
        ctx.beginPath();
        ctx.moveTo(x, top[1]);
        ctx.lineTo(x + wTop / 2, top[1]);
        ctx.lineTo(x + wFoot / 2, foot[1]);
        ctx.lineTo(x, foot[1]);
        ctx.closePath();
        ctx.fill();

        // Bark, as rings. A stack of them is what says the trunk is a solid
        // round thing and not a painted stripe.
        ctx.strokeStyle = css(mix(TRUNK, [0, 0, 0], 0.36));
        ctx.lineWidth = Math.max(0.8, unit * 0.07);
        for (let k = 1; k < 8; k += 1) {
          const f = k / 8;
          const y = top[1] + height * f;
          const w = (wTop + (wFoot - wTop) * f) / 2;
          ctx.beginPath();
          ctx.moveTo(x - w, y);
          ctx.lineTo(x + w, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      };

      /*
       * Before every block, and not in their depth order.
       *
       * A trunk is one tall thing at the middle of the lawn, so it has no one
       * depth: its foot belongs at zero and its crown belongs behind the whole
       * canopy. Sorting it in at either read wrong - at zero, the canopy is
       * drawn first and the branches paint over the blossom, which is a bare
       * branch sticking out of the top of the tree. Painting it first is exact
       * for the only overlap that exists, which is blossom in front of bark.
       */
      drawTrunk();

      /* ---- the cat ------------------------------------------------------- */

      /*
       * One cat, strolling a slow lap of the lawn.
       *
       * It goes the way the wind goes: entirely, by the time the code lands.
       * Everything alive in this scene lives in the second before the QR
       * exists, because a settled code has to be a still target - and a cat
       * sitting on a module is a module a scanner cannot read at all.
       *
       * The path is a circle on the lawn rather than a wander, because a wander
       * needs somewhere to go and a lap does not.
       */
      const alive = Math.min(1, (1 - e) * 2.4);
      const cx = CAT_SPOT.x;
      const cz = CAT_SPOT.z;
      const here = px(cx, cz);

      /*
       * It stays put and only its face moves - a ten-second loop of small,
       * cartoon things: it breathes all the time, blinks every few seconds
       * (twice in a row now and then), tilts its head one way as if curious
       * and later a little the other way, and once a loop squeezes its eyes
       * shut in a smile, blushes, and a heart pops out.
       */
      const loop = now % 10000;
      const breath = Math.sin(now / 520);
      const tilt = 0.085 * pulse(loop, 1800, 2600) - 0.06 * pulse(loop, 8000, 1800);
      const smile = Math.min(1, pulse(loop, 5600, 2200) * 1.6);
      const blinkAt = now % 3700;
      const blink = Math.max(pulse(blinkAt, 0, 170), loop > 9000 ? pulse(blinkAt, 260, 170) : 0);
      const lid = Math.max(blink, smile);

      const paintCat = () => {
        const sheet = catImage();
        if (alive <= 0.01 || !sheet) return;
        const ground = py(cx, 0, cz);
        const f = CAT;
        const k = (unit * CAT_HEIGHT) / CAT.h;

        ctx.save();
        // Its shadow on the lawn, soft and flat.
        ctx.globalAlpha = alive * 0.2;
        ctx.fillStyle = 'rgb(90, 40, 80)';
        ctx.beginPath();
        ctx.ellipse(here, ground, unit * 2.8, unit * 2.8 * Math.max(0.2, cosP) * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // An image fades as one animal, so the scene's alpha is enough.
        ctx.globalAlpha = alive;
        ctx.translate(here, ground);
        // Breathing: a touch taller and narrower on the in-breath.
        ctx.scale(k * (1 - 0.008 * breath), k * (1 + 0.018 * breath));
        // Sheet pixels from here on, with the feet at the origin.
        ctx.translate(-f.ax, -f.h);

        // The body, with the head cut out of it so the head can move on its own.
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, f.w, f.h);
        ctx.rect(HEAD.x, HEAD.y, f.w - HEAD.x, HEAD.clipBelow);
        ctx.clip('evenodd');
        ctx.drawImage(sheet, 0, 0, f.w, f.h, 0, 0, f.w, f.h);
        ctx.restore();

        // The head, tilting about the neck, and everything on the face with it.
        ctx.translate(HEAD.pivotX, HEAD.pivotY);
        ctx.rotate(tilt);
        ctx.translate(-HEAD.pivotX, -HEAD.pivotY);
        ctx.drawImage(sheet, HEAD.x, HEAD.y, HEAD.w, HEAD.h, HEAD.x, HEAD.y, HEAD.w, HEAD.h);

        // Lids: fur comes down over each eye from the top.
        if (lid > 0.01) {
          for (const eye of EYES) {
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(eye.x, eye.y, eye.rx * 1.3, eye.ry * 1.2, 0, 0, Math.PI * 2);
            ctx.clip();
            ctx.fillStyle = FUR;
            const top = eye.y - eye.ry * 1.25;
            ctx.fillRect(eye.x - eye.rx * 1.4, top, eye.rx * 2.8, eye.ry * 2.5 * Math.min(1, lid));
            ctx.restore();
          }
          if (lid > 0.9) {
            // Shut: a soft curve for a blink, a happy arch for a smile.
            ctx.strokeStyle = 'rgb(250, 248, 252)';
            ctx.lineWidth = 3.4;
            ctx.lineCap = 'round';
            for (const eye of EYES) {
              ctx.beginPath();
              if (smile > 0.5) ctx.arc(eye.x, eye.y + eye.ry * 0.35, eye.rx * 0.95, Math.PI * 1.12, Math.PI * 1.88);
              else ctx.arc(eye.x, eye.y - eye.ry * 0.3, eye.rx * 0.95, Math.PI * 0.12, Math.PI * 0.88);
              ctx.stroke();
            }
          }
        }

        // A blush that comes up with the smile.
        if (smile > 0.01) {
          ctx.fillStyle = `rgba(255, 110, 150, ${0.55 * smile})`;
          for (const cheek of CHEEKS) {
            ctx.beginPath();
            ctx.ellipse(cheek.x, cheek.y, 9, 5.5, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();

        // With the smile, a heart pops out above its head and floats up.
        const love = (loop - 5800) / 1800;
        if (love > 0 && love < 1) {
          ctx.save();
          ctx.globalAlpha = alive * Math.min(1, (1 - love) * 3);
          ctx.fillStyle = 'rgb(255, 92, 146)';
          heart(ctx, here + unit * 2.2, ground - unit * (CAT_HEIGHT + 0.4 + love * 2), unit * 1.1 * popIn(love * 4));
          ctx.restore();
        }
      };

      /* ---- the blocks ---------------------------------------------------- */

      /*
       * One gust for the whole scene, sampled per block by its own phase, so
       * the canopy moves as a wave passing through it rather than as one solid
       * object sliding sideways.
       */
      const gust = (phase: number) =>
        Math.sin((now / GUST_MS) * Math.PI * 2 + phase) * GUST * unit;

      type Drawn = {
        sx: number;
        sy: number;
        d: number;
        colour: Rgb;
        grass: boolean;
        /** Block width in px. Blossom is fat in the air, exact on the ground. */
        w: number;
        /** 0 is a leaf on the tree, 1 is the module. Drives shape, not place. */
        t: number;
        turn: number;
      };
      const drawn: Drawn[] = [];

      for (const cell of cells) {
        // Each block runs its own clip of the timeline, offset by its delay.
        const local = Math.max(0, Math.min(1, (p - cell.delay) / (1 - cell.delay)));
        const le = ease(local);

        // Module coordinates, centred, so the code lands on the canvas middle.
        const mx = cell.qx - grid / 2 + 0.5;
        const my = cell.qy - grid / 2 + 0.5;

        const wx = cell.tx + (mx - cell.tx) * le;
        const wz = cell.tz + (my - cell.tz) * le;
        const wy = cell.ty * (1 - le);

        /*
         * Higher in the crown means more travel, and a block on its way down
         * has less and less of it. By the time it is a module it has none.
         */
        const bend = (1 - le) * (1 - e) * Math.min(1, wy / (count * 0.5));

        drawn.push({
          sx: px(wx, wz) + gust(cell.phase) * bend,
          sy: py(wx, wy, wz) + gust(cell.phase + 1.6) * bend * 0.35,
          // Painter's order: further back and lower down is drawn first.
          d: wx * sinS + wz * cosS - wy,
          colour: mix(cell.air, cell.ink, le),
          grass: cell.grass,
          /*
           * A few hundred blocks cannot fill a canopy at one module each, and
           * adding blocks is not available - the count is the number of dark
           * modules. So blossom is drawn fat while it is airborne and shrinks
           * to exactly one module as it lands, which is the only size that
           * matters.
           */
          w: unit * (cell.grass ? 1 : 1 + crown.leaf * (1 - le)),
          t: le,
          turn: cell.turn,
        });
      }

      const flat = p > 0.995;
      if (!flat) drawn.sort((a, b) => a.d - b.d);

      /*
       * The cat is not a block, but "is this in front of that" is a question
       * the block sort already answers - so it goes into the same order rather
       * than being painted before the blocks and hoping.
       *
       * That hope is exactly what put it under the grass: painted ahead of
       * every block, every tuft on the lawn covered it, including the ones on
       * the far side it should have been walking in front of.
       */
      const sprites = flat ? [] : [{ d: cx * sinS + cz * cosS, paint: paintCat }];
      let placed = 0;
      const paintUpTo = (depth: number) => {
        while (placed < sprites.length && sprites[placed]!.d <= depth) {
          sprites[placed]!.paint();
          placed += 1;
        }
      };


      const blade = unit * (0.45 + 1.0 * (1 - e));

      for (const v of drawn) {
        paintUpTo(v.d);
        if (flat) {
          // Landed. Flat, full contrast, no seams - this is the scan target.
          ctx.fillStyle = css(v.colour);
          ctx.fillRect(v.sx - half, v.sy - half, unit + 0.6, unit + 0.6);
          continue;
        }

        const hw = v.w / 2;
        const ax = hw * cosS;
        const az = hw * sinS;
        const tx = hw * sinS * cosP;
        const tz = hw * cosS * cosP;
        const fall = v.w * sinP;

        if (!v.grass) {
          /*
           * Blossom is a leaf, and only becomes a box on the way down. Cubes
           * hanging in a canopy read as gravel; the scalloped edge of a few
           * hundred overlapping leaves is the whole look of the tree.
           */
          ctx.fillStyle = css(v.colour);
          blossom(ctx, v.sx, v.sy, hw, v.t, v.turn);
        } else {
          quad(
            [
              [v.sx - ax - az, v.sy - tz + tx],
              [v.sx + ax - az, v.sy - tz - tx],
              [v.sx + ax + az, v.sy + tz - tx],
              [v.sx - ax + az, v.sy + tz + tx],
            ],
            v.colour,
          );
        }

        /*
         * The two sides the camera can see. They collapse on their own as the
         * pitch reaches zero, so nothing has to decide when to stop drawing
         * them - and on blossom they fade in as the leaf squares up, which is
         * the moment it stops being a leaf and starts being a block.
         */
        const solid = v.grass ? 1 : Math.max(0, (v.t - 0.35) / 0.65);
        if (fall > 0.5 && solid > 0.01) {
          // Shaded by alpha rather than a second colour, so the palette stays
          // at two values however the accent changes.
          quad(
            [
              [v.sx - ax + az, v.sy + tz + tx],
              [v.sx + ax + az, v.sy + tz - tx],
              [v.sx + ax + az, v.sy + tz - tx + fall],
              [v.sx - ax + az, v.sy + tz + tx + fall],
            ],
            v.colour,
            0.76 * solid,
          );
          quad(
            [
              [v.sx + ax - az, v.sy - tz - tx],
              [v.sx + ax + az, v.sy + tz - tx],
              [v.sx + ax + az, v.sy + tz - tx + fall],
              [v.sx + ax - az, v.sy - tz - tx + fall],
            ],
            v.colour,
            0.56 * solid,
          );
        }

        /*
         * Blades, on the grass only. Three strokes off the top face, shortened
         * as the camera lifts: from overhead a tuft is a green module with a
         * texture in it, which is what keeps the lawn from turning into paint.
         */
        if (v.grass && blade > 1.2) {
          /*
           * The same gust, at the height grass has. Only the tip moves - the
           * root of a blade does not - which is what makes it bend rather than
           * slide.
           */
          const lean = gust(v.sx * 0.04) * (1 - e) * 0.95;
          for (let k = -2; k <= 2; k += 1) {
            const bx = v.sx + k * unit * 0.22;
            const len = blade * (1 - Math.abs(k) * 0.16);
            const tip = v.sy - len;
            ctx.fillStyle = css(mix(v.colour, GRASS_AIR, 0.3));
            ctx.beginPath();
            ctx.moveTo(bx - unit * 0.09, v.sy);
            ctx.lineTo(bx + unit * 0.09, v.sy);
            ctx.lineTo(bx + k * unit * 0.26 + lean, tip);
            ctx.closePath();
            ctx.fill();
            // A lit tip, which is the whole reason grass reads as grass and
            // not as a green spike.
            ctx.fillStyle = css(mix(v.colour, [225, 245, 150], 0.55));
            ctx.beginPath();
            ctx.moveTo(bx + (k * unit * 0.26 - unit * 0.05) * 0.85 + lean * 0.66, tip + len * 0.34);
            ctx.lineTo(bx + (k * unit * 0.26 + unit * 0.05) * 0.85 + lean * 0.66, tip + len * 0.34);
            ctx.lineTo(bx + k * unit * 0.26 + lean, tip);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      paintUpTo(Infinity);

      /* ---- petals still coming down -------------------------------------- */

      /*
       * A cherry in blossom is always dropping some of it, and a tree that has
       * a wind in it but nothing falling out of it reads as a tree being
       * wobbled rather than a tree in a garden.
       *
       * Fourteen of them, each a fixed fraction of the way through the same
       * fall, so there is always one leaving the canopy and one arriving. They
       * spin as they go, because a falling leaf turns over - and they fade out
       * in the last of it, arriving among the ones already lying there.
       */
      if (restAlpha > 0.01) {
        ctx.fillStyle = css(PETAL);
        /*
         * They leave from the underside of the crown, not from inside it.
         * Started at the top they spent the whole fall behind the blossom and
         * never appeared at all - the only air in this scene is between the
         * skirt of the canopy and the lawn, so that is where a petal falls.
         */
        const top = count * crown.base;
        for (let i = 0; i < FALLING; i += 1) {
          const seed = i * 2.39996;
          const k = ((now / FALL_MS + i / FALLING) % 1 + 1) % 1;
          const r = edge * 0.62 * (0.35 + ((i * 29) % 100) / 100);
          // Sideways as it comes down, and further with the same gust that is
          // moving the canopy it fell out of.
          const drift = Math.sin(k * 5 + seed) * 1.8 + gust(seed) * k * 0.8;
          const fx = Math.cos(seed) * r + drift;
          const fz = Math.sin(seed) * r + Math.cos(k * 4 + seed) * 1.2;
          const fy = top * (1 - k);

          ctx.globalAlpha = restAlpha * Math.min(1, (1 - k) * 4) * 0.95;
          blossom(ctx, px(fx, fz), py(fx, fy, fz), unit * 0.72, 0, k * 7 + seed);
        }
        ctx.globalAlpha = 1;
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      if (hold !== undefined) window.clearTimeout(hold);
    };
  }, [value, level, size, crown, autoPlay]);

  const hint = caption ?? (open ? 'Tap to see the tree' : 'Tap the tree to see the QR code');

  return (
    <button
      type="button"
      aria-label={open ? `${label}. Tap to see the tree` : `${label}. Tap to see the code`}
      onClick={() => {
        const next = !open;
        setOpen(next);
        target.current = next ? 1 : 0;
      }}
      className={cn(
        'focus-ring relative grid place-items-center rounded-lg',
        'transition-transform duration-instant ease-standard active:scale-[0.99]',
        className,
      )}
      style={{ width: size, height: size + (hint ? 22 : 0) }}
    >
      <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden />
      {hint && (
        <span className="pointer-events-none absolute bottom-1 text-caption text-text-tertiary">
          {hint}
        </span>
      )}
    </button>
  );
}
