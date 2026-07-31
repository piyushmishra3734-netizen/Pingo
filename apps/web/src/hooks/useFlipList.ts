import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Makes a reordering list move rather than jump.
 *
 * ## What it is fixing
 *
 * When a message arrives, its conversation jumps to the top of the list and
 * every row below shuffles down - instantly, in one frame. Nothing tells you
 * *which* row moved or where it came from, so a list you were reading
 * rearranges itself under your eyes and you have to find your place again.
 * It is the single most common moment in the product and the least explained.
 *
 * ## FLIP
 *
 * First, Last, Invert, Play. Measure where everything was, let React paint
 * where everything now is, then transform each row *back* to where it started
 * and animate that transform away. The browser only ever lays out once; the
 * motion is a compositor-only transform on top of the finished layout, which
 * is why this stays smooth on a list of any length.
 *
 * Running in `useLayoutEffect` is what makes it work: it fires after the DOM
 * has changed and before the browser paints, so the inverted position is the
 * first thing on screen and the row is never seen in its new place.
 *
 * ## Only vertical, and only what moved
 *
 * A chat list reorders on one axis, so measuring `top` alone halves the work.
 * Rows whose position did not change are skipped entirely rather than animated
 * by zero, which keeps a list that merely re-rendered from spawning an
 * animation per row.
 *
 * ## Deliberately not animating arrivals or departures
 *
 * A row that was not there before has no previous position to travel from, and
 * inventing one would make every new conversation fly in from an arbitrary
 * place. Those already have `animate-row-in`; this is only about things that
 * moved.
 */

/** Matches the app's standard easing. Motion that reorders is still motion. */
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const DURATION = 280;

export function useFlipList(
  container: RefObject<HTMLElement | null>,
  /**
   * The ordered ids, joined. Passed as a string so the effect compares by value
   * rather than by array identity - a parent re-render that produces an
   * equivalent array must not replay the animation.
   */
  order: string,
): void {
  const previous = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;

    const nodes = root.querySelectorAll<HTMLElement>('[data-flip-id]');
    const next = new Map<string, number>();

    /*
     * Measured in one pass before anything is written.
     *
     * Interleaving reads and writes here would force a synchronous layout per
     * row - the classic layout thrash, and on a long list it is the difference
     * between a smooth reorder and a visible stall.
     */
    for (const node of nodes) {
      const id = node.dataset.flipId;
      if (id) next.set(id, node.getBoundingClientRect().top);
    }

    for (const node of nodes) {
      const id = node.dataset.flipId;
      if (!id) continue;

      const before = previous.current.get(id);
      const after = next.get(id);
      if (before === undefined || after === undefined) continue;

      const delta = before - after;
      // Sub-pixel shifts are rounding, not movement.
      if (Math.abs(delta) < 1) continue;

      node.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        {
          duration: DURATION,
          easing: EASING,
          /*
           * Replaces any animation still running on this row. Without it, a
           * list that reorders twice quickly leaves two transforms fighting and
           * the row lands somewhere neither of them intended.
           */
          composite: 'replace',
        },
      );
    }

    previous.current = next;
  }, [container, order]);
}
