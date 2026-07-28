import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Capacitor } from '@capacitor/core';

import { initNativeShell } from './features/native/shell.js';

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
 * No service worker inside the native shell.
 *
 * On the web it is what makes PINGO open offline, and it stays. In the Android
 * app the assets are already on the device, so it would only duplicate them —
 * and after an app update its cached copy can shadow the newly installed one,
 * leaving the app running an old build until somebody clears its storage.
 * Nobody would ever think to do that.
 *
 * Unregistered rather than never registered, because the registration is a
 * script tag injected at build time into the same index.html both platforms
 * load. Tearing it down here also cleans up after any build installed before
 * this ran.
 */
if (Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((all) => {
    for (const registration of all) void registration.unregister();
  });
  void caches?.keys().then((keys) => {
    for (const key of keys) void caches.delete(key);
  });
}
