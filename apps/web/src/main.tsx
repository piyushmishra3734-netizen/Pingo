import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Capacitor } from '@capacitor/core';

import { initNativeShell } from './features/native/shell.js';
import { trackVisibleViewport } from './features/native/visible-viewport.js';
import { requestPersistentStorage } from './lib/local/db.js';
import { keepServiceWorkerFresh } from './lib/sw-refresh.js';

import { App } from './App.js';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * Opened with no internet, and songs on the phone: PINGO Music's downloads
 * come up first, over the app, the way YouTube opens offline. The app itself
 * still starts underneath, so "Open PINGO" is instant.
 *
 * The check is a localStorage read and the page is its own chunk, so a phone
 * that is online, or has nothing downloaded, pays nothing for it.
 */
function hasMusicDownloads(): boolean {
  try {
    return Object.keys(JSON.parse(localStorage.getItem('pingo:music-downloads:v1') ?? '{}') as object).length > 0;
  } catch {
    return false;
  }
}
if (navigator.onLine === false && hasMusicDownloads()) {
  void import('./features/music/app/OfflineMusic.js').then(({ default: OfflineMusic }) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      <StrictMode>
        <OfflineMusic
          onClose={() => {
            root.unmount();
            host.remove();
          }}
        />
      </StrictMode>,
    );
  });
}

/*
 * The OS behaviours, once the app is mounted.
 *
 * After render rather than before, because the splash is hidden in here and
 * hiding it earlier would reveal an empty root. On the web every call inside
 * is skipped, so this costs a function call and nothing else.
 *
 * The back handler returns false for now: nothing has claimed the gesture, so
 * history and then backgrounding are the correct fallbacks. Screens that open
 * a sheet will claim it here rather than each binding their own listener.
 */
void initNativeShell(() => false);

/*
 * The keyboard, in a mobile browser: keep the layout the height of what is on
 * screen, so the composer sits above the keyboard instead of under it. The
 * native app resizes its WebView itself and does not need this.
 */
if (!Capacitor.isNativePlatform()) trackVisibleViewport();

/*
 * And notice when a new build exists.
 *
 * Registration happens once on load and never asks again, which is how a
 * deploy that removed the largest source of egress was still reaching nobody
 * fifteen hours later. See `sw-refresh.ts`.
 */
keepServiceWorkerFresh();

/*
 * Ask to keep what is on disk.
 *
 * Local-first only means anything if local survives. Without this the browser
 * treats the origin as best-effort and may evict it under disk pressure  - 
 * which would take the sealed cache, the outbox, and this device's keys with
 * it, and losing the keys is not recoverable from the server by design.
 *
 * Fire and forget: the browser may refuse, and the app works either way.
 */
void requestPersistentStorage();

/*
 * No service worker inside the native shell.
 *
 * On the web it is what makes PINGO open offline, and it stays. In the Android
 * app the assets are already on the device, so it would only duplicate them  - 
 * and after an app update its cached copy can shadow the newly installed one,
 * leaving the app running an old build until somebody clears its storage.
 * Nobody would ever think to do that.
 *
 * Unregistered rather than never registered, because the registration is a
 * script tag injected at build time into the same index.html both platforms
 * load. Tearing it down here also cleans up after any build installed before
 * this ran.
 *
 * Its caches go with it, and only when there was a worker to remove: they are
 * the worker's copy of the app. Nothing is cleared on an ordinary launch, and
 * nothing that is not the app's own code is cleared at all. What somebody
 * downloaded or has already seen stays until they clear it themselves, in
 * Settings > Storage.
 */
if (Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then(async (all) => {
    if (!all.length) return;
    await Promise.all(all.map((registration) => registration.unregister()));
    const keys = (await caches?.keys().catch(() => [] as string[])) ?? [];
    for (const key of keys) {
      if (key.startsWith('workbox-precache') || key === 'pingo-chunks' || key === 'pingo-shell') void caches.delete(key);
    }
  });
}
