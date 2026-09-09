import { cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { encodeQr, type QrLevel } from './qr.js';

/**
 * A voxel cherry tree that comes apart into the QR code.
 *
 * Tap it: every block flies to the module it stands for while the camera lifts
 * from a three-quarter view to straight overhead, so the scene is a tree at the
 * start of the second and a scannable code at the end of it. Tap again and it
 * grows back.
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
const FLIGHT_MS = 1250;

/** The quiet zone, in modules. Non-negotiable - see `QrArt`. */
const QUIET = 4;

interface Cell {
  /** Where it lands: module coordinates, with the quiet zone already added. */
  qx: number;
  qy: number;
  /** Where it starts: the tree, in world units. */
  tx: number;
  ty: number;
  tz: number;
  /** Finder modules are the grass; everything else is blossom. */
  finder: boolean;
  /** Staggers the flight so the tree comes apart rather than teleporting. */
  delay: number;
}

/**
 * The tree, built from the code rather than modelled separately.
 *
 * Every lit module gets a place on a trunk-and-canopy silhouette, chosen from
 * its own coordinates so the same profile always grows the same tree.
 *
 * `canopy` is the radius the blossom fills, and it is the only thing worth
 * turning. The block count is fixed - it is the number of dark modules - so a
 * smaller radius packs the same blocks tighter and a larger one spreads them
 * into a spray. It is a prop rather than a constant because the right value is
 * a thing to look at, not a thing to reason about, and guessing at it from a
 * description cost several rewrites that should have been one slider.
 */
function plant(modules: boolean[][], size: number, canopy: number): Cell[] {
  const cells: Cell[] = [];
  const mid = (size - 1) / 2;

  const isFinder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y]?.[x] !== true) continue;

      const finder = isFinder(x, y);
      /*
       * Deterministic per module: the same profile grows the same tree every
       * time it is opened, which is what makes it an object rather than an
       * effect.
       */
      const seed = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const r1 = ((seed % 1000) / 1000) * 2 - 1;
      const r2 = (((seed >> 10) % 1000) / 1000) * 2 - 1;
      const r3 = (((seed >> 20) % 1000) / 1000) * 2 - 1;

      let tx: number;
      let ty: number;
      let tz: number;

      if (finder) {
        // Grass: a thin skirt on the ground, which is where the corner squares
        // come from and where they return to.
        const a = (seed % 628) / 100;
        const rad = size * 0.34 + r1 * size * 0.06;
        tx = Math.cos(a) * rad;
        tz = Math.sin(a) * rad;
        ty = 0.4 + Math.abs(r2) * 0.6;
      } else if ((seed >> 5) % 7 === 0) {
        // The trunk: a short column under the canopy, one block in nine.
        tx = r1 * size * 0.045;
        tz = r2 * size * 0.045;
        ty = 1 + ((seed % 100) / 100) * size * 0.28;
      } else {
        // The canopy: a squashed sphere, packed so the blocks overlap.
        const theta = (seed % 628) / 100;
        const phi = ((seed >> 8) % 314) / 100;
        const rad = size * canopy * (0.55 + Math.abs(r3) * 0.45);
        tx = Math.sin(phi) * Math.cos(theta) * rad;
        tz = Math.sin(phi) * Math.sin(theta) * rad;
        ty = size * 0.34 + Math.cos(phi) * rad * 0.72;
      }

      cells.push({
        qx: x + QUIET,
        qy: y + QUIET,
        tx,
        ty,
        tz,
        finder,
        // Outer modules leave first, so the tree opens from the edges inward.
        delay: Math.min(0.45, (Math.hypot(x - mid, y - mid) / mid) * 0.4),
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
  canopy = 0.3,
  className,
  label = 'Profile QR code',
}: {
  value: string;
  level?: QrLevel;
  size?: number;
  /** Radius the blossom fills, as a fraction of the code's width. */
  canopy?: number;
  className?: string;
  label?: string;
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
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      progress.current = 1;
      target.current = 1;
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

      const unit = size / (grid * (1 + 0.28 * (1 - e)));
      const half = unit / 2;
      const c = grid / 2 - 0.5;
      // Pushed down while tilted, so the canopy has somewhere to be.
      const lift = (1 - e) * size * 0.13;

      const styles = getComputedStyle(canvas);
      const blossom = styles.getPropertyValue('--voxel-blossom').trim() || '#d6336c';
      const grass = styles.getPropertyValue('--voxel-grass').trim() || '#2f7d68';

      type Drawn = { sx: number; sy: number; depth: number; colour: string };
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

        const u = wx * cosS - wz * sinS;
        const v = wx * sinS + wz * cosS;

        drawn.push({
          sx: size / 2 + u * unit,
          sy: size / 2 + lift + (v * cosP - wy * sinP) * unit,
          // Painter's order: further back and lower down is drawn first.
          depth: v - wy,
          colour: cell.finder ? grass : blossom,
        });
      }

      const flat = p > 0.995;
      if (!flat) drawn.sort((a, b) => a.depth - b.depth);

      for (const v of drawn) {
        if (flat) {
          // Landed. Flat, full contrast, no seams - this is the scan target.
          ctx.fillStyle = v.colour;
          ctx.fillRect(v.sx - half, v.sy - half, unit + 0.6, unit + 0.6);
          continue;
        }

        /*
         * A box as its top face and the two sides the camera can see. The
         * sides collapse on their own as the pitch reaches zero, so nothing
         * has to decide when to stop drawing them.
         */
        const ax = half * cosS;
        const az = half * sinS;
        const tx = half * sinS * cosP;
        const tz = half * cosS * cosP;
        const fall = unit * sinP;

        ctx.fillStyle = v.colour;
        ctx.beginPath();
        ctx.moveTo(v.sx - ax - az, v.sy - tz + tx);
        ctx.lineTo(v.sx + ax - az, v.sy - tz - tx);
        ctx.lineTo(v.sx + ax + az, v.sy + tz - tx);
        ctx.lineTo(v.sx - ax + az, v.sy + tz + tx);
        ctx.closePath();
        ctx.fill();

        if (fall > 0.5) {
          // Shaded by alpha rather than a second colour, so the palette stays
          // at two values however the accent changes.
          ctx.globalAlpha = 0.76;
          ctx.beginPath();
          ctx.moveTo(v.sx - ax + az, v.sy + tz + tx);
          ctx.lineTo(v.sx + ax + az, v.sy + tz - tx);
          ctx.lineTo(v.sx + ax + az, v.sy + tz - tx + fall);
          ctx.lineTo(v.sx - ax + az, v.sy + tz + tx + fall);
          ctx.closePath();
          ctx.fill();

          ctx.globalAlpha = 0.56;
          ctx.beginPath();
          ctx.moveTo(v.sx + ax - az, v.sy - tz - tx);
          ctx.lineTo(v.sx + ax + az, v.sy + tz - tx);
          ctx.lineTo(v.sx + ax + az, v.sy + tz - tx + fall);
          ctx.lineTo(v.sx + ax - az, v.sy - tz - tx + fall);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [value, level, size, canopy]);

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
        'focus-ring relative grid place-items-center rounded-lg bg-white',
        'transition-transform duration-instant ease-standard active:scale-[0.99]',
        className,
      )}
      style={
        {
          width: size,
          height: size + 22,
          // Named here so the canvas can read them, and so the palette lives in
          // one place rather than scattered through the draw loop.
          '--voxel-blossom': '#d6336c',
          '--voxel-grass': '#2f7d68',
        } as React.CSSProperties
      }
    >
      <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden />
      <span className="pointer-events-none absolute bottom-1 text-caption text-text-tertiary">
        {open ? 'Tap to see the tree' : 'Tap the tree to see the code'}
      </span>
    </button>
  );
}
