import { cn } from '../utils/cn.js';

/**
 * Waiting, as a ping.
 *
 * ## Why this replaced the orbiting dot
 *
 * The old loader took the brand dot and flew it in a circle around the P. Two
 * problems, and the second is the real one. It looked like a spinner wearing a
 * logo — the most generic gesture in software, dressed up. And it *animated the
 * mark*: the dot is part of the logo, and moving a piece of a logo around the
 * rest of it is the one thing a mark is not allowed to do.
 *
 * A ping is what the product is named after and what a sonar pulse actually
 * looks like: something leaves, expands, fades, and another follows. It says
 * "reaching out, waiting for an answer", which is precisely what loading *is*
 * here — and it belongs to PINGO in a way a rotating arc never could.
 *
 * ## Why the rings are staggered rather than synchronised
 *
 * One ring on its own reads as a heartbeat and stops feeling like progress.
 * Three at a third of a cycle apart mean there is always one mid-flight, so the
 * eye reads continuous outward motion without anything spinning.
 *
 * ## The dot at the centre does not move
 *
 * It pulses very slightly and stays put. Everything that travels is a ring
 * *emitted by* it, so the brand element itself is never in motion — which is
 * the rule the old one broke.
 *
 * Reduced motion gets a still dot and no rings. Not a slower animation: someone
 * who has asked for less movement is not asking for the same movement, gently.
 */

export interface PingoLoaderProps {
  /** Diameter in px of the whole thing, rings included. */
  size?: number;
  /** Announced to assistive tech. The visible caption is the caller's job. */
  label?: string;
  className?: string;
}

export function PingoLoader({ size = 44, label = 'Loading', className }: PingoLoaderProps) {
  /*
   * The dot is a third of the span, so the rings have room to travel a full
   * radius before they fade. Any larger and they clip the moment they appear.
   */
  const dot = size * 0.3;

  return (
    <span
      role="status"
      aria-label={label}
      className={cn('relative inline-grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          aria-hidden
          className={cn(
            'absolute rounded-full',
            'bg-brand-gradient',
            'motion-safe:animate-ping-ripple motion-reduce:hidden',
          )}
          style={{
            width: dot,
            height: dot,
            // A third of the cycle apart, so one is always mid-flight.
            animationDelay: `${index * 500}ms`,
          }}
        />
      ))}

      <span
        aria-hidden
        className={cn(
          'relative rounded-full bg-brand-gradient',
          'motion-safe:animate-ping-core',
        )}
        style={{ width: dot, height: dot }}
      />
    </span>
  );
}
