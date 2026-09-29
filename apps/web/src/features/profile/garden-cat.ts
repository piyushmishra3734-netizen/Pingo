import type { Rgb } from './qr.js';

/**
 * The cat that walks round the cherry tree, drawn the way a cat is built
 * rather than as a mascot: a long body that is higher at the shoulder and the
 * hip than at the waist, a small round head on a neck, legs that walk in a
 * cat's order, and a tail carried up in a loose curve.
 *
 * It stays a little soft - round shapes, big eyes, a pink nose - because it
 * lives in a toy garden. But the proportions, the walk and the light on its
 * coat are a real cat's, which is what makes it read as one at forty pixels.
 *
 * Drawn in its own space: feet on y = 0, facing +x, `s` is the length of the
 * body from chest to rump. The caller flips it with a negative x scale.
 */

export type CatKind = 'black' | 'ginger' | 'snow';

interface Coat {
  /** Top of the coat, where the light falls, and the underside in shade. */
  lit: Rgb;
  shade: Rgb;
  /** Chest, muzzle and paws. */
  bib: Rgb;
  /** Stripes for the tabby, patches for the white cat. */
  mark?: Rgb;
  ear: Rgb;
  iris: Rgb;
  nose: Rgb;
  whisker: string;
}

const COATS: Record<CatKind, Coat> = {
  black: {
    lit: [78, 72, 88],
    shade: [22, 20, 28],
    bib: [40, 37, 48],
    ear: [214, 132, 150],
    iris: [196, 206, 84],
    nose: [96, 70, 80],
    whisker: 'rgba(255,255,255,0.55)',
  },
  ginger: {
    lit: [250, 182, 104],
    shade: [206, 118, 54],
    bib: [255, 244, 228],
    mark: [196, 104, 44],
    ear: [244, 164, 160],
    iris: [132, 176, 70],
    nose: [226, 120, 120],
    whisker: 'rgba(255,255,255,0.8)',
  },
  snow: {
    lit: [255, 255, 255],
    shade: [206, 204, 218],
    bib: [255, 255, 255],
    mark: [150, 146, 160],
    ear: [246, 170, 186],
    iris: [110, 170, 214],
    nose: [238, 140, 160],
    whisker: 'rgba(120,116,134,0.6)',
  },
};

