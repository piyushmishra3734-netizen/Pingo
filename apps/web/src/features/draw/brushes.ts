/**
 * Drawing on a picture: the brushes and how each one is painted.
 *
 * ## One model for every editor
 *
 * The chat photo editor, the story editor, a post, a Ping and the player that
 * replays a drawing over a video all paint from the same stroke: a brush, a
 * colour, a width and a list of points. Nothing is stored in pixels. Points are
 * fractions of the picture (0-1) and the width is a fraction of its shorter side,
 * so the preview on a phone and the export at the photo's own resolution come
 * out identical, and a drawing made in one editor looks the same in another.
 *
 * ## Old drawings still open
 *
 * A stroke saved before brushes existed has only a colour and points. It reads
 * back as the plain pen it always was (`normalizeStroke`).
 *
 * ## Why the eraser is a brush
 *
 * It paints with `destination-out`, which only means something on a layer of
 * its own: it removes drawing, never the photo underneath. Every caller paints
 * strokes onto a transparent canvas and puts that canvas over the picture.
 */

export type Brush = 'pen' | 'marker' | 'neon' | 'chalk' | 'arrow' | 'eraser';

export interface DrawPoint {
  x: number;
  y: number;
}

export interface DrawStroke {
  brush: Brush;
  colour: string;
  /** Width as a fraction of the picture's shorter side. */
  size: number;
  points: DrawPoint[];
}

/** What an older save, or a video's stored marks, may hold. */
export interface StoredStroke {
  colour: string;
  points: DrawPoint[];
  brush?: Brush | undefined;
  size?: number | undefined;
}

/** The pen width every drawing had before the width was a choice. */
export const LEGACY_SIZE = 0.008;
export const MIN_SIZE = 0.004;
export const MAX_SIZE = 0.06;
export const DEFAULT_SIZE = 0.012;

const BRUSHES: readonly Brush[] = ['pen', 'marker', 'neon', 'chalk', 'arrow', 'eraser'];

export function normalizeStroke(stored: StoredStroke): DrawStroke {
  return {
    brush: stored.brush && BRUSHES.includes(stored.brush) ? stored.brush : 'pen',
    colour: stored.colour,
    size: typeof stored.size === 'number' && stored.size > 0 ? Math.min(stored.size, MAX_SIZE * 1.5) : LEGACY_SIZE,
    points: stored.points,
  };
}

/** The colours offered first, in the order they sit on the bar. */
export const SWATCHES = ['#ffffff', '#101114', '#ff3b5c', '#ff9500', '#ffd60a', '#34c759', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff6fb5'];

// ------------------------------------------------------------------ painting

/** A small seeded generator, so chalk grain is the same every time the stroke is repainted. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth line through the points: quadratic curves between midpoints, so a finger's jitter does not show. */
function trace(ctx: CanvasRenderingContext2D, pts: DrawPoint[]): void {
  ctx.beginPath();
  const first = pts[0]!;
  ctx.moveTo(first.x, first.y);
  if (pts.length === 1) {
    // A tap is a dot.
    ctx.lineTo(first.x + 0.01, first.y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i += 1) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  const last = pts[pts.length - 1]!;
  ctx.lineTo(last.x, last.y);
}

export function paintStroke(ctx: CanvasRenderingContext2D, stroke: DrawStroke, w: number, h: number): void {
  if (stroke.points.length === 0) return;
  const unit = Math.min(w, h);
  const width = Math.max(1, stroke.size * unit);
  const pts = stroke.points.map((p) => ({ x: p.x * w, y: p.y * h }));

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = stroke.colour;
  ctx.fillStyle = stroke.colour;

  switch (stroke.brush) {
    case 'marker': {
      // Flat and see-through, like a highlighter: one stroke, so it does not darken where it crosses itself.
      ctx.globalAlpha = 0.5;
      ctx.lineCap = 'square';
      ctx.lineWidth = width * 2.4;
      trace(ctx, pts);
      ctx.stroke();
      break;
    }
    case 'neon': {
      ctx.shadowColor = stroke.colour;
      ctx.shadowBlur = width * 2.8;
      ctx.lineWidth = width;
      trace(ctx, pts);
      ctx.stroke();
      // The bright core, so a dark colour still reads as a tube of light.
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, width * 0.34);
      trace(ctx, pts);
      ctx.stroke();
      break;
    }
    case 'chalk': {
      const rand = seeded(Math.round(pts[0]!.x * 997 + pts[0]!.y * 31));
      const step = Math.max(1, width * 0.2);
      const grains = Math.max(5, Math.round(width / 1.3));
      const dot = (x: number, y: number) => {
        for (let g = 0; g < grains; g += 1) {
          const angle = rand() * Math.PI * 2;
          const dist = Math.sqrt(rand()) * (width / 2);
          ctx.globalAlpha = 0.45 + rand() * 0.55;
          const r = Math.max(0.8, width * (0.05 + rand() * 0.06));
          ctx.beginPath();
          ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, r, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      dot(pts[0]!.x, pts[0]!.y);
      let carry = 0;
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        let at = step - carry;
        while (at <= length) {
          const t = at / length;
          dot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
          at += step;
        }
        carry = (carry + length) % step;
      }
      break;
    }
    case 'arrow': {
      ctx.lineWidth = width;
      trace(ctx, pts);
      ctx.stroke();
      // The head, turned the way the line was going when it ended.
      const tip = pts[pts.length - 1]!;
      let from = pts[0]!;
      for (let i = pts.length - 2; i >= 0; i -= 1) {
        from = pts[i]!;
        if (Math.hypot(tip.x - from.x, tip.y - from.y) > width * 2.5) break;
      }
      if (from !== tip && Math.hypot(tip.x - from.x, tip.y - from.y) > width) {
        const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
        const head = width * 3.6;
        ctx.beginPath();
        for (const turn of [-0.52, 0.52]) {
          ctx.moveTo(tip.x, tip.y);
          ctx.lineTo(tip.x - Math.cos(angle + turn) * head, tip.y - Math.sin(angle + turn) * head);
        }
        ctx.stroke();
      }
      break;
    }
    case 'eraser': {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = width * 2.2;
      trace(ctx, pts);
      ctx.stroke();
      break;
    }
    default: {
      ctx.lineWidth = width;
      trace(ctx, pts);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function paintStrokes(ctx: CanvasRenderingContext2D, strokes: readonly DrawStroke[], w: number, h: number): void {
  for (const stroke of strokes) paintStroke(ctx, stroke, w, h);
}

/** Slider position (0-1) to a width, gently curved so the thin end has room to be precise. */
export const sizeAt = (t: number): number => MIN_SIZE + Math.pow(Math.min(1, Math.max(0, t)), 1.6) * (MAX_SIZE - MIN_SIZE);
export const positionOf = (size: number): number => Math.pow(Math.min(1, Math.max(0, (size - MIN_SIZE) / (MAX_SIZE - MIN_SIZE))), 1 / 1.6);
