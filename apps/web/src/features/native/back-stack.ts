/**
 * Who gets the Android back button first.
 *
 * `native/shell.ts` asks `runBackHandlers()` before it falls back to
 * `history.back()`. A screen that wants back to mean something else (the TV
 * player: leave full screen, then "press back again to exit") pushes a handler
 * here and returns true when it dealt with the press.
 *
 * This is needed rather than a `popstate` listener for the player because the
 * film is often another site's page in a frame, and that page's own navigations
 * join the tab's history: `history.back()` then goes back *inside the frame*,
 * and the app never hears about it.
 */
const handlers: Array<() => boolean> = [];

/** Newest first. Returns the function that removes it. */
export function pushBackHandler(handler: () => boolean): () => void {
  handlers.push(handler);
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/** True when some screen handled the back press. */
export function runBackHandlers(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]!()) return true;
  }
  return false;
}
