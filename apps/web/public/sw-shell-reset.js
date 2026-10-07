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
  event.waitUntil(
    Promise.all([
      caches.delete('pingo-shell'),
      /*
       * An HTML page kept in the precache under an asset's name. Workbox
       * fills the precache at install without looking at what came back, so
       * an install that raced a deploy could keep the fallback page as this
       * build's stylesheet or entry script.
       * Deleting the entry is enough: a precache miss goes to the network.
       */
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('workbox-precache'))
            .map((name) =>
              caches.open(name).then((cache) =>
                cache.keys().then((requests) =>
                  Promise.all(
                    requests.map((request) => {
                      if (!/\.(?:js|css|woff2)(?:$|\?)/.test(request.url)) return undefined;
                      return cache.match(request).then((response) => {
                        const type = (response && response.headers.get('content-type')) || '';
                        return type.includes('text/html') ? cache.delete(request) : undefined;
                      });
                    }),
                  ),
                ),
              ),
            ),
        ),
      ),
      /*
       * And any HTML page kept under a script's name. Before the chunk route
       * refused them, a missing file's fallback page could be stored as that
       * script, and the app never started on that device again.
       */
      caches.open('pingo-chunks').then((cache) =>
        cache.keys().then((requests) =>
          Promise.all(
            requests.map((request) =>
              cache.match(request).then((response) => {
                const type = (response && response.headers.get('content-type')) || '';
                return type.includes('text/html') ? cache.delete(request) : undefined;
              }),
            ),
          ),
        ),
      ),
    ]),
  );
});
