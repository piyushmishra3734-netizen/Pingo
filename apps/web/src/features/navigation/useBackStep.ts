import { useEffect, useRef } from 'react';

/**
 * Back closes the thing you opened, not the page you opened it from.
 *
 * ## The bug this exists for
 *
 * Sheets, menus, viewers, editors and in-place panels are opened by flipping a
 * boolean, and a boolean is invisible to history. So the phone's Back button -
 * and the browser's - popped the *route* underneath: open a group, open its
 * info, look at the description, press Back, and you are on the chat list with
 * three things closed at once. Every layer in the product had that shape, so
 * every one of them had the same fault.
 *
 * ## One entry for the whole stack, not one each
 *
 * While anything is open there is exactly one extra history entry. Back pops
 * it, the topmost layer closes, and if something is still open the entry is put
 * back. Closing from inside the app takes it away again, so the next Back goes
 * where it would have gone if nothing had ever been opened.
 *
 * One shared entry rather than one per layer, because layers swap as often as
 * they nest: a sheet that replaces a sibling sheet unmounts *and* mounts in the
 * same commit, and with an entry each that is a pop racing a push - the arriving
 * sheet closes itself a frame after opening. A stack has nothing to race: the
 * departing layer leaves the stack, the arriving one joins it, and the entry
 * never moves.
 *
 * Nothing about the URL changes. These are steps within a page, not pages, and
 * a URL that changed would be a link somebody could share to a half-open sheet.
 *
 * ## Use it for anything that reads as a screen
 *
 * A full-screen overlay, a bottom sheet, a menu - and also a panel *inside* one
 * of those, or a mode a screen enters, which is why it takes a flag rather than
 * being tied to mounting. Editing a group's description is not the group's
 * info; the camera's editor is not the camera; selecting chats is not the chat
 * list. Back should say so in each case.
 */

interface Step {
  run: () => void;
}

/** Open layers, innermost last. Module-level: there is one history to own. */
const stack: Step[] = [];

/** Whether our entry is currently sitting on top of the history stack. */
let entryOpen = false;

function ensureEntry(): void {
  if (entryOpen) return;
  window.history.pushState({ pingoStep: true }, '');
  entryOpen = true;
}

function releaseEntry(): void {
  if (!entryOpen) return;
  const state = window.history.state as { pingoStep?: boolean } | null;
  entryOpen = false;
  /*
   * Only if it is still ours to take back. A layer that closed itself while
   * navigating somewhere - a row that opens a profile as it closes its sheet -
   * leaves our entry buried under the new route, and going back then would
   * undo the navigation the user just asked for.
   */
  if (state?.pingoStep) window.history.back();
}

function onPop(): void {
  if (!entryOpen) return;
  entryOpen = false;

  const top = stack[stack.length - 1];
  top?.run();

  // Something is still open underneath - it needs an entry of its own to be
  // closed by the next press.
  if (stack.length > 1) ensureEntry();
}

let listening = false;

export function useBackStep(active: boolean, onBack: () => void): void {
  /*
   * Held in a ref so a caller can pass an inline arrow function without
   * re-registering on every render - which would churn the stack and make Back
   * feel like it does nothing several times in a row.
   */
  const handler = useRef(onBack);
  handler.current = onBack;

  useEffect(() => {
    if (!active) return;

    if (!listening) {
      window.addEventListener('popstate', onPop);
      listening = true;
    }

    const step: Step = { run: () => handler.current() };
    stack.push(step);
    ensureEntry();

    return () => {
      const index = stack.indexOf(step);
      if (index >= 0) stack.splice(index, 1);

      /*
       * Deferred by a microtask, and this is the whole reason the stack exists.
       * A sheet being replaced by another unmounts before the replacement
       * mounts; releasing the entry here and now would drop it a moment before
       * the new layer asks for one. By the time the microtask runs, everything
       * in this commit has had its say.
       */
      queueMicrotask(() => {
        if (stack.length === 0) releaseEntry();
      });
    };
  }, [active]);
}
