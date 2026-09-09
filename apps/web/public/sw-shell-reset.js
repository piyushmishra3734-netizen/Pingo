/*
 * Runs inside the service worker, before workbox sets its routes up.
 *
 * `cleanupOutdatedCaches` handles the precache and nothing else. `pingo-shell`
 * is a runtime cache, so it survives every update - and it is the one holding
 * the HTML that names which JavaScript to load. A worker that installs a new
 * build and keeps the old shell has updated everything except the part that
 * decides what runs.
 *
 * Activation is the right moment: it happens once per new worker, after the
 * new precache is populated, so the next navigation either reaches the network
 * for fresh HTML or - if it cannot - falls back to the precached copy from
 * this build rather than the runtime copy from the last one.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('pingo-shell'));
});
