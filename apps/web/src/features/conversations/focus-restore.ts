import { useEffect, useRef } from 'react';

/**
 * Sends focus back where it came from when a dialog closes.
 *
 * ## Why the obvious version is not enough
 *
 * Capturing `document.activeElement` and focusing it again on unmount works
 * only while that element still exists. On this screen it usually does not: the
 * thing that opened the sheet is a row in an overflow menu, inside a selection
 * bar that the action itself dismisses. By the time the sheet closes, the
 * button focus should return to has been unmounted, and calling `focus()` on a
 * detached node does nothing at all — quietly, with focus landing on `<body>`.
 *
 * A keyboard user then restarts from the top of the page, which is the exact
 * failure the restore was meant to prevent. So this checks the node is still in
 * the document and falls back to the closest thing that is: the region the
 * dialog was opened from.
 */

/** Where focus lands when the opener is gone. First match wins. */
const FALLBACKS = ['[role="listbox"]', '[role="toolbar"]', 'main', 'body'];

export function useReturnFocus(): void {
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;

    return () => {
      const previous = opener.current;

      // `isConnected` rather than a truthiness check: a detached element is a
      // perfectly good object that simply cannot take focus.
      if (previous?.isConnected) {
        previous.focus();
        return;
      }

      for (const selector of FALLBACKS) {
        const target = document.querySelector<HTMLElement>(selector);
        if (!target) continue;

        /*
         * A container is not normally focusable, so it is made so for exactly
         * this handover and released immediately after. Leaving `tabindex` on
         * it would insert a permanent stop in the tab order that nobody asked
         * for and no other screen has.
         */
        const hadTabIndex = target.hasAttribute('tabindex');
        if (!hadTabIndex) target.setAttribute('tabindex', '-1');
        target.focus();
        if (!hadTabIndex) target.removeAttribute('tabindex');
        return;
      }
    };
  }, []);
}
