import { useEffect, useRef } from 'react';

/**
 * The voice, as a row of rounded bars under the words.
 *
 * Driven by functions read once per frame rather than by props, for the same
 * reason the old wave was: a prop per sample is a React render sixty times a
 * second to move pixels React is not drawing. The canvas owns its own loop.
 *
 * The amplitude is real - the microphone while listening, the audio while
 * speaking - so the bars fall still in the pauses and jump on a loud word.
 * While thinking there is nothing to hear, so they sink to a low, slow ripple
 * in a quiet colour: alive, and plainly not listening.
 */
export interface VoiceBarsProps {
  /** Current loudness, 0-1, read every frame. */
  level: () => number;
  /** Which colour and motion to use, read every frame. */
  mode: () => 'listening' | 'thinking' | 'speaking' | 'error';
}

const BARS = 36;
const GAP = 3;

export function VoiceBars({ level, mode }: VoiceBarsProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = box.width;
      height = box.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // The colours come from the theme, so the bars follow light and dark.
    const style = getComputedStyle(canvas);
    const ink = style.getPropertyValue('--bars-ink').trim() || '#1c1826';
    const brand = style.getPropertyValue('--bars-brand').trim() || '#8b5cf6';
    const quiet = style.getPropertyValue('--bars-quiet').trim() || '#d6d1de';

    let smooth = 0;
    let frame = 0;
    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      const phase = mode();
      smooth += (level() - smooth) * 0.28;
      const bar = (width - GAP * (BARS - 1)) / BARS;
      if (bar > 0.5) {
        ctx.fillStyle = phase === 'speaking' ? brand : phase === 'listening' ? ink : quiet;
        for (let i = 0; i < BARS; i += 1) {
          const wave = Math.sin(i * 0.55 + now / 180) * 0.5 + 0.5;
          const v =
            phase === 'thinking' || phase === 'error'
              ? 0.1 + 0.06 * Math.sin(now / 320 + i * 0.4)
              : 0.1 + Math.min(1, smooth * 1.4) * (0.3 + 0.7 * wave);
          const h = Math.max(4, v * height);
          ctx.beginPath();
          ctx.roundRect(i * (bar + GAP), (height - h) / 2, bar, h, bar / 2);
          ctx.fill();
        }
      }
      if (!still) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [level, mode]);

  return <canvas ref={ref} aria-hidden className="block h-full w-full" />;
}