const css = (c: Rgb, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * One leg, from inside the body down to a paw.
 *
 * The top of the leg starts well up inside the body and is filled with the
 * same gradient as the coat, so where the two overlap there is no seam - the
 * leg grows out of the animal rather than being pinned on to it. A hind leg
 * is a thick thigh that bends back at the hock; a foreleg is a slimmer,
 * straighter column.
 *
 * `swing` is the leg's angle from straight down (forward is positive) and
 * `lift` raises the paw off the ground as it comes through.
 */
function leg(
  ctx: CanvasRenderingContext2D,
  s: number,
  hipX: number,
  hipY: number,
  swing: number,
  lift: number,
  hind: boolean,
  fill: string | CanvasGradient,
  paw: string,
) {
  const footY = -lift * s * 0.06;
  const length = footY - hipY;
  const footX = hipX + Math.sin(swing) * length * 0.62;
  // A hind leg bends at the knee forward and the hock back; a foreleg barely bends.
  const midX = (hipX + footX) / 2 + (hind ? s * 0.05 : s * 0.012);
  const midY = hipY + length * 0.5;
  const top = s * (hind ? 0.12 : 0.075);
  const mid = s * (hind ? 0.055 : 0.045);
  const bottom = s * 0.034;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(hipX - top, hipY);
  ctx.bezierCurveTo(hipX - top, hipY + length * 0.25, midX - mid, midY - length * 0.1, midX - mid, midY);
  ctx.quadraticCurveTo(footX - bottom * (hind ? 1.4 : 1), footY - length * 0.2, footX - bottom, footY - s * 0.02);
  ctx.lineTo(footX + bottom, footY - s * 0.02);
  ctx.quadraticCurveTo(footX + bottom * 1.1, footY - length * 0.2, midX + mid, midY);
  ctx.bezierCurveTo(midX + mid, midY - length * 0.1, hipX + top, hipY + length * 0.25, hipX + top, hipY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = paw;
  ctx.beginPath();
  ctx.ellipse(footX + s * 0.014, footY - s * 0.02, s * 0.046, s * 0.026, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draws the cat.
 *
 * `step` runs the walk: one whole cycle is 2 pi, in which each leg swings
 * once, in a cat's order - left hind, left fore, right hind, right fore.
 * `blink` closes the eyes, 0 open to 1 shut.
 */
export function paintCat(ctx: CanvasRenderingContext2D, s: number, kind: CatKind, step: number, blink = 0) {
  const k = COATS[kind];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // A walk carries the body up a little on every footfall.
  const b = -Math.abs(Math.sin(step * 2)) * s * 0.012;
  const phase = (o: number) => step + o * Math.PI * 2;
  const swingOf = (o: number) => Math.sin(phase(o)) * 0.5;
  // The paw only leaves the ground while it is coming forward.
  const liftOf = (o: number) => Math.max(0, Math.cos(phase(o)));

  /*
   * One light for the whole animal: lit along the back, falling into shade
   * under the belly and down the legs. Body, neck and near legs all share it,
   * which is what lets them overlap without a line where they meet.
   */
  const coat = ctx.createLinearGradient(0, -s * 0.82, 0, 0);
  coat.addColorStop(0, css(k.lit));
  coat.addColorStop(0.45, css(mix(k.lit, k.shade, 0.55)));
  coat.addColorStop(1, css(k.shade));
  const farCoat = ctx.createLinearGradient(0, -s * 0.6, 0, 0);
  farCoat.addColorStop(0, css(mix(k.shade, [0, 0, 0], 0.05)));
  farCoat.addColorStop(1, css(mix(k.shade, [0, 0, 0], 0.25)));
  const farPaw = css(mix(k.bib, k.shade, 0.55));
  const nearPaw = css(k.bib);

  /* The tail, behind everything: up from the rump in a loose S that sways. */
  const sway = Math.sin(step * 0.5) * 0.07;
  {
    const pts: [number, number][] = [];
    const p0: [number, number] = [-s * 0.5, -s * 0.52 + b];
    const p1: [number, number] = [-s * (0.74 + sway), -s * 0.55];
    const p2: [number, number] = [-s * (0.8 - sway), -s * 0.92];
    const p3: [number, number] = [-s * (0.64 + sway * 1.5), -s * 1.1];
    for (let i = 0; i <= 18; i += 1) {
      const t = i / 18;
      const u = 1 - t;
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    const tail = ctx.createLinearGradient(-s * 0.9, 0, -s * 0.55, 0);
    tail.addColorStop(0, css(mix(k.lit, k.shade, 0.25)));
    tail.addColorStop(1, css(mix(k.lit, k.shade, 0.6)));
    ctx.strokeStyle = tail;
    // Thick at the root and tapering to a rounded tip.
    for (let i = 0; i < pts.length - 1; i += 1) {
      ctx.lineWidth = s * (0.08 - (i / pts.length) * 0.038);
      ctx.beginPath();
      ctx.moveTo(pts[i]![0], pts[i]![1]);
      ctx.lineTo(pts[i + 1]![0], pts[i + 1]![1]);
      ctx.stroke();
    }
    if (kind === 'ginger' && k.mark) {
      ctx.strokeStyle = css(k.mark, 0.7);
      ctx.lineWidth = s * 0.018;
      for (const i of [5, 9, 13]) {
        const [x, y] = pts[i]!;
        const [nx, ny] = pts[i + 1]!;
        const ang = Math.atan2(ny - y, nx - x) + Math.PI / 2;
        const w = s * 0.03;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(ang) * w, y - Math.sin(ang) * w);
        ctx.lineTo(x + Math.cos(ang) * w, y + Math.sin(ang) * w);
        ctx.stroke();
      }
    }
  }

  const hindX = -s * 0.36;
  const foreX = s * 0.2;
  const hipY = -s * 0.46 + b;

  /* The far legs, in the body's own shadow. */
  leg(ctx, s, hindX + s * 0.04, hipY, swingOf(0.5), liftOf(0.5), true, farCoat, farPaw);
  leg(ctx, s, foreX + s * 0.04, hipY, swingOf(0.75), liftOf(0.75), false, farCoat, farPaw);

  /*
   * Body and neck as one shape: a back that dips a little behind the
   * shoulders, a nape rising into the head, a deep chest, a belly that tucks
   * up and a round rump.
   */
  const body = new Path2D();
  body.moveTo(-s * 0.52, -s * 0.5 + b);
  body.bezierCurveTo(-s * 0.4, -s * 0.64 + b, -s * 0.05, -s * 0.6 + b, s * 0.16, -s * 0.62 + b);
  body.bezierCurveTo(s * 0.26, -s * 0.63 + b, s * 0.33, -s * 0.72 + b, s * 0.38, -s * 0.82 + b);
  body.lineTo(s * 0.56, -s * 0.74 + b);
  body.bezierCurveTo(s * 0.52, -s * 0.58 + b, s * 0.44, -s * 0.44 + b, s * 0.34, -s * 0.36 + b);
  body.bezierCurveTo(s * 0.26, -s * 0.3 + b, s * 0.12, -s * 0.31 + b, s * 0.0, -s * 0.34 + b);
  body.bezierCurveTo(-s * 0.14, -s * 0.37 + b, -s * 0.3, -s * 0.35 + b, -s * 0.44, -s * 0.34 + b);
  body.bezierCurveTo(-s * 0.6, -s * 0.34 + b, -s * 0.62, -s * 0.45 + b, -s * 0.52, -s * 0.5 + b);
  body.closePath();
  ctx.fillStyle = coat;
  ctx.fill(body);

  // Markings stay on the coat: clipped to it.
  ctx.save();
  ctx.clip(body);
  if (kind === 'ginger' && k.mark) {
    ctx.fillStyle = css(k.mark, 0.55);
    for (const x of [-0.44, -0.32, -0.2, -0.08, 0.04, 0.15]) {
      ctx.beginPath();
      ctx.ellipse(s * x, -s * 0.58 + b, s * 0.03, s * 0.13, 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (kind === 'snow' && k.mark) {
    ctx.fillStyle = css(k.mark, 0.85);
    ctx.beginPath();
    ctx.ellipse(-s * 0.3, -s * 0.6 + b, s * 0.17, s * 0.11, -0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  // A pale bib down the chest, for the coats that have one.
  if (kind !== 'black') {
    // Soft-edged: fur fades from one colour into the next, it does not stop.
    const bx = s * 0.4;
    const by = -s * 0.48 + b;
    const bib = ctx.createRadialGradient(bx, by, 0, bx, by, s * 0.17);
    bib.addColorStop(0, css(k.bib, 0.95));
    bib.addColorStop(0.55, css(k.bib, 0.7));
    bib.addColorStop(1, css(k.bib, 0));
    ctx.fillStyle = bib;
    ctx.beginPath();
    ctx.ellipse(bx, by, s * 0.13, s * 0.2, -0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  // Light along the ridge of the back.
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = s * 0.03;
  ctx.beginPath();
  ctx.moveTo(s * 0.3, -s * 0.7 + b);
  ctx.bezierCurveTo(s * 0.1, -s * 0.62 + b, -s * 0.3, -s * 0.62 + b, -s * 0.5, -s * 0.52 + b);
  ctx.stroke();
  ctx.restore();

  /* The near legs, grown out of the body in the same light. */
  leg(ctx, s, hindX, hipY, swingOf(0), liftOf(0), true, coat, nearPaw);
  leg(ctx, s, foreX, hipY, swingOf(0.25), liftOf(0.25), false, coat, nearPaw);

  /* The head, nodding a little with the stride. */
  const nod = Math.sin(step * 2 + 0.6) * s * 0.008;
  const hx = s * 0.5;
  const hy = -s * 0.8 + b + nod;
  const r = s * 0.185;

  // Ears: the far one first and in shade, the near one with a pink inside.
  const ear = (bx: number, tipX: number, tipY: number, fill: string, inner?: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.45, hy - r * 0.5);
    ctx.quadraticCurveTo(tipX - r * 0.22, tipY + r * 0.3, tipX, tipY);
    ctx.quadraticCurveTo(tipX + r * 0.25, tipY + r * 0.4, bx + r * 0.45, hy - r * 0.45);
    ctx.closePath();
    ctx.fill();
    if (inner) {
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.moveTo(bx - r * 0.22, hy - r * 0.6);
      ctx.quadraticCurveTo(tipX - r * 0.08, tipY + r * 0.42, tipX + r * 0.03, tipY + r * 0.28);
      ctx.quadraticCurveTo(tipX + r * 0.12, tipY + r * 0.5, bx + r * 0.24, hy - r * 0.56);
      ctx.closePath();
      ctx.fill();
    }
  };
  ear(hx - r * 0.5, hx - r * 0.7, hy - r * 1.5, css(mix(k.shade, [0, 0, 0], 0.1)));
  ear(hx + r * 0.2, hx + r * 0.3, hy - r * 1.58, css(mix(k.lit, k.shade, 0.15)), css(k.ear));

  // Skull and cheeks: a little wider than tall, lit from above.
  const head = ctx.createRadialGradient(hx - r * 0.25, hy - r * 0.5, r * 0.15, hx, hy, r * 1.2);
  head.addColorStop(0, css(k.lit));
  head.addColorStop(1, css(mix(k.lit, k.shade, 0.65)));
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.ellipse(hx, hy, r * 1.05, r * 0.94, 0, 0, Math.PI * 2);
  ctx.fill();
  if (kind === 'ginger' && k.mark) {
    // The tabby's M on the brow.
    ctx.strokeStyle = css(k.mark, 0.55);
    ctx.lineWidth = s * 0.014;
    for (const dx of [-0.2, 0, 0.2]) {
      ctx.beginPath();
      ctx.moveTo(hx + r * dx, hy - r * 0.85);
      ctx.lineTo(hx + r * (dx + 0.04), hy - r * 0.55);
      ctx.stroke();
    }
  }

  // The muzzle, forward and a touch lower.
  ctx.fillStyle = css(kind === 'black' ? mix(k.lit, k.shade, 0.2) : k.bib);
  ctx.beginPath();
  ctx.ellipse(hx + r * 0.72, hy + r * 0.3, r * 0.4, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose at the tip, and the short line and curl of the mouth under it.
  ctx.fillStyle = css(k.nose);
  ctx.beginPath();
  ctx.moveTo(hx + r * 0.98, hy + r * 0.1);
  ctx.quadraticCurveTo(hx + r * 1.08, hy + r * 0.06, hx + r * 1.12, hy + r * 0.13);
  ctx.lineTo(hx + r * 1.06, hy + r * 0.25);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = css(mix(k.shade, [0, 0, 0], 0.35), 0.55);
  ctx.lineWidth = Math.max(0.5, s * 0.008);
  ctx.beginPath();
  ctx.moveTo(hx + r * 1.06, hy + r * 0.25);
  ctx.quadraticCurveTo(hx + r * 1.02, hy + r * 0.42, hx + r * 0.86, hy + r * 0.4);
  ctx.stroke();

  // The eye: almond, a clear iris with a slit pupil and a point of light.
  const ex = hx + r * 0.5;
  const ey = hy - r * 0.1;
  const ew = r * 0.27;
  const eh = r * 0.2 * Math.max(0.1, 1 - blink);
  const eye = new Path2D();
  eye.moveTo(ex - ew, ey + eh * 0.1);
  eye.quadraticCurveTo(ex - ew * 0.1, ey - eh * 1.5, ex + ew, ey - eh * 0.25);
  eye.quadraticCurveTo(ex + ew * 0.1, ey + eh * 1.2, ex - ew, ey + eh * 0.1);
  eye.closePath();
  ctx.fillStyle = css(k.iris);
  ctx.fill(eye);
  if (blink < 0.7) {
    ctx.save();
    ctx.clip(eye);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(ex - ew, ey - eh * 1.6, ew * 2, eh * 0.7);
    ctx.fillStyle = 'rgb(20,18,24)';
    ctx.beginPath();
    ctx.ellipse(ex + ew * 0.12, ey - eh * 0.15, ew * 0.2, eh * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(ex + ew * 0.32, ey - eh * 0.5, Math.max(0.5, ew * 0.15), 0, Math.PI * 2);
    ctx.fill();
  }

  // A faint pink flush on the cheek.
  ctx.fillStyle = 'rgba(255,140,170,0.2)';
  ctx.beginPath();
  ctx.ellipse(hx + r * 0.22, hy + r * 0.34, r * 0.22, r * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();

  // Whiskers, fine and pale, fanning back from the muzzle.
  ctx.strokeStyle = k.whisker;
  ctx.lineWidth = Math.max(0.4, s * 0.005);
  for (const [dy, len, bend] of [[0.2, 1.0, -0.12], [0.3, 1.05, 0], [0.4, 0.9, 0.14]] as const) {
    ctx.beginPath();
    ctx.moveTo(hx + r * 0.85, hy + r * dy);
    ctx.quadraticCurveTo(hx + r * (0.85 + len * 0.5), hy + r * (dy - 0.05 + bend * 0.5), hx + r * (0.85 + len), hy + r * (dy + bend));
    ctx.stroke();
  }
}
