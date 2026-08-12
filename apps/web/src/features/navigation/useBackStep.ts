import { useEffect, useRef } from 'react';

/**
 * Back closes the thing you opened, not the page you opened it from.
 *
 * ## The bug this exists for
 *
 * Sheets, menus, viewers and editors were opened by flipping a boolean, and a
 * boolean is invisible to history. So the phone's Back button - and the
 * browser's - popped the *route* underneath: open a group, open its info,
 * press Back, and you are on the chat list with three things closed at once.
 * Every layer in the product had the same shape, so every one of them had the
 * same fault.
 *
 * ## What it does instead
 *
 * Anything open pushes one history entry of its own. Back pops that entry,
 * which runs `onBack` and leaves the route alone; closing from inside the app
 * takes the entry away again, so the next Back goes where it would have gone if
 * the layer had never been opened. Nothing about the URL changes: these are
 * steps within a page, not pages, and a URL that changed would be a link
 * somebody could share to a half-open sheet.
 *
 * ## Layers on top of layers
 *
 * Every step is numbered, and a pop is answered only by the step that was on
 * top. Without that, a sheet opened over a sheet would hear the same `popstate`
 * as the one underneath and both would close - which is the original bug in
 * miniature, one layer down.
 *
 * ## Use it for anything that reads as a screen
 *
 * A full-screen overlay, a bottom sheet, a menu - and also a panel *inside* one
 * of those, which is why it takes a flag rather than being tied to mounting.
 * Editing a group's description is not the group's info, and Back should say so.
 */

let steps = 0;

export function useBackStep(active: boolean, onBack: () => void): void {
  /*
   * Held in a ref so a caller can pass an inline arrow function without
   * pushing a fresh history entry on every render - which would fill history
   * with duplicates and make Back feel like it does nothing several times.
   */
  const handler = useRef(onBack);
  handler.current = onBack;

  useEffect(() => {
    if (!active) return;

    steps += 1;
    const id = steps;
    window.history.pushState({ pingoStep: id }, '');

    let popped = false;
    const listener = () => {
      const state = window.history.state as { pingoStep?: number } | null;
      // Still above us: something opened later owns this press.
      if (state?.pingoStep === id) return;
      popped = true;
      handler.current();
    };

    window.addEventListener('popstate', listener);

    return () => {
      window.removeEventListener('popstate', listener);
      if (popped) return;

      /*
       * Closed from inside the app - a tap on the scrim, a Done button,
       * Escape. The entry is still sitting in history and would otherwise
       * swallow the next Back, so it is taken back out.
       *
       * Unless the app has navigated on top of it: a row that closes a sheet
       * and opens a profile in the same breath leaves our entry buried, and
       * going back then would undo the navigation the user asked for.
       */
      const state = window.history.state as { pingoStep?: number } | null;
      if (state?.pingoStep === id) window.history.back();
    };
  }, [active]);
}
