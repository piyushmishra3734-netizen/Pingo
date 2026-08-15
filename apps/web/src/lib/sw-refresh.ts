/**
 * Makes a long-lived tab notice that a new build exists.
 *
 * ## The measurement that produced this file
 *
 * Fifteen hours after a deploy that removed the single largest source of
 * egress, production was still running the old code: the query that fix
 * targets was still being called at 425 an hour, its unchanged historical
 * average, while the new endpoint that replaces it had barely been touched.
 * The fix was correct, deployed, and reaching nobody.
 *
 * The service worker is not the problem - it is built with `skipWaiting` and
 * `clientsClaim`, so it takes over the moment it installs. The problem is that
 * nothing asks whether there is one to install. The generated registration runs
 * `register()` once on `load`, and a chat app is precisely the thing people
 * never close: no navigation, no reload, no update check, for days.
 *
 * ## Two triggers, both cheap
 *
 * An hourly timer, and coming back to the tab. `update()` is a conditional
 * request for one file; when nothing has changed the answer is a 304 and the
 * cost is a few hundred bytes. Set against a stale build that was costing
 * megabytes an hour, that is not a trade worth thinking about.
 *
 * ## Why not prompt
 *
 * Because there is nothing to decide. `skipWaiting` was chosen deliberately
 * (see `vite.config.ts`) on the grounds that a reload at an awkward moment
 * beats running an old build indefinitely - this only makes that choice
 * actually happen.
 */

/** Long enough to be invisible, short enough that a fix lands the same day. */
const CHECK_MS = 60 * 60 * 1000;

export function keepServiceWorkerFresh(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  void navigator.serviceWorker.ready
    .then((registration) => {
      const check = () => {
        // A failed check is a check that happens again in an hour.
        void registration.update().catch(() => undefined);
      };

      window.setInterval(check, CHECK_MS);

      /*
       * Returning to the app is the moment worth checking.
       *
       * On a phone the tab is backgrounded rather than closed, so this is what
       * "opening PINGO" actually looks like - and it is the point at which a
       * reload costs the least, because the person has only just arrived.
       */
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    })
    .catch(() => undefined);
}
