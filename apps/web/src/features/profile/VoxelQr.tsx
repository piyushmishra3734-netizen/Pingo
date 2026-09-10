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

/** The tree gets a beat to be a tree before an autoplaying scene opens it. */
const HOLD_MS = 900;

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
const REST: Rgb = [233, 229, 234];
const TRUNK: Rgb = [138, 98, 68];
const PETAL: Rgb = [246, 168, 182];

const css = (c: Rgb) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

const shadeOf = (ink: Rgb, air: Rgb, jitter: number) => mix(ink, air, jitter * GARDEN.jitter);

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
  air: Rgb;
  ink: Rgb;
}

/**
 * The tree, built from the code rather than modelled separately.
 *
 * Every lit module gets a place on a trunk-and-canopy silhouette, chosen from
 * its own coordinates so the same profile always grows the same tree.
 *
 * `canopy` is how far the dome splays past the module each block belongs to:
 * 1 is a canopy exactly the width of the lawn, and above that it overhangs. It
 * is the only thing worth turning, and it is a prop rather than a constant
 * because the right value is a thing to look at, not a thing to reason about -
 * guessing at it from a description cost several rewrites that should have been
 * one slider.
 */
function plant(modules: boolean[][], size: number, canopy: number): Cell[] {
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
         * How far out along its own bearing this block sits, as a fraction of
         * the dome's surface. A block at 0.6 is on an inner shell of the same
         * dome, which is what turns a moulded cap - solid on top, hollow and
         * visibly thin underneath - into a canopy with a volume. It costs a
         * little travel, and it costs none of the bearing.
         */
        const fill = 0.6 + 0.4 * Math.abs(r3);
        const dome = size * 0.85 * Math.sqrt(1 - r * r);

        tx = (x - mid) * canopy * fill;
        tz = (y - mid) * canopy * fill;
        ty = size * 0.46 + dome * fill;
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
        air: grass ? GRASS_AIR : BLOSSOM_AIR,
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
  canopy = 1.25,
  autoPlay = false,
  className,
  label = 'Profile QR code',
  caption,
}: {
  value: string;
  level?: QrLevel;
  size?: number;
  /** How far the dome splays past each block's own module. 1 is lawn-width. */
  canopy?: number;
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
    const cells = plant(modules, count, canopy);

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

      const unit = size / (grid * (1 + 0.72 * (1 - e)));
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
        ctx.globalAlpha = restAlpha * 0.8;
        ctx.fillStyle = css(PETAL);
        for (let i = 0; i < 26; i += 1) {
          // The golden angle, so a couple of dozen of them spread evenly
          // without a random number generator or a table of positions.
          const a = (i * 2.39996) % 6.283;
          const r = edge * 0.6 * Math.sqrt(((i * 37) % 100) / 100);
          const fx = Math.cos(a) * r;
          const fz = Math.sin(a) * r;
          ctx.fillRect(
            px(fx, fz) - unit * 0.3,
            py(fx, 0.02, fz) - unit * 0.18,
            unit * 0.6,
            unit * 0.36,
          );
        }
        ctx.globalAlpha = 1;
      }

      /* ---- the trunk ----------------------------------------------------- */

      const trunkH = count * 0.66 * (1 - e);
      if (trunkH > 0.05) {
        const w = Math.max(1.5, count * 0.075) * unit;
        const top = at(0, 0, trunkH);
        const foot = at(0, 0, 0);
        const height = Math.max(0, foot[1] - top[1]);
        ctx.globalAlpha = Math.min(1, (1 - e) * 2.2);
        ctx.fillStyle = css(TRUNK);
        ctx.fillRect(top[0] - w * 0.5, top[1], w, height);
        // One shaded half, which is the whole lighting model a column needs.
        ctx.fillStyle = css(mix(TRUNK, [0, 0, 0], 0.22));
        ctx.fillRect(top[0], top[1], w * 0.5, height);
        ctx.globalAlpha = 1;
      }

      /* ---- the blocks ---------------------------------------------------- */

      type Drawn = {
        sx: number;
        sy: number;
        d: number;
        colour: Rgb;
        grass: boolean;
        /** Block width in px. Blossom is fat in the air, exact on the ground. */
        w: number;
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

        drawn.push({
          sx: px(wx, wz),
          sy: py(wx, wy, wz),
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
          w: unit * (cell.grass ? 1 : 1 + 1.55 * (1 - le)),
        });
      }

      const flat = p > 0.995;
      if (!flat) drawn.sort((a, b) => a.d - b.d);

      const blade = unit * (0.45 + 0.6 * (1 - e));

      for (const v of drawn) {
        if (flat) {
          // Landed. Flat, full contrast, no seams - this is the scan target.
          ctx.fillStyle = css(v.colour);
          ctx.fillRect(v.sx - half, v.sy - half, unit + 0.6, unit + 0.6);
          continue;
        }

        /*
         * A box as its top face and the two sides the camera can see. The
         * sides collapse on their own as the pitch reaches zero, so nothing
         * has to decide when to stop drawing them.
         */
        const hw = v.w / 2;
        const ax = hw * cosS;
        const az = hw * sinS;
        const tx = hw * sinS * cosP;
        const tz = hw * cosS * cosP;
        const fall = v.w * sinP;
        quad(
          [
            [v.sx - ax - az, v.sy - tz + tx],
            [v.sx + ax - az, v.sy - tz - tx],
            [v.sx + ax + az, v.sy + tz - tx],
            [v.sx - ax + az, v.sy + tz + tx],
          ],
          v.colour,
        );

        if (fall > 0.5) {
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
            0.76,
          );
          quad(
            [
              [v.sx + ax - az, v.sy - tz - tx],
              [v.sx + ax + az, v.sy + tz - tx],
              [v.sx + ax + az, v.sy + tz - tx + fall],
              [v.sx + ax - az, v.sy - tz - tx + fall],
            ],
            v.colour,
            0.56,
          );
        }

        /*
         * Blades, on the grass only. Three strokes off the top face, shortened
         * as the camera lifts: from overhead a tuft is a green module with a
         * texture in it, which is what keeps the lawn from turning into paint.
         */
        if (v.grass && blade > 1.2) {
          ctx.fillStyle = css(mix(v.colour, GRASS_AIR, 0.35));
          for (let k = -1; k <= 1; k += 1) {
            const bx = v.sx + k * unit * 0.28;
            ctx.beginPath();
            ctx.moveTo(bx - unit * 0.1, v.sy);
            ctx.lineTo(bx + unit * 0.1, v.sy);
            ctx.lineTo(bx + k * unit * 0.2, v.sy - blade);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      if (hold !== undefined) window.clearTimeout(hold);
    };
  }, [value, level, size, canopy, autoPlay]);

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
