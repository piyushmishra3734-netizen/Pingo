import { useLayoutEffect } from 'react';

/**
 * The launch splash, from the app's side.
 *
 * The splash itself lives in index.html - the PINGO mark on the app's ground,
 * painted in the first frame with nothing to download - so it is there before
 * this bundle has even arrived. What this file decides is when it goes.
 *
 * It goes the moment nothing is still opening. Every screen that stands for "not
 * ready yet" (the route that decides where to send you, the auth check, the
 * shell waiting for chats, a lazy screen in flight) calls `useSplashHold()`
 * while it is up; when the last of them is gone the splash swells and fades
 * into whatever is there. No minimum time: on a fast phone that is one spring
 * of the logo, on a slow one the logo keeps a light passing along it instead.
 *
 * Once it has gone it never comes back. The holds after that do nothing, so a
 * later loading state is only ever that screen's own.
 */

type SplashApi = { done: () => void; gone: boolean };

declare global {
  interface Window {
    __pingoSplash?: SplashApi;
  }
}

let holds = 0;
let checking = false;

function check() {
  if (checking) return;
  checking = true;
  // Two frames: whatever replaced the hold has been laid out and painted underneath.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      checking = false;
      if (holds === 0) window.__pingoSplash?.done();
    }),
  );
}

/** Called once the app has mounted: if nothing holds the splash by then, it goes. */
export function releaseSplash() {
  if (typeof window !== 'undefined') check();
}

/** Keeps the splash up while the calling screen is mounted (and `active`). */
export function useSplashHold(active = true) {
  useLayoutEffect(() => {
    if (!active || typeof window === 'undefined' || window.__pingoSplash?.gone !== false) return;
    holds += 1;
    return () => {
      holds -= 1;
      check();
    };
  }, [active]);
}
