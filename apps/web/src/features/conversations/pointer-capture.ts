/**
 * Pointer capture, without the throw.
 *
 * `setPointerCapture` and `releasePointerCapture` both raise `NotFoundError`
 * when the pointer is no longer active, and optional-calling them (`?.`) only
 * guards a *missing method* - not a throwing one.
 *
 * That distinction is the whole reason this file exists. An exception thrown
 * here lands inside a pointer handler, so the release path aborts before it can
 * commit the gesture or reset the element: the swipe silently does nothing and
 * the row stays stuck half-open with no way back. The pointer really can go away
 * mid-gesture - the browser takes the gesture over for a scroll or a back-swipe,
 * or a `pointercancel` beats the `pointerup` to it.
 *
 * Shared by the chat-row swipe and the message swipe so the two gestures cannot
 * drift apart on something this easy to get wrong in one place and not the other.
 */

/**
 * Failing to capture is survivable: the gesture still tracks the pointer, it
 * just stops following one that leaves the element. Nothing to report.
 */
export function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    /* Pointer already gone; the gesture continues uncaptured. */
  }
}

export function releasePointer(element: Element, pointerId: number): void {
  try {
    element.releasePointerCapture(pointerId);
  } catch {
    /* Never captured, or already released. There is nothing to undo. */
  }
}
