/**
 * Where the finger landed, handed to the stylesheet.
 *
 * `.glass-lit` draws a soft light at `--lit-x` / `--lit-y` and spreads it on
 * `:active`. Everything about how that looks lives in CSS; the only thing CSS
 * cannot know is the coordinate, and this is the whole of the code that tells
 * it.
 *
 * ## One listener, not a prop on every control
 *
 * A hook returning an `onPointerDown` would mean touching each component and
 * threading a handler through anything that wraps a button. One delegated
 * listener finds the nearest lit surface from the event target instead, so a
 * surface opts in by carrying a class and nothing else.
 *
 * It also means no React state is involved at all. A press writes two custom
 * properties on one element; no render, no reconciliation, and nothing per
 * frame - the animation after that is the browser's.
 *
 * ## Capture, and passive
 *
 * Capture, so a control that stops propagation on its own pointerdown - the
 * bubbles do, to keep a tap from reaching the thread - still lights up.
 * Passive, because this never calls `preventDefault` and saying so lets the
 * browser start scrolling without waiting to find out.
 *
 * `pointerdown` covers mouse, touch and pen in one event, which is why there
 * is no touch-specific path here.
 */

/** Percentages, so the gradient follows the element if it is resized mid-press. */
function positionOn(surface: HTMLElement, clientX: number, clientY: number): void {
  const box = surface.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;

  surface.style.setProperty('--lit-x', `${((clientX - box.left) / box.width) * 100}%`);
  surface.style.setProperty('--lit-y', `${((clientY - box.top) / box.height) * 100}%`);
}

export function startPressLight(): () => void {
  const onPointerDown = (event: PointerEvent) => {
    const from = event.target;
    if (!(from instanceof Element)) return;

    /*
     * The nearest lit surface, which may be several levels up: pressing a dock
     * item lights the dock, and the item itself is not what carries the class.
     */
    const surface = from.closest('.glass-lit');
    if (surface instanceof HTMLElement) positionOn(surface, event.clientX, event.clientY);
  };

  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  };
}
