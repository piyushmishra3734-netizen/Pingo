/**
 * Makes a new build actually reach a tab that never closes.
 *
 * ## What was measured
 *
 * Fifteen hours after a deploy that removed the largest source of egress,
 * production was still running the old code: the query that fix targets was
 * still being called at its unchanged historical rate, while the endpoint
 * replacing it had barely been touched.
 *
 * ## The blocker, found rather than guessed
 *
 * Three candidates were checked and two cleared. `sw.js` is served
 * `max-age=0, must-revalidate`, so an update check genuinely reaches the
 * origin - caching was not it. The worker is built with `skipWaiting` and
 * `clientsClaim`, so a new one takes over the moment it installs - the
 * lifecycle was not it either.
 *
 * What was missing is the last step. A new worker taking over changes which
 * worker answers *future* requests; it does nothing about the JavaScript
 * already parsed and running in the tab. Without a reload the page keeps
 * executing the old bundle for as long as it stays open, which for a chat app
 * is days. Nothing in the codebase listened for `controllerchange`.
 *
 * So: check for a new worker, and when one takes over, reload - once, and at a
 * moment nobody notices.
 *
 * ## Why reloading is safe here
 *
 * Everything that would hurt to lose is already on disk before this runs.
 * Drafts, the outbox, local messages, the media vault and this device's keys
 * are all in IndexedDB; the session is in the Supabase client's own storage.
 * A reload costs in-memory UI state - scroll position, an open sheet - and
 * nothing else. It is deliberately not attempted while the tab is in front of
 * somebody, so even that is not felt.
 */

/** Long enough to be invisible, short enough that a fix lands the same day. */
const CHECK_MS = 60 * 60 * 1000;

/**
 * Set for the life of the tab once it has reloaded itself.
 *
 * `sessionStorage` rather than a variable, because the flag has to survive the
 * very reload it is guarding - a variable would be reset by it, and a worker
 * that claims clients again on the next load would reload again, forever.
 */
const RELOADED = 'pingo.sw.reloaded';

export function keepServiceWorkerFresh(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  /*
   * A worker took over. The bundle in memory is now the previous build.
   *
   * Fires only when the controller actually changes, which after the first
   * install means a genuinely new deploy - not every load.
   */
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    reloadWhenUnwatched();
  });

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
       * "opening PINGO" actually looks like.
       */
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });

      check();
    })
    .catch(() => undefined);
}

/**
 * Reloads the moment nobody is looking, and never twice.
 *
 * Hidden already - the person has switched away - means now. Otherwise it
 * waits for them to leave, so the update happens between glances rather than
 * under a thumb mid-sentence. A tab that is never hidden simply keeps running
 * the old build until it is, which is the honest trade: correctness matters,
 * but not enough to yank a conversation out from under somebody.
 */
function reloadWhenUnwatched(): void {
  try {
    if (sessionStorage.getItem(RELOADED)) return;
  } catch {
    // Private mode with storage disabled: better to skip than to loop.
    return;
  }

  const go = () => {
    try {
      sessionStorage.setItem(RELOADED, '1');
    } catch {
      return;
    }
    window.location.reload();
  };

  if (document.visibilityState === 'hidden') {
    go();
    return;
  }

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') go();
    },
    { once: true },
  );
}
