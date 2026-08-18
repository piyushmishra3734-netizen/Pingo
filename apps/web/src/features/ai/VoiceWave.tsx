import { useEffect, useRef } from 'react';

/**
 * The line that moves when there is a voice.
 *
 * ## What it is drawing
 *
 * Several sine strands laid over each other, each with its own frequency, its
 * own drift and its own share of the amplitude. One sine wave reads as a test
 * signal; five slightly disagreeing ones read as something alive, because real
 * sound is never one frequency and the eye knows it.
 *
 * ## Why it is driven by a function and not a prop
 *
 * The amplitude is read once per frame from `level()`. A prop would mean a
 * React render per sample - sixty a second, each one re-running the component -
 * to move some pixels that React is not drawing anyway. The canvas owns its own
 * loop; React only decides whether the canvas exists.
 *
 * ## Why it matters that it is real
 *
 * The amplitude comes from the actual microphone while listening and from the
 * actual audio while speaking. A timer-driven wave looks identical for the
 * first two seconds and then gives itself away: it keeps moving through the
 * pauses, it swells while nobody is talking, and it is the same shape for a
 * shouted word as for a whispered one. People do not consciously notice the
 * difference. They notice that one feels like a picture of listening and the
 * other feels like being listened to.
 */

export interface VoiceWaveProps {
  /** Current loudness, 0-1, read every frame. */
  level: () => number;
  /**
   * Whether to move, read every frame like the level.
   *
   * A boolean prop would restart the loop on every phase change, which is a
   * visible hitch at exactly the moment the line is meant to hand over from
   * listening to speaking.
   */
  active: () => boolean;
  className?: string;
}

/** Strands, front to back. Each is a fraction of the height and a speed. */
const STRANDS = [
  { amplitude: 1.0, frequency: 1.6, speed: 0.8, width: 2.0, alpha: 0.95 },
  { amplitude: 0.75, frequency: 2.3, speed: -1.1, width: 1.5, alpha: 0.7 },
  { amplitude: 0.55, frequency: 3.1, speed: 1.4, width: 1.2, alpha: 0.5 },
  { amplitude: 0.4, frequency: 4.4, speed: -1.8, width: 1.0, alpha: 0.35 },
  { amplitude: 0.28, frequency: 5.9, speed: 2.2, width: 0.8, alpha: 0.25 },
];

/**
 * How fast the drawn level chases the real one.
 *
 * Speech amplitude is spiky - every consonant is a transient - and following it
 * exactly produces a jitter that reads as noise rather than voice. Rising
 * quickly and falling slowly is how a physical needle behaves, and it is what
 * makes the line feel attached to the sound.
 */
const RISE = 0.35;
const FALL = 0.08;

/** A resting ripple, so the line is never a dead straight rule. */
const FLOOR = 0.06;

export function VoiceWave({ level, active, className }: VoiceWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    /*
     * Honouring the system setting, because this is decoration and somebody who
     * has asked for less motion has asked for exactly this.
     */
    const stillness = window.matchMedia('(prefers-reduced-motion: reduce)');

    let frame = 0;
    let smoothed = 0;
    let phase = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const box = canvas.getBoundingClientRect();
      width = box.width;
      height = box.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = () => {
      frame = requestAnimationFrame(draw);

      const target = active() ? Math.max(level(), FLOOR) : FLOOR * 0.5;
      // Rise fast, fall slow - see RISE/FALL.
      smoothed += (target - smoothed) * (target > smoothed ? RISE : FALL);
      phase += stillness.matches ? 0.004 : 0.02;

      context.clearRect(0, 0, width, height);

      const middle = height / 2;
      const reach = (height / 2 - 2) * smoothed;

      for (const strand of STRANDS) {
        context.beginPath();

        /*
         * Stepped in twos rather than every pixel. At this thickness the
         * difference is invisible and it halves the work, which matters on the
         * phones this runs on more than the desktop it was written on.
         */
        for (let x = 0; x <= width; x += 2) {
          const across = x / width;
          /*
           * Tapered at both ends, so the strands emerge from nothing rather
           * than being cut off by the edge of the canvas. This is most of what
           * makes it look drawn rather than plotted.
           */
          const taper = Math.sin(across * Math.PI) ** 1.5;
          const y =
            middle +
            Math.sin(across * Math.PI * 2 * strand.frequency + phase * strand.speed) *
              reach *
              strand.amplitude *
              taper;
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }

        const gradient = context.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, 'rgba(120, 170, 255, 0)');
        gradient.addColorStop(0.5, `rgba(190, 220, 255, ${strand.alpha})`);
        gradient.addColorStop(1, 'rgba(120, 170, 255, 0)');

        context.strokeStyle = gradient;
        context.lineWidth = strand.width;
        context.lineCap = 'round';
        // The glow is the whole look. Without it these are five thin lines.
        context.shadowBlur = 12 * smoothed + 4;
        context.shadowColor = 'rgba(120, 170, 255, 0.65)';
        context.stroke();
      }
      context.shadowBlur = 0;
    };

    draw();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // Both inputs are read per frame and are stable by contract, so this runs
    // once for the life of the canvas - which is what keeps it smooth.
  }, [level, active]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      // Sized by CSS; the backing store is set from the box in `resize`.
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}
