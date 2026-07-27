import { useEffect, useRef, useState } from 'react';

/**
 * A number that counts up to its value.
 *
 * ## Why the DOM text is the final number from the first frame
 *
 * A screen reader announcing "0, 1, 4, 9, 17, 24 friends" is not a nicer
 * experience than "24 friends" — it is a worse one, and it is what `aria-live`
 * on a ticking number produces. So the accessible name is set once, to the
 * destination, and the animation happens in a decorative span beside it.
 *
 * ## Why it is time-based rather than per-frame
 *
 * Stepping by a fixed amount each frame makes the duration depend on the value:
 * 3 posts finishes in three frames and 182 photos takes three seconds. Easing
 * across a fixed duration means every number on the row lands together, which
 * is the only reason to animate them at all.
 *
 * Reduced motion skips it entirely — not a shorter animation, none.
 */

const DURATION_MS = 620;

/** Fast at first, settling at the end. The same curve as `--ease-standard`. */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function AnimatedCount({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = from.current;
    // Counting from the previous value, not from zero: a stat that goes 2 → 3
    // when a post is published should tick by one, not restart.
    const distance = value - start;
    if (distance === 0) return;

    const began = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - began) / DURATION_MS);
      setShown(Math.round(start + distance * easeOut(progress)));
      if (progress < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <>
      {/* The real number, for anything that reads rather than watches. */}
      <span className="sr-only">{value}</span>
      <span aria-hidden>{shown}</span>
    </>
  );
}
